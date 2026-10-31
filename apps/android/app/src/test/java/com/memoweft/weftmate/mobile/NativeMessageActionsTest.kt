package com.memoweft.weftmate.mobile

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeMessageActionsTest {
    private fun event(type: String, seq: Long, source: JSONObject? = null) =
        JSONObject().put("eventId", "$type-$seq").put("type", type).put("seq", seq).apply { source?.let { put("sourceRef", it) } }

    @Test fun hostActionsUseTheSourceSessionAndSequenceNotTheTimelineIndex() {
        val logical = event("assistant.message", 41, JSONObject().put("kind", "native").put("sessionId", "session-a").put("seq", 3))
        val ref = messageRef(logical, "session-fallback")!!
        assertEquals("session-a", ref.sessionId)
        assertEquals(3L, ref.event.getLong("seq"))
        assertEquals(41L, logical.getLong("seq"))
        assertEquals("session-fallback", messageRef(event("assistant.message", 7), "session-fallback")!!.sessionId)
        assertNull(messageRef(event("assistant.message", 7), ""))
    }

    @Test fun editingAndRegeneratingWaitForAQuietConnectedComputerChat() {
        assertNull(messageMutationBlock(local = false, running = false, connected = true, readOnly = false))
        assertEquals("回复进行中，结束后再操作", messageMutationBlock(false, true, true, false))
        assertEquals("电脑不在线，连上后再操作", messageMutationBlock(false, false, false, false))
        assertEquals("这段是在手机上聊的，需要先由电脑接续", messageMutationBlock(true, true, false, true))
    }

    @Test fun aVersionBarSitsUnderTheFirstReplyAfterTheBranchPoint() {
        val groups = listOf(JSONObject().put("action", "regenerate").put("versions", JSONArray()
            .put(JSONObject().put("sessionId", "session-a").put("afterSeq", 1))
            .put(JSONObject().put("sessionId", "session-b").put("afterSeq", 1))))
        val events = listOf(event("user.message", 1), event("assistant.message", 3), event("assistant.message", 5))
        assertEquals(1 to listOf("session-a", "session-b"), messageVersion(groups, "session-b", events[1], events))
        assertNull(messageVersion(groups, "session-b", events[2], events))
        assertNull(messageVersion(groups, "session-b", events[0], events))
        assertNull(messageVersion(groups, "session-other", events[1], events))
    }

    @Test fun typedTextReachesTheSharedCoreAsAStringLiteral() {
        val ref = MessageRef("session-a", event("user.message", 1))
        val script = MessageScripts.branch(ref, "edit", "\");alert(1);(\"", null)
        assertTrue(script.contains(JSONObject.quote("\");alert(1);(\"")))
        assertFalse(script.contains(",\");alert(1);(\","))
    }
}
