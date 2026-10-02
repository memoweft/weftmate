package com.memoweft.weftmate.mobile

import org.json.JSONArray
import org.json.JSONObject

/** Assembles OpenAI-compatible assistant deltas without inventing reasoning text. */
class SseMessageCollector(private val onProgress: (String) -> Unit,
    private val onPhase: (String) -> Unit) {
    private data class ToolParts(var id: String = "", val name: StringBuilder = StringBuilder(),
        val arguments: StringBuilder = StringBuilder())
    private val tools = sortedMapOf<Int, ToolParts>()
    private val text = StringBuilder()
    private var phase = "waiting"
    val partialText: String get() = text.toString()
    var finishReason: String? = null
        private set

    fun accept(raw: String) {
        val frame = try { JSONObject(raw) } catch (_: Exception) { throw ApiFailure(502, "MODEL_STREAM_INVALID") }
        if (frame.has("error")) throw ApiFailure(502, "MODEL_STREAM_FAILED")
        val choice = frame.optJSONArray("choices")?.optJSONObject(0) ?: return
        if (!choice.isNull("finish_reason")) {
            val reason = choice.optString("finish_reason")
            if (reason.isNotEmpty()) finishReason = reason
        }
        val delta = choice.optJSONObject("delta") ?: return
        val reasoning = if (delta.isNull("reasoning_content")) "" else delta.optString("reasoning_content")
        if (reasoning.isNotEmpty() && phase == "waiting") { phase = "reasoning"; onPhase("reasoning") }
        val next = if (delta.isNull("content")) "" else delta.optString("content")
        if (next.isNotEmpty()) {
            if (phase != "answering") { phase = "answering"; onPhase("answering") }
            text.append(next)
            if (text.length > 16_384) throw ModelNotCompleted(text.toString().take(16_384), "MODEL_OUTPUT_LIMIT")
            onProgress(text.toString())
        }
        val calls = delta.optJSONArray("tool_calls")
        if (calls != null) for (index in 0 until calls.length()) {
            val row = calls.optJSONObject(index) ?: continue
            val number = row.optInt("index", -1)
            if (number !in 0..2) throw ApiFailure(502, "MODEL_TOOL_CALL_INVALID")
            if (phase != "tool") { phase = "tool"; onPhase("tool") }
            val parts = tools.getOrPut(number) { ToolParts() }
            val id = row.optString("id")
            if (id.isNotEmpty()) parts.id = id
            val function = row.optJSONObject("function")
            if (function != null) {
                parts.name.append(function.optString("name"))
                parts.arguments.append(function.optString("arguments"))
                if (parts.name.length > 128 || parts.arguments.length > 16_384)
                    throw ApiFailure(502, "MODEL_TOOL_CALL_INVALID")
            }
        }
    }

    fun message(): JSONObject {
        val result = JSONObject().put("role", "assistant")
            .put("content", text.toString())
        if (tools.isNotEmpty()) {
            val calls = JSONArray()
            for ((_, parts) in tools) {
                if (parts.id.isBlank() || parts.name.isBlank()) throw ApiFailure(502, "MODEL_TOOL_CALL_INVALID")
                calls.put(JSONObject().put("id", parts.id).put("type", "function")
                    .put("function", JSONObject().put("name", parts.name.toString())
                        .put("arguments", parts.arguments.toString())))
            }
            result.put("tool_calls", calls)
        }
        return result
    }
}
