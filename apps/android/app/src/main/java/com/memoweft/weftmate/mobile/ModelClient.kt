package com.memoweft.weftmate.mobile

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

class ModelCancelled(val partialText: String = "") : Exception()
class ModelNotCompleted(val partialText: String, val code: String) : Exception(code)
class ModelLimitReached : Exception()

/** Only Xiaomi's official API uses this case-insensitive MiMo model naming scheme. */
internal fun officialXiaomiChatEndpoint(settings: ModelSettings): Boolean {
    val url = URL(Endpoints.modelUrl(settings.endpoint))
    return url.protocol == "https" && url.host.equals("api.xiaomimimo.com", ignoreCase = true) &&
        (url.port == -1 || url.port == 443) && url.path == "/v1/chat/completions"
}

/** Catalog filtering is limited to known non-chat MiMo families on the official provider. */
internal fun isChatCatalogModel(settings: ModelSettings, modelId: String): Boolean {
    if (!officialXiaomiChatEndpoint(settings)) return true
    val id = modelId.lowercase(Locale.ROOT)
    return id != "mimo-v2.5-asr" && !Regex("mimo-v2\\.5-tts(?:-[a-z0-9]+)*").matches(id)
}

internal fun requestModelId(settings: ModelSettings): String {
    val mimoId = Regex("mimo-v[0-9]+(?:\\.[0-9]+)*-[a-z0-9]+(?:-[a-z0-9]+)*", RegexOption.IGNORE_CASE)
    return if (officialXiaomiChatEndpoint(settings) && mimoId.matches(settings.modelId))
        settings.modelId.lowercase(Locale.ROOT) else settings.modelId
}

internal fun supportsAttachmentImage(settings: ModelSettings): Boolean {
    return !officialXiaomiChatEndpoint(settings) || requestModelId(settings) == "mimo-v2.6-flash"
}

/** Phone-owned model loop. A provider decides language; the tool set alone defines executable power. */
class ModelClient(context: Context, private val http: JsonTransport = JsonHttp(),
    private val tools: DeviceToolExecutor = DeviceTools(context)) {
    private val cancelled = AtomicBoolean(false)
    private val active = AtomicReference<HttpURLConnection?>()

    fun cancel() { cancelled.set(true); active.getAndSet(null)?.disconnect() }

    private fun checkActive() { if (cancelled.get()) throw ModelCancelled() }

    private fun checkFinish(reason: String?, message: JSONObject) {
        val partial = if (message.isNull("content")) "" else message.optString("content", "")
        when (reason) {
            null, "", "stop" -> return // Some older compatible providers omit finish_reason.
            "tool_calls" -> if ((message.optJSONArray("tool_calls")?.length() ?: 0) > 0) return
                else throw ModelNotCompleted(partial, "MODEL_FINISH_UNKNOWN")
            "length" -> throw ModelNotCompleted(partial, "MODEL_OUTPUT_LIMIT")
            "content_filter" -> throw ModelNotCompleted(partial, "MODEL_CONTENT_FILTERED")
            else -> throw ModelNotCompleted(partial, "MODEL_FINISH_UNKNOWN")
        }
    }

    fun complete(settings: ModelSettings, history: List<LocalMessage>,
        receipt: (String, String, String, String) -> Unit,
        contextOmitted: (Int) -> Unit = {},
        onProgress: (String) -> Unit = {}, onPhase: (String) -> Unit = {},
        attachments: List<ChatAttachment> = emptyList(), attachmentStore: AttachmentStore? = null,
        onRequestStart: (String, String) -> Unit = { _, _ -> }): String {
        if (attachments.isNotEmpty() && attachmentStore == null) throw ApiFailure(400, "ATTACHMENT_INVALID")
        if (attachments.any { it.kind == "image" } && !supportsAttachmentImage(settings))
            throw ApiFailure(415, "MODEL_IMAGE_UNSUPPORTED")
        val messages = JSONArray().put(JSONObject().put("role", "system").put("content",
            "你是手机上的WeftMate助手。仅在用户要求手机动作时调用工具。打开应用后只能说明请求已派发，不能声称目标页面已核对。不要重复无进展动作。"))
        val selected = mutableListOf<LocalMessage>()
        var contextBytes = 0
        for (message in history.asReversed()) {
            val size = message.text.toByteArray(Charsets.UTF_8).size + 100
            if (selected.isEmpty() && size > 160 * 1024) throw ApiFailure(413, "MODEL_CONTEXT_TOO_LARGE")
            if (selected.size >= 30 || contextBytes + size > 160 * 1024) break
            selected += message
            contextBytes += size
        }
        contextOmitted(history.size - selected.size)
        for (message in selected.asReversed()) {
            val content: Any = if (message.id == history.lastOrNull()?.id && attachments.isNotEmpty()) {
                val parts = attachments.filter { it.kind == "file" }.map {
                    "文件：${it.name}\n${attachmentStore!!.text(it)}"
                }
                val textContent = (listOf(message.text) + parts).joinToString("\n\n")
                if (attachments.none { it.kind == "image" }) textContent else {
                    val blocks = JSONArray().put(JSONObject().put("type", "text").put("text", textContent))
                    for (attachment in attachments.filter { it.kind == "image" })
                        blocks.put(JSONObject().put("type", "image_url")
                            .put("image_url", JSONObject().put("url", attachmentStore!!.dataUri(attachment))))
                    blocks
                }
            } else message.text
            messages.put(JSONObject().put("role", message.role).put("content", content))
        }
        val seen = mutableMapOf<String, Int>()
        val dispatched = mutableSetOf<String>()
        val definitions = toolDefinitions()
        repeat(6) {
            checkActive()
            val payload = JSONObject().put("model", requestModelId(settings)).put("messages", messages)
                .put("stream", http is SseTransport).put("tools", definitions).put("tool_choice", "auto")
            val payloadLimit = if (attachments.any { it.kind == "image" }) 14 * 1024 * 1024 else 240 * 1024
            if (payload.toString().toByteArray(Charsets.UTF_8).size > payloadLimit)
                throw ApiFailure(413, if (attachments.any { it.kind == "image" })
                    "ATTACHMENT_TOO_LARGE" else "MODEL_CONTEXT_TOO_LARGE")
            val headers = if (settings.apiKey.isBlank()) emptyMap() else mapOf("Authorization" to "Bearer ${settings.apiKey}")
            onPhase("waiting")
            val requestUrl = Endpoints.modelUrl(settings.endpoint)
            onRequestStart(requestUrl, payload.getString("model"))
            val (answer, finishReason) = if (http is SseTransport) {
                val collector = SseMessageCollector(onProgress, onPhase)
                try {
                    val full = http.streamRequest(requestUrl, payload, headers,
                        active, 300_000, collector::accept)
                    if (cancelled.get()) throw ModelCancelled(collector.partialText)
                    if (full != null) {
                        val choice = full.getJSONArray("choices").getJSONObject(0)
                        choice.getJSONObject("message") to (if (choice.isNull("finish_reason")) null else
                            choice.optString("finish_reason").takeIf { it.isNotEmpty() })
                    } else collector.message() to collector.finishReason
                } catch (error: Exception) {
                    if (cancelled.get() || error is ModelCancelled) throw ModelCancelled(collector.partialText)
                    throw error
                }
            } else {
                val reply = try { http.request(requestUrl, "POST", payload, headers, active, 300_000).body }
                    catch (error: Exception) { checkActive(); throw error }
                val choice = reply.getJSONArray("choices").getJSONObject(0)
                choice.getJSONObject("message") to (if (choice.isNull("finish_reason")) null else
                    choice.optString("finish_reason").takeIf { it.isNotEmpty() })
            }
            checkActive()
            checkFinish(finishReason, answer)
            val calls = answer.optJSONArray("tool_calls")
            if (calls == null || calls.length() == 0) {
                val text = (if (answer.isNull("content")) "" else answer.optString("content", "")).trim()
                if (text.isBlank()) throw ApiFailure(502, "MODEL_EMPTY_REPLY")
                if (text.length > 16_384) throw ModelNotCompleted(text.take(16_384), "MODEL_OUTPUT_LIMIT")
                onProgress(text)
                return text
            }
            if (calls.length() > 3) throw ModelLimitReached()
            messages.put(answer)
            for (index in 0 until calls.length()) {
                checkActive()
                val call = calls.getJSONObject(index)
                val providerId = call.optString("id")
                if (providerId.isBlank() || providerId.length > 128) throw ApiFailure(502, "MODEL_TOOL_CALL_INVALID")
                val function = call.getJSONObject("function")
                val name = function.getString("name")
                val args = try { JSONObject(function.optString("arguments", "{}")) }
                    catch (_: Exception) { throw ApiFailure(502, "MODEL_TOOL_CALL_INVALID") }
                val signature = "$name|${args}"
                val count = (seen[signature] ?: 0) + 1
                seen[signature] = count
                if (count > 2 || signature in dispatched) throw ModelLimitReached()
                val localCallId = "tool-${UUID.randomUUID()}"
                val result = try { tools.execute(name, args) }
                    catch (error: ModelCancelled) { throw ModelCancelled(answer.optString("content", "")) }
                receipt(localCallId, name, result.status, result.summary)
                if (result.status == "dispatched") dispatched += signature
                messages.put(JSONObject().put("role", "tool").put("tool_call_id", providerId)
                    .put("content", result.result.toString()))
            }
        }
        throw ModelLimitReached()
    }

    private fun toolDefinitions(): JSONArray {
        fun tool(name: String, description: String, properties: JSONObject = JSONObject(), required: JSONArray = JSONArray()) =
            JSONObject().put("type", "function").put("function", JSONObject().put("name", name)
                .put("description", description).put("parameters", JSONObject().put("type", "object")
                    .put("properties", properties).put("required", required).put("additionalProperties", false)))
        return JSONArray()
            .put(tool("list_launchable_apps", "列出这台手机当前可启动的应用，只在需要选择应用时使用"))
            .put(tool("open_app", "请求Android打开指定已安装应用；结果仅表示派发，不能证明已显示",
                JSONObject().put("packageName", JSONObject().put("type", "string")), JSONArray().put("packageName")))
            .put(tool("open_settings", "请求Android打开系统设置；结果仅表示派发"))
    }
}
