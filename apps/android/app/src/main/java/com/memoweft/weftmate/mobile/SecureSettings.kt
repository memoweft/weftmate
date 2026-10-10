package com.memoweft.weftmate.mobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import org.json.JSONArray
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class HostIdentity(val origin: String, val username: String, val ownerId: String,
    val hostId: String, val deviceId: String, val cookie: String, val csrf: String,
    val authSource: String = "local")
data class ModelSettings(val endpoint: String, val modelId: String, val apiKey: String,
    val displayName: String = modelId)
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

    private data class ModelEntry(val id: String, val label: String)
    private data class Provider(val endpoint: String, val apiKey: String, val models: List<ModelEntry>)
    private data class Library(val providers: List<Provider>, val activeEndpoint: String?, val activeModelId: String?)
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
        require(entries.length() <= 16)
        val providers = mutableListOf<Provider>()
        val seen = mutableSetOf<String>()
        for (index in 0 until entries.length()) {
            val row = entries.getJSONObject(index)
            val endpoint = row.getString("endpoint")
            val key = row.getString("apiKey")
            require(key.length <= 4096 && seen.add(canonical(endpoint)))
            val ids = row.getJSONArray("models")
            require(ids.length() in 1..100)
            val names = (0 until ids.length()).map { rowIndex ->
                val item = ids.getJSONObject(rowIndex)
                ModelEntry(item.getString("id"), item.getString("label"))
            }
            require(names.map { it.id }.distinct().size == names.size && names.all {
                it.id.matches(Regex("[A-Za-z0-9._:/-]{1,128}")) && it.label.isNotBlank() && it.label.length <= 100
            })
            providers += Provider(endpoint, key, names)
        }
        val activeEndpoint = body.optString("activeEndpoint").takeIf { it.isNotBlank() }
        val activeModelId = body.optString("activeModelId").takeIf { it.isNotBlank() }
        require((activeEndpoint == null) == (activeModelId == null))
        if (activeEndpoint != null) require(providers.any { canonical(it.endpoint) == canonical(activeEndpoint) && it.models.any { item -> item.id == activeModelId } })
        return Library(providers, activeEndpoint, activeModelId)
    }

    @Synchronized private fun ensureMigrated() {
        captureLegacyOwner()
        if (prefs.getBoolean("models_v3_migrated", false)) return
        val scope = activeModelScope()
        val legacy = legacyLibrary()
        val editor = prefs.edit().putBoolean("models_v3_migrated", true)
            .remove("models_v2").remove("model")
        if (legacy.providers.isNotEmpty()) editor.putString(scopedKey(scope), encrypt(serialize(legacy)))
        check(editor.commit())
    }

    private fun library(scope: String): Library {
        ensureMigrated()
        val raw = prefs.getString(scopedKey(scope), null) ?: return Library(emptyList(), null, null)
        return parseLibrary(raw)
    }

    private fun serialize(value: Library): String {
        val rows = JSONArray()
        for (provider in value.providers) {
            val models = JSONArray()
            for (item in provider.models) models.put(JSONObject().put("id", item.id).put("label", item.label))
            rows.put(JSONObject().put("endpoint", provider.endpoint).put("apiKey", provider.apiKey).put("models", models))
        }
        val body = JSONObject().put("version", 1).put("providers", rows)
            .put("activeEndpoint", value.activeEndpoint ?: "").put("activeModelId", value.activeModelId ?: "")
        return body.toString()
    }

    private fun persist(value: Library, scope: String) {
        check(prefs.edit().putString(scopedKey(scope), encrypt(serialize(value))).commit())
    }

    @Synchronized fun model(scope: String = activeModelScope()): ModelSettings? {
        val value = library(scope)
        val endpoint = value.activeEndpoint ?: return null
        val profile = value.providers.find { canonical(it.endpoint) == canonical(endpoint) } ?: return null
        val selectedId = value.activeModelId ?: return null
        val label = profile.models.find { it.id == selectedId }?.label ?: selectedId
        return ModelSettings(profile.endpoint, selectedId, profile.apiKey, label)
    }

    /** Returns only entries saved by this phone. A catalog response is not silently persisted. */
    @Synchronized fun modelProfiles(scope: String = activeModelScope()): List<ModelSettings> = library(scope).providers.flatMap { provider ->
        provider.models.map { ModelSettings(provider.endpoint, it.id, provider.apiKey, it.label) }
    }

    @Synchronized fun saveModel(value: ModelSettings, scope: String = activeModelScope()): ModelSettings {
        val endpoint = value.endpoint.trim().trimEnd('/')
        val identity = canonical(endpoint)
        require(value.modelId.matches(Regex("[A-Za-z0-9._:/-]{1,128}")) && value.apiKey.length <= 4096 &&
            value.displayName.isNotBlank() && value.displayName.length <= 100)
        val old = library(scope)
        val providers = old.providers.toMutableList()
        val index = providers.indexOfFirst { canonical(it.endpoint) == identity }
        val previous = providers.getOrNull(index)
        val key = if (value.apiKey.isNotEmpty()) value.apiKey else previous?.apiKey ?: ""
        val models = (previous?.models ?: emptyList()).toMutableList()
        val existingIndex = models.indexOfFirst { it.id == value.modelId }
        val oldLabel = models.getOrNull(existingIndex)?.label
        val selectedLabel = if (value.displayName == value.modelId && oldLabel != null) oldLabel else value.displayName
        val entry = ModelEntry(value.modelId, selectedLabel)
        if (existingIndex >= 0) models[existingIndex] = entry else models += entry
        require(models.size <= 100 && (index >= 0 || providers.size < 16))
        val updated = Provider(endpoint, key, models)
        if (index >= 0) providers[index] = updated else providers += updated
        val active = ModelSettings(endpoint, value.modelId, key, selectedLabel)
        persist(Library(providers, endpoint, value.modelId), scope)
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
        require(models.size <= 100 && (index >= 0 || providers.size < 16))
        val updated = Provider(endpoint, value.apiKey, models)
        if (index >= 0) providers[index] = updated else providers += updated
        persist(old.copy(providers = providers), scope)
        return ModelImportResult("saved", ModelSettings(endpoint, value.modelId, value.apiKey, selectedLabel))
    }

    @Synchronized fun removeModelProfile(endpoint: String, modelId: String, scope: String = activeModelScope()) {
        val old = library(scope)
        require(old.activeEndpoint == null || canonical(old.activeEndpoint) != canonical(endpoint) || old.activeModelId != modelId)
        val providers = old.providers.mapNotNull { profile ->
            if (canonical(profile.endpoint) != canonical(endpoint)) profile
            else profile.copy(models = profile.models.filterNot { it.id == modelId }).takeIf { it.models.isNotEmpty() }
        }
        persist(old.copy(providers = providers), scope)
    }
}
