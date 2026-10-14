package com.memoweft.weftmate.mobile

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeChatHistoryTest {
    private val full = "河流沿岸的树木在晚风里轻轻摇晃。".repeat(450) + "全文结束。"
    @Test fun messageDetailUsesTheExistingNativeBridgeWithoutBusinessProjectionLimits() = runBlocking {
        val text = full.repeat(3)
        val detail = nativeMessageDetail("session-original", 42) { method, params ->
            // The actual native business transport rejects legacy detail paths.
            if (method == "host.business") throw IllegalArgumentException("legacy path is not a business route")
            assertEquals("shared.sessions.eventDetail", method)
            assertEquals("session-original", params.getString("sessionId")); assertEquals(42L, params.getLong("seq"))
            JSONObject().put("type", "assistant.message").put("text", text)
        }
        assertEquals(text, detail.getString("text"))
    }
    private fun message(type: String = "assistant.message") = JSONObject().put("eventId", "event-long").put("type", type)
        .put("sourceRef", JSONObject().put("sessionId", "session-original").put("seq", 42))
        .put("data", JSONObject().put("text", full.take(4000)).put("truncated", true))
    @Test fun truncatedHistoryReadsOriginalSourceAndPublishesTheEntireReply() = runBlocking {
        val timeline = NativeTimeline(); val requests = mutableListOf<Pair<String, Long>>()
        timeline.readPage(JSONObject().put("items", JSONArray().put(message()))) { session, seq ->
            requests.add(session to seq)
            JSONObject().put("type", "assistant.message").put("text", full)
        }
        assertEquals(listOf("session-original" to 42L), requests)
        assertEquals(full, timeline.rows().single().getJSONObject("data").getString("text"))
        assertFalse(timeline.rows().single().getJSONObject("data").optBoolean("truncated"))
    }
    @Test fun olderUserMessagesAlsoReadFullTextButToolsAndCompleteMessagesDoNot() = runBlocking {
        val timeline = NativeTimeline(); var requests = 0
        val user = message("user.message")
        val tool = message("tool.completed").put("eventId", "tool")
        val complete = message().put("eventId", "short").put("data", JSONObject().put("text", "短回复"))
        timeline.readPage(JSONObject().put("items", JSONArray().put(user).put(tool).put(complete)), older = true) { _, _ ->
            requests++; JSONObject().put("type", "user.message").put("text", full)
        }
        assertEquals(1, requests)
        assertEquals(full, timeline.rows().first { it.optString("type") == "user.message" }.getJSONObject("data").getString("text"))
    }
    @Test fun lateDetailAfterSwitchNeverEntersTheNewTimeline() = runBlocking {
        val timeline = NativeTimeline(); var selected = true
        timeline.readPage(JSONObject().put("items", JSONArray().put(message())), current = { selected }) { _, _ ->
            selected = false; timeline.reset()
            JSONObject().put("type", "assistant.message").put("text", full)
        }
        assertTrue(timeline.rows().isEmpty())
    }
    @Test fun incompleteOrWrongDetailIsNotPublishedAndTheSamePageCanRetry() = runBlocking {
        val timeline = NativeTimeline(); val page = JSONObject().put("upserts", JSONArray().put(message()))
        for (detail in listOf(JSONObject().put("type", "user.message").put("text", full),
            JSONObject().put("type", "assistant.message").put("text", full.take(4000)).put("truncated", true))) {
            try { timeline.readPage(page) { _, _ -> detail }; fail("Incomplete text must not look complete") }
            catch (_: IllegalStateException) { assertTrue(timeline.rows().isEmpty()) }
        }
        timeline.readPage(page) { _, _ -> JSONObject().put("type", "assistant.message").put("text", full) }
        assertEquals(full, timeline.rows().single().getJSONObject("data").getString("text"))
        assertTrue(page.getJSONArray("upserts").getJSONObject(0).getJSONObject("data").getBoolean("truncated"))
    }
    @Test fun generatedAndRenamedTitlesUseTheSameProjectionAsInitialSelection() {
        val chat = JSONObject().put("kind", "side").put("title", "新对话")
        assertEquals("新对话", hostChatTitle(chat))
        assertEquals("河流沿岸", hostChatTitle(chat.put("title", "河流沿岸")))
        assertEquals("改名后的对话", hostChatTitle(chat.put("title", "改名后的对话")))
        assertEquals("WeftMate", hostChatTitle(chat.put("kind", "main")))
    }
}
