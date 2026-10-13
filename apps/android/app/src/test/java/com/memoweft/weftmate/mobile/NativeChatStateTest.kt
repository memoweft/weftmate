package com.memoweft.weftmate.mobile

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeChatStateTest {
    @Test fun emptyComposerHasOneVoiceAction() { val c=NativeComposerState("",false,0,false);assertEquals(ComposerHeight.Capsule,c.height);assertEquals(ComposerAction.Voice,c.action) }
    @Test fun focusExpandsWithoutSending() { val c=NativeComposerState("",true,0,false);assertEquals(ComposerHeight.Draft,c.height);assertEquals(ComposerAction.Voice,c.action) }
    @Test fun retainedDraftStaysExpandedAfterKeyboardDismissal() { val c=NativeComposerState("你好",false,0,false);assertEquals(ComposerHeight.Draft,c.height);assertEquals(ComposerAction.Send,c.action) }
    @Test fun attachmentsStayExpandedAndCanSendWithoutText() { val c=NativeComposerState("",false,1,false);assertEquals(ComposerHeight.Attachments,c.height);assertEquals(ComposerAction.Send,c.action) }
    @Test fun runningEmptyDraftStopsButNewMessageCanQueue() { assertEquals(ComposerAction.Stop,NativeComposerState("",false,0,true).action);assertEquals(ComposerAction.Send,NativeComposerState("再问一件事",true,0,true).action) }
    @Test fun phoneGenerationKeepsStopAndRetainsTheDraftUntilCompletion() { val state=NativeComposerState("下一句话",true,0,true,false);assertEquals(ComposerAction.Stop,state.action);assertEquals("下一句话",state.text);assertEquals(ComposerAction.Send,state.copy(running=false).action) }
    private fun event(seq:Long,text:String,type:String="assistant.delta",stream:Long?=null)=JSONObject().put("seq",seq).put("type",type).put("sourceRef",JSONObject().put("sessionId","session-one")).put("data",JSONObject().put("text",text).apply{stream?.let{put("streamSeq",it)}})
    private fun page(w:Long,vararg e:JSONObject)=JSONObject().put("liveSeq",w).put("liveEvents",JSONArray(e.toList()))
    @Test fun cumulativeStreamReplacesInsteadOfAppending() { val t=NativeTimeline();t.merge(page(1,event(1,"你")));t.merge(page(2,event(1,"你好")));assertEquals(1,t.rows().size);assertEquals("你好",t.rows().single().getJSONObject("data").getString("text")) }
    @Test fun lateSnapshotCannotRollBackText() { val t=NativeTimeline();t.merge(page(3,event(1,"完整正文")));t.merge(page(2,event(1,"旧正文")));assertEquals("完整正文",t.rows().single().getJSONObject("data").getString("text")) }
    @Test fun historyPaginationDoesNotReplaceLiveSnapshot() { val t=NativeTimeline();t.merge(page(3,event(1,"正在回复")));t.merge(page(4),true);assertEquals(1,t.rows().size) }
    @Test fun emptyCurrentSnapshotClearsTransientText() { val t=NativeTimeline();t.merge(page(1,event(1,"正文")));t.merge(page(2));assertTrue(t.rows().isEmpty()) }
    @Test fun durableMessageReplacesItsLiveAnchor() { val t=NativeTimeline();t.merge(page(2,event(1,"正文")));t.merge(JSONObject().put("events",JSONArray().put(event(4,"正文","assistant.message",1))));assertEquals(1,t.rows().size);assertEquals("assistant.message",t.rows().single().getString("type")) }
    @Test fun sameAnchorFromAnotherSessionIsNotReplaced() { val t=NativeTimeline();t.merge(page(2,event(1,"正文")));val f=event(4,"其它回复","assistant.message",1).put("sourceRef",JSONObject().put("sessionId","other"));t.merge(JSONObject().put("events",JSONArray().put(f)));assertEquals(2,t.rows().size) }
    @Test fun contentRevisionInvalidatesOldTextAndSnapshot() { val t=NativeTimeline();t.merge(page(1,event(1,"删除前")).put("contentRevision",1));t.merge(page(2).put("contentRevision",2));assertTrue(t.rows().isEmpty()) }
    @Test fun registeredApprovalDoesNotClaimExecutionCompleted() { assertEquals("已批准 · 等待确认",decisionReceipt(JSONObject().put("status","answered").put("decisionOutcome","allowed-once"))) }
    @Test fun resolvedRejectionAndUnavailableHaveReceipts() { assertEquals("已拒绝",decisionReceipt(JSONObject().put("status","resolved").put("outcome","rejected")));assertEquals("已结束",decisionReceipt(JSONObject().put("status","unavailable")));assertNull(decisionReceipt(JSONObject().put("status","pending"))) }
}
