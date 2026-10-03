package com.memoweft.weftmate.mobile

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** Account cloud models: secrets cross only this native HTTP boundary. */
internal class AccountModels(private val store: LocalStore, private val api: PersonalApi,
    private val secrets: SecureSettings) {
    private fun scope(host: HostIdentity) = Endpoints.ownerKey(host.origin, host.ownerId)
    private fun sha(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") {
            (it.toInt() and 0xff).toString(16).padStart(2, '0') }

    private fun publicModel(value: JSONObject?): JSONObject? {
        if (value == null) return null
        val id = value.optString("accountModelId")
        val revision = value.optLong("revision", 0)
        if (!id.matches(Regex("[A-Za-z0-9_-]{1,128}")) || revision < 1) return null
        val result = JSONObject().put("accountModelId", id).put("revision", revision)
        for (name in listOf("profileId", "name", "provider", "baseUrl", "modelId", "status",
            "createdAt", "updatedAt")) if (value.has(name) && value.opt(name) is String)
            result.put(name, value.getString(name))
        result.put("configured", value.optBoolean("configured"))
        val fingerprint = value.optString("routeFingerprint")
        result.put("routeFingerprint", if (fingerprint.matches(Regex("[a-f0-9]{64}")))
            fingerprint else JSONObject.NULL)
        return result
    }

    private fun publicOperation(value: JSONObject?): JSONObject? {
        if (value == null) return null
        val requestId = value.optString("requestId")
        if (!requestId.matches(Regex("[A-Za-z0-9_.:-]{1,128}"))) return null
        val result = JSONObject().put("requestId", requestId)
        for (name in listOf("kind", "accountModelId", "status", "reasonCode", "errorCode",
            "createdAt", "updatedAt")) if (value.has(name) && value.opt(name) is String)
            result.put(name, value.getString(name))
        for (name in listOf("expectedRevision", "resultRevision")) if (value.has(name) &&
            value.opt(name) is Number) result.put(name, value.getLong(name))
        value.optJSONObject("testResult")?.let { checked -> result.put("testResult", JSONObject()
            .put("configured", checked.optBoolean("configured"))
            .put("reachable", checked.optBoolean("reachable"))
            .put("modelListed", checked.optBoolean("modelListed"))) }
        return result
    }

    private fun publicReply(value: JSONObject): JSONObject {
        val operation = publicOperation(value.optJSONObject("operation"))
            ?: throw ApiFailure(502, "MODEL_RECEIPT_INVALID")
        val reply = JSONObject().put("operation", operation)
        publicModel(value.optJSONObject("model"))?.let { reply.put("model", it) }
        return reply
    }

    fun list(host: HostIdentity, current: () -> Boolean): JSONObject {
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val raw = api.accountModels(host)
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val rows = raw.optJSONArray("models") ?: throw ApiFailure(502, "MODEL_RECEIPT_INVALID")
        val models = JSONArray()
        for (index in 0 until minOf(rows.length(), 100))
            publicModel(rows.optJSONObject(index))?.let { models.put(it) }
        return JSONObject().put("models", models).put("canManage", raw.optBoolean("canManage"))
    }

    fun byRequest(host: HostIdentity, requestId: String, current: () -> Boolean): JSONObject {
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val raw = api.accountModelByRequest(host, requestId)
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val result = publicReply(raw)
        if (result.getJSONObject("operation").optString("requestId") != requestId)
            throw ApiFailure(502, "MODEL_RECEIPT_INVALID")
        return result
    }

    fun control(host: HostIdentity, accountModelId: String, action: String,
        requestId: String, expectedRevision: Long, current: () -> Boolean): JSONObject {
        if (action !in setOf("test", "stop-using", "remove") || expectedRevision < 1 ||
            !requestId.matches(Regex("[A-Za-z0-9_.:-]{1,128}")))
            throw ApiFailure(400, "INVALID_REQUEST")
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val body = JSONObject().put("requestId", requestId).put("expectedRevision", expectedRevision)
        val prior = try { api.accountModelByRequest(host, requestId) }
        catch (error: ApiFailure) { if (error.status == 404) null else throw error }
        val response = prior ?: api.mutateAccountModel(host, accountModelId, action, body)
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val projected = publicReply(response)
        val operation = projected.getJSONObject("operation")
        if (operation.optString("requestId") != requestId ||
            operation.optString("accountModelId") != accountModelId ||
            operation.optString("kind") != when (action) { "stop-using" -> "stop_using";
                "remove" -> "remove"; else -> "test" })
            throw ApiFailure(502, "MODEL_RECEIPT_INVALID")
        return projected
    }

    fun publishSaved(host: HostIdentity, endpoint: String, modelId: String,
        requestId: String, current: () -> Boolean): JSONObject {
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val scope = scope(host)
        val selected = secrets.modelProfiles(scope).find {
            Endpoints.modelUrl(it.endpoint) == Endpoints.modelUrl(endpoint) && it.modelId == modelId
        } ?: throw ApiFailure(404, "MODEL_NOT_FOUND")
        val actualId = requestModelId(selected)
        val requestUrl = Endpoints.modelUrl(selected.endpoint)
        val baseUrl = requestUrl.removeSuffix("/chat/completions")
        if (baseUrl == requestUrl) throw ApiFailure(400, "MODEL_ROUTE_INVALID")
        val fingerprint = modelRouteFingerprint(requestUrl, actualId)
            ?: throw ApiFailure(409, "MODEL_ROUTE_NOT_PORTABLE")
        if (selected.apiKey.isBlank()) throw ApiFailure(409, "MODEL_NOT_CONFIGURED")
        val name = selected.displayName.trim().take(100).ifBlank { actualId }
        val safeBody = JSONObject().put("endpoint", baseUrl).put("modelId", actualId)
            .put("name", name).put("keyHash", sha(selected.apiKey)).put("routeFingerprint", fingerprint)
        val hash = sha(safeBody.toString())
        store.queueAccountModelIntent(scope, host.hostId, requestId, "publish", hash, safeBody)
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val prior = try { api.accountModelByRequest(host, requestId) }
        catch (error: ApiFailure) { if (error.status == 404) null else throw error }
        val response = if (prior != null) prior else try {
            api.createAccountModel(host, requestId, name, baseUrl, actualId, selected.apiKey)
        } catch (error: Exception) {
            store.updateAccountModelIntent(scope, host.hostId, requestId, "uncertain")
            if (error is ApiFailure && error.status in setOf(400, 401, 403, 409, 422)) throw error
            return JSONObject().put("state", "uncertain").put("requestId", requestId)
        }
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val projected = publicReply(response)
        val operation = projected.getJSONObject("operation")
        if (operation.optString("requestId") != requestId || operation.optString("kind") != "create")
            throw ApiFailure(502, "MODEL_RECEIPT_INVALID")
        val state = when (operation.optString("status")) {
            "succeeded" -> "succeeded"; "failed" -> "failed"; "uncertain" -> "uncertain"; else -> "pending" }
        store.updateAccountModelIntent(scope, host.hostId, requestId, state, projected)
        return projected.put("state", state)
    }

    fun importToPhone(host: HostIdentity, accountModelId: String, expectedRevision: Long,
        requestId: String, replaceExistingKey: Boolean, current: () -> Boolean): JSONObject {
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val scope = scope(host)
        api.registerSyncCapabilities(host)
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val public = api.accountModel(host, accountModelId).optJSONObject("model")
            ?: throw ApiFailure(502, "MODEL_RECEIPT_INVALID")
        if (public.optLong("revision") != expectedRevision || public.optString("status") != "active" ||
            !public.optString("routeFingerprint").matches(Regex("[a-f0-9]{64}")))
            throw ApiFailure(409, "MODEL_NOT_PORTABLE")
        val body = JSONObject().put("accountModelId", accountModelId)
            .put("expectedRevision", expectedRevision).put("replaceExistingKey", replaceExistingKey)
        store.queueAccountModelIntent(scope, host.hostId, requestId, "transfer", sha(body.toString()), body)
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val transfer = try { api.transferAccountModel(host, accountModelId, requestId, expectedRevision) }
        catch (error: Exception) {
            store.updateAccountModelIntent(scope, host.hostId, requestId, "uncertain")
            throw error
        }
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        val model = transfer.optJSONObject("model") ?: throw ApiFailure(502, "MODEL_RECEIPT_INVALID")
        val key = transfer.optString("apiKey")
        if (model.optString("accountModelId") != accountModelId ||
            model.optLong("revision") != expectedRevision || key.isBlank() || key.length > 4096 ||
            model.optString("baseUrl") != public.optString("baseUrl") ||
            model.optString("modelId") != public.optString("modelId"))
            throw ApiFailure(502, "MODEL_RECEIPT_INVALID")
        val imported = secrets.importModel(ModelSettings(model.getString("baseUrl"),
            model.getString("modelId"), key, model.optString("name", model.getString("modelId"))),
            replaceExistingKey, scope)
        if (!current()) throw ApiFailure(409, "ACCOUNT_SWITCHED")
        if (imported.status == "credential_conflict") {
            store.updateAccountModelIntent(scope, host.hostId, requestId, "credential_conflict")
            return JSONObject().put("status", "credential_conflict")
                .put("requestId", requestId).put("model", publicModel(model))
        }
        val projected = JSONObject().put("status", "saved").put("requestId", requestId)
            .put("model", publicModel(model)).put("phoneModel", JSONObject()
                .put("endpoint", imported.model!!.endpoint).put("modelId", imported.model.modelId)
                .put("displayName", imported.model.displayName).put("selected", false))
        store.updateAccountModelIntent(scope, host.hostId, requestId, "succeeded", projected)
        return projected
    }
}
