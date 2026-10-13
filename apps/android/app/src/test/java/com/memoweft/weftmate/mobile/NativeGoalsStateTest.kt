package com.memoweft.weftmate.mobile

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class NativeGoalsStateTest {
    private val now=Instant.parse("2026-10-14T01:00:00Z")
    private fun row(host:String="desk",session:String="s")=JSONObject().put("id","same").put("hostId",host).put("sessionId",session)
    private fun draft(kind:String="schedule")=GoalDraft(kind,selectedSession="session",host="desk").apply{title="提醒喝水";time="09:00";date="2026-10-15"}
    @Test fun mergeKeepsComputerAndConversationNamespaces(){val first=row();val updated=row().put("revision",2);assertEquals(3,goalMerge(listOf(first,updated,row("laptop"),row(session="other"))).size);assertEquals(2,goalMerge(listOf(first,updated)).single().getInt("revision"))}
    @Test fun computerLabelsOnlyAppearForMultipleComputers(){val computers=listOf(JSONObject().put("hostId","desk").put("name","合成电脑"),JSONObject().put("hostId","laptop").put("displayName","合成电脑 (2)"));assertEquals("",goalComputerLabel(row(),computers.take(1)));assertEquals("合成电脑 (2)",goalComputerLabel(row("laptop"),computers))}
    @Test fun stateUsesActualScheduleAndGoalPhases(){for((state,label)in listOf("scheduled" to "已启用","paused" to "已暂停","completed" to "已完成"))assertEquals(label,goalState(row().put("state",state)));assertEquals("需要处理",goalState(row().put("phase","blocked")));assertEquals("进行中",goalState(row().put("phase","active")))}
    @Test fun timeUsesAccountZoneAndNoSeconds(){assertEquals("明天 9:00",goalTime("2026-10-15T01:00:00Z","Asia/Shanghai",now));assertEquals("今天 9:00",goalTime(now.toEpochMilli(),"Asia/Shanghai",now));assertEquals("周五 9:00",goalTime("2026-10-16T01:00:00Z","Asia/Shanghai",now));assertEquals("",goalTime("broken","Asia/Shanghai",now))}
    @Test fun resultDistinguishesAcceptedFromCompleted(){val r=row().put("timeZone","Asia/Shanghai");assertEquals("尚未运行",goalResult(r,now));r.put("lastRunAt",now.minusSeconds(20).toString()).put("lastResult",JSONObject().put("state","queued"));assertEquals("刚刚 · 等待执行",goalResult(r,now));r.getJSONObject("lastResult").put("state","completed");assertEquals("刚刚完成",goalResult(r,now))}
    @Test fun allFiveRepeatRulesHaveBodies(){for(kind in listOf("once","daily","weekly","monthly","interval")){val d=draft().apply{repeat=kind};assertEquals("",d.validate("Asia/Shanghai",now));val b=d.body();if(kind=="once")assertEquals("2026-10-15",b.getJSONObject("at").getString("date"))else assertEquals(kind,b.getJSONObject("repeat").getString("kind"));assertFalse(b.has("timeZone"))}}
    @Test fun validatesRequiredContentConversationIntervalAndRealDates(){val d=draft();d.title=" ";assertTrue(d.validate("Asia/Shanghai",now).isNotEmpty());d.title="a";d.session="";assertTrue(d.validate("Asia/Shanghai",now).isNotEmpty());d.session="s";d.repeat="interval";for(s in listOf("299","300.5","x")){d.seconds=s;assertTrue(d.validate("Asia/Shanghai",now).isNotEmpty())};d.repeat="once";d.date="2026-02-30";assertTrue(d.validate("Asia/Shanghai",now).isNotEmpty());d.date="2026-10-13";assertTrue(d.validate("Asia/Shanghai",now).isNotEmpty())}
    @Test fun daylightGapIsRejectedAndAmbiguousTimeRemainsValid(){val d=draft().apply{repeat="once";date="2027-03-14";time="02:30"};assertTrue(d.validate("America/New_York",now).contains("不存在"));d.date="2026-11-01";d.time="01:30";assertEquals("",d.validate("America/New_York",now))}
    @Test fun uncertainSaveKeepsExactBodyAndId(){val d=draft();val body=d.body().toString();d.title="改过的内容";d.repeat="weekly";assertEquals(body,d.body().toString());val id=d.requestId;d.rejected();assertNotEquals(id,d.requestId);assertEquals("改过的内容",d.body().getString("text"))}
    @Test fun editCarriesRevisionAndOriginalSession(){val d=GoalDraft("schedule",row().put("revision",8).put("text","原内容").put("kind","task").put("repeat",JSONObject().put("kind","daily").put("time","09:00:00")));val b=d.body();assertEquals(8,b.getInt("expectedRevision"));assertEquals("s",b.getString("sessionId"));assertEquals("task",b.getString("kind"))}
    @Test fun goalCheckpointsAreExplanationAndNotInventedEndpoint(){val d=draft("goal").apply{description="检查点：先整理资料，再写结论。"};assertEquals("",d.validate("Asia/Shanghai",now));assertEquals(d.description,d.body().getString("description"));assertFalse(d.body().has("checkpoints"));d.title="a".repeat(161);assertTrue(d.validate("Asia/Shanghai",now).isNotEmpty())}
}
