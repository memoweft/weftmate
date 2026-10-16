package com.memoweft.weftmate.mobile

import android.content.Context
import org.json.JSONObject
import org.json.JSONArray
import java.net.HttpURLConnection
import java.util.concurrent.atomic.AtomicReference
import java.util.UUID

internal val HostIdentity.phoneOnly: Boolean get() = authSource == "phone" || authSource == "phone-local"

/** Account-owned phone content uses the M3 vault, independently of a computer cookie. */
internal class PhoneAccount(private val context: Context, private val secrets: SecureSettings,
    private val catalogHttp: JsonTransport = JsonHttp()) {
    /** A device-owned space is not a cloud account and carries no server authority. */
    fun localIdentity(): HostIdentity = synchronized(secrets) {
        val value = secrets.appValue("local-phone-account")?.let(::JSONObject) ?: JSONObject()
            .put("accountId", "local-${UUID.randomUUID()}").put("deviceId", "phone-${UUID.randomUUID()}")
            .also { secrets.saveAppValue("local-phone-account", it.toString()) }
        HostIdentity("https://local.weftmate.invalid", "本机使用", value.getString("accountId"),
            "unconnected", value.getString("deviceId"), "", "", "phone-local")
    }
    fun bootstrapIdentity(): HostIdentity = synchronized(secrets) {
        secrets.host() ?: localIdentity().also(secrets::saveHost)
    }
    fun storedIdentity(): HostIdentity {
        secrets.host()?.takeIf { it.authSource == "phone-local" }?.let { return it }
        val value = JSONObject(secrets.appValue("phone-account") ?: throw ApiFailure(401, "LOGIN_REQUIRED"))
        return HostIdentity(value.getString("origin"), value.getString("email"), value.getString("accountId"),
            "unconnected", value.getString("deviceId"), "", "", "phone")
    }
    fun identity(): HostIdentity {
        val account = storedIdentity()
        if (account.authSource == "phone-local") return account
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
        if (previous != null && previous.authSource != "phone-local" && (previous.ownerId != next.ownerId || previous.origin != next.origin)) OfflineVault(context, previous).clear()
        secrets.saveAppValue("phone-account", JSONObject(params.toString()).put("origin", origin).toString())
        return next
    }
    private fun scope() = identity().let { Endpoints.ownerKey(it.origin, it.ownerId) }
    private fun modelView(model: ModelSettings) = JSONObject().put("source", "phone").put("endpoint", model.endpoint)
        .put("modelId", model.modelId).put("displayName", model.displayName).put("serviceId", model.serviceId)
        .put("interfaceType", model.interfaceType)
    fun models(method: String, params: JSONObject): JSONObject {
        val scope = scope()
        return when (method) {
            "list" -> JSONObject().put("models", JSONArray(secrets.modelProfiles(scope).map { model ->
                modelView(model).put("selected", secrets.model(scope)?.let { it.serviceId == model.serviceId && it.modelId == model.modelId } == true) }))
                .put("selected", secrets.model(scope)?.let { modelView(it) } ?: JSONObject.NULL)
                .put("services", secrets.modelServices(scope).getJSONArray("services"))
            "services" -> secrets.modelServices(scope).put("model", secrets.model(scope)?.let { modelView(it) } ?: JSONObject.NULL)
            "serviceConfigure" -> {
                val endpoint = phoneServiceEndpoint(params.getString("endpoint"))
                require(endpoint.startsWith("https://") || (BuildConfig.DEBUG && endpoint.startsWith("http://127.0.0.1:")))
                val id = secrets.configureModelService(params, scope)
                if (params.optString("modelId").isNotBlank()) secrets.updateModelService(JSONObject()
                    .put("serviceId", id).put("modelId", params.getString("modelId")), scope)
                val result = refreshService(id, scope)
                if (!params.has("serviceId") || params.optString("serviceId").isBlank()) {
                    val service = result.getJSONArray("services").let { rows -> (0 until rows.length()).map { rows.getJSONObject(it) }.first { it.getString("serviceId") == id } }
                    val rows = service.getJSONArray("models")
                    val choices = (0 until rows.length()).map { rows.getJSONObject(it) }.filter { it.optBoolean("enabled", true) }
                    val preferred = choices.firstOrNull { Regex("(?i)(?:flash|mini|haiku)(?:$|[-_.])").containsMatchIn(it.getString("modelId")) } ?: choices.firstOrNull()
                    if (preferred != null) secrets.selectServiceModel(id, preferred.getString("modelId"), scope)
                }
                secrets.modelServices(scope).put("model", secrets.model(scope)?.let { modelView(it) } ?: JSONObject.NULL).put("serviceId", id)
            }
            "serviceRefresh" -> {
                val id = params.optString("serviceId")
                if (id.isNotBlank()) refreshService(id, scope) else {
                    val rows = secrets.modelServices(scope).getJSONArray("services")
                    for (index in 0 until rows.length()) {
                        val service = rows.getJSONObject(index)
                        if (params.optBoolean("force") || System.currentTimeMillis() - service.getJSONObject("catalog").optLong("checkedAt") >= 60 * 60 * 1000)
                            refreshService(service.getString("serviceId"), scope)
                    }
                    secrets.modelServices(scope).put("model", secrets.model(scope)?.let { modelView(it) } ?: JSONObject.NULL)
                }
            }
            "serviceSelect" -> modelView(secrets.selectServiceModel(params.getString("serviceId"), params.getString("modelId"), scope))
            "serviceUpdate" -> {
                secrets.updateModelService(params, scope)
                secrets.modelServices(scope).put("model", secrets.model(scope)?.let { modelView(it) } ?: JSONObject.NULL)
            }
            "serviceRemove" -> {
                secrets.removeModelService(params.getString("serviceId"), scope)
                secrets.modelServices(scope).put("model", secrets.model(scope)?.let { modelView(it) } ?: JSONObject.NULL)
            }
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
    private fun refreshService(id: String, scope: String): JSONObject {
        val model = secrets.modelServiceProfile(id, scope)
        var status = "available"
        val metadata = mutableMapOf<String, JSONObject>()
        val models = try {
            val headers = if (model.interfaceType == "anthropic") mapOf("x-api-key" to model.apiKey, "anthropic-version" to "2023-06-01")
                else mapOf("Authorization" to "Bearer ${model.apiKey}")
            val rows = JSONArray()
            val cursors = mutableSetOf<String>()
            var cursor: String? = null
            do {
                val url = Endpoints.modelCatalogUrl(model.endpoint) + (cursor?.let { "?after_id=" + java.net.URLEncoder.encode(it, "UTF-8") } ?: "")
                val reply = catalogHttp.request(url, "GET", headers = headers, readTimeoutMs = 15_000).body
                val page = reply.optJSONArray("data") ?: throw ApiFailure(502, "MODEL_CATALOG_INVALID")
                for (index in 0 until page.length()) page.optJSONObject(index)?.let { rows.put(it) }
                cursor = if (reply.optBoolean("has_more")) reply.optString("last_id").also {
                    if (it.isBlank() || !cursors.add(it)) throw ApiFailure(502, "MODEL_CATALOG_INVALID")
                } else null
            } while (cursor != null)
            (0 until rows.length()).mapNotNull { index ->
                val row = rows.optJSONObject(index) ?: return@mapNotNull null
                val modelId = row.optString("id")
                if (!modelId.matches(Regex("[A-Za-z0-9._:/-]{1,128}")) || !isServiceChatModel(modelId, row.optString("type"))) return@mapNotNull null
                val supplied = row.optString("display_name").ifBlank { row.optString("name") }
                val declared = row.optJSONObject("capabilities")
                val capabilities = JSONObject()
                if (declared?.opt("vision") is Boolean) capabilities.put("vision", declared.getBoolean("vision"))
                else if (declared?.optJSONObject("image_input")?.opt("supported") is Boolean) capabilities.put("vision", declared.getJSONObject("image_input").getBoolean("supported"))
                else row.optJSONArray("input_modalities")?.let { values -> capabilities.put("vision", (0 until values.length()).any { values.optString(it) == "image" }) }
                val contextWindow = row.optLong("context_window", row.optLong("context_length", row.optLong("max_input_tokens", declared?.optLong("contextWindow") ?: 0)))
                if (contextWindow > 0) capabilities.put("contextWindow", contextWindow)
                val details = JSONObject()
                if (capabilities.length() > 0) details.put("capabilities", capabilities)
                val reasoning = declared?.opt("reasoning")?.takeIf { it is Boolean } ?: row.opt("supports_reasoning")?.takeIf { it is Boolean }
                    ?: declared?.optJSONObject("thinking")?.opt("supported")
                if (reasoning is Boolean) {
                    val deep = JSONObject().put("supported", reasoning)
                    val types = declared?.optJSONObject("thinking")?.optJSONObject("types")
                    if (types?.optJSONObject("adaptive")?.optBoolean("supported") == true && types.optJSONObject("enabled")?.optBoolean("supported") == false) deep.put("type", "adaptive")
                    details.put("deepThinking", deep)
                }
                metadata[modelId] = details
                DiscoveredModel(modelId, phoneModelDisplayName(modelId, supplied))
            }.distinctBy { it.id }
        } catch (error: Exception) {
            status = phoneCatalogFailureStatus(error)
            emptyList()
        }
        secrets.cacheModelServiceCatalog(id, models, status, scope, metadata, model)
        return secrets.modelServices(scope).put("model", secrets.model(scope)?.let { modelView(it) } ?: JSONObject.NULL)
    }
    fun complete(body: JSONObject, active: AtomicReference<HttpURLConnection?>, serviceId: String? = null, progress: (String) -> Unit): JSONObject {
        val model = if (serviceId != null) {
            val profile = secrets.modelServiceProfile(serviceId, scope())
            profile.copy(modelId = body.getString("model"))
        } else secrets.model(scope()) ?: throw ApiFailure(409, "MODEL_NOT_CONFIGURED")
        require(body.getString("model") == model.modelId && !body.has("tools") && !body.has("tool_choice"))
        if (model.interfaceType == "anthropic") {
            val messages = body.getJSONArray("messages")
            val inputs = JSONArray(); val system = mutableListOf<String>()
            for (index in 0 until messages.length()) {
                val message = messages.getJSONObject(index)
                if (message.optString("role") == "system") system += message.optString("content") else inputs.put(message)
            }
            val payload = JSONObject().put("model", model.modelId).put("messages", inputs).put("max_tokens", 4096)
                .put("system", system.joinToString("\n\n")).put("stream", false)
            body.optJSONObject("thinking")?.let { payload.put("thinking", it) }
            val response = catalogHttp.request(model.endpoint.removeSuffix("/chat/completions") + "/messages", "POST", payload,
                mapOf("x-api-key" to model.apiKey, "anthropic-version" to "2023-06-01"), active, 180_000).body
            if (response.optString("stop_reason") !in setOf("", "end_turn", "stop_sequence")) throw ApiFailure(502, "MODEL_STREAM_INCOMPLETE")
            val blocks = response.optJSONArray("content") ?: throw ApiFailure(502, "MODEL_UNAVAILABLE")
            val text = (0 until blocks.length()).mapNotNull { blocks.optJSONObject(it)?.takeIf { row -> row.optString("type") == "text" }?.optString("text") }.joinToString("")
            progress(text)
            return JSONObject().put("choices", JSONArray().put(JSONObject().put("message", JSONObject().put("content", text))))
        }
        val collector = SseMessageCollector(progress, {})
        val full = JsonHttp().streamRequest(Endpoints.modelUrl(model.endpoint), body,
            mapOf("Authorization" to "Bearer ${model.apiKey}"), active, 180_000, collector::accept)
        if (full != null) return full
        if (collector.finishReason != "stop") throw ApiFailure(502, "MODEL_STREAM_INCOMPLETE")
        return JSONObject().put("choices", JSONArray().put(JSONObject().put("message", collector.message())))
    }
}
