package com.memoweft.weftmate.mobile

import android.content.Context
import androidx.compose.runtime.*
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Presentation only: account, model, local conversations, attachments and commands stay in the existing native layer. */
@Stable
internal class NativeChatModel(private val activity: NativeActivity, val scope: CoroutineScope) {
    var loggedIn by mutableStateOf(false)
    var owner by mutableStateOf("")
    var tab by mutableStateOf("chat")
    var title by mutableStateOf("小纬")
    var draft by mutableStateOf("")
    var focused by mutableStateOf(false)
    var running by mutableStateOf(false)
    var loading by mutableStateOf(true)
    var error by mutableStateOf("")
    var connected by mutableStateOf(true)
    var rows by mutableStateOf(emptyList<JSONObject>())
    var approvals by mutableStateOf(emptyList<JSONObject>())
    var questions by mutableStateOf(emptyList<JSONObject>())
    var attachments by mutableStateOf(emptyList<JSONObject>())
    var chats by mutableStateOf(emptyList<JSONObject>())
    var models by mutableStateOf(emptyList<JSONObject>())
    var modelLabel by mutableStateOf("选择模型")
    var modelId by mutableStateOf("")
    var mode by mutableStateOf("auto")
    var chatId by mutableStateOf("")
    private var chatKind = ""
    private var messageIntent = "queue"
    var sessionId by mutableStateOf("")
    var phone by mutableStateOf(false)
    var phoneHistory by mutableStateOf(false)
    var standalone by mutableStateOf(false)
    var phoneArchive by mutableStateOf(false)
    var canRegenerate by mutableStateOf(false)
    var dark by mutableStateOf(false)
    var textSize by mutableFloatStateOf(DesignTokens.font15)
    var codeSize by mutableFloatStateOf(DesignTokens.font13)
    var olderCursor by mutableStateOf("")
    var hasOlder by mutableStateOf(false)
    var sendAvailable by mutableStateOf(true)
    var timeZone by mutableStateOf("Asia/Shanghai")
    var uncertain by mutableStateOf(emptyList<JSONObject>())
    var fileAnchor by mutableStateOf("")
    var scrollVersion by mutableStateOf(0)
    var copyVersion by mutableStateOf(0)
    private val timeline = NativeTimeline()
    private var cursor = ""
    private var liveRevision = 0L
    private var replyWait = false
    private var seq = -1L
    private var generation = 0
    private var poll: Job? = null
    private var sending by mutableStateOf(false)
    val submitting get() = sending
    private var refreshing = false
    private var refreshGeneration = -1
    internal var refreshPhase = "idle"
    private var phoneLive = ""
    private var phoneOwner = ""
    private var phoneModelSwitching = false
    private var composerSave: Job? = null
    private var bootstrapping = false
    private var modelSettingsFinished = false
    private val prefs = activity.getSharedPreferences("native-chat", Context.MODE_PRIVATE)
    val composer get() = NativeComposerState(draft, focused, attachments.size, running, !standalone)
    suspend fun call(method: String, params: JSONObject = JSONObject()): JSONObject = suspendCancellableCoroutine { c ->
        val cancel = activity.nativeRequest(method, params) { r -> if (c.isActive) r.fold({ c.resume(it) }, { c.resumeWithException(it) }) }
        c.invokeOnCancellation { cancel() }
    }
    suspend fun business(path: String, method: String = "GET", body: JSONObject? = null) = call("host.business", JSONObject().put("path", "/personal/v1$path").put("method", method).apply { body?.let { put("body", it) } })
    private fun launchJob(action: suspend () -> Unit): Job = scope.launch { try { action() } catch (e: CancellationException) { throw e } catch (_: Exception) { error = "暂时没能完成，请重试。" } }
    fun launch(action: suspend () -> Unit) { launchJob(action) }
    fun start() { launch { bootstrap() } }
    suspend fun bootstrap() {
        if (bootstrapping) return
        bootstrapping = true
        try {
        val b = call("app.bootstrap")
        val nextOwner = b.optString("owner")
        if (owner != nextOwner) { loading=true; generation++; poll?.cancel(); timeline.reset(); rows = emptyList(); attachments = emptyList(); approvals = emptyList(); questions = emptyList(); draft = ""; uncertain = emptyList(); chatId = ""; sessionId = ""; tab="chat"; modelSettingsFinished=false }
        owner = nextOwner; loggedIn = b.optBoolean("loggedIn"); standalone = b.optString("authSource") == "phone"
        val appearance = call("settings.appearance")
        dark = resolvedAppearanceDark(appearance.optString("value"), appearance.optBoolean("systemDark"))
        if (!loggedIn) { composerSave?.cancel(); phoneOwner = ""; chats = emptyList(); models = emptyList(); running = false; phoneArchive = false; loading = false; return }
        var phoneView = activity.phonePresentation("view")
        readingPreferences(phoneView)
        if(phoneView.optBoolean("active")) standalone=true
        if (standalone) {
            var view = phoneView
            val deadline = android.os.SystemClock.elapsedRealtime() + 20000
            while ((!view.optBoolean("ready") || view.optBoolean("authBusy")) && android.os.SystemClock.elapsedRealtime() < deadline) { delay(100); view = activity.phonePresentation("view") }
            if (!view.optBoolean("ready") || view.optBoolean("authBusy")) { loading = false; return }
            phoneOwner = view.optString("owner")
            refreshPhoneModels()
            refreshChats()
            if (chatId.isBlank()) {
                val composer = view.optJSONObject("composer")
                val id = composer?.optString("conversationId")?.takeUnless { it == "null" }
                    ?: view.optString("selectedId").takeUnless { it == "null" }.orEmpty()
                select(chats.find { it.optString("id") == id } ?: JSONObject().put("id", "phone-new").put("nativePhone", true).put("title", "小纬"))
                draft = composer?.optString("draft").orEmpty()
            } else refreshPhone(view)
            loading = false; return
        }
        models = runCatching { call("models.host").optJSONArray("models")?.objects() ?: emptyList() }.getOrDefault(emptyList()) +
            runCatching { call("models.list").optJSONArray("models")?.objects() ?: emptyList() }.getOrDefault(emptyList())
        val selected = b.optJSONObject("model")
        modelId = selected?.optString("profileId") ?: ""
        if (modelId.isBlank()) modelId = models.firstOrNull { it.optBoolean("configured") }?.optString("profileId") ?: ""
        modelLabel = selected?.optString("displayName")?.takeIf { it.isNotBlank() } ?: models.firstOrNull { it.optString("profileId") == modelId }?.optString("displayName") ?: "选择模型"
        replyWait = runCatching { business("/status").optJSONObject("personalCapabilities")?.optInt("replyWait") == 1 }.getOrDefault(false)
        refreshMessageIntent()
        refreshChats()
        if (chatId.isBlank()) {
            val main = runCatching { business("/chats/main").getJSONObject("chat") }.getOrNull()
            if (main != null) select(main) else {
                connected = false; sendAvailable = false; loading = false
                error = "正在连接电脑，请稍候。"
                return
            }
        }
        loading = false
        } finally { bootstrapping = false; loading = false }
    }
    private suspend fun refreshPhoneModels() {
        val result = call("phone.models.list")
        models = result.optJSONArray("models")?.objects().orEmpty()
        val selected = result.optJSONObject("selected")
        modelId = selected?.optString("modelId").orEmpty()
        modelLabel = selected?.optString("displayName")?.ifBlank { modelId } ?: "选择模型"
        sendAvailable = modelId.isNotBlank() && !phoneModelSwitching
    }
    private fun phoneParams() = JSONObject().put("owner", phoneOwner).put("conversationId", chatId.takeUnless { it == "phone-new" })
    private fun readingPreferences(view:JSONObject) { textSize=view.optDouble("fontSize",DesignTokens.font15.toDouble()).toFloat();codeSize=view.optDouble("codeFontSize",DesignTokens.font13.toDouble()).toFloat() }
    private fun refreshPhone(view: JSONObject) {
        readingPreferences(view)
        if (!view.optBoolean("ready") || view.optString("owner") != phoneOwner) return
        phoneModelSwitching=view.optBoolean("modelSwitching")
        sendAvailable=modelId.isNotBlank() && !phoneModelSwitching
        val conversations = view.optJSONArray("conversations")?.objects().orEmpty()
        if (chatId == "phone-new" && view.optBoolean("running")) {
            val next = view.optString("selectedId").takeUnless { it == "null" }.orEmpty()
            if(next.isNotBlank()) { chatId=next; launch { call("native.conversation",JSONObject().put("id",next)) } }
        }
        val conversation = conversations.find { it.optString("id") == chatId }
        val turns = conversation?.optJSONArray("turns")?.objects().orEmpty()
        running = view.optBoolean("running")
        rows = turns.flatMap { turn -> turn.optJSONArray("messages")?.objects().orEmpty().mapIndexed { index, message ->
            JSONObject().put("eventId", "${turn.optString("id")}:$index").put("at", java.time.Instant.ofEpochMilli(turn.optLong("timestamp")).toString())
                .put("type", if (running && view.optString("selectedId") == chatId && turn === turns.lastOrNull() && message.optString("role") == "assistant") "assistant.delta" else "${message.optString("role")}.message").put("data", message)
        } }
        canRegenerate = standalone && !running && turns.lastOrNull()?.let { !it.optBoolean("synced") && it.optJSONArray("messages")?.objects()?.any { m -> m.optString("role") == "user" } == true } == true
        title = turns.firstOrNull()?.optJSONArray("messages")?.optJSONObject(0)?.optString("text")?.take(40) ?: "新对话"
        error = view.optString("error"); connected = true
        if (tab == "models") {
            if (modelSettingsFinished && view.optString("page") == "chat") { tab="chat"; modelSettingsFinished=false }
        }
        sendAvailable = standalone && modelId.isNotBlank()
        chats = chats.filter { !it.optBoolean("nativePhone") } + conversations.map { c -> JSONObject().put("id",c.optString("id")).put("source","phone").put("nativePhone",true)
            .put("title", c.optJSONArray("turns")?.optJSONObject(0)?.optJSONArray("messages")?.optJSONObject(0)?.optString("text")?.take(40) ?: "新对话") }
    }
    suspend fun refreshChats() {
        chats = if (standalone) emptyList() else runCatching { business("/chats").optJSONArray("items")?.objects().orEmpty() }.getOrDefault(emptyList()) +
            runCatching { call("conversations.list").optJSONArray("conversations")?.objects().orEmpty() }.getOrDefault(emptyList())
        val view = activity.phonePresentation("view")
        if (view.optBoolean("ready")) {
            phoneOwner = view.optString("owner")
            chats = chats + view.optJSONArray("conversations")?.objects().orEmpty().map { c -> JSONObject().put("id",c.optString("id")).put("source","phone").put("nativePhone",true)
                .put("title", c.optJSONArray("turns")?.optJSONObject(0)?.optJSONArray("messages")?.optJSONObject(0)?.optString("text")?.take(40) ?: "新对话") }
        }
    }
    suspend fun select(chat: JSONObject) {
        val startingDraft = if(chatId.isBlank())draft else ""
        saveDraft(); generation++; poll?.cancel(); timeline.reset(); cursor = ""; liveRevision = 0; seq = -1
        val g = generation
        phoneArchive = chat.optBoolean("nativePhone")
        phoneHistory = chat.optBoolean("phoneHistory")
        phone = hostChatUsesPhoneStorage(chat)
        chatId = if (phone) chat.getString("id") else chat.optString("chatId")
        chatKind = chat.optString("kind")
        sessionId = chat.optString("activeSessionId").takeUnless { it == "null" } ?: ""
        sendAvailable = phone || chat.optBoolean("sendAvailable")
        title = if (chat.optString("kind") == "main") "WeftMate" else chat.optString("title", "新对话")
        timeZone = chat.optString("timeZone", java.time.ZoneId.systemDefault().id)
        modelId = chat.stringOrEmpty("selectedModelProfileId").ifEmpty { chat.stringOrEmpty("modelProfileId") }.ifEmpty { modelId }
        modelLabel = models.firstOrNull { it.optString("profileId",it.optString("modelId")) == modelId }?.optString("displayName") ?: modelLabel
        draft = prefs.getString("draft:$owner:$chatId", startingDraft) ?: startingDraft
        rows = emptyList(); approvals = emptyList(); questions = emptyList(); uncertain = emptyList(); phoneLive = ""; focused = false
        canRegenerate = false
        call("native.conversation", JSONObject().put("id", chatId))
        if (g != generation) return
        if (phoneArchive) {
            attachments = emptyList(); draft = ""; hasOlder = false; olderCursor = ""
            val view = activity.phonePresentation("view")
            if (g != generation) return
            val saved = view.optJSONObject("composer")
            if (standalone) draft = view.optJSONObject("drafts")?.optString(if(chatId=="phone-new")"new" else chatId)
                ?: if(saved?.optString("conversationId").orEmpty().ifBlank { "phone-new" } == chatId) saved?.optString("draft").orEmpty() else ""
            refreshPhone(view)
            call("native.draft",JSONObject().put("hasDraft",draft.isNotEmpty()))
            if (g != generation) return
            poll = scope.launch { while (isActive && g == generation) { delay(if (running) 100 else 500); if (activity.nativeForeground) refresh() } }
            return
        }
        refreshAttachments()
        if (g != generation) return
        call("native.draft",JSONObject().put("hasDraft",draft.isNotEmpty() || attachments.isNotEmpty()))
        if (g != generation) return
        if (sessionId.isNotBlank()) mode = runCatching { business("/sessions/$sessionId/approval-mode").optString("mode", "auto") }.getOrDefault("auto")
        if (g != generation) return
        refresh()
        if (g != generation) return
        poll = scope.launch { while (isActive && g == generation) {
            if (refreshing && refreshGeneration == g) { delay(50); continue }
            if (tab == "chat" && activity.nativeForeground && replyWait && !phone && cursor.isNotBlank()) refresh(wait = true)
            else { delay(if (running) 250 else 2500); if (tab == "chat" && activity.nativeForeground) refresh() }
            if (!connected) delay(1500)
        } }
    }
    fun saveDraft() {
        if (phoneArchive) {
            composerSave?.cancel()
            if (standalone && phoneOwner.isNotBlank()) { val p = phoneParams().put("draft", draft); composerSave = scope.launch { delay(150); runCatching { activity.phonePresentation("composer", p) } } }
        } else if (owner.isNotBlank() && chatId.isNotBlank()) prefs.edit().putString("draft:$owner:$chatId", draft).apply()
    }
    suspend fun locateFile(source: JSONObject) {
        val started=generation;val sourceOwner=owner
        val id=source.optString("chatId").takeIf { it.isNotBlank() && it!="null" }
        val target=if(id!=null)business("/chats/$id").getJSONObject("chat") else
            business("/sessions/${source.getString("sessionId")}/chat").getJSONObject("chat")
        if(started!=generation || sourceOwner!=owner)return
        select(target)
        val selectedGeneration=generation
        val anchor=source.optString("eventId")
        if(anchor.isNotBlank()) {
            val page=business("/chats/$chatId/events?around=${java.net.URLEncoder.encode(anchor,"UTF-8")}&limit=100")
            if(selectedGeneration!=generation || sourceOwner!=owner)return
            timeline.reset();timeline.merge(page);rows=timeline.rows();olderCursor=page.optString("olderCursor").takeUnless{it=="null"}.orEmpty();hasOlder=page.optBoolean("hasOlder")
            fileAnchor=anchor
        }
        tab="chat"
    }
    /** Preserve continuous history: the existing UI pages from latest to older. */
    suspend fun locateActivityTarget(target: JSONObject): Boolean {
        val g = generation
        while (g == generation && rows.none { feedTargetMatches(it, target) }) {
            while (refreshing && g == generation) delay(50)
            if (g != generation || !hasOlder) return false
            val before = olderCursor
            refresh(true)
            if (g != generation) return false
            if (rows.none { feedTargetMatches(it, target) } && hasOlder && olderCursor == before)
                throw ApiFailure(503, "ACTIVITY_SOURCE_UNAVAILABLE")
        }
        return g == generation
    }
    fun edit(text: String) { draft = text; saveDraft(); launch { call("native.draft",JSONObject().put("hasDraft",text.isNotEmpty() || attachments.isNotEmpty())) } }
    suspend fun refreshAttachments() {
        if (!phone && !sendAvailable) { attachments = emptyList(); return }
        attachments = call("attachments.list", JSONObject().put("conversationId", chatId)).optJSONArray("attachments")?.objects().orEmpty()
    }
    private suspend fun refreshMessageIntent() { messageIntent = runCatching { business("/settings/personalization").optJSONObject("settings")?.optString("messageMode", "queue") ?: "queue" }.getOrDefault("queue") }
    suspend fun refresh(older: Boolean = false, wait: Boolean = false) {
        if (refreshing && refreshGeneration == generation) return
        refreshing = true
        val g = generation
        refreshGeneration = g
        try {
            if (phoneArchive) {
                val view = activity.phonePresentation("view"); if (g != generation) return
                refreshPhone(view)
                if (standalone && tab == "chat" && !running) refreshPhoneModels()
                return
            } else if (phone) {
                val p = call("conversations.messages", JSONObject().put("conversationId", chatId)); if (g != generation) return
                rows = p.optJSONArray("messages")?.objects().orEmpty().map { m -> JSONObject().put("eventId", m.optString("id")).put("type", "${m.optString("role")}.message").put("data", m) }
                running = p.optString("turnStatus") in listOf("running", "streaming")
                if (running && phoneLive.isNotBlank()) rows = rows + JSONObject().put("eventId","phone-live").put("type","assistant.delta").put("data",JSONObject().put("text",phoneLive))
            } else {
                val path = if (older) "/chats/$chatId/events?before=${java.net.URLEncoder.encode(olderCursor, "UTF-8")}&limit=100"
                    else if (cursor.isBlank()) "/chats/$chatId/events?limit=100" else "/chats/$chatId/changes?cursor=${java.net.URLEncoder.encode(cursor, "UTF-8")}&limit=100" +
                        if (wait && replyWait) "&waitMs=15000&liveRevision=$liveRevision" else ""
                refreshPhase = "history"
                val p = business(path); if (g != generation) return
                val previousRows = rows.toString()
                timeline.merge(p, older); rows = timeline.rows()
                if (p.has("olderCursor")) { olderCursor = p.optString("olderCursor").takeUnless { it == "null" } ?: ""; hasOlder = p.optBoolean("hasOlder") }
                if (!older) { cursor = p.optString("nextCursor", p.optString("syncCursor", cursor)); liveRevision = p.optLong("liveRevision", liveRevision) }
                refreshPhase = "chat-status"
                val current = business("/chats/$chatId").getJSONObject("chat"); if (g != generation) return
                sessionId = current.optString("activeSessionId").takeUnless { it == "null" } ?: ""
                sendAvailable = current.optBoolean("sendAvailable")
                running = current.optBoolean("running") || rows.any { it.optString("type") == "assistant.delta" && it.optJSONObject("data")?.optBoolean("streaming") == true }
                if (sessionId.isNotBlank()) {
                    refreshPhase = "approvals"
                    val a = call("shared.approvals.list", JSONObject().put("sessionId", sessionId)); if (g != generation) return
                    approvals = a.optJSONArray("approvals")?.objects().orEmpty().map { row ->
                        val saved = prefs.getString("decision:$owner:$sessionId:${row.optString("approvalId")}",null)
                        if(row.optString("status")=="pending" && saved!=null) JSONObject(row.toString()).put("nativeDecision",JSONObject(saved)) else row
                    }
                    refreshPhase = "questions"
                    val q = call("shared.questions.list", JSONObject().put("sessionId", sessionId)); if (g != generation) return
                    questions = q.optJSONArray("questions")?.objects().orEmpty()
                }
                refreshPhase = "delivery"
                uncertain = call("shared.outbox.list").optJSONArray("commands")?.objects().orEmpty().filter {
                    it.optString("sessionId") in setOf(chatId, sessionId) && it.optString("state") !in setOf("accepted")
                }
                if (rows.toString() != previousRows && uncertain.any { it.optString("state") == "pending" }) {
                    call("shared.outbox.reconcile")
                    if (g != generation) return
                    uncertain = call("shared.outbox.list").optJSONArray("commands")?.objects().orEmpty().filter {
                        it.optString("sessionId") in setOf(chatId, sessionId) && it.optString("state") != "accepted"
                    }
                }
            }
            connected = true; error = ""
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) {
            if (g != generation) return
            connected = false
            if (e is ApiFailure && e.status == 409) { cursor = ""; timeline.reset(); rows = emptyList() }
            if (e is ApiFailure && e.status in listOf(401, 403)) { loggedIn = false; rows = emptyList(); approvals = emptyList(); questions = emptyList(); timeline.reset(); poll?.cancel(); activity.showLogin() }
            else error = "连接暂时中断，正在重连。"
        } finally { if (refreshGeneration == g) { refreshing = false; refreshPhase = "idle" } }
    }
    fun send() = launch {
        if (sending || !sendAvailable || uncertain.any { it.optString("state") == "uncertain" } || draft.isBlank() && attachments.isEmpty()) return@launch
        if(standalone && running)return@launch
        scrollVersion++
        sending = true
        val g = generation; val text = draft; val files = attachments.map { it.getString("attachmentId") }
        try {
            if (phoneArchive) {
                val accepted=activity.phonePresentation("send", phoneParams().put("text",text))
                if(g!=generation)return@launch
                check(accepted.optBoolean("ready") && accepted.optString("owner")==phoneOwner) { "ACCOUNT_SWITCHED" }
                if(!accepted.optBoolean("sent",true)) { refreshPhone(accepted);return@launch }
                draft = ""; saveDraft(); call("native.draft",JSONObject().put("hasDraft",false)); running = true
                refresh(); return@launch
            }
            val p = JSONObject().put("text", text).put("attachmentIds", JSONArray(files)).put("requestId", "native-${UUID.randomUUID()}")
            val result = if (phone) call("chat.send", p.put("conversationId", chatId)) else {
                val target = hostChatSendTarget(chatKind, chatId, sessionId)
                for (key in target.keys()) p.put(key, target.get(key))
                call("shared.send", p.put("modelProfileId", modelId).put("intent", messageIntent))
            }
            if (g != generation) return@launch
            if (result.optString("state") == "rejected") { error = if(result.optString("errorCode") in setOf("UNAUTHORIZED","DEVICE_NOT_TRUSTED")) "电脑连接已失效，请重新连接后发送。草稿已保留。" else "消息没能发送，草稿已保留。"; return@launch }
            if (!phone && result.optString("state") != "accepted") uncertain = uncertain.filter { it.optString("requestId") != result.optString("requestId") } + result
            draft = ""; saveDraft(); sending = false; running = result.optString("state") != "uncertain"
            launch { call("native.draft",JSONObject().put("hasDraft",false)); if (g == generation) { refreshAttachments(); refresh() } }
        } finally { sending = false }
    }
    fun stop() = launch { if (phoneArchive) activity.phonePresentation("stop", phoneParams()) else if (phone) call("chat.stop") else if (sessionId.isNotBlank()) call("shared.stop", JSONObject().put("sessionId", sessionId).put("requestId", "stop-${UUID.randomUUID()}")); refresh() }
    fun regenerate() = launch { if (canRegenerate) { scrollVersion++;activity.phonePresentation("regenerate", phoneParams()); refresh() } }
    fun copyReply(text:String) = launch { call("clipboard.copy",JSONObject().put("text",text));copyVersion++ }
    fun checkDelivery() = launch { call("shared.outbox.reconcile"); refresh() }
    fun newChat() = launch {
        if (standalone || !connected) {
            select(if(standalone) JSONObject().put("id","phone-new").put("nativePhone",true).put("title","小纬") else call("conversations.create"))
        } else {
            val status = business("/status")
            val id = "native-${UUID.randomUUID()}"
            var command = business("/commands", "POST", JSONObject().put("requestId", id).put("kind", "session.create")
                .put("targetDeviceId", status.getString("hostId")).put("modelProfileId", modelId)).getJSONObject("command")
            val deadline = android.os.SystemClock.elapsedRealtime() + 15000
            while (command.optString("state") in setOf("pending","preflight","dispatching") && android.os.SystemClock.elapsedRealtime() < deadline) {
                delay(100); command = call("shared.commands.byRequest", JSONObject().put("requestId", id)).getJSONObject("command")
            }
            if (command.optString("state") !in setOf("accepted_by_dsh","observed")) { error="电脑还没能创建对话，请稍后重试。"; return@launch }
            val resolved = business("/sessions/${command.getString("sessionId")}/chat")
            select(business("/chats/${resolved.getString("chatId")}").getJSONObject("chat"))
        }
        tab="chat"
    }
    fun returnToChat() { tab="chat"; launch { readingPreferences(activity.phonePresentation("view"));if(standalone)refreshPhoneModels() else refreshMessageIntent(); refresh() } }
    fun openModels() { modelSettingsFinished=false; tab="models" }
    fun selectModel(row: JSONObject) = launch {
        val id = row.optString("profileId",row.optString("modelId"))
        if(standalone) { activity.phonePresentation("model", phoneParams().put("endpoint",row.getString("endpoint")).put("modelId",row.getString("modelId"))); refreshPhoneModels() }
        else { if(row.optString("source")=="phone")call("models.select",JSONObject().put("endpoint",row.getString("endpoint")).put("modelId",row.getString("modelId"))) else call("models.selectHost",JSONObject().put("profileId",id)); modelId=id;modelLabel=row.optString("displayName",id) }
    }
    fun pick(kind: String) = launch { call("attachments.pick", JSONObject().put("conversationId", chatId).put("kind", kind)) }
    fun remove(row: JSONObject) = launch { call("attachments.remove", JSONObject().put("conversationId", chatId).put("attachmentId", row.getString("attachmentId"))); refreshAttachments() }
    fun decide(row: JSONObject, outcome: String, decisionScope: String = "once") = launchJob {
        val id = row.getString("approvalId"); val key = "decision:$owner:$sessionId:$id"
        val p = prefs.getString(key, null)?.let(::JSONObject) ?: JSONObject().put("sessionId", sessionId).put("approvalId", id).put("requestId", "approve-${UUID.randomUUID()}").put("outcome", outcome).apply { if (outcome != "rejected") put("scope", decisionScope) }
        check(prefs.edit().putString(key, p.toString()).commit())
        approvals = approvals.map { if(it.optString("approvalId")==id)JSONObject(it.toString()).put("nativeDecision",p) else it }
        val receipt = call("shared.approvals.decide", p).optJSONObject("approval")
        if (receipt != null) approvals = approvals.map { if (it.optString("approvalId") == id && it.optString("status") == "pending") receipt else it }
        refresh()
    }
    fun answer(row: JSONObject, answers: JSONArray) = launch {
        val id = row.getString("questionRpcId"); val key = "question:$owner:$sessionId:$id"
        val p = prefs.getString(key, null)?.let(::JSONObject) ?: JSONObject().put("sessionId", sessionId).put("questionRpcId", id).put("requestId", "answer-${UUID.randomUUID()}").put("answer", JSONObject().put("answers", answers))
        check(prefs.edit().putString(key, p.toString()).commit()); call("shared.questions.answer", p); refresh()
    }
    fun event(type: String, data: JSONObject) {
        when {
            type == "result.app.ready" || type == "result.auth.login" || type == "result.cloud.adopt" || type == "result.phone.adopt" || type == "result.auth.logout" -> launch { bootstrap() }
            type.startsWith("result.phone.models.") && standalone -> {
                if(tab=="models" && type in listOf("result.phone.models.test","result.phone.models.select")) modelSettingsFinished=true
                launch { refreshPhoneModels() }
            }
            type == "attachment.result" -> launch { refreshAttachments() }
            type == "navigation.activity" -> tab = "activity"
            type == "navigation.conversation" -> launch { refreshChats(); chats.find { it.optString("chatId",it.optString("id")) == data.optString("conversationId") }?.let { select(it) };tab="chat" }
            type == "voice.result" && data.optString("conversationId") == chatId -> data.optString("text").takeIf { it.isNotBlank() }?.let { edit(draft + it) }
            type.startsWith("chat.") && data.optString("conversationId") == chatId -> { if (type == "chat.progress") {
                val text = data.optString("text"); phoneLive = text; if (text.isNotBlank()) rows = rows.filter { it.optString("eventId") != "phone-live" } + JSONObject().put("eventId", "phone-live").put("type", "assistant.delta").put("data", JSONObject().put("text", text))
            } else { if(type=="chat.finished")phoneLive="";launch { refresh() } } }
            type == "result.settings.appearance" || type == "theme.system" -> launch { val a = call("settings.appearance"); dark = resolvedAppearanceDark(a.optString("value"), a.optBoolean("systemDark")) }
        }
    }
    fun close() { saveDraft(); poll?.cancel() }
}
