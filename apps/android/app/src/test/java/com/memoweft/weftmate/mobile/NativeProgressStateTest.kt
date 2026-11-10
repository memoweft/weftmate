package com.memoweft.weftmate.mobile

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeProgressStateTest {
    private val fixtures=JSONObject(javaClass.getResource("/fix36-progress.json")!!.readText())
    private fun rows(mode:String)=fixtures.getJSONArray(mode).objects()
    private fun progress(mode:String)=rows(mode).single { it.optString("type")=="native.progress" }
    @Test fun twelveStepsStartAsOneCollapsedRowAboveReply() {
        val row=progress("completed");val state=NativeProgressState()
        assertEquals(12,row.getJSONObject("data").getJSONArray("steps").length())
        assertTrue(state.visibleSteps(row).isEmpty());assertFalse(state.isExpanded(row.getString("eventId")))
        assertEquals("assistant.message",rows("completed").last().getString("type"))
    }
    @Test fun expandingAndCollapsingUsesTheSameStableReplyKey() {
        val row=progress("completed");val key=row.getString("eventId");val state=NativeProgressState()
        state.toggle(key);assertEquals(12,state.visibleSteps(row).size);state.toggle(key);assertTrue(state.visibleSteps(row).isEmpty())
    }
    @Test fun runningUsesTheCurrentSharedHumanDescription() {
        val row=progress("running");assertEquals("正在读取邮件…",row.getJSONObject("data").getString("summary"))
        assertTrue(NativeProgressState().visibleSteps(row).isEmpty())
    }
    @Test fun failuresAndApprovalsRemainExposedWithoutOpeningTheWholeReply() {
        val state=NativeProgressState();assertEquals(1,state.visibleSteps(progress("failed")).size)
        assertEquals(1,state.visibleSteps(progress("approval")).size)
        assertEquals(1,rows("approval").count { it.optString("type")=="approval.requested" })
    }
    @Test fun historyAndRestartAlwaysStartCollapsedAndUseSharedMapping() {
        val row=progress("completed");val state=NativeProgressState();state.toggle(row.getString("eventId"))
        assertEquals(12,state.visibleSteps(row).size);assertTrue(NativeProgressState().visibleSteps(JSONObject(row.toString())).isEmpty())
        val summary=row.getJSONObject("data").getString("summary")
        assertTrue(summary.contains("查了健康数据"));assertTrue(summary.contains("查了日历"));assertFalse(summary.contains("准备可用工具"));assertFalse(row.toString().contains("调用扩展服务"))
    }
}
