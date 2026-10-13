package com.memoweft.weftmate.mobile

import android.widget.Toast
import androidx.compose.runtime.*
import kotlinx.coroutines.*
import org.json.JSONObject

internal fun serviceCatalogMessage(status:String):String = when(status) {
    "available" -> "模型清单已更新"
    "authentication_failed" -> "密钥不正确或没有查询权限，请检查密钥。"
    "unsupported" -> "这个服务不提供模型清单，可以手填型号。"
    "unavailable", "offline", "failed", "invalid" -> "暂时无法查询，已有模型仍保留，请稍后重试。"
    else -> "尚未查询模型清单"
}
internal fun serviceModelMatches(model:JSONObject,id:String) = id.isNotBlank() && (model.stringOrEmpty("profileId")==id || model.optJSONArray("profileIds")?.let{rows->(0 until rows.length()).any{rows.optString(it)==id}}==true)
internal fun serviceVisibleModels(service:JSONObject,all:Boolean,query:String="",current:String="") : List<JSONObject> {
    val rows=service.optJSONArray("models")?.objects().orEmpty().filter{it.optBoolean("enabled",true)}
    val visible=if(all||rows.size<=12)rows else rows.sortedWith(compareByDescending<JSONObject>{serviceModelMatches(it,current)||it.optString("modelId")==current}.thenByDescending{it.optString("lastUsedAt")}).take(8)
    return visible.filter{(it.optString("name")+" "+it.optString("modelId")).contains(query,true)}
}

internal fun serviceRequiresVision(drafts:List<JSONObject>,events:List<JSONObject>):Boolean {
    fun image(row:JSONObject)=row.optString("kind")=="image" || row.optString("contentType",row.optString("mimeType")).startsWith("image/")
    return drafts.any(::image) || events.any{event->
        val data=event.optJSONObject("data") ?: event
        data.optJSONArray("images")?.length()?.let{it>0}==true || listOf("attachments","originalAttachments","thumbnails").any{key->data.optJSONArray(key)?.objects().orEmpty().any(::image)}
    }
}

internal class SettingsConfirmation(val title:String,val message:String,val label:String,val dismiss:()->Unit,val confirm:()->Unit)

@Stable internal class NativeSettingsModel(val chat:NativeChatModel,val activity:NativeActivity) {
    val bridge=NativeSettingsBridge(activity)
    var page by mutableStateOf("")
    var webPage by mutableStateOf("")
    var loading by mutableStateOf(false)
    var menuLoading by mutableStateOf(false)
    var busy by mutableStateOf(false)
    var error by mutableStateOf("")
    var home by mutableStateOf(JSONObject())
    var directory by mutableStateOf(JSONObject())
    var services by mutableStateOf(emptyList<JSONObject>())
    var selected by mutableStateOf(JSONObject())
    var legacy by mutableStateOf(false)
    var editingService by mutableStateOf<JSONObject?>(null)
    var adding by mutableStateOf(false)
    var device by mutableStateOf<JSONObject?>(null)
    var accountFlow by mutableStateOf("")
    var thinking by mutableStateOf(false)
    var menuVisible by mutableStateOf(false)
    var confirmation by mutableStateOf<SettingsConfirmation?>(null)
    var search by mutableStateOf("")
    val scrollPositions=mutableMapOf<String,Int>()
    var restoreComposer:(()->Unit)?=null
    private var identity=""
    private var read:Job?=null
    private var mutation:Job?=null
    private var menuRead:Job?=null
    val title get()=if(webPage.isNotEmpty())home.optJSONArray("categories")?.objects()?.find{it.optString("id")==webPage}?.optString("name") ?: "设置" else if(page=="models")if(adding)"添加模型服务" else if(editingService!=null)"修改模型服务" else "模型" else home.optJSONArray("categories")?.objects()?.find{it.optString("id")==page}?.optString("name") ?: "设置"
    fun reset() { read?.cancel();mutation?.cancel();menuRead?.cancel();scrollPositions.clear();search="";identity=chat.owner;page="";webPage="";home=JSONObject();directory=JSONObject();services=emptyList();selected=JSONObject();device=null;editingService=null;adding=false;accountFlow="";busy=false;error="";menuVisible=false;menuLoading=false;confirmation=null }
    fun open(id:String="",add:Boolean=false) { if(identity!=chat.owner)reset();page=id;webPage="";editingService=null;device=null;accountFlow="";adding=add;chat.tab="settings";refresh() }
    fun back() { if(webPage.isNotEmpty()){webPage="";return};if(adding||editingService!=null){adding=false;editingService=null;return};if(device!=null){device=null;return};if(accountFlow.isNotEmpty()){accountFlow="";return};if(page.isNotEmpty()){page="";refresh()}else chat.returnToChat() }
    fun original(id:String) { webPage=id;chat.tab="settings" }
    fun toast(text:String) { Toast.makeText(activity,text,Toast.LENGTH_SHORT).show() }
    fun run(success:String="",action:suspend ()->Unit) {
        if(busy)return
        val owner=chat.owner;busy=true;error=""
        mutation=chat.scope.launch { try { action();if(owner==chat.owner&&success.isNotEmpty())toast(success) } catch(e:CancellationException){throw e} catch(e:Exception){if(owner==chat.owner)error=e.message?.takeUnless{it.matches(Regex("[A-Z_]+"))} ?: "暂时没能完成，请重试。"} finally{if(owner==chat.owner)busy=false} }
    }
    fun refresh() { read?.cancel();val owner=chat.owner;loading=true;error="";read=chat.scope.launch {
        try { val value=bridge.call("home");if(owner!=chat.owner)return@launch;home=value
            if(page=="devices") { val d=bridge.call("directory");if(owner!=chat.owner)return@launch;directory=d }
            if(page=="models")loadServices()
        }catch(e:CancellationException){throw e}catch(e:Exception){if(owner==chat.owner)error=e.message?.takeUnless{it.matches(Regex("[A-Z_]+"))} ?: "暂时无法读取，请重试。"}finally{if(owner==chat.owner)loading=false}
    } }
    suspend fun loadServices(force:Boolean=false) {
        val owner=chat.owner
        val result=try { if(chat.standalone)bridge.call("phoneService",JSONObject().put("action",if(force)"refresh" else "list").put("body",JSONObject().put("force",force))) else chat.business("/model-services") }
        catch(e:ApiFailure) { if(!chat.standalone && e.status in listOf(404,405,501)){legacy=true;return};throw e }
        if(owner!=chat.owner)return
        legacy=false;services=result.optJSONArray("services")?.objects().orEmpty();selected=result.optJSONObject("selected") ?: result.optJSONObject("model") ?: JSONObject()
        if(!chat.standalone) {
            val session=if(chat.sessionId.isNotBlank())runCatching{chat.business("/chats/${chat.chatId}")}.getOrNull() else null
            val id=session?.optJSONObject("chat")?.stringOrEmpty("selectedModelProfileId").orEmpty().ifEmpty{session?.optJSONObject("chat")?.stringOrEmpty("modelProfileId").orEmpty()}.ifEmpty{chat.modelId}
            services.forEach{service->service.optJSONArray("models")?.objects()?.find{serviceModelMatches(it,id)}?.let{selected=JSONObject(it.toString()).put("serviceId",service.getString("serviceId"))}}
        }
        services.find{it.optString("serviceId")==selected.optString("serviceId")}?.optJSONArray("models")?.objects()?.find{it.optString("modelId")==selected.optString("modelId")}?.let{selected=JSONObject(it.toString()).put("serviceId",selected.getString("serviceId"))}
        selected.optString("name").takeIf{it.isNotBlank()}?.let{chat.modelLabel=it}
    }
    fun menuOpened() { val owner=chat.owner;error="";menuLoading=services.isEmpty();menuRead?.cancel();menuRead=chat.scope.launch { try {loadServices();if(owner!=chat.owner)return@launch
        if(!legacy) { thinking=if(chat.standalone)currentModel()?.optJSONObject("deepThinking")?.optBoolean("enabled")==true else runCatching{chat.business("/sessions/${chat.sessionId}/thinking").optBoolean("enabled")}.getOrDefault(false)
            // Only stale catalogs refresh; keep the menu and cached rows usable while querying.
            val stale=services.filter{System.currentTimeMillis()-(goalInstant(it.optJSONObject("catalog")?.opt("checkedAt"))?.toEpochMilli() ?: 0L)>=3600000L};stale.forEach{service->
                runCatching{if(chat.standalone)bridge.call("phoneService",JSONObject().put("action","refresh").put("body",JSONObject().put("serviceId",service.getString("serviceId")))) else chat.business("/model-services/${service.getString("serviceId")}/refresh","POST",JSONObject())}
            }
            if(owner==chat.owner&&stale.isNotEmpty())loadServices()
        }
    }catch(e:CancellationException){throw e}catch(_:Exception){if(owner==chat.owner)error="暂时无法读取模型，请重试。"}finally{if(owner==chat.owner)menuLoading=false} } }
    fun currentModel()=services.find{it.optString("serviceId")==selected.optString("serviceId")}?.optJSONArray("models")?.objects()?.find{it.optString("modelId")==selected.optString("modelId")}
    fun select(service:JSONObject,model:JSONObject,done:()->Unit) = run {chooseModel(service,model);done()}
    suspend fun chooseModel(service:JSONObject,model:JSONObject) {
        val owner=chat.owner;val p=JSONObject().put("serviceId",service.getString("serviceId")).put("modelId",model.getString("modelId"))
        if(chat.standalone)bridge.call("phoneService",JSONObject().put("action","select").put("body",p)) else {
            val session=chat.sessionId.ifEmpty{if(chat.chatId.isNotBlank())chat.business("/chats/${chat.chatId}").optJSONObject("chat")?.stringOrEmpty("activeSessionId").orEmpty() else ""}
            if(session.isNotBlank())p.put("sessionId",session)
            val response=chat.business("/model-services/${service.getString("serviceId")}/select","POST",p.put("requestId",java.util.UUID.randomUUID().toString()))
            if(owner==chat.owner)chat.modelId=response.getString("profileId")
        }
        if(owner!=chat.owner)return
        selected=JSONObject(model.toString()).put("serviceId",service.getString("serviceId"));chat.modelLabel=model.optString("name",model.getString("modelId"))
    }
    fun toggleThinking(enabled:Boolean)=run { if(chat.standalone)bridge.call("phoneService",JSONObject().put("action","update").put("body",JSONObject().put("serviceId",selected.getString("serviceId")).put("modelId",selected.getString("modelId")).put("deepThinkingEnabled",enabled))) else chat.business("/sessions/${chat.sessionId}/thinking","PATCH",JSONObject().put("enabled",enabled));thinking=enabled }
    suspend fun writeService(action:String,service:JSONObject?,body:JSONObject=JSONObject()):JSONObject {
        if(chat.standalone)return bridge.call("phoneService",JSONObject().put("action",action).put("body",body.apply{service?.let{put("serviceId",it.getString("serviceId"))}}))
        val id=service?.getString("serviceId");body.put("requestId",java.util.UUID.randomUUID().toString());service?.let{if(action!="refresh")body.put("expectedRevision",it.getLong("revision"))}
        if(body.has("endpoint")){body.put("baseUrl",body.getString("endpoint"));body.remove("endpoint")}
        if(body.has("enabledModelIds")){val enabled=body.getJSONArray("enabledModelIds");body.put("models",org.json.JSONArray(service?.optJSONArray("models")?.objects().orEmpty().map{JSONObject().put("modelId",it.getString("modelId")).put("enabled",(0 until enabled.length()).any{i->enabled.optString(i)==it.getString("modelId")})}));body.remove("enabledModelIds")}
        return chat.business("/model-services"+(id?.let{"/$it"}.orEmpty())+(if(action=="refresh")"/refresh" else ""),if(action=="remove")"DELETE" else if(id!=null&&action!="refresh")"PATCH" else "POST",body)
    }
    fun close(){read?.cancel();mutation?.cancel();menuRead?.cancel()}
}
