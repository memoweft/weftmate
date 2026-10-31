package com.memoweft.weftmate.mobile

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class NativeChatListTest {
    private val zone = ZoneId.of("Asia/Shanghai")
    private val today = LocalDate.of(2026, 10, 31)
    private fun chat(id: String, at: String, vararg flags: Pair<String, Any>) =
        JSONObject().put("chatId", id).put("title", id).put("at", at).put("revision", 7).apply { flags.forEach { (k, v) -> put(k, v) } }

    @Test fun decisionsOutrankRunningFailureAndUnread() {
        assertEquals(ChatDot.Attention, chatDot(chat("a", "", "attention" to "approval", "running" to true, "unread" to true)))
        assertEquals(ChatDot.Running, chatDot(chat("b", "", "running" to true, "unread" to true, "lastOutcome" to "failed")))
        assertEquals(ChatDot.Failed, chatDot(chat("c", "", "unread" to true, "lastOutcome" to "failed")))
        assertEquals(ChatDot.Unread, chatDot(chat("d", "", "unread" to true)))
        assertEquals(ChatDot.None, chatDot(chat("e", "", "attention" to JSONObject.NULL, "lastOutcome" to "failed")))
    }

    @Test fun pinnedFirstThenLocalDaysAndPhoneLast() {
        val rows = listOf(
            chat("old", "2026-10-20T03:00:00Z"), chat("phone", "", "nativePhone" to true),
            chat("late", "2026-10-30T17:30:00Z"), chat("pin", "2026-10-01T00:00:00Z", "pinned" to true),
            chat("yesterday", "2026-10-30T02:00:00Z"))
        val sections = chatSections(rows, today, zone)
        assertEquals(listOf("置顶", "今天", "昨天", "更早", "手机上的对话"), sections.map { it.title })
        assertEquals(listOf("late"), sections[1].rows.map { it.getString("chatId") })
        assertEquals("01:30", chatTime(rows[2], today, zone))
        assertEquals("10月20日", chatTime(rows[0], today, zone))
    }

    @Test fun menusOnlyOfferWritesTheHostAccepts() {
        assertEquals(listOf("pin", "unread", "rename", "group", "fork", "archive", "delete"), chatMenu(chat("a", ""), standalone = false))
        assertEquals(listOf("unread"), chatMenu(chat("m", "", "kind" to "main"), standalone = false))
        assertTrue(chatMenu(chat("p", "", "nativePhone" to true), standalone = false).isEmpty())
        assertTrue(chatMenu(chat("a", ""), standalone = true).isEmpty())
    }

    @Test fun writesCarryAFreshRequestAndTheRowRevision() {
        val row = chat("a", "")
        val first = chatWriteBody(row, JSONObject().put("pinned", true))
        val second = chatWriteBody(row)
        assertEquals(setOf("pinned", "requestId", "expectedRevision"), first.keySet())
        assertEquals(7L, first.getLong("expectedRevision"))
        assertNotEquals(first.getString("requestId"), second.getString("requestId"))
        assertTrue(chatMatches(row, " A ")); assertFalse(chatMatches(row, "b"))
    }
}
