package com.memoweft.weftmate.mobile

import org.json.JSONObject
import java.time.LocalDate
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.roundToInt

internal val healthMetrics=linkedMapOf(
    "recovery" to ("恢复" to "分"),"sleep" to ("睡眠" to "分"),"load" to ("负荷" to "分"),
    "stress" to ("压力" to "分"),"energy" to ("电能" to "分"),"fitnessAge" to ("体能年龄" to "岁"),"activity" to ("活动" to "分"),
    "hrvSdnnMs" to ("心率变异性" to "毫秒"),"restingHeartRateBpm" to ("静息心率" to "次/分"),
    "respiratoryRateBrpm" to ("呼吸频率" to "次/分"),"spo2Pct" to ("血氧" to "%"),"wristTempC" to ("手腕温度" to "℃"),
    "sleepMinutes" to ("睡眠时长" to "分"),"deepMinutes" to ("深睡" to "分"),"remMinutes" to ("快速眼动" to "分"),"awakeMinutes" to ("清醒时长" to "分"),
    "steps" to ("步数" to "步"),"activeEnergyKcal" to ("活动能量" to "千卡"),"exerciseMinutes" to ("运动时长" to "分"),
    "usageLateNightMinutes" to ("深夜使用时长" to "分"),"usageActiveMinutes" to ("电脑使用时长" to "分"),"vo2Max" to ("最大摄氧量" to "毫升/千克/分"))
internal val healthVitals=listOf("hrvSdnnMs","restingHeartRateBpm","respiratoryRateBrpm","spo2Pct","wristTempC")
internal fun JSONObject.number(key:String):Double? = (opt(key) as? Number)?.toDouble()?.takeIf{it.isFinite()}
internal fun healthDuration(value:Double?):String {
    if(value==null||!value.isFinite())return "—"
    val minutes=value.roundToInt().coerceAtLeast(0)
    return if(minutes<60)"$minutes 分" else "${minutes/60} 小时"+if(minutes%60==0)"" else " ${minutes%60} 分"
}
internal fun healthValue(value:Double?,id:String=""):String {
    if(value==null||!value.isFinite())return "—"
    if(id.endsWith("Minutes")||id=="activity")return healthDuration(value)
    return NumberFormat.getNumberInstance(Locale.SIMPLIFIED_CHINESE).apply{val decimals=if(id in listOf("wristTempC","respiratoryRateBrpm","vo2Max"))1 else 0;minimumFractionDigits=decimals;maximumFractionDigits=decimals}.format(value)
}
internal fun healthReading(value:Double?,id:String)=healthValue(value,id)+if(value!=null&&!id.endsWith("Minutes")&&id!="activity")" ${healthMetrics[id]?.second.orEmpty()}" else ""
internal fun healthText(text:String):String=Regex("(\\d+(?:\\.\\d+)?)\\s*分钟").replace(text){match->match.groupValues[1].toDoubleOrNull()?.let(::healthDuration) ?: match.value}
internal fun healthDay(day:String,today:String):String=runCatching{val date=LocalDate.parse(day);if(day==today)"今天 · ${date.monthValue}月${date.dayOfMonth}日" else "${date.monthValue}月${date.dayOfMonth}日"}.getOrDefault("今天")
internal fun healthClock(time:String?,zone:String):String {
    if(time.isNullOrBlank())return "—"
    if(time.matches(Regex("\\d{2}:\\d{2}")))return time
    return runCatching{Instant.parse(time).atZone(ZoneId.of(zone)).format(DateTimeFormatter.ofPattern("HH:mm"))}.getOrDefault("—")
}
internal fun healthVital(overview:JSONObject?,id:String):JSONObject?=overview?.optJSONArray("vitals")?.objects()?.find{it.optString("id")==id} ?: overview?.optJSONObject("vitals")?.optJSONObject(id)
internal fun healthScope(id:String):String?=when(id){in listOf("recovery","sleep","load","stress","energy","fitnessAge","activity")->id;in listOf("steps","activeEnergyKcal","exerciseMinutes")->"activity";in healthVitals->"vital:$id";else->null}
internal fun healthSeries(result:JSONObject,day:String,days:Int):JSONObject {
    val points=result.optJSONArray("points")?.objects().orEmpty()
    val rows=points.filter{it.optString("day")<=day}.takeLast(days)
    val values=rows.mapNotNull{it.number("value")}
    return JSONObject(result.toString()).put("points",org.json.JSONArray(rows)).put("average",if(values.isEmpty())JSONObject.NULL else values.average()).put("outsideRange",points.isNotEmpty()&&day<points.first().optString("day"))
}
internal fun healthQuote(day:String,title:String,text:String)="> $day · $title\n> ${healthText(text).replace("\n","\n> ")}\n\n"

/** Identical normalized geometry to WeftHealth.chart, with gaps kept in each path. */
internal class HealthPlotGeometry(val points:List<JSONObject>,average:Double?=null) {
    private val values=points.flatMap{listOfNotNull(it.number("value"),it.number("low"),it.number("high"))}+listOfNotNull(average)
    private val low=values.minOrNull() ?: 0.0
    private val high=values.maxOrNull() ?: 1.0
    private val margin=(if(high!=low)high-low else if(high!=0.0)kotlin.math.abs(high)*.1 else 1.0)*.15
    val min=low-margin;val max=high+margin
    fun x(i:Int)=if(points.size<2)160f else 16f+i*288f/(points.size-1)
    fun y(value:Double)=(154-(value-min)*132/(max-min)).toFloat()
    val lines=runs{it.number("value")!=null}
    val bands=runs{it.number("low")!=null&&it.number("high")!=null}
    private fun runs(valid:(JSONObject)->Boolean):List<List<Int>> {
        val result=mutableListOf<List<Int>>();var run=mutableListOf<Int>()
        points.forEachIndexed{i,p->if(valid(p))run.add(i) else if(run.isNotEmpty()){result.add(run);run=mutableListOf()}}
        if(run.isNotEmpty())result.add(run);return result
    }
}
