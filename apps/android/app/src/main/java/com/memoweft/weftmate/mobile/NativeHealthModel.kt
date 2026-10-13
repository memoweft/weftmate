package com.memoweft.weftmate.mobile

import androidx.compose.runtime.*
import kotlinx.coroutines.*
import org.json.JSONObject
import java.time.LocalDate
import java.util.UUID

/** Transient presentation of the existing authenticated health contract. */
internal class NativeHealthModel(private val chat:NativeChatModel) {
    var overview by mutableStateOf<JSONObject?>(null);private set
    var day by mutableStateOf("");private set
    var today by mutableStateOf("");private set
    var view by mutableStateOf("today")
    var metric by mutableStateOf("recovery");private set
    var days by mutableStateOf(30);private set
    var loading by mutableStateOf(false);private set
    var error by mutableStateOf("");private set
    var supplementError by mutableStateOf("");private set
    var supplementLoading by mutableStateOf(false);private set
    var series by mutableStateOf<Map<String,JSONObject>>(emptyMap());private set
    var trend by mutableStateOf<JSONObject?>(null);private set
    var usageTrend by mutableStateOf<JSONObject?>(null);private set
    var trendLoading by mutableStateOf(false);private set
    var trendError by mutableStateOf("");private set
    var overlay by mutableStateOf(false);private set
    var calendar by mutableStateOf<JSONObject?>(null);private set
    var month by mutableStateOf("");private set
    var calendarOpen by mutableStateOf(false)
    var calendarLoading by mutableStateOf(false);private set
    var calendarError by mutableStateOf("");private set
    var settings by mutableStateOf<JSONObject?>(null);private set
    var analyses by mutableStateOf<Map<String,JSONObject>>(emptyMap());private set
    var analysisOpen by mutableStateOf<Set<String>>(emptySet());private set
    var analysisBusy by mutableStateOf<Set<String>>(emptySet());private set
    var analysisErrors by mutableStateOf<Map<String,String>>(emptyMap());private set
    var reminders by mutableStateOf<Set<String>>(emptySet());private set
    var reminderBusy by mutableStateOf<Set<String>>(emptySet());private set
    var toast by mutableStateOf("")
    var noComputer by mutableStateOf(false);private set
    var ready by mutableStateOf(false);private set
    var webMetric by mutableStateOf("");private set
    var webView by mutableStateOf("detail");private set
    val dark get()=chat.dark
    val zone get()=trend?.optString("timeZone")?.takeIf{it.isNotBlank()} ?: chat.timeZone
    private var epoch=0
    private var read:Job?=null
    private var trendRead:Job?=null
    private var calendarRead:Job?=null
    private var toastJob:Job?=null
    private val analysisJobs=mutableMapOf<String,Job>()
    private val reminderRequests=mutableMapOf<String,JSONObject>()
    private var owner=""
    private fun current(g:Int)=g==epoch&&chat.loggedIn&&chat.owner==owner
    private fun failure(e:Exception)=when((e as? ApiFailure)?.status){401,403->"请重新登录后查看健康记录。";503->"电脑暂时不在线，连接后再试。";else->"暂时读不到健康记录，请检查网络后重试。"}
    private fun notice(text:String) {
        toastJob?.cancel();toast=text
        toastJob=chat.scope.launch{delay(3000);if(toast==text)toast=""}
    }
    suspend fun prepare() {
        close();owner=chat.owner;overview=null;day="";today="";view="today";metric="recovery";webMetric="";webView="detail";noComputer=false;days=30;series=emptyMap();trend=null;usageTrend=null;calendar=null;calendarOpen=false;settings=null;analyses=emptyMap();analysisOpen=emptySet();analysisBusy=emptySet();analysisErrors=emptyMap();reminders=emptySet();reminderBusy=emptySet();reminderRequests.clear();overlay=false;error="";supplementError="";toast=""
        if(!chat.loggedIn)return
        val g=epoch
        val bootstrap=chat.call("app.bootstrap");if(!current(g))return
        noComputer=feedHasNoComputer(bootstrap)
        if(noComputer){day=LocalDate.now(java.time.ZoneId.of(chat.timeZone)).toString();today=day;overview=JSONObject().put("day",day).put("connected",false)}
        ready=true
    }
    fun refresh(requested:String=day) {
        if(!ready||noComputer||!chat.loggedIn)return
        read?.cancel();trendRead?.cancel();calendarRead?.cancel();analysisJobs.values.forEach{it.cancel()};analysisJobs.clear()
        val g=++epoch;loading=true;error="";analysisBusy=emptySet();reminderBusy=emptySet();supplementLoading=false;trendLoading=false;calendarLoading=false
        read=chat.scope.launch {
            try {
                val o=chat.business("/health/overview"+if(requested.isEmpty()||requested==today)"" else "?day=$requested")
                if(!current(g))return@launch
                val changed=day!=o.optString("day");overview=o;day=o.getString("day");if(requested.isEmpty()||requested==today||today.isEmpty())today=day
                if(changed){analyses=emptyMap();analysisOpen=emptySet();analysisErrors=emptyMap();series=emptyMap();trend=null;usageTrend=null;calendar=null;calendarOpen=false;reminders=emptySet();reminderRequests.clear()}
                loading=false
                val nextSettings=runCatching{chat.business("/settings/health").optJSONObject("settings")}.getOrNull();if(!current(g))return@launch;settings=nextSettings
                if(o.optBoolean("connected")) {
                    supplementLoading=true
                    loadTrend();loadCalendar(day.substring(0,7))
                    if(settings?.has("itemAnalysisEnabled")==true) {
                        val cached=runCatching{chat.business("/health/analysis?day=$day")}.getOrNull()
                        if(!current(g))return@launch
                        if(cached?.optString("day")==day)analyses=cached.optJSONArray("items")?.objects().orEmpty().filter{it.optString("day")==day}.associateBy{it.optString("scope")}
                    }
                    val ids=listOf("sleepMinutes","usageLateNightMinutes","recovery","sleep","load","deepMinutes","remMinutes","awakeMinutes","inBedMinutes","steps","activeEnergyKcal","exerciseMinutes")+listOf("stress","energy","fitnessAge").filter{o.has(it)}
                    val results=coroutineScope{ids.map{id->async{ id to runCatching{fetchSeries(id,if(id in listOf("recovery","sleep","load","stress","energy","fitnessAge"))14 else 7)} }}.awaitAll()}
                    if(!current(g))return@launch
                    series=results.mapNotNull{(id,r)->r.getOrNull()?.let{id to it}}.toMap()
                    supplementError=if(results.any{it.second.isFailure})"部分对比记录暂时读不到，可点右上角刷新再试。" else ""
                }
            }catch(e:CancellationException){throw e}catch(e:Exception){if(current(g)){error=failure(e);if((e as? ApiFailure)?.status in listOf(401,403)){overview=null;series=emptyMap();analyses=emptyMap()}}}
            finally{if(current(g)){loading=false;supplementLoading=false}}
        }
    }
    internal suspend fun fetchSeries(id:String,n:Int):JSONObject {
        val supportsTo=(overview?.optJSONObject("capabilities")?.optInt("record") ?: 0)>=3
        val query="days=${if(!supportsTo&&day<today)90 else n}"+if(supportsTo)"&to=$day" else ""
        return healthSeries(chat.business("/health/metrics/$id?$query"),day,n)
    }
    fun shift(offset:Long){if(day.isNotEmpty()){val target=LocalDate.parse(day).plusDays(offset).toString();if(target<=today)refresh(target)}}
    fun openMetric(id:String,mode:String="detail") { if(id !in healthMetrics)return;metric=id;view=mode;calendarOpen=false;loadTrend() }
    fun home(){view="today";calendarOpen=false}
    fun toggleOverlay(value:Boolean){overlay=value;loadTrend()}
    fun loadTrend(n:Int=days) {
        if(n !in listOf(7,14,30,60)||overview?.optBoolean("connected")!=true)return
        trendRead?.cancel();days=n;val g=epoch;val id=metric;trend=null;usageTrend=null;trendLoading=true;trendError=""
        trendRead=chat.scope.launch{try{
            val values=coroutineScope{val first=async{fetchSeries(if(id=="fitnessAge")"vo2Max" else if(id=="activity")"exerciseMinutes" else id,n)};val second=async{if(overlay)fetchSeries("usageLateNightMinutes",n) else null};first.await() to second.await()}
            if(current(g)&&metric==id){trend=values.first;usageTrend=values.second}
        }catch(e:CancellationException){throw e}catch(e:Exception){if(current(g)&&metric==id)trendError=failure(e)}finally{if(current(g)&&metric==id)trendLoading=false}}
    }
    fun loadCalendar(value:String=day.take(7)) {
        if(noComputer||value.length!=7)return
        calendarRead?.cancel();val g=epoch;month=value;calendarLoading=true;calendarError=""
        calendarRead=chat.scope.launch{try{val result=chat.business("/health/calendar?month=$value");if(current(g)&&month==value)calendar=result}catch(e:CancellationException){throw e}catch(e:Exception){if(current(g)&&month==value)calendarError=failure(e)}finally{if(current(g)&&month==value)calendarLoading=false}}
    }
    fun monthShift(offset:Long){val value=LocalDate.parse("$month-01").plusMonths(offset).toString().take(7);if(value<=today.take(7))loadCalendar(value)}
    fun point(id:String)=series[id]?.optJSONArray("points")?.objects()?.find{it.optString("day")==day}
    fun data(id:String)=if(id in healthVitals)healthVital(overview,id) ?: JSONObject() else overview?.optJSONObject(id) ?: JSONObject()
    fun dimension(id:String):Double?=healthVital(overview,id)?.number("value") ?: point(id)?.number("value") ?: when(id){"sleepMinutes"->data("sleep").number("minutes");else->data("activity").number(id)}
    fun toggleAnalysis(scope:String) {
        if(settings?.has("itemAnalysisEnabled")!=true)return
        if(scope in analysisOpen){analysisOpen=analysisOpen-scope;return}
        analysisOpen=analysisOpen+scope
        if(settings?.optBoolean("itemAnalysisEnabled")==true&&analyses[scope]==null)generateAnalysis(scope)
    }
    fun enableAnalysis(scope:String) {
        if(scope in analysisBusy)return
        val g=epoch;analysisBusy=analysisBusy+scope
        analysisJobs[scope]=chat.scope.launch{try{
            val result=chat.business("/settings/health","PATCH",JSONObject().put("itemAnalysisEnabled",true))
            if(current(g)){settings=result.optJSONObject("settings");analysisBusy=analysisBusy-scope;generateAnalysis(scope)}
        }catch(e:CancellationException){throw e}catch(e:Exception){if(current(g)){analysisErrors=analysisErrors+(scope to failure(e));analysisBusy=analysisBusy-scope}}}
    }
    fun generateAnalysis(scope:String) {
        if(scope in analysisBusy||healthScope(scope.removePrefix("vital:"))==null)return
        val g=epoch;val requestedDay=day;analysisBusy=analysisBusy+scope;analysisErrors=analysisErrors-scope
        analysisJobs[scope]=chat.scope.launch{try{
            val result=chat.business("/health/analysis","POST",JSONObject().put("scope",scope).put("day",requestedDay))
            if(current(g)&&day==requestedDay&&settings?.optBoolean("itemAnalysisEnabled")==true)analyses=analyses+(scope to result)
        }catch(e:CancellationException){throw e}catch(e:Exception){if(current(g)){val f=e as? ApiFailure;analysisErrors=analysisErrors+(scope to when{f?.safeCode=="AI_ANALYSIS_OFF"->{settings=settings?.let{JSONObject(it.toString()).put("itemAnalysisEnabled",false)};"各项的 AI 分析已关闭。可以重新打开。"};f?.status==429->"今天分析的次数已经用完了，明天再来看看。";f?.status==503->"电脑暂时不在线，连接后再试。";f?.safeCode=="HEALTH_DATA_CHANGED"->"记录已变化，请刷新后再展开。";else->"这次没能完成分析，请再试一次。"})}}
        finally{if(current(g))analysisBusy=analysisBusy-scope}}
    }
    fun remind(suggestion:JSONObject) {
        val id=suggestion.optString("id");if(id in reminders||id in reminderBusy||!suggestion.has("reminder")||day!=today)return
        val g=epoch;reminderBusy=reminderBusy+id
        val body=reminderRequests.getOrPut(id){JSONObject().put("requestId",UUID.randomUUID().toString()).apply{if(chat.sessionId.isNotBlank())put("sessionId",chat.sessionId)}}
        chat.scope.launch{try{chat.business("/health/suggestions/$id/remind","POST",body);if(current(g)){reminders=reminders+id;notice("已设提醒");reminderRequests.remove(id)}}catch(e:CancellationException){throw e}catch(e:Exception){if(current(g))notice(failure(e))}finally{if(current(g))reminderBusy=reminderBusy-id}}
    }
    fun ask(scope:String?=null) {
        val item=if(scope==null)overview?.optJSONObject("insight") else analyses[scope]
        item ?: return
        quote(if(scope==null)item.optString("headline") else "${healthMetrics[scope.removePrefix("vital:")]?.first ?: "健康"} AI 分析",item.optString("text"))
    }
    fun askMetric(){val id=metric;val d=data(id);quote(healthMetrics[id]?.first ?: "健康",healthReading(if(id in healthVitals)d.number("value") else when(id){"fitnessAge"->d.number("fitnessAge");"energy"->d.number("current");"activity"->d.number("exerciseMinutes");else->d.number("score")},id)+" · "+d.optString("label"))}
    private fun quote(title:String,text:String) {
        val g=epoch;val quoted=healthQuote(day,title,text)
        chat.launch { val main=chat.business("/chats/main").getJSONObject("chat");if(!current(g))return@launch;chat.select(main);if(!current(g))return@launch;chat.edit(quoted+chat.draft);chat.tab="chat";chat.focused=false }
    }
    fun openOriginal(){webMetric=metric;webView=view;chat.tab="health-web"}
    fun closeWeb(){webMetric="";chat.tab="health";refresh()}
    fun event(type:String){if(chat.tab=="health"&&(type=="sync.changed"||type.startsWith("health.")))refresh()}
    fun close(){epoch++;ready=false;toastJob?.cancel();read?.cancel();trendRead?.cancel();calendarRead?.cancel();analysisJobs.values.forEach{it.cancel()};analysisJobs.clear();loading=false;trendLoading=false;calendarLoading=false;supplementLoading=false}
}
