package com.memoweft.weftmate.mobile

import android.content.Context
import org.json.JSONObject
import org.json.JSONArray
import java.net.HttpURLConnection
import java.util.concurrent.atomic.AtomicReference

/** Account-owned phone content uses the M3 vault, independently of a computer cookie. */
internal class PhoneAccount(private val context: Context, private val secrets: SecureSettings) {
    fun storedIdentity(): HostIdentity {
        val value = JSONObject(secrets.appValue("phone-account") ?: throw ApiFailure(401, "LOGIN_REQUIRED"))
        return HostIdentity(value.getString("origin"), value.getString("email"), value.getString("accountId"),
            "unconnected", value.getString("deviceId"), "", "", "phone")
    }
    fun identity(): HostIdentity {
        val account = storedIdentity()
        val credentials = JSONObject(secrets.appValue("credentials") ?: "{}")
        val subjects = credentials.keys().asSequence().filter { it.startsWith("app-tokens:") }
            .mapNotNull { credentials.optJSONObject(it)?.optString("sub") }.toList()
        if (subjects.isNotEmpty() && account.ownerId !in subjects) throw ApiFailure(403, "ACCOUNT_SWITCHED")
        return account
    }
    fun adopt(params: JSONObject): HostIdentity {
        val credentials = JSONObject(secrets.appValue("credentials") ?: "{}")
        require(credentials.keys().asSequence().filter { it.startsWith("app-tokens:") }.any {
            credentials.optJSONObject(it)?.optString("sub") == params.getString("accountId") })
        val previous = try { storedIdentity() } catch (_: Exception) { null }
        val origin = Endpoints.hostOrigin(params.getString("origin"))
        val next = HostIdentity(origin, params.getString("email"), params.getString("accountId"),
            "unconnected", params.getString("deviceId"), "", "", "phone")
        if (previous != null && (previous.ownerId != next.ownerId || previous.origin != next.origin)) OfflineVault(context, previous).clear()
        secrets.saveAppValue("phone-account", JSONObject(params.toString()).put("origin", origin).toString())
        return next
    }
    private fun scope() = identity().let { Endpoints.ownerKey(it.origin, it.ownerId) }
    private fun modelView(model: ModelSettings) = JSONObject().put("source", "phone").put("endpoint", model.endpoint)
        .put("modelId", model.modelId).put("displayName", model.displayName)
    fun models(method: String, params: JSONObject): JSONObject {
        val scope = scope()
        return when (method) {
            "list" -> JSONObject().put("models", JSONArray(secrets.modelProfiles(scope).map { model ->
                modelView(model).put("selected", secrets.model(scope)?.let { it.endpoint == model.endpoint && it.modelId == model.modelId } == true) }))
                .put("selected", secrets.model(scope)?.let { modelView(it) } ?: JSONObject.NULL)
            "configure" -> {
                val endpoint = Endpoints.modelUrl(params.getString("endpoint"))
                require(endpoint.startsWith("https://") || (BuildConfig.DEBUG && endpoint.startsWith("http://127.0.0.1:")))
                val id = params.getString("modelId"); require(id.isNotBlank() && id.length <= 128)
                val key = params.optString("apiKey").ifBlank { secrets.modelProfiles(scope).firstOrNull { it.endpoint == endpoint }?.apiKey ?: "" }
                require(key.isNotBlank())
                modelView(secrets.saveModel(ModelSettings(endpoint, id, key, params.optString("displayName", id)), scope))
            }
            "select" -> modelView(secrets.selectModel(params.getString("endpoint"), params.getString("modelId"), scope))
            "remove" -> { secrets.removeModelProfile(params.getString("endpoint"), params.getString("modelId"), scope, true); JSONObject().put("removed", true) }
            "test" -> {
                val model = secrets.model(scope) ?: throw ApiFailure(409, "MODEL_NOT_CONFIGURED")
                val reply = JsonHttp().request(Endpoints.modelUrl(model.endpoint), "POST", JSONObject().put("model", model.modelId)
                    .put("stream", false).put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", "只回复 OK"))),
                    mapOf("Authorization" to "Bearer ${model.apiKey}"), readTimeoutMs = 180_000).body
                require(reply.optJSONArray("choices")?.optJSONObject(0)?.optJSONObject("message")?.optString("content")?.isNotBlank() == true)
                JSONObject().put("available", true)
            }
            else -> throw ApiFailure(400, "METHOD_UNKNOWN")
        }
    }
    fun complete(body: JSONObject, active: AtomicReference<HttpURLConnection?>, progress: (String) -> Unit): JSONObject {
        val model = secrets.model(scope()) ?: throw ApiFailure(409, "MODEL_NOT_CONFIGURED")
        require(body.getString("model") == model.modelId && !body.has("tools") && !body.has("tool_choice"))
        val collector = SseMessageCollector(progress, {})
        val full = JsonHttp().streamRequest(Endpoints.modelUrl(model.endpoint), body,
            mapOf("Authorization" to "Bearer ${model.apiKey}"), active, 180_000, collector::accept)
        if (full != null) return full
        if (collector.finishReason != "stop") throw ApiFailure(502, "MODEL_STREAM_INCOMPLETE")
        return JSONObject().put("choices", JSONArray().put(JSONObject().put("message", collector.message())))
    }
}
