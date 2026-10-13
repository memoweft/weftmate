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

internal fun decisionReceipt(row: JSONObject, question: Boolean = false): String? = when (row.optString("status")) {
    "answered" -> if (question) "已提交 · 等待确认" else if (row.optString("decisionOutcome") == "rejected") "已拒绝 · 等待确认" else "已批准 · 等待确认"
    "resolved" -> if (question) "已回答" else if (row.optString("outcome", row.optString("decisionOutcome")) == "rejected") "已拒绝" else "已批准"
    "unavailable" -> "已结束"
    else -> null
}
