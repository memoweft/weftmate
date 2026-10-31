package com.memoweft.weftmate.mobile

import androidx.compose.runtime.*
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

internal suspend fun readNativeApprovalMode(fallback: String, read: suspend () -> String): String {
    val modes = listOf("auto", "ask", "accept-edits", "plan", "allow-all")
    return try {
        val selected = read()
        check(selected in modes) { "APPROVAL_RECEIPT_INVALID" }
        selected
    } catch (e: CancellationException) { throw e
    } catch (_: Exception) { fallback.takeIf { it in modes } ?: "ask" }
}

internal suspend fun saveNativeApprovalMode(selected: String, local: Boolean, save: suspend () -> String): String {
    if (local) return selected
    val saved = save()
    check(saved == selected) { "APPROVAL_RECEIPT_INVALID" }
    return saved
}

/** Presentation only: account, model, local conversations, attachments and commands stay in the existing native layer. */
@Stable
internal class NativeChatModel(private val environment: NativeChatEnvironment, val scope: CoroutineScope) {
    constructor(activity: NativeActivity, scope: CoroutineScope) : this(ActivityNativeChatEnvironment(activity), scope)
    var loggedIn by mutableStateOf(false)
    var localOnly by mutableStateOf(false)
    var owner by mutableStateOf("")
    var tab by mutableStateOf("chat")
    var title by mutableStateOf("小纬")
    var draft by mutableStateOf("")
    var focused by mutableStateOf(false)
    var running by mutableStateOf(false)
    var loading by mutableStateOf(true)
    var error by mutableStateOf("")
    var connected by mutableStateOf(true)
    var computerOffline by mutableStateOf(false)
        private set
    var rows by mutableStateOf(emptyList<JSONObject>())
    var approvals by mutableStateOf(emptyList<JSONObject>())
    var questions by mutableStateOf(emptyList<JSONObject>())
    var attachments by mutableStateOf(emptyList<JSONObject>())
    var chats by mutableStateOf(emptyList<JSONObject>())
    var models by mutableStateOf(emptyList<JSONObject>())
    var hostModelServices by mutableStateOf(false)
    var workAndChat by mutableStateOf(false)
    var conversationMode by mutableStateOf("chat")
        private set
    var sidebarMode by mutableStateOf("chat")
        private set
    var hostId by mutableStateOf("")
        private set
    var hostName by mutableStateOf("这台电脑")
        private set
    var computers by mutableStateOf(emptyList<JSONObject>())
        private set
    var projects by mutableStateOf(emptyList<JSONObject>())
        private set
    var workProject by mutableStateOf<JSONObject?>(null)
        private set
    var newWork by mutableStateOf(false)
        private set
    var workChoicesBusy by mutableStateOf(false)
        private set
    var workComputerBusy by mutableStateOf(false)
        private set
    val workBusy get() = workChoicesBusy || workComputerBusy
    var workChoicesError by mutableStateOf("")
        private set
    private var switchingComputer = false
    private var workCreateRequest = ""
    private var workCreateProject = ""
    var offlineWorkReady by mutableStateOf(false)
        private set
    val visibleChats get() = nativeModeChats(chats, sidebarMode, workAndChat)
    val canSend get() = sendAvailable && (!workAndChat || conversationMode != "work" || workProject != null && connected)
    val subtitle get() = when {
        phoneHistory -> "来自手机 · 只读"
        standalone || phone -> "手机自己答的"
        computerOffline -> "$hostName · 现在离线"
        workAndChat && conversationMode == "work" -> "$hostName · ${workProject?.stringOrEmpty("name")?.ifEmpty { null } ?: "选择项目或文件夹"}"
        workAndChat -> "由 $hostName 回答"
        connected -> "已连接"
        else -> "正在重连"
    }
    var modelLabel by mutableStateOf("选择模型")
    var modelId by mutableStateOf("")
    var mode by mutableStateOf("auto")
    var approvalModeBusy by mutableStateOf(false)
    private var approvalModeReady = false
    private var pendingApprovalMode: String? = null
    private var approvalModeRevision = 0
    var chatId by mutableStateOf("")
    var chatKind = ""
        private set
    private var messageIntent = "queue"
    var sessionId by mutableStateOf("")
    var phone by mutableStateOf(false)
    var phoneHistory by mutableStateOf(false)
    var standalone by mutableStateOf(false)
    var phoneArchive by mutableStateOf(false)
    var canRegenerate by mutableStateOf(false)
    var canRetryQueue by mutableStateOf(false)
    var canRetryPhoneReply by mutableStateOf(false)
    private var phoneRetryText = ""
    private var phoneReplyFailure = ""
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
    private var creatingChat by mutableStateOf(false)
    val submitting get() = sending || approvalModeBusy
    private var refreshing = false
    private var refreshGeneration = -1
    internal var refreshPhase = "idle"
    private var phoneLive = ""
    private var phoneOwner = ""
    private var phoneModelSwitching = false
    private var composerSave: Job? = null
    private var bootstrapping = false
    private var modelSettingsFinished = false
    private val prefs = environment.preferences
    private val uncreatedDraftKey get() = "draft-new:$owner:$conversationMode"
    val composer get() = NativeComposerState(draft, focused, attachments.size, running)
    suspend fun call(method: String, params: JSONObject = JSONObject()): JSONObject = environment.request(method, params)
    suspend fun business(path: String, method: String = "GET", body: JSONObject? = null): JSONObject {
        val request: suspend () -> JSONObject = { call("host.business", JSONObject().put("path", "/personal/v1$path").put("method", method).apply { body?.let { put("body", it) } }) }
        return if (path == "/model-services" || path.startsWith("/model-services/")) hostModelServicesRequest(hostModelServices, request) else request()
    }
    private fun launchJob(action: suspend () -> Unit): Job = scope.launch { try { action() } catch (e: CancellationException) { throw e } catch (_: Exception) { error = "暂时没能完成，请重试。" } }
    fun launch(action: suspend () -> Unit) { launchJob(action) }
    fun start() { launch { bootstrap() } }
    suspend fun bootstrap() {
        if (bootstrapping) return
        bootstrapping = true
        try {
        hostModelServices = false
        val b = call("app.bootstrap")
        val nextOwner = b.optString("owner")
        if (owner != nextOwner) { computerOffline=false; offlineWorkReady=false; workAndChat=false; newWork=false; conversationMode="chat"; loading=true; generation++; poll?.cancel(); timeline.reset(); rows = emptyList(); attachments = emptyList(); approvals = emptyList(); questions = emptyList(); draft = ""; uncertain = emptyList(); chatId = ""; sessionId = ""; tab="chat"; modelSettingsFinished=false }
        owner = nextOwner; loggedIn = b.optBoolean("loggedIn"); localOnly = b.optString("authSource") == "phone-local"; standalone = b.optString("authSource") in setOf("phone", "phone-local")
        sidebarMode = prefs.getString("conversation-mode:$owner", "chat").let { if (it == "work") "work" else "chat" }
        val appearance = call("settings.appearance")
        dark = resolvedAppearanceDark(appearance.optString("value"), appearance.optBoolean("systemDark"))
        if (!loggedIn) { workAndChat=false; composerSave?.cancel(); phoneOwner = ""; chats = emptyList(); models = emptyList(); running = false; phoneArchive = false; loading = false; return }
        var phoneView = environment.phone("view")
        readingPreferences(phoneView)
        if(phoneView.optBoolean("active")) standalone=true
        if (standalone) {
            var view = phoneView
            val deadline = android.os.SystemClock.elapsedRealtime() + 20000
            while ((!view.optBoolean("ready") || view.optBoolean("authBusy")) && android.os.SystemClock.elapsedRealtime() < deadline) { delay(100); view = environment.phone("view") }
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
        refreshHostModels(b.optJSONObject("model"))
        val hostStatus = runCatching { business("/status") }.getOrNull()
        replyWait = hostStatus?.optJSONObject("personalCapabilities")?.optInt("replyWait") == 1
        hostModelServices = hostModelServicesDeclared(hostStatus)
        workAndChat = hostWorkAndChatDeclared(hostStatus)
        hostId = hostStatus?.stringOrEmpty("hostId").orEmpty()
        hostName = hostStatus?.stringOrEmpty("hostName")?.ifEmpty { null } ?: "这台电脑"
        if (hostStatus != null) { connected = true; computerOffline = false }
        if (workAndChat) refreshWorkChoices()
        refreshMessageIntent()
        refreshChats()
        if (chatId.isBlank()) {
            if (switchingComputer) return
            if (workAndChat && newWork) return
            if (workAndChat && prefs.getBoolean("new-work:$owner", false)) { newChat("work").join(); return }
            if (workAndChat) { val remembered = sidebarMode; newChat("chat").join(); chooseSidebarMode(remembered); return }
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
    private suspend fun refreshHostModels(selected: JSONObject?) {
        models = runCatching { call("models.host").optJSONArray("models")?.objects() ?: emptyList() }.getOrDefault(emptyList()) +
            runCatching { call("models.list").optJSONArray("models")?.objects() ?: emptyList() }.getOrDefault(emptyList())
        modelId = selected?.stringOrEmpty("profileId").orEmpty()
        if (modelId.isBlank()) modelId = models.firstOrNull { it.optBoolean("configured") }?.stringOrEmpty("profileId").orEmpty()
        modelLabel = selected?.stringOrEmpty("displayName")?.takeIf { it.isNotBlank() } ?: models.firstOrNull { it.optString("profileId") == modelId }?.optString("displayName") ?: "选择模型"
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
        val conversation = conversations.find { it.optString("id") == chatId }
        val turns = conversation?.optJSONArray("turns")?.objects().orEmpty()
        running = view.optBoolean("running")
        canRetryQueue = standalone && view.optBoolean("queueRetryAvailable")
        rows = turns.flatMap { turn -> turn.optJSONArray("messages")?.objects().orEmpty().mapIndexed { index, message ->
            JSONObject().put("eventId", "${turn.optString("id")}:$index").put("at", java.time.Instant.ofEpochMilli(turn.optLong("timestamp")).toString())
                .put("type", if (running && view.optString("activeConversationId",view.optString("selectedId")) == chatId && turn === turns.lastOrNull() && message.optString("role") == "assistant") "assistant.delta" else "${message.optString("role")}.message").put("data", message)
        } } + view.optJSONArray("pendingMessages")?.objects().orEmpty().filter { it.optString("conversationId") == chatId }.map { pending ->
            JSONObject().put("eventId", "queued:${pending.optString("id")}").put("type", "user.message")
                .put("at", java.time.Instant.ofEpochMilli(pending.optLong("timestamp")).toString())
                .put("data", JSONObject().put("text",pending.optString("text")).put("queued",true))
        }
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
        if (workAndChat) {
            val main = runCatching { business("/chats/main").getJSONObject("chat") }.getOrNull()
            if (main != null && chats.none { it.stringOrEmpty("chatId") == main.stringOrEmpty("chatId") }) chats = listOf(main) + chats
        }
        if (workAndChat && computers.size > 1) {
            val all = runCatching { environment.presentation("const all=await uiCore.accessApi('/chats?limit=200');for(const computer of uiCore.state.computers||[]){try{const value=await uiCore.computerApi(computer.hostId,'/chats/main');if(value.chat && !all.items.some(row=>row.chatId===value.chat.chatId))all.items.unshift({...value.chat,hostId:computer.hostId});}catch{}}return all;") }.getOrNull()
            all?.optJSONArray("items")?.let {
                val items = it.objects()
                chats = items + chats.filter { row -> hostChatUsesPhoneStorage(row) || row.stringOrEmpty("kind") == "main" && items.none { item -> item.stringOrEmpty("chatId") == row.stringOrEmpty("chatId") } }
            }
        }
        val view = environment.phone("view")
        if (view.optBoolean("ready")) {
            phoneOwner = view.optString("owner")
            chats = chats + view.optJSONArray("conversations")?.objects().orEmpty().map { c -> JSONObject().put("id",c.optString("id")).put("source","phone").put("nativePhone",true)
                .put("title", c.optJSONArray("turns")?.optJSONObject(0)?.optJSONArray("messages")?.optJSONObject(0)?.optString("text")?.take(40) ?: "新对话") }
        }
    }
    suspend fun select(chat: JSONObject, requestedApprovalMode: String? = null) {
        val sourceHost = chat.stringOrEmpty("workHostId").ifEmpty { chat.stringOrEmpty("hostId") }
        if (!hostChatUsesPhoneStorage(chat) && sourceHost.isNotEmpty() && sourceHost != hostId && computers.any { it.stringOrEmpty("hostId") == sourceHost }) {
            if (chat.optBoolean("computerOffline")) { error = "这段工作所在的电脑不在线，连接后可继续。"; return }
            connectComputer(sourceHost)
        }
        val transferringWork = newWork && requestedApprovalMode != null
        val startingDraft = if (chatId.isBlank() && (!newWork || transferringWork)) draft else ""
        val startingDraftKey = if (workAndChat && chatId.isBlank() && (!newWork || transferringWork)) uncreatedDraftKey else null
        saveDraft(); generation++; sending=false; workChoicesBusy=false; poll?.cancel(); timeline.reset(); cursor = ""; liveRevision = 0; seq = -1
        val g = generation
        approvalModeReady = false
        approvalModeRevision++
        pendingApprovalMode = requestedApprovalMode
        phoneArchive = chat.optBoolean("nativePhone")
        phoneHistory = chat.optBoolean("phoneHistory")
        phone = hostChatUsesPhoneStorage(chat)
        approvalModeBusy = !phoneArchive && !phone
        chatId = if (phone) chat.getString("id") else chat.optString("chatId")
        chatKind = chat.optString("kind")
        newWork = false
        applyWorkMetadata(chat, true)
        sessionId = chat.optString("activeSessionId").takeUnless { it == "null" } ?: ""
        sendAvailable = phone || chat.optBoolean("sendAvailable")
        title = hostChatTitle(chat)
        timeZone = chat.optString("timeZone", java.time.ZoneId.systemDefault().id)
        modelId = chat.stringOrEmpty("selectedModelProfileId").ifEmpty { chat.stringOrEmpty("modelProfileId") }.ifEmpty { modelId }
        modelLabel = models.firstOrNull { it.optString("profileId",it.optString("modelId")) == modelId }?.optString("displayName") ?: modelLabel
        draft = prefs.getString("draft:$owner:$chatId", startingDraft) ?: startingDraft
        if (workAndChat && !phone) prefs.edit().apply {
            remove("new-work:$owner")
            if (startingDraftKey != null) { putString("draft:$owner:$chatId", draft); remove(startingDraftKey) }
        }.apply()
        rows = emptyList(); approvals = emptyList(); questions = emptyList(); uncertain = emptyList(); phoneLive = ""; focused = false
        canRegenerate = false; canRetryQueue = false
        canRetryPhoneReply = false; phoneRetryText = ""; phoneReplyFailure = ""
        var approvalSelectionRevision = approvalModeRevision
        try {
        call("native.conversation", JSONObject().put("id", chatId))
        if (g != generation) return
        if (phoneArchive) {
            attachments = emptyList(); draft = ""; hasOlder = false; olderCursor = ""
            val view = environment.phone("view")
            if (g != generation) return
            val saved = view.optJSONObject("composer")
            if (standalone) draft = view.optJSONObject("drafts")?.optString(if(chatId=="phone-new")"new" else chatId)
                ?: if(saved?.optString("conversationId").orEmpty().ifBlank { "phone-new" } == chatId) saved?.optString("draft").orEmpty() else ""
            refreshPhone(view)
            call("native.draft",JSONObject().put("hasDraft",draft.isNotEmpty()))
            if (g != generation) return
            poll = scope.launch { while (isActive && g == generation) { delay(if (running) 100 else 500); if (environment.foreground) refresh() } }
            return
        }
        refreshAttachments()
        if (g != generation) return
        call("native.draft",JSONObject().put("hasDraft",draft.isNotEmpty() || attachments.isNotEmpty()))
        if (g != generation) return
        val modeRevision = ++approvalModeRevision
        approvalSelectionRevision = modeRevision
        approvalModeBusy = true
        try {
            val selected = if (requestedApprovalMode != null) writeApprovalMode(requestedApprovalMode, sessionId, chatId)
                else readNativeApprovalMode(chat.optString("approvalMode", mode)) {
                    if (phone) prefs.getString("approval:$owner:$chatId", "auto") ?: "auto"
                    else if (sessionId.isNotBlank()) business("/sessions/$sessionId/approval-mode").getString("mode")
                    else chat.optString("approvalMode", "auto")
                }
            check(selected in listOf("auto", "ask", "accept-edits", "plan", "allow-all")) { "APPROVAL_RECEIPT_INVALID" }
            if (g == generation && modeRevision == approvalModeRevision) { mode = selected; pendingApprovalMode = null; approvalModeReady = true }
        } catch (e: CancellationException) { throw e
        } catch (_: Exception) {
            if (g == generation && modeRevision == approvalModeRevision) error = "审批方式未保存，请重试。"
        } finally { if (g == generation && modeRevision == approvalModeRevision) approvalModeBusy = false }
        if (g != generation) return
        refresh()
        if (g != generation) return
        startPolling(g)
        } finally { if (g == generation && approvalSelectionRevision == approvalModeRevision) approvalModeBusy = false }
    }
    private fun startPolling(g: Int) {
        poll?.cancel()
        poll = scope.launch { while (isActive && g == generation) {
            if (refreshing && refreshGeneration == g) { delay(50); continue }
            if (tab == "chat" && environment.foreground && replyWait && !phone && cursor.isNotBlank()) refresh(wait = true)
            else { delay(if (running) 250 else 2500); if (tab == "chat" && environment.foreground) refresh() }
            if (!connected) delay(1500)
        } }
    }
    fun saveDraft() {
        if (phoneArchive) {
            composerSave?.cancel()
            if (standalone && phoneOwner.isNotBlank()) { val p = phoneParams().put("draft", draft); composerSave = scope.launch { delay(150); runCatching { environment.phone("composer", p) } } }
        } else if (owner.isNotBlank()) {
            if (chatId.isNotBlank()) prefs.edit().putString("draft:$owner:$chatId", draft).apply()
            else if (workAndChat) prefs.edit().putString(uncreatedDraftKey, draft).putBoolean("new-work:$owner", newWork).apply()
        }
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
            timeline.reset();readHistoryPage(page, selectedGeneration)
            if(selectedGeneration!=generation || sourceOwner!=owner)return
            rows=timeline.rows();olderCursor=page.optString("olderCursor").takeUnless{it=="null"}.orEmpty();hasOlder=page.optBoolean("hasOlder")
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
    private suspend fun readHistoryPage(page: JSONObject, selectedGeneration: Int, older: Boolean = false) {
        timeline.readPage(page, older, { selectedGeneration == generation }) { sourceSession, sourceSeq ->
            nativeMessageDetail(sourceSession, sourceSeq, ::call)
        }
    }
    suspend fun refresh(older: Boolean = false, wait: Boolean = false) {
        if (newWork && workBusy) return
        if (refreshing && refreshGeneration == generation) return
        refreshing = true
        val g = generation
        refreshGeneration = g
        try {
            if (workAndChat && !phone && chatId.isBlank()) {
                // An unbound draft has no history endpoint, but still needs model
                // updates and connection recovery while it waits for a folder.
                business("/status"); if (g != generation) return
                val b = call("app.bootstrap"); if (g != generation || b.stringOrEmpty("owner") != owner) return
                refreshHostModels(b.optJSONObject("model")); if (g != generation) return
                sendAvailable = !newWork && modelId.isNotBlank()
                approvalModeReady = true
                if (newWork) refreshWorkChoices(false)
                if (g != generation) return
            } else if (phoneArchive) {
                val view = environment.phone("view"); if (g != generation) return
                refreshPhone(view)
                if (standalone && tab == "chat" && !running) refreshPhoneModels()
                return
            } else if (phone) {
                val p = call("conversations.messages", JSONObject().put("conversationId", chatId)); if (g != generation) return
                rows = p.optJSONArray("messages")?.objects().orEmpty().map { m -> JSONObject().put("eventId", m.optString("id")).put("type", "${m.optString("role")}.message").put("data", m) }
                running = p.optString("turnStatus") in listOf("running", "streaming")
                phoneReplyFailure = if (p.optString("turnStatus") == "failed") "回复没能完成，请检查网络或模型设置后重试。" else ""
                phoneRetryText = if (phoneReplyFailure.isNotEmpty()) p.optJSONArray("messages")?.objects().orEmpty()
                    .lastOrNull { it.optString("role") == "user" }?.optString("text").orEmpty() else ""
                canRetryPhoneReply = !running && phoneRetryText.isNotBlank()
                if (running && phoneLive.isNotBlank()) rows = rows + JSONObject().put("eventId","phone-live").put("type","assistant.delta").put("data",JSONObject().put("text",phoneLive))
            } else {
                val path = if (older) "/chats/$chatId/events?before=${java.net.URLEncoder.encode(olderCursor, "UTF-8")}&limit=100"
                    else if (cursor.isBlank()) "/chats/$chatId/events?limit=100" else "/chats/$chatId/changes?cursor=${java.net.URLEncoder.encode(cursor, "UTF-8")}&limit=100" +
                        if (wait && replyWait) "&waitMs=15000&liveRevision=$liveRevision" else ""
                refreshPhase = "history"
                val p = business(path); if (g != generation) return
                val previousRows = rows.toString()
                readHistoryPage(p, g, older); if (g != generation) return
                rows = timeline.rows(); uncertain = uncertain.filter { nativePendingMessageVisible(it, rows) }
                if (p.has("olderCursor")) { olderCursor = p.optString("olderCursor").takeUnless { it == "null" } ?: ""; hasOlder = p.optBoolean("hasOlder") }
                if (!older) { cursor = p.optString("nextCursor", p.optString("syncCursor", cursor)); liveRevision = p.optLong("liveRevision", liveRevision) }
                refreshPhase = "chat-status"
                val current = business("/chats/$chatId").getJSONObject("chat"); if (g != generation) return
                if (!approvalModeBusy && pendingApprovalMode == null && current.has("approvalMode")) {
                    val saved = current.getString("approvalMode")
                    check(saved in listOf("auto", "ask", "accept-edits", "plan", "allow-all")) { "APPROVAL_RECEIPT_INVALID" }
                    mode = saved; approvalModeReady = true
                }
                title = hostChatTitle(current)
                chats = chats.map { if (it.optString("chatId") == chatId) nativeChatMetadata(it, current) else it }
                applyWorkMetadata(current)
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
                    it.optString("sessionId") in setOf(chatId, sessionId) && it.optString("state") !in setOf("accepted") && nativePendingMessageVisible(it, rows)
                }
                if (rows.toString() != previousRows && uncertain.any { it.optString("state") == "pending" }) {
                    call("shared.outbox.reconcile")
                    if (g != generation) return
                    uncertain = call("shared.outbox.list").optJSONArray("commands")?.objects().orEmpty().filter {
                        it.optString("sessionId") in setOf(chatId, sessionId) && it.optString("state") != "accepted" && nativePendingMessageVisible(it, rows)
                    }
                }
            }
            connected = true; computerOffline = false; error = if (phone) phoneReplyFailure else ""
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) {
            if (g != generation) return
            connected = false
            if (e is ApiFailure && e.status == 409) { cursor = ""; timeline.reset(); rows = emptyList() }
            if (e is ApiFailure && e.status in listOf(401, 403)) { computerOffline = false; loggedIn = false; rows = emptyList(); approvals = emptyList(); questions = emptyList(); timeline.reset(); poll?.cancel(); environment.showLogin() }
            else describeComputerFailure(g,hostId)
        } finally { if (refreshGeneration == g) { refreshing = false; refreshPhase = "idle" } }
    }
    private suspend fun describeComputerFailure(g:Int,originalHost:String) {
        val directory=try { environment.directory() } catch(e:CancellationException) { throw e } catch(_:Exception) { null }
        if(g!=generation||hostId!=originalHost)return
        val hosts=directory?.optJSONArray("hosts")?.objects().orEmpty()
        val original=hosts.find{originalHost.isNotBlank()&&it.stringOrEmpty("hostId")==originalHost}
        computerOffline=original!=null&&(original.opt("online")==false||original.optString("status")=="offline")
        if(hosts.isNotEmpty())computers=hosts
        if(computerOffline&&original!=null){
            hostName=original.stringOrEmpty("displayName").ifEmpty{original.stringOrEmpty("name")}.ifEmpty{hostName}
            error="这台电脑（$hostName）现在离线。上线后可以接着${if(conversationMode=="work")"原来的工作" else "这段对话"}。"
        }else error="连接暂时中断，正在重连。"
    }
    fun send() = launch {
        if (sending || approvalModeBusy || !canSend || workBusy || uncertain.any { it.optString("state") == "uncertain" } || draft.isBlank() && attachments.isEmpty()) return@launch
        if (workAndChat && !phone && chatId.isBlank()) {
            newChat("chat", pendingApprovalMode ?: mode).join()
            if (chatId.isBlank() || !canSend || approvalModeBusy) return@launch
        }
        if (!phone && pendingApprovalMode != null) {
            val selected = pendingApprovalMode!!; val retryGeneration = generation; val revision = approvalModeRevision
            approvalModeBusy = true
            try {
                val saved = writeApprovalMode(selected, sessionId, chatId)
                if (retryGeneration != generation || revision != approvalModeRevision) return@launch
                mode = saved; pendingApprovalMode = null; approvalModeReady = true
            } catch (e: CancellationException) { throw e
            } catch (_: Exception) {
                if (retryGeneration == generation && revision == approvalModeRevision) error = "审批方式未保存，请重试。"
                return@launch
            } finally { if (retryGeneration == generation && revision == approvalModeRevision) approvalModeBusy = false }
        }
        if (!phone && !approvalModeReady) return@launch
        scrollVersion++
        sending = true
        val g = generation; val text = draft; val files = attachments.map { it.getString("attachmentId") }
        // Transfer exactly this draft to the submission. The live editor is now the
        // next message; receipts never rewrite its cursor/composing region.
        draft=remainingNativeDraft(draft,text);saveDraft()
        var submitted=false
        try {
            if (phoneArchive) {
                val accepted=environment.phone("send", phoneParams().put("text",text))
                if(g!=generation)return@launch
                check(accepted.optBoolean("ready") && accepted.optString("owner")==phoneOwner) { "ACCOUNT_SWITCHED" }
                if(!accepted.optBoolean("sent",true)) { refreshPhone(accepted);return@launch }
                submitted=true; sending=false
                if (chatId == "phone-new") {
                    val next=accepted.stringOrEmpty("selectedId")
                    if(next.isNotBlank()) { chatId=next; call("native.conversation",JSONObject().put("id",next)) }
                }
                refreshPhone(accepted)
                call("native.draft",JSONObject().put("hasDraft",draft.isNotEmpty()))
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
            submitted=true; sending = false; running = result.optString("state") != "uncertain"
            launch { call("native.draft",JSONObject().put("hasDraft",draft.isNotEmpty() || attachments.isNotEmpty())); if (g == generation) { refreshAttachments(); refresh() } }
        } finally { if(g==generation) {
            if(!submitted){draft=text+draft;saveDraft()}
            sending=false
        } }
    }
    fun stop() = launch { if (phoneArchive) environment.phone("stop", phoneParams()) else if (phone) call("chat.stop") else if (sessionId.isNotBlank()) call("shared.stop", JSONObject().put("sessionId", sessionId).put("requestId", "stop-${UUID.randomUUID()}")); refresh() }
    fun regenerate() = launch { if (canRegenerate) { scrollVersion++;environment.phone("regenerate", phoneParams()); refresh() } }
    fun retryQueue() = launch { if (standalone && phoneArchive && canRetryQueue) { scrollVersion++;environment.phone("retryQueue",phoneParams());refresh() } }
    fun retryPhoneReply() = launch {
        if (!phone || !canRetryPhoneReply || running || sending) return@launch
        val g = generation; val text = phoneRetryText
        sending = true; canRetryPhoneReply = false; scrollVersion++
        try {
            call("chat.send", JSONObject().put("conversationId",chatId).put("text",text).put("attachmentIds",JSONArray()))
            if (g == generation) refresh()
        } finally { if (g == generation) sending = false }
    }
    fun copyReply(text:String) = launch { call("clipboard.copy",JSONObject().put("text",text));copyVersion++ }
    fun checkDelivery() = launch { call("shared.outbox.reconcile"); refresh() }
    private suspend fun writeApprovalMode(selected: String, session: String, chat: String): String {
        val local = phone
        val saved = saveNativeApprovalMode(selected, local) {
          if (session.isNotBlank()) business("/sessions/$session/approval-mode", "PATCH", JSONObject().put("mode", selected)).getString("mode")
            else business("/chats/$chat", "PATCH", JSONObject().put("approvalMode", selected)).getJSONObject("chat").getString("approvalMode")
        }
        if (local) prefs.edit().putString("approval:$owner:$chat", saved).apply()
        return saved
    }
    fun setApprovalMode(selected: String) {
        if (approvalModeBusy) return
        approvalModeRevision++
        pendingApprovalMode = selected
        if (sessionId.isBlank() && chatId.isBlank()) { mode = selected; return }
        val g = generation; val revision = approvalModeRevision; val session = sessionId; val chat = chatId
        approvalModeBusy = true
        launch {
            try {
                val saved = writeApprovalMode(selected, session, chat)
                if (g == generation && revision == approvalModeRevision) { mode = saved; pendingApprovalMode = null; approvalModeReady = true }
            } catch (e: CancellationException) { throw e
            } catch (_: Exception) {
                if (g == generation && revision == approvalModeRevision) error = "审批方式未保存，请重新选择后再发送。"
            } finally { if (g == generation && revision == approvalModeRevision) approvalModeBusy = false }
        }
    }
    fun newChat(productMode: String = sidebarMode, approvalChoice: String? = null) = launchJob {
        if(creatingChat)return@launchJob
        val usePhone=standalone || !connected
        saveDraft(); generation++; val creatingGeneration=generation
        poll?.cancel(); timeline.reset(); cursor=""; liveRevision=0
        val startingDraft = if (chatId.isBlank() && conversationMode == productMode) draft else ""
        if(chatId.isNotBlank())draft=""
        chatId="";sessionId="";title="新对话";rows=emptyList();approvals=emptyList();questions=emptyList();uncertain=emptyList();attachments=emptyList()
        pendingApprovalMode=approvalChoice;approvalModeRevision++;approvalModeBusy=false;mode=approvalChoice ?: "auto"
        running=false;sending=false;sendAvailable=false;loading=false;error="";tab="chat";creatingChat=true
        newWork = workAndChat && productMode == "work"
        conversationMode = if (newWork) "work" else "chat"
        if (workAndChat) chooseSidebarMode(conversationMode)
        workProject = null; workCreateRequest = ""; workCreateProject = ""
        try {
            if (newWork || workAndChat && !usePhone && modelId.isBlank()) {
                phone = false; phoneArchive = false; phoneHistory = false
                draft = prefs.getString(uncreatedDraftKey, startingDraft) ?: startingDraft
                saveDraft(); approvalModeReady = true
                if (newWork) { title="新工作"; refreshWorkChoices() }
                if (creatingGeneration == generation) startPolling(creatingGeneration)
                return@launchJob
            }
            draft = startingDraft
            if (workAndChat) prefs.edit().remove("new-work:$owner").apply()
            val conversation=if(usePhone) {
                if(standalone) JSONObject().put("id","phone-new").put("nativePhone",true).put("title","小纬") else call("conversations.create")
            } else {
                val status = business("/status")
                // A cold start can read the model list before the computer answers; the host refuses a chat without one.
                if (modelId.isBlank()) refreshHostModels(null)
                val id = "native-${UUID.randomUUID()}"
                var command = business("/commands", "POST", JSONObject().put("requestId", id).put("kind", "session.create")
                    .put("targetDeviceId", status.getString("hostId")).put("modelProfileId", modelId)).getJSONObject("command")
                val deadline = android.os.SystemClock.elapsedRealtime() + 15000
                while (command.optString("state") in setOf("pending","preflight","dispatching") && android.os.SystemClock.elapsedRealtime() < deadline) {
                    delay(100); command = call("shared.commands.byRequest", JSONObject().put("requestId", id)).getJSONObject("command")
                }
                check(command.optString("state") in setOf("accepted_by_dsh","observed")) { "CREATE_PENDING" }
                val resolved = business("/sessions/${command.getString("sessionId")}/chat")
                business("/chats/${resolved.getString("chatId")}").getJSONObject("chat")
            }
            if(creatingGeneration!=generation)return@launchJob
            creatingChat=false
            select(conversation, pendingApprovalMode)
        } catch(e:CancellationException){throw e}
        catch(e:Exception){if(creatingGeneration==generation)error="电脑还没能创建对话，请重新点新对话。草稿已保留。"}
        finally{creatingChat=false}
    }
    fun returnToChat() { tab="chat"; launch { readingPreferences(environment.phone("view"));if(standalone)refreshPhoneModels() else refreshMessageIntent(); refresh() } }
    fun openModels() { modelSettingsFinished=false; tab="models" }
    fun selectModel(row: JSONObject) = launch {
        val id = row.optString("profileId",row.optString("modelId"))
        if(standalone) { environment.phone("model", phoneParams().put("endpoint",row.getString("endpoint")).put("modelId",row.getString("modelId"))); refreshPhoneModels() }
        else {
            if(row.optString("source")=="phone")call("models.select",JSONObject().put("endpoint",row.getString("endpoint")).put("modelId",row.getString("modelId"))) else call("models.selectHost",JSONObject().put("profileId",id))
            modelId=id;modelLabel=row.optString("displayName",id)
            if (workAndChat && !phone && chatId.isBlank()) { sendAvailable = !newWork && modelId.isNotBlank() && connected; approvalModeReady = true }
        }
    }
    fun pick(kind: String) = launch { call("attachments.pick", JSONObject().put("conversationId", chatId).put("kind", kind)) }
    fun remove(row: JSONObject) = launch { call("attachments.remove", JSONObject().put("conversationId", chatId).put("attachmentId", row.getString("attachmentId"))); refreshAttachments() }
    fun decide(row: JSONObject, outcome: String, decisionScope: String = "once", workProjectId: String? = null) = launchJob {
        val id = row.getString("approvalId"); val key = "decision:$owner:$sessionId:$id"
        val p = prefs.getString(key, null)?.let(::JSONObject) ?: nativeApprovalBody("approve-${UUID.randomUUID()}", outcome,
            if (outcome != "rejected") decisionScope else null,
            if (workAndChat && row.stringOrEmpty("intent") == "work-switch" && outcome == "allowed-once") workProjectId else null)
            .put("sessionId", sessionId).put("approvalId", id)
        check(prefs.edit().putString(key, p.toString()).commit())
        approvals = approvals.map { if(it.optString("approvalId")==id)JSONObject(it.toString()).put("nativeDecision",p) else it }
        val receipt = call("shared.approvals.decide", p).optJSONObject("approval")
        if (receipt != null) approvals = approvals.map { if (it.optString("approvalId") == id && it.optString("status") == "pending") receipt else it }
        refresh()
    }
    fun chooseSidebarMode(value: String) {
        sidebarMode = if (value == "work") "work" else "chat"
        prefs.edit().putString("conversation-mode:$owner", sidebarMode).apply()
    }
    private fun applyWorkMetadata(chat: JSONObject, selecting: Boolean = false) {
        val previous = conversationMode
        conversationMode = nativeConversationMode(chat)
        if (workAndChat && (selecting || previous != conversationMode)) chooseSidebarMode(conversationMode)
        val directory = chat.optJSONObject("workDirectory")
        workProject = directory ?: projects.find { it.stringOrEmpty("projectId") == chat.stringOrEmpty("projectId") && !it.optBoolean("revoked") }
    }
    suspend fun refreshWorkChoices(includeComputers: Boolean = true) {
        workChoicesBusy = true; workChoicesError = ""
        val g = generation
        try {
            if (includeComputers) {
                val directory = runCatching { environment.directory() }.getOrNull()
                if (g != generation) return
                offlineWorkReady = runCatching { environment.presentation("return {ready:globalThis.WeftMobileCloud?.core?.offlineWorkReady?.()===true};").optBoolean("ready") }.getOrDefault(false)
                computers = directory?.optJSONArray("hosts")?.objects()?.takeIf { it.isNotEmpty() }
                    ?: listOf(JSONObject().put("hostId", hostId).put("name", hostName).put("online", connected))
                hostName = computers.find { it.stringOrEmpty("hostId") == hostId }?.let { it.stringOrEmpty("displayName").ifEmpty { it.stringOrEmpty("name") } }?.ifEmpty { null } ?: hostName
            }
            val result = business("/projects")
            if (g != generation) return
            projects = result.optJSONArray("projects")?.objects().orEmpty().filter { !it.optBoolean("revoked") }
            if (workProject != null) workProject = projects.find { it.stringOrEmpty("projectId") == workProject?.stringOrEmpty("projectId") }
        } catch (e: CancellationException) { throw e
        } catch (_: Exception) { if (g == generation) { projects = emptyList(); workChoicesError = "项目暂时无法读取，请重试。" } }
        finally { if (g == generation) workChoicesBusy = false }
    }
    private suspend fun connectComputer(id: String) {
        if (id == hostId) return
        if (computers.none { it.stringOrEmpty("hostId") == id && it.optBoolean("online") }) throw ApiFailure(503,"COMPUTER_OFFLINE")
        switchingComputer = true
        try {
            environment.presentation("const core=globalThis.WeftMobileCloud.core,account=core.state.cloudAuth.sub;const connection=await core.cloudConnect(${JSONObject.quote(id)});if(connection.status!=='online')throw {code:'COMPUTER_OFFLINE'};if(connection.pairingRequired)throw {code:'COMPUTER_UPDATE_REQUIRED'};await core.cloudConnectTrusted(connection);if(core.state.cloudAuth.sub!==account)throw {code:'ACCOUNT_SWITCHED'};await core.enterAssistant();return {};")
            chatId = ""; sessionId = ""; poll?.cancel()
            bootstrap()
            check(hostId == id) { "TARGET_UNAVAILABLE" }
        } finally { switchingComputer = false }
    }
    fun chooseWorkComputer(id: String) = launch {
        if (!newWork || workBusy) return@launch
        val text = draft
        val selectedApprovalMode = pendingApprovalMode ?: mode
        workComputerBusy = true
        try {
            connectComputer(id)
            if (!workAndChat) { error="这台电脑需要更新 WeftMate 后才能使用对话和工作。"; return@launch }
            val currentApprovalMode = pendingApprovalMode ?: selectedApprovalMode
            newChat("work").join(); setApprovalMode(currentApprovalMode); edit(text)
        } finally { workComputerBusy = false }
    }
    fun chooseWorkProject(project: JSONObject) = launch {
        if (workBusy || running || !connected) return@launch
        if (newWork && modelId.isBlank()) { error="先选择一个模型，再选文件夹开始工作。"; return@launch }
        workChoicesBusy = true
        val g = generation
        try {
            if (newWork) {
                if (workCreateRequest.isEmpty() || workCreateProject != project.getString("projectId")) {
                    workCreateRequest = "native-work-${UUID.randomUUID()}"; workCreateProject = project.getString("projectId")
                }
                var command = nativeCreateWork(hostId, project.getString("projectId"), workCreateRequest, modelId) { _, path, body ->
                    business(path,"POST",body)
                }.getJSONObject("command")
                val deadline = android.os.SystemClock.elapsedRealtime() + 15000
                while (command.optString("state") in setOf("pending","preflight","dispatching") && android.os.SystemClock.elapsedRealtime() < deadline) {
                    delay(100); command = call("shared.commands.byRequest",JSONObject().put("requestId",workCreateRequest)).getJSONObject("command")
                }
                check(command.optString("state") in setOf("accepted_by_dsh","observed")) { "CREATE_PENDING" }
                if (g != generation) return@launch
                val resolved = business("/sessions/${command.getString("sessionId")}/chat")
                val chat = business("/chats/${resolved.getString("chatId")}").getJSONObject("chat")
                if (g != generation) return@launch
                workChoicesBusy = false
                select(chat, pendingApprovalMode ?: mode); refreshChats()
            } else {
                business("/sessions/$sessionId/metadata","PATCH",JSONObject().put("projectId",project.getString("projectId")))
                if (g != generation) return@launch
                workProject = project; refresh()
            }
        } catch (e: CancellationException) { throw e
        } catch (_: Exception) { error="文件夹未选好，请重试。草稿已保留。" }
        finally { workChoicesBusy = false }
    }
    fun refreshOfflineWorkAvailability() = launchJob {
        val g=generation
        val ready=runCatching{environment.presentation("return {ready:globalThis.WeftMobileCloud?.core?.offlineWorkReady?.()===true};").optBoolean("ready")}.getOrDefault(false)
        if(g==generation)offlineWorkReady=ready
    }
    fun openOfflineWork(row: JSONObject? = null) = launch {
        val text = if(row==null)draft else nativeWorkSwitchText(row, rows, draft)
        environment.presentation("const core=globalThis.WeftMobileCloud?.core;if(!core?.offlineWorkReady?.())throw {code:'COMPUTER_OFFLINE'};core.openOfflineWorkMode(${JSONObject.quote(text)});return {};")
        tab="web-chat"
    }
    fun answer(row: JSONObject, answers: JSONArray) = launch {
        val id = row.getString("questionRpcId"); val key = "question:$owner:$sessionId:$id"
        val p = prefs.getString(key, null)?.let(::JSONObject) ?: JSONObject().put("sessionId", sessionId).put("questionRpcId", id).put("requestId", "answer-${UUID.randomUUID()}").put("answer", JSONObject().put("answers", answers))
        check(prefs.edit().putString(key, p.toString()).commit()); call("shared.questions.answer", p); refresh()
    }
    fun event(type: String, data: JSONObject) {
        when {
            type == "result.app.ready" || type == "result.auth.login" || type == "result.cloud.adopt" || type == "result.phone.adopt" || type == "result.auth.logout" -> if (!switchingComputer) launch { bootstrap() }
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
