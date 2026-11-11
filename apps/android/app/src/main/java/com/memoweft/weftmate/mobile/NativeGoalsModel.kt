package com.memoweft.weftmate.mobile

import androidx.compose.runtime.*
import kotlinx.coroutines.*
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID

/** Display state only. Mutations keep the original native dispatcher and computer channels. */
internal class NativeGoalsModel(private val chat: NativeChatModel, private val activity: NativeActivity) {
    var sections by mutableStateOf<Map<String,List<JSONObject>>>(emptyMap()); private set
    var sessions by mutableStateOf(emptyList<JSONObject>()); private set
    var computers by mutableStateOf(emptyList<JSONObject>()); private set
    var errors by mutableStateOf<Map<String,String>>(emptyMap()); private set
    var offline by mutableStateOf(emptyList<String>()); private set
    var loading by mutableStateOf(false); private set
    var noComputer by mutableStateOf(false); private set
    var busy by mutableStateOf(false); private set
    var detail by mutableStateOf<JSONObject?>(null); private set
    var detailKind by mutableStateOf(""); private set
    var records by mutableStateOf(emptyList<JSONObject>()); private set
    var recordsLoading by mutableStateOf(false); private set
    var recordsError by mutableStateOf(""); private set
    var showRecords by mutableStateOf(false); private set
    var draft by mutableStateOf<GoalDraft?>(null); private set
    var formError by mutableStateOf(""); private set
    var toast by mutableStateOf("")
    var webPayload by mutableStateOf<JSONObject?>(null); private set
    var filter by mutableStateOf("all")
    var timeZone by mutableStateOf(""); private set
    val dark get()=chat.dark
    private var epoch=0
    private var read:Job?=null
    private var poll:Job?=null
    private var history:Job?=null
    private val snapshots=mutableMapOf<String,List<JSONObject>>()
    private val requests=mutableMapOf<String,String>()
    private var primaryHost=""
    private var selectedHost=""
    private var unavailableHosts=emptySet<String>()
    private val capabilities=mutableMapOf<String,JSONObject>()
    private val zones=mutableMapOf<String,String>()
    fun zone(host:String)=zones[host] ?: timeZone
    private fun encode(value:String)=URLEncoder.encode(value,"UTF-8")
    private fun launch(work:suspend ()->Unit)=chat.scope.launch { try { work() } catch(e:CancellationException){throw e} catch(e:Exception){toast=failure(e)} }
    private fun failure(e:Exception):String=when((e as? ApiFailure)?.safeCode) {
        "GOAL_ALREADY_EXISTS" -> "这个对话已有目标，请完成或归档后再新建。"
        "SOURCE_UNAVAILABLE","SESSION_UNAVAILABLE" -> "关联内容已清理，请重新新建。"
        "COMPUTER_OFFLINE" -> "这台电脑不在线，连接后再试。"
        else -> when((e as? ApiFailure)?.status){401,403 -> "请重新登录后查看目标。";409 -> "内容已变化，请刷新后再试。";else -> "暂时无法读取，请检查网络后重试。"}
    }
    /** Uses the existing page's M3-2 channel without exporting authentication material. */
    internal suspend fun presentation(expression:String):JSONObject = activity.core.call(expression)
    private suspend fun api(host:String,path:String,method:String="GET",body:JSONObject?=null):JSONObject {
        if(host.isEmpty()||host==primaryHost)return chat.business(path,method,body)
        return presentation("return await uiCore.computerApi(${JSONObject.quote(host)},${JSONObject.quote(path)},{method:${JSONObject.quote(method)}${if(body!=null)",body:$body" else ""}});")
    }
    suspend fun prepare() {
        epoch++;read?.cancel();poll?.cancel();history?.cancel();snapshots.clear();requests.clear();capabilities.clear();zones.clear();unavailableHosts=emptySet();sections=emptyMap();sessions=emptyList();computers=emptyList();offline=emptyList();errors=emptyMap();closeDetail();webPayload=null;busy=false;loading=false;toast="";filter="all"
        if(!chat.loggedIn)return
        noComputer=feedHasNoComputer(chat.call("app.bootstrap"))
        if(!noComputer)refresh()
        poll=chat.scope.launch { while(isActive){delay(5000);if(activity.nativeForeground&&chat.tab=="goals"&&!noComputer&&errors.isEmpty())refresh()} }
    }
    fun refresh() {
        if(noComputer||!chat.loggedIn||read?.isActive==true||busy)return
        val g=epoch
        read=chat.scope.launch {
            loading=sections.isEmpty() && errors.isEmpty()
            try { nativePageRead readPage@{
                val directory=runCatching{nativePageRead(2000){presentation("if(typeof uiCore==='undefined')return {};return {computers:uiCore.state.computers||[],selected:uiCore.currentExecutionComputer?.()||''};")}}.getOrDefault(JSONObject())
                if(g!=epoch)return@readPage
                computers=directory.optJSONArray("computers")?.objects() ?: computers
                val status=runCatching{chat.business("/status")}.getOrDefault(JSONObject());if(g!=epoch)return@readPage
                primaryHost=status.stringOrEmpty("hostId").ifEmpty{SecureSettings(activity).host()?.hostId.orEmpty()};timeZone=status.stringOrEmpty("timeZone").ifEmpty{timeZone}
                selectedHost=directory.stringOrEmpty("selected").ifEmpty{primaryHost}
                val hosts=if(computers.size>1)computers else listOf(JSONObject().put("hostId",primaryHost).put("online",status.length()>0).put("name",status.optString("hostName","这台电脑")))
                val failed=mutableListOf<String>();val failedHosts=mutableSetOf<String>();val invalidatedHosts=mutableSetOf<String>();val nextErrors=mutableMapOf<String,String>();val next=mutableMapOf<String,MutableList<JSONObject>>()
                val nextSessions=mutableListOf<JSONObject>()
                val validIds=hosts.map{it.stringOrEmpty("hostId")}.toSet();snapshots.keys.removeAll{it.substringBefore('|') !in validIds}
                for(host in hosts) {
                    val id=host.stringOrEmpty("hostId");val name=host.stringOrEmpty("displayName").ifEmpty{host.stringOrEmpty("name").ifEmpty{"这台电脑"}}
                    var unavailable=!host.optBoolean("online",true)||(id==primaryHost&&status.length()==0)
                    val caps=if(!unavailable)runCatching{if(id==primaryHost)status else api(id,"/status")}.getOrElse{unavailable=true;JSONObject()}.optJSONObject("personalCapabilities") else null
                    caps?.let{capabilities[id]=it}
                    for((section,path,cap) in listOf(Triple("tasks","/tasks","taskOverview"),Triple("schedules","/schedules","scheduleEditing"),Triple("goals","/goals","goals"),Triple("sessions","/sessions",null))) {
                        val key="$id|$section"
                        try {
                            if(unavailable)throw ApiFailure(0,"COMPUTER_OFFLINE")
                            if(cap!=null&&caps?.optInt(cap)!=1){nextErrors[section]="更新电脑上的 WeftMate 后可使用这项功能。";continue}
                            val result=api(id,path);if(g!=epoch)return@readPage
                            val rows=(result.optJSONArray(if(section=="sessions")"sessions" else "items")?.objects().orEmpty()).map{JSONObject(it.toString()).put("hostId",id)}
                            snapshots[key]=rows
                            if(section=="tasks"){zones[id]=result.stringOrEmpty("timeZone").ifEmpty{timeZone};if(id==selectedHost)timeZone=zones[id].orEmpty();snapshots["$id|recent"]=result.optJSONArray("recent")?.objects().orEmpty().map{JSONObject(it.toString()).put("hostId",id)}}
                        }catch(e:CancellationException){throw e}catch(e:Exception){nextErrors[section]=failure(e);if((e as? ApiFailure)?.status in listOf(401,403)||(e as? ApiFailure)?.safeCode=="CURSOR_RESET_REQUIRED"){invalidatedHosts.add(id);snapshots.keys.removeAll{it.startsWith("$id|")}}else{failedHosts.add(id);if(!failed.contains(name))failed.add(name)}}
                        val rows=snapshots[key].orEmpty().map{JSONObject(it.toString()).put("computerOffline",unavailable||failed.contains(name))}
                        if(section=="sessions")nextSessions.addAll(rows) else next.getOrPut(section){mutableListOf()}.addAll(rows)
                    }
                    next.getOrPut("recent"){mutableListOf()}.addAll(snapshots["$id|recent"].orEmpty())
                }
                if(g!=epoch)return@readPage
                sections=next.mapValues{goalMerge(it.value,invalidatedHosts)};sessions=nextSessions.filter{it.stringOrEmpty("hostId") !in invalidatedHosts};offline=failed;unavailableHosts=failedHosts+invalidatedHosts;errors=nextErrors
                if(selectedHost in failedHosts)selectedHost=hosts.firstOrNull{it.stringOrEmpty("hostId") !in failedHosts&&it.optBoolean("online",true)}?.stringOrEmpty("hostId") ?: selectedHost
                if(sessions.none{goalSession(it)==chat.sessionId}&&chat.sessionId.isNotBlank())sessions=sessions+JSONObject().put("sessionId",chat.sessionId).put("hostId",primaryHost).put("title","WeftMate 主对话").put("taskAvailable",true)
            }}catch(e:CancellationException){throw e}catch(e:Exception){if(g==epoch){offline=listOf(computers.firstOrNull{it.stringOrEmpty("hostId")==primaryHost}?.stringOrEmpty("name").orEmpty().ifEmpty{"这台电脑"});if(sections.isEmpty())errors=mapOf("all" to failure(e))}}
            finally{if(g==epoch)loading=false}
        }
    }
    fun newDraft(kind:String,row:JSONObject?=null) {
        if(row?.optBoolean("temporary")==true){openSource(row);return}
        closeDetail();toast="";val host=row?.stringOrEmpty("hostId") ?: selectedHost
        val session=sessions.firstOrNull{it.stringOrEmpty("hostId")==host&&it.optBoolean("taskAvailable",true)}?.let(::goalSession).orEmpty()
        draft=GoalDraft(kind,row,row?.stringOrEmpty("timeZone")?.ifEmpty{zone(host)} ?: zone(host),session,host);formError=""
    }
    fun canCreate(kind:String,host:String)=!noComputer&&!busy&&host !in unavailableHosts&&capabilities[host]?.optInt(if(kind=="schedule")"scheduleEditing" else "goals")==1&&sessions.any{it.stringOrEmpty("hostId")==host&&it.optBoolean("taskAvailable",true)}
    val creationHost get()=selectedHost
    fun returnToChat(){chat.returnToChat()}
    fun save()=launch {
        val d=draft ?: return@launch;if(busy)return@launch
        if(d.pending==null){formError=d.validate(zone(d.hostId));if(formError.isNotEmpty())return@launch}
        val g=epoch;val target=d.hostId;val body=d.body();busy=true;formError=""
        try { api(target,if(d.kind=="goal")"/goals" else d.original?.let{"/schedules/${encode(goalSession(it))}/${encode(it.getString("id"))}"} ?: "/schedules",if(d.original!=null)"PATCH" else "POST",body)
            if(g==epoch){draft=null;toast="已保存"}
        }catch(e:CancellationException){throw e}catch(e:Exception){if(g==epoch){if((e as? ApiFailure)?.status?.let{it in 400..499}==true)d.rejected();formError=failure(e)+if(d.pending!=null)" 可用原内容重试确认。" else ""}}
        finally{if(g==epoch){busy=false;refresh()}}
    }
    fun manage(kind:String,row:JSONObject,action:String)=launch {
        if(busy)return@launch;val g=epoch;busy=true
        val key="${goalRowKey(row)}:$action";val id=requests.getOrPut(key){UUID.randomUUID().toString()}
        try {
            val base=if(kind=="schedule")"/schedules/${encode(goalSession(row))}/${encode(row.getString("id"))}" else if(kind=="task")"/tasks/${encode(row.getString("taskId"))}" else "/goals/${encode(goalSession(row))}"
            val body=JSONObject().put("requestId",id);if(kind=="goal")body.put("ref",JSONObject().put("id",row.getString("id")).put("revision",row.getLong("revision")))
            api(row.stringOrEmpty("hostId"),if(action=="delete")base else "$base/$action",if(action=="delete")"DELETE" else "POST",if(action=="delete")null else body)
            if(g==epoch){requests.remove(key);if(action in listOf("delete","archive"))closeDetail();toast=when(action){"pause"->"已暂停";"resume"->"已启用";"run"->"已安排立即运行";"delete"->"定时任务已删除";"complete"->"目标已完成";"archive"->"目标已归档";else->"已请求停止"}}
        }finally{if(g==epoch){busy=false;refresh()}}
    }
    fun open(kind:String,row:JSONObject,record:Boolean=false) { draft=null;formError="";history?.cancel();detail=row;detailKind=kind;showRecords=record;records=emptyList();recordsError="";if(record)loadRecords() }
    fun loadRecords() {
        val row=detail ?: return;history?.cancel();showRecords=true;recordsLoading=true;recordsError="";val g=epoch
        history=chat.scope.launch {try{
            // The schedule ID is returned by the existing notifications endpoint; no fabricated history.
            val result=api(row.stringOrEmpty("hostId"),"/notifications");if(g!=epoch||detail!==row)return@launch
            records=result.optJSONArray("items")?.objects().orEmpty().filter{it.stringOrEmpty("scheduleId")==row.stringOrEmpty("id")&&goalSession(it)==goalSession(row)}.sortedByDescending{it.stringOrEmpty("createdAt")}
        }catch(e:CancellationException){throw e}catch(e:Exception){if(g==epoch)recordsError=failure(e)}finally{if(g==epoch)recordsLoading=false}}
    }
    fun closeDetail(){history?.cancel();detail=null;draft=null;showRecords=false;records=emptyList();recordsError="";recordsLoading=false;formError=""}
    fun openOriginal(row:JSONObject?=null,kind:String="goals") { webPayload=JSONObject().put("page",kind).apply{row?.let{put("row",it)}};chat.tab="goals-web" }
    fun closeWeb(){webPayload=null;chat.tab="goals";refresh()}
    fun openSource(row:JSONObject)=launch {
        val g=epoch
        if(row.stringOrEmpty("hostId").isNotEmpty()&&row.stringOrEmpty("hostId")!=primaryHost){openOriginal(row,"chat");return@launch}
        val source=goalSource(row);var id=source.stringOrEmpty("chatId")
        if(id.isEmpty())id=chat.business("/sessions/${encode(goalSession(row))}/chat").stringOrEmpty("chatId")
        val conversation=chat.business("/chats/${encode(id)}").getJSONObject("chat");if(g!=epoch)return@launch;chat.select(conversation);if(g!=epoch)return@launch
        if(source.has("seq")||source.stringOrEmpty("eventId").isNotEmpty()){chat.locateActivityTarget(source);activity.feed.focusTarget=source}
        closeDetail();chat.tab="chat"
    }
    fun event(type:String,data:JSONObject){if(type=="sync.changed"||type.startsWith("schedule.")||type.startsWith("goal.")||type.startsWith("activity."))refresh()}
    fun close(){epoch++;read?.cancel();poll?.cancel();history?.cancel();snapshots.clear();requests.clear()}
}
