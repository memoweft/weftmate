package com.memoweft.weftmate.mobile

import androidx.compose.runtime.*
import kotlinx.coroutines.*
import org.json.JSONObject

/** A page keeps only navigation and drafts. The existing shared core supplies data and actions. */
@Stable internal class NativePageModel(private val activity: NativeActivity, private val chat: NativeChatModel) {
    var page by mutableStateOf(""); private set
    var title by mutableStateOf(""); private set
    var data by mutableStateOf(JSONObject()); private set
    var loading by mutableStateOf(false); private set
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf(""); private set
    var confirmation by mutableStateOf<JSONObject?>(null)
    var pairing by mutableStateOf<JSONObject?>(null); private set
    val values = mutableStateMapOf<String, Any>()
    private var payload = JSONObject()
    private var returnTab = "chat"
    private var ticket = 0
    private var job: Job? = null
    private var timer: Job? = null
    private val stack = mutableListOf<Pair<String, JSONObject>>()
    private val bridge = NativePageBridge(activity)
    fun open(id: String, params: JSONObject = JSONObject(), from: String = chat.tab) {
        if (chat.tab != "native") { returnTab = from; stack.clear() }
        else stack.add(page to payload)
        show(id, params)
        chat.tab = "native"
    }
    private fun show(id: String, params: JSONObject) {
        page=id;payload=params;data=JSONObject();values.clear();confirmation=null;title=nativePageTitle(id);refresh()
    }
    fun back() {
        if(pairing!=null)bridge.cancelPairing()
        ticket++;job?.cancel();timer?.cancel();confirmation=null;pairing=null;busy=false;loading=false
        if (stack.isNotEmpty()) { val previous=stack.removeAt(stack.lastIndex);show(previous.first,previous.second) }
        else { chat.tab=returnTab;page="" }
    }
    fun refresh() { execute("read", JSONObject(), false) }
    fun act(row: JSONObject, value: Any? = null) {
        if (busy) return
        if (row.optString("confirm").isNotBlank()) { confirmation=row;return }
        val params=JSONObject(row.optJSONObject("params")?.toString() ?: "{}")
        if (row.has("key") && value != null) params.put("key",row.getString("key")).put("value",value)
        execute(row.getString("action"),params,true)
    }
    fun confirm() { val row=confirmation ?: return;confirmation=null;val copy=JSONObject(row.toString());copy.remove("confirm");act(copy) }
    private fun execute(command: String, actionParams: JSONObject, mutation: Boolean, keepDrafts:Boolean=false) {
        timer?.cancel();job?.cancel();val generation=++ticket;val owner=chat.owner
        if (mutation) busy=true else loading=true
        error=""
        val params=JSONObject(payload.toString());actionParams.keys().forEach { params.put(it,actionParams.get(it)) }
        val fields=nativePageFields(data,values)
        job=chat.scope.launch {
            try {
                val response=coroutineScope {
                    val poll=if(command in listOf("pairing","scanPairing"))launch {
                        while(isActive){delay(350);val status=bridge.pairingStatus();if(generation==ticket)pairing=status.optJSONObject("pairing")}
                    } else null
                    try{bridge.call(page,command,params,fields,owner)}finally{poll?.cancel();pairing=null}
                }
                if (generation!=ticket || owner!=chat.owner&&!response.optBoolean("authenticated")) return@launch
                if(page=="appearance")chat.readPresentationPreferences()
                response.optString("message").takeIf { it.isNotBlank() }?.let(activity.fileActions::notice)
                response.optJSONObject("effect")?.let { effect ->
                    when(effect.optString("kind")) {
                        "page" -> open(effect.getString("page"),effect.optJSONObject("params") ?: JSONObject())
                        "settings" -> { activity.settings.open(effect.optString("page"));stack.clear() }
                        "tab" -> {chat.tab=effect.getString("tab");stack.clear()}
                        "authenticated" -> {stack.clear();chat.tab="chat";chat.bootstrap()}
                        "newChat" -> {stack.clear();chat.newChat("chat").join()}
                        "chat" -> { activity.openNativeSource(effect.optJSONObject("source") ?: JSONObject());if(effect.has("draft"))chat.edit(effect.getString("draft"));stack.clear() }
                        "file" -> activity.openNativeFile(effect.getJSONObject("file"))
                        "external" -> activity.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW,android.net.Uri.parse(effect.getString("url"))))
                    }
                    return@launch
                }
                response.optJSONObject("view")?.let { next ->
                    data=next;title=next.optString("title")
                    if (!mutation&&!keepDrafts || response.optBoolean("resetValues")) values.clear()
                    if(next.optLong("refreshAfterMs")>0)timer=chat.scope.launch {
                        delay(next.optLong("refreshAfterMs").coerceIn(250,5000))
                        if(generation==ticket)execute("read",JSONObject(),false,keepDrafts=true)
                    }
                }
            } catch(e:CancellationException) {throw e}
            catch(e:Exception) { if (generation==ticket && owner==chat.owner) error=(e as? NativeCoreFailure)?.text?.takeUnless{it.isBlank()||it.matches(Regex("[A-Z_]+"))} ?: e.message?.takeUnless{it.isBlank()||it.matches(Regex("[A-Z_]+"))} ?: "暂时无法读取，请检查连接后重试。" }
            finally { if(generation==ticket) {busy=false;loading=false;if(mutation)data.optJSONArray("sections")?.objects().orEmpty().flatMap{it.optJSONArray("rows")?.objects().orEmpty()}.filter{it.optBoolean("secret")}.forEach{values.remove(it.optString("key"))}} }
        }
    }
    fun reset() {if(pairing!=null)bridge.cancelPairing();pairing=null;ticket++;job?.cancel();timer?.cancel();stack.clear();values.clear();page="";data=JSONObject();confirmation=null;error="";busy=false;loading=false;if(chat.tab=="native")chat.tab="chat"}
}

internal fun nativePageTitle(page:String):String = mapOf(
    "login" to "登录 WeftMate", "connect" to "连接电脑", "account" to "账户", "profile" to "个人资料",
    "accountPassword" to "修改密码", "accountEmail" to "修改邮箱", "personalization" to "个性化", "assistant" to "助理",
    "notifications" to "通知", "reviewHealth" to "回顾与健康", "approvals" to "审批", "appearance" to "外观",
    "system" to "系统状态", "sync" to "同步", "updates" to "检查更新", "help" to "帮助", "releases" to "更新记录", "legal" to "法律信息",
    "usage" to "用量", "archived" to "已归档", "schedules" to "定时任务", "memory" to "记忆", "phoneMemory" to "手机记忆",
    "memoryItem" to "记忆详情", "memoryForget" to "遗忘范围", "data" to "数据与存储", "connectors" to "能力", "connector" to "连接器",
    "executionRecords" to "执行记录", "executionRecord" to "操作详情", "resources" to "资料访问", "project" to "项目对话",
    "browserTask" to "网页任务", "cloudModels" to "账户模型", "modelConflict" to "模型配置核对", "offlineWork" to "离线工作"
)[page] ?: "详情"

internal fun nativePageFields(data:JSONObject,drafts:Map<String,Any>):JSONObject {
    val result=JSONObject()
    data.optJSONArray("sections")?.objects().orEmpty().flatMap{it.optJSONArray("rows")?.objects().orEmpty()}.forEach{row ->
        val key=row.optString("key")
        if(key.isNotBlank()&&(row.optString("type")=="input"||row.optString("type")=="choice"&&row.optString("action").isBlank()))result.put(key,drafts[key] ?: row.opt("value") ?: "")
    }
    return result
}

internal class NativePageBridge(private val activity: NativeActivity) {
    fun cancelPairing(){activity.embeddedWeb.evaluateJavascript("(globalThis.WeftMobileCloud?.core||uiCore).cancelCloudPairing?.()",null)}
    suspend fun pairingStatus()=activity.core.call("return {pairing:(globalThis.WeftMobileCloud?.core||uiCore).cloudAuthView().pairing||null};")
    suspend fun call(page: String, action: String, params: JSONObject, values: JSONObject, expectedOwner:String): JSONObject {
        val deadline=android.os.SystemClock.elapsedRealtime()+15000
        while(!activity.core.call("return {ready:typeof uiCore!=='undefined'&&typeof state!=='undefined'&&state.booted===true};").optBoolean("ready")) {
            if(android.os.SystemClock.elapsedRealtime()>=deadline)throw IllegalStateException("页面还未准备好，请稍后重试。")
            delay(100)
        }
        val files=listOf("base","preferences","information","memory","account","tools")
        val source=files.joinToString("\n") { activity.assets.open("ui-core/native-presentation/$it.js").bufferedReader().use { it.readText() } }
        val context=activity.assets.open("native-presentation-context.js").bufferedReader().use { it.readText() }
        val command=if(action=="scanPairing")"pairing" else action
        if(action=="scanPairing")params.put("qrCode",activity.scanPairing())
        return activity.core.call("""
            if(typeof uiCore==='undefined'||!state.booted)throw Error('正在准备页面，请稍后重试。');
            if(globalThis.WeftUiCore.nativePresentation?.version!==1){$source}
            $context
            nativeContext.expectedOwner=${JSONObject.quote(expectedOwner)};
            return await WeftUiCore.nativePresentation.request(nativeContext,${JSONObject.quote(page)},${JSONObject.quote(command)},$params,$values);
        """.trimIndent(),120000)
    }
}
