package com.memoweft.weftmate.mobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import org.json.JSONArray
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class HostIdentity(val origin: String, val username: String, val ownerId: String,
    val hostId: String, val deviceId: String, val cookie: String, val csrf: String,
    val authSource: String = "local")
data class ModelSettings(val endpoint: String, val modelId: String, val apiKey: String,
    val displayName: String = modelId, val serviceId: String? = null, val interfaceType: String = "openai-compatible")
data class ModelImportResult(val status: String, val model: ModelSettings? = null)

internal fun hostAuthenticationSource(body: JSONObject, hasCloudCredentials: Boolean): String =
    body.optString("authSource").ifBlank { if (hasCloudCredentials) "cloud" else "local" }

/** Passwords never enter preferences. The credential blobs are AES-GCM encrypted with an AndroidKeyStore key. */
class SecureSettings(context: Context, storageName: String = "private-settings", keyAlias: String = "weftmate-mobile-v1") {
    private val prefs = context.getSharedPreferences(storageName, Context.MODE_PRIVATE)
    private val alias = keyAlias
    init {
        // Background sync also constructs SecureSettings before opening any host connection.
        JSONObject(cloudValue("pins") ?: "{}").let { pins ->
            for (origin in pins.keys()) CloudPins.install(origin, pins.getString(origin))
        }
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build())
        return generator.generateKey()
    }

    private fun encrypt(text: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val joined = cipher.iv + cipher.doFinal(text.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(joined, Base64.NO_WRAP)
    }

    private fun decrypt(value: String): String {
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        require(bytes.size > 28)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
    }

    @Synchronized fun saveCloudValue(name: String, value: String?) {
        require(name in setOf("login", "result", "callback", "state", "tokens", "pins"))
        val editor = prefs.edit()
        if (value == null) editor.remove("cloud-$name") else editor.putString("cloud-$name", encrypt(value))
        check(editor.commit())
    }
    fun cloudValue(name: String): String? = prefs.getString("cloud-$name", null)?.let { decrypt(it) }

    /** Separate namespace: legacy cloud.tokens cannot read native app refresh credentials. */
    @Synchronized internal fun saveAppValue(name: String, value: String?) {
        val editor = prefs.edit()
        if (value == null) editor.remove("app-cloud:$name") else editor.putString("app-cloud:$name", encrypt(value))
        check(editor.commit())
    }
    internal fun appValue(name: String): String? = prefs.getString("app-cloud:$name", null)?.let { decrypt(it) }

    @Synchronized fun saveHost(value: HostIdentity) {
        captureLegacyOwner()
        ensureMigrated()
        val body = JSONObject().put("origin", value.origin).put("username", value.username)
            .put("ownerId", value.ownerId).put("hostId", value.hostId)
            .put("deviceId", value.deviceId).put("cookie", value.cookie).put("csrf", value.csrf)
            .put("authSource", value.authSource)
        check(prefs.edit().putString("host", encrypt(body.toString())).commit())
    }

    fun host(): HostIdentity? {
        val raw = prefs.getString("host", null) ?: return null
        val body = JSONObject(decrypt(raw))
        return HostIdentity(body.getString("origin"), body.getString("username"),
            body.getString("ownerId"), body.getString("hostId"), body.getString("deviceId"),
            body.getString("cookie"), body.getString("csrf"), hostAuthenticationSource(body,
                JSONObject(appValue("credentials") ?: "{}").keys().asSequence().any { it.startsWith("app-tokens:") }
                    || !cloudValue("tokens").isNullOrBlank()))
    }

    @Synchronized fun clearHost() { captureLegacyOwner(); ensureMigrated(); check(prefs.edit().remove("host").commit()) }

    @Synchronized fun legacyOwnerScope(): String? {
        captureLegacyOwner()
        return prefs.getString("legacy_owner_scope", null)
    }

    @Synchronized private fun captureLegacyOwner() {
        if (prefs.getBoolean("legacy_owner_captured", false)) return
        val previous = host()
        val editor = prefs.edit().putBoolean("legacy_owner_captured", true)
        if (previous != null) editor.putString("legacy_owner_scope", Endpoints.ownerKey(previous.origin, previous.ownerId))
        check(editor.commit())
    }

    private data class ModelEntry(val id: String, val label: String, val enabled: Boolean = true,
        val lastUsedAt: Long = 0, val manual: Boolean = true, val capabilities: JSONObject? = null,
        val deepThinking: JSONObject? = null, val deepThinkingEnabled: Boolean = false)
    private data class Provider(val endpoint: String, val apiKey: String, val models: List<ModelEntry>,
        val serviceId: String = UUID.randomUUID().toString(), val name: String = phoneServiceDisplayName(endpoint),
        val interfaceType: String = "openai-compatible", val catalogStatus: String = "not_checked", val checkedAt: Long = 0)
    private data class Library(val providers: List<Provider>, val activeEndpoint: String?, val activeModelId: String?,
        val activeServiceId: String? = null)
    private fun canonical(endpoint: String) = Endpoints.modelUrl(endpoint)
    fun activeModelScope(): String = host()?.let { Endpoints.ownerKey(it.origin, it.ownerId) } ?: "local"
    private fun checkedScope(scope: String): String {
        require(scope == "local" || scope.matches(Regex("[a-f0-9]{64}")))
        return scope
    }
    private fun scopedKey(scope: String) = "models_v3:${checkedScope(scope)}"
    @Synchronized fun saveProfile(scope: String, profile: JSONObject) {
        val value = profile.toString()
        require(value.length <= 200_000)
        check(prefs.edit().putString("profile_v1:${checkedScope(scope)}", encrypt(value)).commit())
    }
    @Synchronized fun cachedProfile(scope: String): JSONObject? {
        val raw = prefs.getString("profile_v1:${checkedScope(scope)}", null) ?: return null
        return JSONObject(decrypt(raw))
    }

    /** One-time migration assigns old global credentials only to the account active before a switch. */
    private fun legacyLibrary(): Library {
        val raw = prefs.getString("models_v2", null)
        if (raw == null) {
            val legacy = prefs.getString("model", null) ?: return Library(emptyList(), null, null)
            val body = JSONObject(decrypt(legacy))
            val model = ModelSettings(body.getString("endpoint"), body.getString("modelId"), body.getString("apiKey"))
            canonical(model.endpoint)
            return Library(listOf(Provider(model.endpoint, model.apiKey, listOf(ModelEntry(model.modelId, model.modelId)))), model.endpoint, model.modelId)
        }
        return parseLibrary(raw)
    }

    private fun parseLibrary(raw: String): Library {
        val body = JSONObject(decrypt(raw))
        require(body.getInt("version") == 1)
        val entries = body.getJSONArray("providers")
        val providers = mutableListOf<Provider>()
        val seen = mutableSetOf<String>()
        for (index in 0 until entries.length()) {
            val row = entries.getJSONObject(index)
            val endpoint = row.getString("endpoint")
            val key = row.getString("apiKey")
            val serviceId = row.optString("serviceId").ifBlank {
                "phone-" + MessageDigest.getInstance("SHA-256").digest(canonical(endpoint).toByteArray())
                    .take(12).joinToString("") { "%02x".format(it) }
            }
            require(key.length <= 4096 && seen.add(serviceId))
            val ids = row.getJSONArray("models")
            val names = (0 until ids.length()).map { rowIndex ->
                val item = ids.getJSONObject(rowIndex)
                ModelEntry(item.getString("id"), item.getString("label"), item.optBoolean("enabled", true),
                    item.optLong("lastUsedAt"), item.optBoolean("manual", true), item.optJSONObject("capabilities"),
                    item.optJSONObject("deepThinking"), item.optBoolean("deepThinkingEnabled"))
            }
            require(names.map { it.id }.distinct().size == names.size && names.all {
                it.id.matches(Regex("[A-Za-z0-9._:/-]{1,128}")) && it.label.isNotBlank() && it.label.length <= 100
            })
            providers += Provider(endpoint, key, names, serviceId, row.optString("name").ifBlank { phoneServiceDisplayName(endpoint) },
                row.optString("interfaceType", "openai-compatible"), row.optString("catalogStatus", "not_checked"), row.optLong("checkedAt"))
        }
        val activeEndpoint = body.optString("activeEndpoint").takeIf { it.isNotBlank() }
        val activeModelId = body.optString("activeModelId").takeIf { it.isNotBlank() }
        require((activeEndpoint == null) == (activeModelId == null))
        if (activeEndpoint != null) require(providers.any { canonical(it.endpoint) == canonical(activeEndpoint) && it.models.any { item -> item.id == activeModelId } })
        return Library(providers, activeEndpoint, activeModelId, body.optString("activeServiceId").takeIf { it.isNotBlank() })
    }

    @Synchronized private fun ensureMigrated() {
        captureLegacyOwner()
        if (prefs.getBoolean("models_v3_migrated", false)) return
        val scope = activeModelScope()
        val legacy = legacyLibrary()
        val editor = prefs.edit().putBoolean("models_v3_migrated", true)
            .remove("models_v2").remove("model")
        for (name in listOf("models_v2", "model")) prefs.getString(name, null)?.let {
            editor.putString("${name}_service_backup", it)
        }
        if (legacy.providers.isNotEmpty()) editor.putString(scopedKey(scope), encrypt(serialize(legacy)))
        check(editor.commit())
    }

    private fun library(scope: String): Library {
        ensureMigrated()
        val raw = prefs.getString(scopedKey(scope), null) ?: return Library(emptyList(), null, null)
        return try { parseLibrary(raw) } catch (error: Exception) {
            val backup = prefs.getString("models_service_backup:${checkedScope(scope)}", null) ?: throw error
            parseLibrary(backup)
        }
    }

    private fun serialize(value: Library): String {
        val rows = JSONArray()
        for (provider in value.providers) {
            val models = JSONArray()
            for (item in provider.models) models.put(JSONObject().put("id", item.id).put("label", item.label)
                .put("enabled", item.enabled).put("lastUsedAt", item.lastUsedAt).put("manual", item.manual)
                .put("capabilities", item.capabilities ?: JSONObject.NULL).put("deepThinking", item.deepThinking ?: JSONObject.NULL)
                .put("deepThinkingEnabled", item.deepThinkingEnabled))
            rows.put(JSONObject().put("endpoint", provider.endpoint).put("apiKey", provider.apiKey).put("models", models)
                .put("serviceId", provider.serviceId).put("name", provider.name).put("interfaceType", provider.interfaceType)
                .put("catalogStatus", provider.catalogStatus).put("checkedAt", provider.checkedAt))
        }
        val body = JSONObject().put("version", 1).put("providers", rows)
            .put("activeEndpoint", value.activeEndpoint ?: "").put("activeModelId", value.activeModelId ?: "")
            .put("activeServiceId", value.activeServiceId ?: "")
        return body.toString()
    }

    private fun persist(value: Library, scope: String) {
        val previous = prefs.getString(scopedKey(scope), null)
        val backupKey = "models_service_backup:${checkedScope(scope)}"
        // Copy the existing encrypted blob before replacing it; failed commits keep the old library usable.
        if (previous != null && !prefs.contains(backupKey)) check(prefs.edit().putString(backupKey, previous).commit())
        val editor = prefs.edit()
        editor.putString(scopedKey(scope), encrypt(serialize(value)))
        if (!editor.commit()) {
            val rollback = prefs.edit()
            if (previous == null) rollback.remove(scopedKey(scope)) else rollback.putString(scopedKey(scope), previous)
            rollback.commit()
            error("MODEL_SERVICE_SAVE_FAILED")
        }
    }

    @Synchronized fun model(scope: String = activeModelScope()): ModelSettings? {
        val value = library(scope)
        val endpoint = value.activeEndpoint ?: return null
        val profile = value.providers.find { if (value.activeServiceId != null) it.serviceId == value.activeServiceId
            else canonical(it.endpoint) == canonical(endpoint) } ?: return null
        val selectedId = value.activeModelId ?: return null
        val label = profile.models.find { it.id == selectedId }?.label ?: selectedId
        return ModelSettings(profile.endpoint, selectedId, profile.apiKey, label, profile.serviceId, profile.interfaceType)
    }

    /** Returns only entries saved by this phone. A catalog response is not silently persisted. */
    @Synchronized fun modelProfiles(scope: String = activeModelScope()): List<ModelSettings> = library(scope).providers.flatMap { provider ->
        provider.models.map { ModelSettings(provider.endpoint, it.id, provider.apiKey, it.label, provider.serviceId, provider.interfaceType) }
    }

    @Synchronized fun saveModel(value: ModelSettings, scope: String = activeModelScope()): ModelSettings {
        val endpoint = value.endpoint.trim().trimEnd('/')
        val identity = canonical(endpoint)
        require(value.modelId.matches(Regex("[A-Za-z0-9._:/-]{1,128}")) && value.apiKey.length <= 4096 &&
            value.displayName.isNotBlank() && value.displayName.length <= 100)
        val old = library(scope)
        val providers = old.providers.toMutableList()
        val index = providers.indexOfFirst { if (value.serviceId != null) it.serviceId == value.serviceId else
            canonical(it.endpoint) == identity && (value.apiKey.isEmpty() || it.apiKey == value.apiKey) }
        val previous = providers.getOrNull(index)
        val key = if (value.apiKey.isNotEmpty()) value.apiKey else previous?.apiKey ?: ""
        val models = (previous?.models ?: emptyList()).toMutableList()
        val existingIndex = models.indexOfFirst { it.id == value.modelId }
        val oldLabel = models.getOrNull(existingIndex)?.label
        val selectedLabel = if (value.displayName == value.modelId && oldLabel != null) oldLabel else value.displayName
        val entry = (models.getOrNull(existingIndex) ?: ModelEntry(value.modelId, selectedLabel)).copy(label = selectedLabel,
            enabled = true, lastUsedAt = System.currentTimeMillis())
        if (existingIndex >= 0) models[existingIndex] = entry else models += entry
        val updated = previous?.copy(endpoint = endpoint, apiKey = key, models = models) ?: Provider(endpoint, key, models)
        if (index >= 0) providers[index] = updated else providers += updated
        val active = ModelSettings(endpoint, value.modelId, key, selectedLabel, updated.serviceId, updated.interfaceType)
        persist(Library(providers, endpoint, value.modelId, updated.serviceId), scope)
        return active
    }

    @Synchronized fun selectModel(endpoint: String, modelId: String, scope: String = activeModelScope()): ModelSettings {
        val saved = modelProfiles(scope).find { canonical(it.endpoint) == canonical(endpoint) && it.modelId == modelId }
            ?: throw IllegalArgumentException("Unknown saved model")
        return saveModel(saved, scope)
    }

    /** Explicit account import preserves the current phone selection. A shared endpoint has one key. */
    @Synchronized fun importModel(value: ModelSettings, replaceExistingKey: Boolean,
        scope: String = activeModelScope()): ModelImportResult {
        val endpoint = value.endpoint.trim().trimEnd('/')
        val identity = canonical(endpoint)
        require(value.modelId.matches(Regex("[A-Za-z0-9._:/-]{1,128}")) &&
            value.apiKey.isNotBlank() && value.apiKey.length <= 4096 &&
            value.displayName.isNotBlank() && value.displayName.length <= 100)
        val old = library(scope)
        val providers = old.providers.toMutableList()
        val index = providers.indexOfFirst { canonical(it.endpoint) == identity }
        val previous = providers.getOrNull(index)
        if (previous != null && previous.apiKey != value.apiKey && !replaceExistingKey)
            return ModelImportResult("credential_conflict")
        val models = (previous?.models ?: emptyList()).toMutableList()
        val itemIndex = models.indexOfFirst { it.id == value.modelId }
        val selectedLabel = value.displayName.trim()
        val item = ModelEntry(value.modelId, selectedLabel)
        if (itemIndex >= 0) models[itemIndex] = item else models += item
        val updated = previous?.copy(endpoint = endpoint, apiKey = value.apiKey, models = models) ?: Provider(endpoint, value.apiKey, models)
        if (index >= 0) providers[index] = updated else providers += updated
        persist(old.copy(providers = providers), scope)
        return ModelImportResult("saved", ModelSettings(endpoint, value.modelId, value.apiKey, selectedLabel))
    }

    @Synchronized fun removeModelProfile(endpoint: String, modelId: String, scope: String = activeModelScope(), allowSelected: Boolean = false) {
        val old = library(scope)
        val selected = old.activeEndpoint != null && canonical(old.activeEndpoint) == canonical(endpoint) && old.activeModelId == modelId
        require(!selected || allowSelected)
        val providers = old.providers.mapNotNull { profile ->
            if (canonical(profile.endpoint) != canonical(endpoint)) profile
            else profile.copy(models = profile.models.filterNot { it.id == modelId }).takeIf { it.models.isNotEmpty() }
        }
        persist(old.copy(providers = providers, activeEndpoint = if (selected) null else old.activeEndpoint,
            activeModelId = if (selected) null else old.activeModelId, activeServiceId = if (selected) null else old.activeServiceId), scope)
    }

    /** Public service views never include credentials. Existing model fields remain readable by older web bundles. */
    @Synchronized fun modelServices(scope: String = activeModelScope()): JSONObject {
        val value = library(scope)
        val migrationKey = "models_services_migrated:${checkedScope(scope)}"
        if (value.providers.isNotEmpty() && !prefs.getBoolean(migrationKey, false)) {
            try { persist(value, scope); check(prefs.edit().putBoolean(migrationKey, true).commit()) }
            catch (_: Exception) { /* The old encrypted library remains usable; retry on the next read. */ }
        }
        val selected = model(scope)
        val services = JSONArray(value.providers.map { provider ->
            JSONObject().put("serviceId", provider.serviceId).put("name", provider.name)
                .put("baseUrl", provider.endpoint.removeSuffix("/chat/completions"))
                .put("endpoint", provider.endpoint).put("interfaceType", provider.interfaceType)
                .put("selectedModelId", selected?.takeIf { it.serviceId == provider.serviceId }?.modelId ?: JSONObject.NULL)
                .put("catalog", JSONObject().put("status", provider.catalogStatus).put("checkedAt", provider.checkedAt))
                .put("models", JSONArray(provider.models.map { item -> JSONObject().put("modelId", item.id)
                    .put("name", item.label).put("displayName", item.label).put("enabled", item.enabled)
                    .put("lastUsedAt", item.lastUsedAt).put("manual", item.manual)
                    .put("capabilities", item.capabilities ?: JSONObject.NULL)
                    .put("capabilitySource", if (item.capabilities != null || item.deepThinking != null) "service-directory" else JSONObject.NULL)
                    .put("deepThinking", item.deepThinking?.let { JSONObject(it.toString()).put("enabled", item.deepThinkingEnabled) } ?: JSONObject.NULL) }))
        })
        return JSONObject().put("services", services).put("selected", selected?.let {
            JSONObject().put("serviceId", it.serviceId).put("modelId", it.modelId)
        } ?: JSONObject.NULL)
    }

    @Synchronized internal fun modelServiceProfile(serviceId: String, scope: String): ModelSettings {
        val provider = library(scope).providers.find { it.serviceId == serviceId } ?: throw ApiFailure(404, "MODEL_NOT_FOUND")
        return ModelSettings(provider.endpoint, provider.models.firstOrNull()?.id ?: "", provider.apiKey, provider.name, provider.serviceId, provider.interfaceType)
    }

    @Synchronized fun configureModelService(params: JSONObject, scope: String): String {
        val old = library(scope)
        val endpoint = phoneServiceEndpoint(params.getString("endpoint"))
        val id = params.optString("serviceId")
        val prior = old.providers.find { it.serviceId == id }
        val apiKey = params.optString("apiKey").ifBlank { prior?.apiKey ?: "" }
        require(apiKey.isNotBlank() && apiKey.length <= 4096)
        val type = params.optString("interfaceType", prior?.interfaceType ?: "openai-compatible").let { if (it == "openai") "openai-compatible" else it }
        require(type in setOf("openai", "openai-compatible", "anthropic"))
        val same = old.providers.find { canonical(it.endpoint) == endpoint && it.apiKey == apiKey && it.interfaceType == type }
        val previous = prior ?: same
        val name = params.optString("name").trim().take(100).ifBlank { previous?.name ?: phoneServiceDisplayName(endpoint) }
        val provider = previous?.copy(endpoint = endpoint, apiKey = apiKey, name = name, interfaceType = type,
            catalogStatus = if (endpoint == previous.endpoint && apiKey == previous.apiKey) previous.catalogStatus else "not_checked",
            checkedAt = if (endpoint == previous.endpoint && apiKey == previous.apiKey) previous.checkedAt else 0)
            ?: Provider(endpoint, apiKey, emptyList(), name = name, interfaceType = type)
        val providers = old.providers.toMutableList()
        val index = providers.indexOfFirst { it.serviceId == provider.serviceId }
        if (index < 0) providers += provider else providers[index] = provider
        val activeId = model(scope)?.serviceId
        persist(old.copy(providers = providers, activeEndpoint = if (activeId == provider.serviceId) endpoint else old.activeEndpoint,
            activeServiceId = if (activeId == provider.serviceId) activeId else old.activeServiceId), scope)
        return provider.serviceId
    }

    @Synchronized fun cacheModelServiceCatalog(serviceId: String, models: List<DiscoveredModel>, status: String, scope: String,
        metadata: Map<String, JSONObject> = emptyMap(), source: ModelSettings? = null) {
        val old = library(scope)
        val current = old.providers.find { it.serviceId == serviceId } ?: return
        if (source != null && (current.endpoint != source.endpoint || current.apiKey != source.apiKey || current.interfaceType != source.interfaceType)) return
        val providers = old.providers.map { provider ->
            if (provider.serviceId != serviceId) provider else {
                val entries = provider.models.associateBy { it.id }.toMutableMap()
                for (model in models) entries[model.id] = (entries[model.id] ?: ModelEntry(model.id, model.displayName, manual = false))
                    .copy(label = model.displayName, capabilities = metadata[model.id]?.optJSONObject("capabilities") ?: entries[model.id]?.capabilities,
                        deepThinking = metadata[model.id]?.optJSONObject("deepThinking") ?: entries[model.id]?.deepThinking)
                provider.copy(models = entries.values.toList(), catalogStatus = status, checkedAt = System.currentTimeMillis())
            }
        }
        var updated = old.copy(providers = providers)
        if (old.activeModelId == null) {
            val provider = providers.find { it.serviceId == serviceId }
            val selected = provider?.models?.firstOrNull { it.enabled && Regex("(?i)(?:flash|mini|haiku|chat)").containsMatchIn(it.id) }
                ?: provider?.models?.firstOrNull { it.enabled }
            if (selected != null && provider != null) updated = updated.copy(activeEndpoint = provider.endpoint, activeModelId = selected.id, activeServiceId = serviceId)
        }
        persist(updated, scope)
    }

    @Synchronized fun selectServiceModel(serviceId: String, modelId: String, scope: String): ModelSettings {
        val provider = library(scope).providers.find { it.serviceId == serviceId } ?: throw ApiFailure(404, "MODEL_NOT_FOUND")
        val entry = provider.models.find { it.id == modelId } ?: throw ApiFailure(404, "MODEL_NOT_FOUND")
        return saveModel(ModelSettings(provider.endpoint, entry.id, provider.apiKey, entry.label, serviceId, provider.interfaceType), scope)
    }

    @Synchronized fun updateModelService(params: JSONObject, scope: String) {
        val old = library(scope)
        val serviceId = params.getString("serviceId")
        val enabled = params.optJSONArray("enabledModelIds")?.let { rows -> (0 until rows.length()).map { rows.getString(it) }.toSet() }
        val manualId = params.optString("modelId")
        if (manualId.isNotBlank()) require(manualId.matches(Regex("[A-Za-z0-9._:/-]{1,128}")))
        val providers = old.providers.map { provider -> if (provider.serviceId != serviceId) provider else {
            val models = provider.models.map { item -> item.copy(enabled = enabled?.contains(item.id) ?: item.enabled,
                deepThinkingEnabled = if (params.has("deepThinkingEnabled") && item.id == manualId && item.deepThinking?.optBoolean("supported") == true)
                    params.getBoolean("deepThinkingEnabled") else item.deepThinkingEnabled) }.toMutableList()
            if (manualId.isNotBlank() && models.none { it.id == manualId }) models += ModelEntry(manualId,
                params.optString("displayName").ifBlank { manualId }.take(100))
            provider.copy(models = models)
        } }
        var updated = old.copy(providers = providers)
        val active = model(scope)
        if (enabled != null && active?.serviceId == serviceId && active.modelId !in enabled) {
            val provider = providers.find { it.serviceId == serviceId }
            val selected = provider?.models?.firstOrNull { it.enabled }
            updated = updated.copy(activeEndpoint = if (selected != null) provider?.endpoint else null,
                activeModelId = selected?.id, activeServiceId = if (selected != null) serviceId else null)
        }
        persist(updated, scope)
    }

    @Synchronized fun removeModelService(serviceId: String, scope: String) {
        val old = library(scope)
        val selected = model(scope)?.serviceId == serviceId
        persist(old.copy(providers = old.providers.filterNot { it.serviceId == serviceId },
            activeEndpoint = if (selected) null else old.activeEndpoint, activeModelId = if (selected) null else old.activeModelId,
            activeServiceId = if (selected) null else old.activeServiceId), scope)
    }
}
