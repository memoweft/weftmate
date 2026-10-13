package com.memoweft.weftmate.mobile

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class NativeFeedStateTest {
    private fun row(id:String,at:String="2026-10-13T01:00:00Z",pending:Boolean=false,read:Boolean=false)=JSONObject().put("id",id).put("at",at).put("type",if(pending)"approval.pending" else "task.completed").put("state",if(pending)"pending" else "completed").put("read",read).put("attentionRevision",7)
    private fun page(vararg rows:JSONObject)=JSONObject().put("items",JSONArray(rows.toList())).put("nextCursor","older").put("syncCursor","sync").put("snapshotCursor","frozen").put("unreadCount",3).put("actionableCount",1)
    @Test fun pendingRemainsFirstAcrossPagesAndIdsAreUnique() {
        val state=NativeFeedState();state.page(page(row("recent"),row("pending","2026-10-01T01:00:00Z",true)))
        state.page(page(row("recent",read=true),row("old","2026-09-30T01:00:00Z")),true)
        assertEquals(listOf("pending","recent","old"),state.items.map{it.getString("id")});assertTrue(state.items[1].getBoolean("read"));assertEquals("sync",state.syncCursor)
    }
    @Test fun changesResolvePendingAndUpdateCountsWithoutInventingRead() {
        val state=NativeFeedState();state.page(page(row("a",pending=true)));state.changes(JSONObject().put("upserts",JSONArray().put(row("a",read=false))).put("nextCursor","s2").put("unreadCount",1).put("actionableCount",0))
        assertEquals("completed",state.items.single().getString("state"));assertFalse(state.items.single().getBoolean("read"));assertEquals(1,state.unread);assertEquals(0,state.actionable)
    }
    @Test fun filteredDeltaRemovesReadOrResolvedRows() {
        val state=NativeFeedState();state.filter="unread";state.page(page(row("a")));state.changes(JSONObject().put("upserts",JSONArray().put(row("a",read=true))))
        assertTrue(state.items.isEmpty());state.filter="actionable";state.page(page(row("b",pending=true)));state.changes(JSONObject().put("upserts",JSONArray().put(row("b"))))
        assertTrue(state.items.isEmpty())
    }
    @Test fun deletionInvalidatesFrozenPagesAndIdentityClearDropsCounts() {
        val state=NativeFeedState();state.page(page(row("a")));assertFalse(state.changes(JSONObject().put("removals",JSONArray().put("a"))))
        assertTrue(state.items.isEmpty());assertEquals("",state.nextCursor);assertEquals(0,state.unread);state.page(page(row("b")));state.clear();assertEquals(0,state.actionable)
    }
    @Test fun readReceiptUsesVisibleAttentionRevisionAndDoesNotApprove() {
        val r=row("a",pending=true);val body=feedReadBody(r,"same-request")
        assertEquals(7,body.getLong("attentionRevision"));assertTrue(body.getBoolean("read"));assertEquals("same-request",body.getString("requestId"));assertFalse(body.has("outcome"));assertEquals("pending",r.getString("state"))
    }
    @Test fun launchUsesOnlyAccountValidatedBootstrapId() {
        assertEquals("",feedLaunchId(JSONObject().put("activityId","foreign")));assertEquals("activity-a",feedLaunchId(JSONObject().put("launchActivityId","activity-a")))
        for(id in listOf("../a","a/b","null",""))assertEquals("",feedLaunchId(JSONObject().put("launchActivityId",id)))
    }
    @Test fun phoneAccountHasAccessibleEmptyPageWithoutAComputerRequest() {
        assertTrue(feedHasNoComputer(JSONObject().put("loggedIn",true).put("authSource","phone")))
        assertTrue(feedHasNoComputer(JSONObject().put("phoneOnly",true)))
        assertTrue(feedHasNoComputer(JSONObject().put("hostAvailable",false)))
        assertFalse(feedHasNoComputer(JSONObject().put("loggedIn",true).put("authSource","local")))
        assertFalse(feedHasNoComputer(JSONObject().put("hostAvailable",true)))
    }
    @Test fun exactCardAndEventAnchorsDoNotMatchAnotherSession() {
        val e=JSONObject().put("eventId","event-a").put("sourceRef",JSONObject().put("sessionId","s1").put("seq",12)).put("data",JSONObject().put("approvalId","approval-a"))
        assertTrue(feedTargetMatches(e,JSONObject().put("approvalId","approval-a")));assertTrue(feedTargetMatches(e,JSONObject().put("eventId","event-a")))
        assertFalse(feedTargetMatches(e,JSONObject().put("eventId","event-a").put("questionRpcId","question-a")))
        assertTrue(feedTargetMatches(e,JSONObject().put("sessionId","s1").put("seq",12)));assertFalse(feedTargetMatches(e,JSONObject().put("sessionId","s2").put("seq",12)))
    }
    @Test fun timeUsesAccountDayAndHasNoSecondsOrInternalZone() {
        val now=Instant.parse("2026-10-13T02:00:00Z")
        assertEquals("今天 9:00",feedTime("2026-10-13T01:00:00Z","Asia/Shanghai",now));assertEquals("昨天 9:00",feedTime("2026-10-12T01:00:00Z","Asia/Shanghai",now))
        assertEquals("周日 9:00",feedTime("2026-10-11T01:00:00Z","Asia/Shanghai",now));assertEquals("9 月 1 日 9:00",feedTime("2026-09-01T01:00:00Z","Asia/Shanghai",now))
    }
}
