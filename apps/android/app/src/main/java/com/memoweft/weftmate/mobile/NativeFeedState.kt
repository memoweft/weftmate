package com.memoweft.weftmate.mobile

import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Server snapshots are authoritative. Reading never resolves an approval or question. */
internal class NativeFeedState {
    var filter = "all"
    var items = emptyList<JSONObject>(); private set
    var nextCursor = ""; private set
    var syncCursor = ""; private set
    var snapshotCursor = ""; private set
    var unread = 0; private set
    var actionable = 0; private set
    var timeZone = "Asia/Shanghai"; private set
    fun clear() { items=emptyList(); nextCursor=""; syncCursor=""; snapshotCursor=""; unread=0; actionable=0 }
    fun counts(page: JSONObject) { unread=page.optInt("unreadCount",unread); actionable=page.optInt("actionableCount",actionable) }
    fun accepts(row: JSONObject) = when(filter) {
        "unread" -> !row.optBoolean("read")
        "actionable" -> row.optString("state")=="pending"
        "task", "reminder", "memory" -> row.optString("type").startsWith("$filter.")
        else -> true
    }
    fun page(page: JSONObject, more: Boolean=false) {
        val rows=page.optJSONArray("items")?.objects().orEmpty()
        items=merge(if(more)items else emptyList(),rows)
        nextCursor=page.stringOrEmpty("nextCursor")
        if(!more) { syncCursor=page.stringOrEmpty("syncCursor"); snapshotCursor=page.stringOrEmpty("snapshotCursor") }
        timeZone=page.optString("timeZone",timeZone); counts(page)
    }
    /** Deletions invalidate frozen pagination; caller reloads, as the web client does. */
    fun changes(page: JSONObject): Boolean {
        if((page.optJSONArray("removals")?.length() ?: 0)>0) { clear(); return false }
        val updates=page.optJSONArray("upserts")?.objects().orEmpty()
        val ids=updates.map{it.optString("id")}.toSet()
        items=merge(items.filter{it.optString("id") !in ids},updates.filter(::accepts))
        syncCursor=page.stringOrEmpty("nextCursor"); snapshotCursor=page.stringOrEmpty("snapshotCursor"); counts(page)
        return true
    }
    fun acknowledge(row: JSONObject) { items=merge(items.filter{it.optString("id")!=row.optString("id")},listOf(row).filter(::accepts)) }
    private fun merge(old:List<JSONObject>, rows:List<JSONObject>) = (old+rows).associateBy{it.getString("id")}.values.sortedWith(
        compareByDescending<JSONObject>{it.optString("state")=="pending"}.thenByDescending{it.optString("at")}.thenByDescending{it.optString("id")})
}
internal fun JSONObject.stringOrEmpty(key:String) = optString(key).takeUnless{it=="null"}.orEmpty()
internal fun feedReadBody(row:JSONObject, requestId:String) = JSONObject().put("requestId",requestId).put("read",true).put("attentionRevision",row.getLong("attentionRevision"))
internal fun feedLaunchId(bootstrap:JSONObject) = bootstrap.stringOrEmpty("launchActivityId").takeIf{it.matches(Regex("[A-Za-z0-9_-]{1,160}"))}.orEmpty()
internal fun feedHasNoComputer(bootstrap:JSONObject) = bootstrap.optString("authSource")=="phone" || bootstrap.optBoolean("phoneOnly") || bootstrap.has("hostAvailable")&&!bootstrap.optBoolean("hostAvailable")
internal fun feedTargetMatches(row:JSONObject,target:JSONObject):Boolean {
    val data=row.optJSONObject("data") ?: JSONObject(); val source=row.optJSONObject("sourceRef") ?: JSONObject()
    for(key in listOf("approvalId","questionRpcId"))if(target.stringOrEmpty(key).isNotEmpty())return data.optString(key)==target.optString(key)
    return target.stringOrEmpty("eventId").let{it.isNotEmpty() && row.optString("eventId")==it} ||
        target.has("seq") && (source.optLong("seq",-1)==target.optLong("seq") || row.optLong("seq",-1)==target.optLong("seq")) &&
        (target.stringOrEmpty("sessionId").isEmpty() || source.optString("sessionId",row.optString("sessionId"))==target.optString("sessionId"))
}
internal fun feedTime(at:String,zone:String,now:Instant=Instant.now()):String = runCatching {
    val z=ZoneId.of(zone);val date=Instant.parse(at).atZone(z);val today=now.atZone(z).toLocalDate();val day=date.toLocalDate()
    val prefix=when { day==today->"今天"; day==today.minusDays(1)->"昨天"; day>=today.minusDays(6)&&day<today->listOf("周一","周二","周三","周四","周五","周六","周日")[day.dayOfWeek.value-1]; else->"${day.monthValue} 月 ${day.dayOfMonth} 日" }
    "$prefix ${date.format(DateTimeFormatter.ofPattern("H:mm",Locale.CHINA))}"
}.getOrDefault("")
