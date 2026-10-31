package com.memoweft.weftmate.mobile

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeTurnTest {
    private val fixtures = JSONObject(javaClass.getResource("/fix36-progress.json")!!.readText())
    private fun rows(mode: String) = fixtures.getJSONArray(mode).objects()
    private fun row(type: String, text: String = "") = JSONObject().put("eventId", "$type:$text").put("type", type).put("data", JSONObject().put("text", text))

    @Test fun finishedStepsMoveAboveTheAnswerAndFold() {
        val ordered = nativeTurnRows(rows("completed"))
        assertEquals(listOf("user.message", "native.progress", "assistant.message"), ordered.map { it.getString("type") })
        val progress = ordered[1]
        assertTrue(progress.getString("eventId") in answeredProgress(ordered))
        assertEquals(StepLayout.Folded, stepLayout(12, progress.getJSONObject("data").optBoolean("running"), true))
    }

    @Test fun workingStepsStayFlatUntilTextArrives() {
        val ordered = nativeTurnRows(rows("running"))
        val progress = ordered.single { it.getString("type") == "native.progress" }
        assertFalse(progress.getString("eventId") in answeredProgress(ordered))
        assertEquals(StepLayout.Flat, stepLayout(12, true, false))
        assertEquals(StepLayout.Flat, stepLayout(1, false, true))
    }

    @Test fun eachTurnKeepsItsOwnStepsAndAnswer() {
        val first = rows("completed")
        val working = rows("running").single { it.getString("type") == "native.progress" }.put("eventId", "progress:turn-2")
        val second = listOf(row("user.message", "再问一次"), row("assistant.delta", ""), working)
        val ordered = nativeTurnRows(first + second)
        assertEquals(listOf("user.message", "native.progress", "assistant.message", "user.message", "assistant.delta", "native.progress"), ordered.map { it.getString("type") })
        assertEquals(setOf(ordered[1].getString("eventId")), answeredProgress(ordered))
    }

    @Test fun streamedMarkdownKeepsItsBlockShapes() {
        val streaming = parseMarkdown("## 标题\n\n1. 一\n- 二\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```kotlin\nval x = 1")
        assertEquals(MarkdownBlock.Heading(2, "标题"), streaming[0])
        assertEquals(MarkdownBlock.Item("1.", 0, "一"), streaming[1])
        assertEquals(MarkdownBlock.Item("•", 0, "二"), streaming[2])
        assertEquals(MarkdownBlock.Table(listOf("a", "b"), listOf(listOf("1", "2"))), streaming[3])
        assertEquals(MarkdownBlock.Code("kotlin", "val x = 1", false), streaming[4])
        assertEquals(MarkdownBlock.Code("kotlin", "val x = 1", true), parseMarkdown("```kotlin\nval x = 1\n```").single())
    }
}
