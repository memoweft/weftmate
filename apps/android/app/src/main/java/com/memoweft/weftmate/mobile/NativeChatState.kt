package com.memoweft.weftmate.mobile

import org.json.JSONArray
import org.json.JSONObject

internal fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
internal enum class ComposerHeight { Capsule, Draft, Attachments }
internal enum class ComposerAction { Voice, Send, Stop }
internal data class NativeComposerState(val text: String, val focused: Boolean, val attachments: Int, val running: Boolean, val queueSupported: Boolean = true) {
    val height get() = when { attachments > 0 -> ComposerHeight.Attachments; focused || text.isNotEmpty() -> ComposerHeight.Draft; else -> ComposerHeight.Capsule }
    val action get() = when { running && !queueSupported -> ComposerAction.Stop; text.isNotBlank() || attachments > 0 -> ComposerAction.Send; running -> ComposerAction.Stop; else -> ComposerAction.Voice }
}

/** Public cumulative snapshots replace a node. Neither live watermarks nor anchors are history cursors. */
internal class NativeTimeline {
    private val durable = linkedMapOf<String, JSONObject>()
    private var live = emptyList<JSONObject>()
    private var watermark = -1L
    private var revision: Long? = null
    private fun key(e: JSONObject): String = e.optString("eventId").ifBlank { "${session(e)}:${e.optLong("seq")}" }
    private fun session(e: JSONObject) = e.optJSONObject("sourceRef")?.optString("sessionId") ?: e.optString("sessionId")
    fun reset() { durable.clear(); live = emptyList(); watermark = -1; revision = null }
    fun merge(page: JSONObject, older: Boolean = false) {
        if (page.has("contentRevision")) {
            val next = page.getLong("contentRevision")
            if (revision != null && revision != next) reset()
            revision = next
        }
        val rows = page.optJSONArray("items") ?: page.optJSONArray("upserts") ?: page.optJSONArray("events") ?: JSONArray()
        for (e in rows.objects()) durable[key(e)] = e
        page.optJSONArray("removals")?.let { a -> for (i in 0 until a.length()) durable.remove(a.optString(i)) }
        val w = page.optLong("liveRevision", page.optLong("liveSeq", -1))
        if (!older && page.has("liveEvents") && w >= watermark) {
            watermark = w
            live = page.getJSONArray("liveEvents").objects()
        }
    }
    fun rows(): List<JSONObject> {
        val finals = durable.values.filter { it.optString("type") == "assistant.message" }
        val active = live.filter { e -> finals.none { f ->
            session(e) == session(f) && f.optJSONObject("data")?.optLong("streamSeq", -2) == e.optLong("seq", -1)
        } }
        return (durable.values + active).sortedWith(compareBy<JSONObject> { it.optString("orderKey").ifBlank { it.optLong("seq").toString().padStart(20, '0') } }.thenBy { it.optLong("seq") })
    }
}

/** Expansion belongs to presentation, never to persistent tool records. */
internal class NativeProgressState {
    private val expanded = mutableSetOf<String>()
    fun isExpanded(key: String) = key in expanded
    fun toggle(key: String) { if (!expanded.add(key)) expanded.remove(key) }
    fun visibleSteps(row: JSONObject): List<JSONObject> {
        val steps = row.optJSONObject("data")?.optJSONArray("steps")?.objects().orEmpty()
        return if (isExpanded(row.optString("eventId"))) steps else steps.filter { it.optBoolean("attention") }
    }
}

internal fun decisionReceipt(row: JSONObject, question: Boolean = false): String? = when (row.optString("status")) {
    "answered" -> if (question) "已提交 · 等待确认" else if (row.optString("decisionOutcome") == "rejected") "已拒绝 · 等待确认" else "已批准 · 等待确认"
    "resolved" -> if (question) "已回答" else if (row.optString("outcome", row.optString("decisionOutcome")) == "rejected") "已拒绝" else "已批准"
    "unavailable" -> "已结束"
    else -> null
}

/** Only the submitted prefix belongs to this receipt. Replacement drafts are independent. */
internal fun remainingNativeDraft(current: String, submitted: String): String =
    if (submitted.isNotEmpty() && current.startsWith(submitted)) current.removePrefix(submitted) else current
/** A read deadline is an error state; parent/lifecycle cancellation must still propagate. */
internal suspend fun <T> nativePageRead(timeoutMs: Long = 15000, read: suspend () -> T): T =
    try { kotlinx.coroutines.withTimeout(timeoutMs) { read() } }
    catch (e: kotlinx.coroutines.TimeoutCancellationException) {
        kotlin.coroutines.coroutineContext[kotlinx.coroutines.Job]?.let { if (!it.isActive) throw e }
        throw ApiFailure(408, "PAGE_READ_TIMEOUT")
    }
internal fun nativeAccountProjection(home: JSONObject): JSONObject {
    val result=JSONObject(home.toString())
    if(result.optBoolean("cloud")) {
        val email=result.stringOrEmpty("email")
        // The connected computer may only expose its local-owner compatibility profile.
        val profile=JSONObject().put("displayName",email.ifEmpty { "WeftMate 账户" })
        result.put("profile",profile).put("accountLabel",email.ifEmpty { "" })
    }
    return result
}
internal fun nativeBusinessResponseLimit(path: String): Int = when {
    path.substringBefore('?').matches(Regex("/personal/v1/library/[A-Za-z0-9_-]{1,128}/preview")) -> 28 * 1024 * 1024
    path.startsWith("/personal/v1/offline/") -> 4 * 1024 * 1024
    else -> 256 * 1024
}
internal fun nativePendingMessageVisible(command: JSONObject, rows: List<JSONObject>): Boolean {
    val request=command.stringOrEmpty("requestId")
    val receipt=command.stringOrEmpty("receiptId").ifEmpty { command.optJSONObject("command")?.stringOrEmpty("receiptId").orEmpty() }
    val receipts=rows.filter { it.optString("type")=="task.queued" }.mapNotNull {
        it.optJSONObject("data")?.takeIf { data -> request.isNotEmpty() && data.stringOrEmpty("requestId")==request }?.stringOrEmpty("receiptId")?.takeIf(String::isNotEmpty)
    }.toSet()+listOf(receipt).filter(String::isNotEmpty)
    return rows.none {
        val data=it.optJSONObject("data")
        it.optString("type")=="user.message" && data!=null &&
            (data.stringOrEmpty("receiptId") in receipts || request.isNotEmpty() && request==data.stringOrEmpty("requestId"))
    }
}

    internal fun nativePublicBusiness(value: Any?, depth: Int = 0, preview: Boolean = false): Any {
        if (depth > 8) throw ApiFailure(502, "BUSINESS_RESPONSE_INVALID")
        return when (value) {
            is JSONObject -> {
                val result = JSONObject()
                val forbidden = setOf("token", "password", "secret", "credential", "cookie", "csrftoken", "apikey",
                    "authorization", "salt", "hash")
                for (key in value.keys()) {
                    if (key.lowercase() in forbidden) continue
                    result.put(key, if(preview && key in setOf("data","text") && value.get(key) is String) value.getString(key) else nativePublicBusiness(value.get(key), depth + 1, preview))
                }
                result
            }
            is JSONArray -> {
                if (value.length() > 1000) throw ApiFailure(502, "BUSINESS_RESPONSE_INVALID")
                val result = JSONArray()
                for (index in 0 until value.length()) result.put(nativePublicBusiness(value.get(index), depth + 1, preview))
                result
            }
            is String -> value.take(16_384)
            is Number, is Boolean -> value
            else -> JSONObject.NULL
        }
    }
