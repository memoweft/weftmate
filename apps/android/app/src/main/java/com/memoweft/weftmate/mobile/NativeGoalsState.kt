package com.memoweft.weftmate.mobile

import org.json.JSONObject
import java.time.*
import java.time.format.DateTimeFormatter
import java.util.UUID

internal fun goalSession(row: JSONObject) = row.stringOrEmpty("sessionId").ifEmpty { row.optJSONObject("source")?.stringOrEmpty("sessionId").orEmpty() }
internal fun goalRowKey(row: JSONObject) = "${row.stringOrEmpty("hostId")}:${goalSession(row)}:${row.stringOrEmpty("id").ifEmpty { row.stringOrEmpty("taskId") }}"
internal fun goalMerge(rows: List<JSONObject>, invalidatedHosts:Set<String> = emptySet()) = rows.filter{it.stringOrEmpty("hostId") !in invalidatedHosts}.associateBy(::goalRowKey).values.toList()
internal fun goalComputerLabel(row: JSONObject, computers: List<JSONObject>): String = if(computers.size <= 1) "" else computers.firstOrNull { it.stringOrEmpty("hostId") == row.stringOrEmpty("hostId") }?.let { it.stringOrEmpty("displayName").ifEmpty { it.stringOrEmpty("name") } }.orEmpty()
internal fun goalState(row: JSONObject): String = when(row.stringOrEmpty("state").ifEmpty { row.stringOrEmpty("phase").ifEmpty { row.stringOrEmpty("status") } }) {
    "scheduled" -> "已启用"; "active", "running" -> "进行中"; "paused" -> "已暂停"; "complete", "completed" -> "已完成"; "blocked" -> "需要处理"
    "queued" -> "排队中"; "approval" -> "等待审批"; "question" -> "等待回答"; "stopping" -> "正在停止"; "stopped" -> "已停止"; "failed" -> "失败"; else -> "结果待确认"
}
internal fun goalZone(value: String) = runCatching { ZoneId.of(value) }.getOrDefault(ZoneId.systemDefault())
internal fun goalInstant(value: Any?): Instant? = when(value) { is Number -> Instant.ofEpochMilli(value.toLong()); is String -> runCatching { Instant.parse(value) }.getOrNull(); else -> null }
internal fun goalTime(value: Any?, zone: String, now: Instant = Instant.now()): String {
    val instant=goalInstant(value) ?: return ""; val date=instant.atZone(goalZone(zone)); val today=now.atZone(goalZone(zone)).toLocalDate()
    val days=java.time.temporal.ChronoUnit.DAYS.between(today,date.toLocalDate()); val clock=date.format(DateTimeFormatter.ofPattern("H:mm"))
    return when(days) { 0L -> "今天 $clock"; 1L -> "明天 $clock"; -1L -> "昨天 $clock"; in 2L..6L -> "周${"一二三四五六日"[date.dayOfWeek.value-1]} $clock"; else -> "${if(date.year!=today.year) "${date.year} 年 " else ""}${date.monthValue} 月 ${date.dayOfMonth} 日 $clock" }
}
internal fun goalFrequency(row: JSONObject): String {
    val r=row.optJSONObject("repeat") ?: return "一次性"; val t=r.stringOrEmpty("time").take(5).removePrefix("0")
    return when(r.stringOrEmpty("kind")) { "daily" -> "每天 $t"; "weekly" -> "每周${"日一二三四五六".getOrNull(r.optInt("weekday")) ?: '一'} $t"; "monthly" -> "每月 ${r.optInt("day")} 日 $t"; "interval" -> r.optInt("seconds").let { if(it%3600==0) "每 ${it/3600} 小时" else if(it%60==0) "每 ${it/60} 分钟" else "每 $it 秒" }; else -> "重复安排" }
}
internal fun goalResult(row: JSONObject, now: Instant=Instant.now()): String {
    if(row.isNull("lastRunAt")||!row.has("lastRunAt"))return "尚未运行"
    val state=row.optJSONObject("lastResult")?.stringOrEmpty("state"); val at=goalInstant(row.opt("lastRunAt")); val recent=at!=null&&Duration.between(at,now).seconds in 0..59
    val result=when(state) { "delivered" -> "已提醒"; "completed" -> "已完成"; "failed" -> "失败"; "stopped" -> "已停止"; "queued" -> "等待执行"; else -> "结果待确认" }
    return if(recent) "刚刚${when(state){"completed"->"完成";"delivered"->"提醒";else->" · $result"}}" else "${goalTime(row.opt("lastRunAt"),row.stringOrEmpty("timeZone"),now)} · $result"
}

/** A form retains its exact intent after a lost response; editing does not create a second write. */
internal class GoalDraft(val kind: String, val original: JSONObject? = null, zone: String = "", selectedSession: String = "", host: String = "") {
    var title=original?.stringOrEmpty(if(kind=="schedule")"text" else "title").orEmpty()
    var description=original?.stringOrEmpty("description").orEmpty()
    var session=original?.let(::goalSession) ?: selectedSession
    var hostId=original?.stringOrEmpty("hostId") ?: host
    var mode=original?.stringOrEmpty("kind") ?: "reminder"
    var repeat=original?.optJSONObject("repeat")?.stringOrEmpty("kind") ?: if(original==null)"daily" else "once"
    private val initial=(goalInstant(original?.opt("nextRunAt")) ?: Instant.now().plusSeconds(3600)).atZone(goalZone(zone))
    var date=initial.toLocalDate().toString()
    var time=original?.optJSONObject("repeat")?.stringOrEmpty("time")?.take(5) ?: initial.format(DateTimeFormatter.ofPattern("HH:mm"))
    var weekday=original?.optJSONObject("repeat")?.optInt("weekday",1) ?: 1
    var monthday=original?.optJSONObject("repeat")?.optInt("day",1) ?: 1
    var seconds=(original?.optJSONObject("repeat")?.optInt("seconds",300) ?: 300).toString()
    var requestId=UUID.randomUUID().toString(); private set
    var pending: JSONObject?=null; private set
    fun validate(zone: String, now: Instant=Instant.now()): String {
        if(title.isBlank())return if(kind=="schedule")"请写下要做什么。" else "请写下目标标题。"
        if(title.length>if(kind=="schedule")32000 else 160)return "内容太长，请精简后再保存。"
        if(description.length>32000)return "目标说明太长，请精简后再保存。"
        if(session.isBlank())return "先开始一个对话，再来关联安排或目标。"
        if(kind!="schedule")return ""
        if(mode !in listOf("reminder","task"))return "请选择到点做什么。"
        if(repeat=="interval")return if(seconds.toIntOrNull()?.let{it>=300}==true)"" else "间隔至少 300 秒，请填写整数。"
        val local=runCatching{LocalTime.parse(time)}.getOrNull() ?: return "请选择有效时间。"
        if(repeat=="once") {
            val day=runCatching{LocalDate.parse(date)}.getOrNull() ?: return "请选择有效日期。"
            val stamp=LocalDateTime.of(day,local); val z=goalZone(zone)
            if(z.rules.getValidOffsets(stamp).isEmpty())return "这个时间不存在，请换一个时间。"
            if(!stamp.atZone(z).toInstant().isAfter(now))return "请选择之后的时间。"
        }
        if(repeat=="weekly"&&weekday !in 0..6)return "请选择星期。"
        if(repeat=="monthly"&&monthday !in 1..31)return "每月日期要在 1 到 31 日之间。"
        if(repeat !in listOf("once","daily","weekly","monthly"))return "请选择重复规则。"
        return ""
    }
    fun body(): JSONObject {
        pending?.let { return JSONObject(it.toString()) }
        val b=JSONObject().put("requestId",requestId).put("sessionId",session)
        if(kind=="goal") b.put("title",title.trim()).put("description",description.trim())
        else {
            b.put("text",title.trim()).put("kind",mode);original?.let { b.put("expectedRevision",it.getLong("revision")) }
            if(repeat=="once") b.put("at",JSONObject().put("date",date).put("time","$time:00"))
            else b.put("repeat",JSONObject().put("kind",repeat).apply { if(repeat=="interval")put("seconds",seconds.toInt()) else put("time","$time:00");if(repeat=="weekly")put("weekday",weekday);if(repeat=="monthly")put("day",monthday) })
        }
        pending=JSONObject(b.toString());return b
    }
    fun rejected(){pending=null;requestId=UUID.randomUUID().toString()}
}
