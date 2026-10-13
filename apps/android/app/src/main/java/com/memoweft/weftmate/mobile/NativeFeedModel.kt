package com.memoweft.weftmate.mobile

import androidx.compose.runtime.*
import kotlinx.coroutines.*
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID

/** Activity presentation reuses HybridActivity's authenticated business dispatcher. */
internal class NativeFeedModel(private val chat:NativeChatModel,private val activity:NativeActivity) {
    private val state=NativeFeedState()
    var items by mutableStateOf(emptyList<JSONObject>()); private set
    var filter by mutableStateOf("all"); private set
    var unread by mutableStateOf(0); private set
    var actionable by mutableStateOf(0); private set
    var loading by mutableStateOf(false); private set
    var refreshingGesture by mutableStateOf(false); private set
    var error by mutableStateOf(""); private set
    var noComputer by mutableStateOf(false); private set
    var nextCursor by mutableStateOf(""); private set
    var detail by mutableStateOf<JSONObject?>(null); private set
    var busy by mutableStateOf(false); private set
    var focusTarget by mutableStateOf<JSONObject?>(null)
    var webDetail by mutableStateOf<JSONObject?>(null); private set
    var focusRowId by mutableStateOf(""); private set
    val dark get()=chat.dark
    val timeZone get()=state.timeZone
    private var epoch=0
    private var readJob:Job?=null
    private var poll:Job?=null
    private var pendingLaunch=""
    private val requests=mutableMapOf<String,String>()
    private fun publish() { items=state.items;unread=state.unread;actionable=state.actionable;nextCursor=state.nextCursor }
    private fun launch(work:suspend ()->Unit):Job { val g=epoch;return chat.scope.launch { try { work() } catch(e:CancellationException){throw e} catch(e:Exception){if(g==epoch)error=failure(e)} } }
    private fun failure(e:Exception)=when((e as? ApiFailure)?.status) { 401,403->"请重新登录后查看动态。";409->"动态有了变化，请重试。";else->"暂时无法读取动态，请检查网络后重试。" }
    suspend fun prepare() {
        epoch++;readJob?.cancel();poll?.cancel();requests.clear();state.clear();filter="all";state.filter=filter;detail=null;webDetail=null;focusTarget=null;focusRowId="";error="";busy=false;refreshingGesture=false;publish()
        if(!chat.loggedIn){loading=false;return}
        val g=epoch
        val b=chat.call("app.bootstrap");if(g!=epoch)return
        noComputer=feedHasNoComputer(b)
        pendingLaunch=feedLaunchId(b)
        if(!noComputer) refresh()
        else loading=false
        poll=chat.scope.launch { while(isActive) { delay(5000);if(activity.nativeForeground&&!noComputer)refresh() } }
        if(pendingLaunch.isNotBlank())openLaunch()
    }
    fun refresh(more:Boolean=false,full:Boolean=false,gesture:Boolean=false) {
        if(noComputer||!chat.loggedIn||readJob?.isActive==true)return
        val g=epoch
        readJob=launch {
            loading=true
            refreshingGesture=gesture
            try {
                val status=chat.call("host.status");if(g!=epoch)return@launch
                if(status.optJSONObject("personalCapabilities")?.optInt("activity")!=1) { error="更新电脑上的 WeftMate 后可查看动态。";return@launch }
                if(more || full || state.syncCursor.isBlank())readPage(more,g)
                else {
                    val counts=chat.business("/activity/unread");if(g!=epoch)return@launch;state.counts(counts);publish()
                    if(chat.tab=="activity") {
                        var moreChanges=true
                        while(moreChanges) {
                            val delta=chat.business("/activity/changes?${query()}&cursor=${encode(state.syncCursor)}&limit=200");if(g!=epoch)return@launch
                            if(!state.changes(delta)) { readPage(false,g);break }
                            moreChanges=delta.optBoolean("hasMore");publish()
                        }
                    }
                }
                if(g==epoch) { error="";detail?.let{old->detail=items.find{it.optString("id")==old.optString("id")} ?: old} }
            } catch(e:CancellationException){throw e} catch(e:Exception) {
                if(g==epoch) { if(e is ApiFailure&&e.status==409){state.clear();publish();readPage(false,g)}else error=failure(e) }
            } finally { if(g==epoch){loading=false;refreshingGesture=false} }
        }
    }
    private suspend fun readPage(more:Boolean,g:Int) {
        val page=chat.business("/activity?${query()}&limit=50"+(if(more&&state.nextCursor.isNotEmpty())"&cursor=${encode(state.nextCursor)}" else ""))
        if(g!=epoch)return
        state.page(page,more);publish()
        // Pending items remain visible even when the newest page is full of completed items.
        if(!more&&filter=="all") {
            var cursor=""
            do {
                val pending=chat.business("/activity?filter=actionable&limit=200"+(if(cursor.isNotEmpty())"&cursor=${encode(cursor)}" else ""));if(g!=epoch)return
                pending.optJSONArray("items")?.objects()?.forEach(state::acknowledge);publish();cursor=pending.stringOrEmpty("nextCursor")
            }while(cursor.isNotEmpty())
        }
    }
    private fun query()=when(filter){"unread","actionable"->"filter=$filter";"task","reminder","memory"->"type=$filter";else->"filter=all"}
    fun choose(value:String) { if(value==filter||busy)return;epoch++;readJob?.cancel();filter=value;state.filter=value;state.clear();publish();detail=null;refresh(full=true) }
    fun open(row:JSONObject) {
        val pending=row.optString("state")=="pending"
        val actions=row.optJSONArray("actions")?.objects().orEmpty()
        if(pending) actions.firstOrNull{it.optString("kind") in listOf("respond_approval","answer_question","open_chat")}?.let{action(row,it);return}
        actions.firstOrNull{it.optString("kind") in listOf("open_chat","answer_question","view_memory","view_settings","view_library") }?.let{action(row,it);return}
        mark(row)
    }
    fun showDetail(row:JSONObject){detail=row;mark(row)}
    fun openMemoryReview(row:JSONObject){webDetail=JSONObject().put("row",row).put("action",JSONObject().put("kind","native_memory_review"));detail=null;chat.tab="activity-web"}
    fun openOriginalRow(row:JSONObject){webDetail=JSONObject().put("row",row).put("action",JSONObject().put("kind","native_activity_item"));detail=null;chat.tab="activity-web"}
    fun clearRowFocus(){focusRowId=""}
    fun openMemoryItem(row:JSONObject,value:JSONObject,mode:String?=null) {
        action(row,JSONObject().put("kind","memory_item").put("target",JSONObject().put("kind",value.getString("kind")).put("id",value.getString("id"))),mode)
    }
    fun confirmMemory(row:JSONObject,value:JSONObject)=launch {
        if(busy)return@launch
        val g=epoch;busy=true
        val key="review:${row.getString("id")}:${row.getLong("attentionRevision")}:${value.getString("kind")}:${value.getString("id")}"
        try {
            val body=feedReadBody(row,requests.getOrPut(key){UUID.randomUUID().toString()}).put("reviewedMemory",JSONObject().put("kind",value.getString("kind")).put("id",value.getString("id")))
            val receipt=chat.business("/activity/${encode(row.getString("id"))}/read","PATCH",body)
            if(g==epoch){receipt.optJSONObject("item")?.let(state::acknowledge);publish();requests.remove(key);refresh(full=true)}
        }finally{if(g==epoch)busy=false}
    }
    fun mark(row:JSONObject) { if(row.optBoolean("read"))return;launch { markNow(row,epoch) } }
    private suspend fun markNow(row:JSONObject,g:Int) {
        if(row.optBoolean("read"))return
        val key="${row.optString("id")}:${row.optLong("attentionRevision")}"
        val id=requests.getOrPut(key){UUID.randomUUID().toString()}
        try {
            val result=chat.business("/activity/${encode(row.getString("id"))}/read","PATCH",feedReadBody(row,id));if(g!=epoch)return
            result.optJSONObject("item")?.let { state.acknowledge(it);if(detail?.optString("id")==it.optString("id"))detail=it }
            val counts=chat.business("/activity/unread");if(g==epoch){state.counts(counts);publish();requests.remove(key)}
        }catch(e:ApiFailure){if(e.status==409){refresh(full=true);error="这条动态刚有更新，请重新打开。"}else throw e}
    }
    fun markAll()=launch {
        if(state.snapshotCursor.isEmpty()||busy)return@launch
        val g=epoch;val through=state.snapshotCursor;busy=true
        try { val key="all:$through";chat.business("/activity/read","POST",JSONObject().put("requestId",requests.getOrPut(key){UUID.randomUUID().toString()}).put("through",through));if(g==epoch){requests.remove(key);refresh(full=true)} }finally{if(g==epoch)busy=false}
    }
    fun action(row:JSONObject,action:JSONObject,outcome:String?=null) = launch {
        if(busy)return@launch
        val g=epoch;busy=true
        try {
            val kind=action.optString("kind");val target=action.optJSONObject("target") ?: JSONObject()
            if(kind in listOf("open_chat","answer_question","respond_approval")) {
                val source=JSONObject((row.optJSONObject("source") ?: JSONObject()).toString());target.keys().forEach{source.put(it,target.get(it))}
                if(row.optString("state")=="pending")row.optJSONArray("actions")?.objects()?.firstOrNull{it.optString("kind") in listOf("respond_approval","answer_question")}?.optJSONObject("target")?.let{pending->pending.keys().forEach{source.put(it,pending.get(it))}}
                openChat(source,g)
                if(kind=="respond_approval"&&outcome!=null&&g==epoch) {
                    val id=target.getString("approvalId")
                    val approval=chat.approvals.firstOrNull{it.optString("approvalId")==id} ?: throw ApiFailure(404,"APPROVAL_UNAVAILABLE")
                    chat.decide(approval,outcome).join()
                    val receipt=chat.call("shared.approvals.list",JSONObject().put("sessionId",target.getString("sessionId"))).optJSONArray("approvals")?.objects()?.firstOrNull{it.optString("approvalId")==id}
                    if(receipt==null||receipt.optString("status")=="pending")throw ApiFailure(409,"APPROVAL_UNAVAILABLE")
                }
            } else if(kind in listOf("view_memory","memory_item","view_settings","view_library")) {
                webDetail=JSONObject().put("row",row).put("action",action).apply{outcome?.let{put("outcome",it)}};chat.tab="activity-web"
            } else return@launch
            if(g==epoch){detail=null;markNow(row,g)}
        }finally{if(g==epoch)busy=false}
    }
    private suspend fun openChat(target:JSONObject,g:Int) {
        var id=target.stringOrEmpty("chatId")
        if(id.isEmpty()&&target.stringOrEmpty("sessionId").isNotEmpty())id=chat.business("/sessions/${encode(target.getString("sessionId"))}/chat").stringOrEmpty("chatId")
        check(id.isNotEmpty())
        val conversation=chat.business("/chats/${encode(id)}").getJSONObject("chat");if(g!=epoch)return
        chat.select(conversation);if(g!=epoch)return
        target.stringOrEmpty("eventId").takeIf{it.isNotEmpty()}?.let { chat.locateActivityEvent(it) }
        if(g!=epoch)return
        // Legacy sources have seq rather than eventId: load existing older pages until found.
        while(target.has("seq")&&chat.hasOlder&&chat.rows.none{feedTargetMatches(it,target)}){chat.refresh(true);if(g!=epoch)return}
        focusTarget=target;chat.tab="chat"
    }
    fun closeDetail(){detail=null}
    fun closeWeb(){webDetail=null;chat.tab="activity";refresh(full=true)}
    fun event(type:String,data:JSONObject) {
        if(type=="navigation.activity") { pendingLaunch=data.stringOrEmpty("activityId");chat.tab="activity";launch{openLaunch()} }
        else if(type in listOf("notifications.needed","notifications.action","sync.changed")||type.startsWith("activity."))refresh()
    }
    private suspend fun openLaunch() {
        val id=pendingLaunch;if(id.isEmpty()||!chat.loggedIn||noComputer)return
        val g=epoch;chat.tab="activity"
        // Cold launch first finishes the shell's initial conversation selection.
        while(chat.loading&&chat.loggedIn&&g==epoch)delay(50)
        if(g!=epoch||!chat.loggedIn)return
        var cursor="";var found:JSONObject?=null
        do {
            val page=chat.business("/activity?filter=all&limit=200"+(if(cursor.isNotEmpty())"&cursor=${encode(cursor)}" else ""));if(g!=epoch)return
            found=page.optJSONArray("items")?.objects()?.find{it.optString("id")==id};cursor=page.stringOrEmpty("nextCursor")
        }while(found==null&&cursor.isNotEmpty())
        if(g!=epoch)return
        pendingLaunch=""
        activity.intent?.removeExtra("activityId")
        if(found!=null) {
            if(filter!="all")choose("all")
            state.acknowledge(found);publish();focusRowId=id
            if(found.optJSONArray("actions")?.objects()?.any{it.optString("kind") in listOf("open_chat","answer_question","respond_approval")}==true)open(found) else mark(found)
        } else error="这条动态已不在列表中。"
    }
    fun close(){epoch++;readJob?.cancel();poll?.cancel()}
    private fun encode(value:String)=URLEncoder.encode(value,"UTF-8")
}
