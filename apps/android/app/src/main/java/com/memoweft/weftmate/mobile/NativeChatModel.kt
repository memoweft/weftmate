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
    var sessionId by mutableStateOf("")
    var phone by mutableStateOf(false)
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
    var scrollVersion by mutableStateOf(0)
    var copyVersion by mutableStateOf(0)
    private val timeline = NativeTimeline()
    private var cursor = ""
    private var seq = -1L
    private var generation = 0
    private var poll: Job? = null
    private var sending = false
    private var refreshing = false
    private var nextReconcile = 0L
    private var phoneLive = ""
    private var phoneOwner = ""
    private var composerSave: Job? = null
    private var bootstrapping = false
    private var modelSettingsFinished = false
    private val prefs = activity.getSharedPreferences("native-chat", Context.MODE_PRIVATE)
    val composer get() = NativeComposerState(draft, focused, attachments.size, running, !standalone)
    suspend fun call(method: String, params: JSONObject = JSONObject()): JSONObject = suspendCancellableCoroutine { c ->
        activity.nativeRequest(method, params) { r -> if (c.isActive) r.fold({ c.resume(it) }, { c.resumeWithException(it) }) }
    }
    suspend fun business(path: String, method: String = "GET", body: JSONObject? = null) = call("host.business", JSONObject().put("path", "/personal/v1$path").put("method", method).apply { body?.let { put("body", it) } })
    fun launch(action: suspend () -> Unit) { scope.launch { try { action() } catch (e: CancellationException) { throw e } catch (_: Exception) { error = "暂时没能完成，请重试。" } } }
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
        refreshChats()
        if (chatId.isBlank()) {
            val main = runCatching { business("/chats/main").getJSONObject("chat") }.getOrNull()
            if (main != null) select(main) else {
                val locals = call("conversations.list").optJSONArray("conversations")?.objects().orEmpty()
                select(locals.firstOrNull() ?: call("conversations.create"))
            }
        }
        loading = false
        } finally { bootstrapping = false }
    }
    private suspend fun refreshPhoneModels() {
        val result = call("phone.models.list")
        models = result.optJSONArray("models")?.objects().orEmpty()
        val selected = result.optJSONObject("selected")
        modelId = selected?.optString("modelId").orEmpty()
        modelLabel = selected?.optString("displayName")?.ifBlank { modelId } ?: "选择模型"
        sendAvailable = modelId.isNotBlank()
    }
    private fun phoneParams() = JSONObject().put("owner", phoneOwner).put("conversationId", chatId.takeUnless { it == "phone-new" })
    private fun readingPreferences(view:JSONObject) { textSize=view.optDouble("fontSize",DesignTokens.font15.toDouble()).toFloat();codeSize=view.optDouble("codeFontSize",DesignTokens.font13.toDouble()).toFloat() }
    private fun refreshPhone(view: JSONObject) {
        readingPreferences(view)
        if (!view.optBoolean("ready") || view.optString("owner") != phoneOwner) return
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
        saveDraft(); generation++; poll?.cancel(); timeline.reset(); cursor = ""; seq = -1
        phoneArchive = chat.optBoolean("nativePhone")
        phone = chat.optString("source") == "phone" || !chat.has("chatId") && chat.has("id")
        chatId = if (phone) chat.getString("id") else chat.optString("chatId")
        sessionId = chat.optString("activeSessionId").takeUnless { it == "null" } ?: ""
        sendAvailable = phone || chat.optBoolean("sendAvailable")
        title = if (chat.optString("kind") == "main") "WeftMate" else chat.optString("title", "新对话")
        timeZone = chat.optString("timeZone", java.time.ZoneId.systemDefault().id)
        modelId = chat.optString("modelProfileId").ifBlank { modelId }
        modelLabel = models.firstOrNull { it.optString("profileId",it.optString("modelId")) == modelId }?.optString("displayName") ?: modelLabel
        draft = prefs.getString("draft:$owner:$chatId", startingDraft) ?: startingDraft
        rows = emptyList(); approvals = emptyList(); questions = emptyList(); uncertain = emptyList(); phoneLive = ""; focused = false
        canRegenerate = false
        call("native.conversation", JSONObject().put("id", chatId))
        if (phoneArchive) {
            attachments = emptyList(); draft = ""; hasOlder = false; olderCursor = ""
            val view = activity.phonePresentation("view")
            val saved = view.optJSONObject("composer")
            if (standalone) draft = view.optJSONObject("drafts")?.optString(if(chatId=="phone-new")"new" else chatId)
                ?: if(saved?.optString("conversationId").orEmpty().ifBlank { "phone-new" } == chatId) saved?.optString("draft").orEmpty() else ""
            refreshPhone(view)
            call("native.draft",JSONObject().put("hasDraft",draft.isNotEmpty()))
            val g = generation
            poll = scope.launch { while (isActive && g == generation) { delay(if (running) 100 else 500); if (activity.nativeForeground) refresh() } }
            return
        }
        refreshAttachments()
        call("native.draft",JSONObject().put("hasDraft",draft.isNotEmpty() || attachments.isNotEmpty()))
        if (sessionId.isNotBlank()) mode = runCatching { business("/sessions/$sessionId/approval-mode").optString("mode", "auto") }.getOrDefault("auto")
        refresh()
        val g = generation
        poll = scope.launch { while (isActive && g == generation) { delay(if (running) 250 else 2500); if (tab == "chat" && activity.nativeForeground) refresh() } }
    }
    fun saveDraft() {
        if (phoneArchive) {
            composerSave?.cancel()
            if (standalone && phoneOwner.isNotBlank()) { val p = phoneParams().put("draft", draft); composerSave = scope.launch { delay(150); runCatching { activity.phonePresentation("composer", p) } } }
        } else if (owner.isNotBlank() && chatId.isNotBlank()) prefs.edit().putString("draft:$owner:$chatId", draft).apply()
    }
    fun edit(text: String) { draft = text; saveDraft(); launch { call("native.draft",JSONObject().put("hasDraft",text.isNotEmpty() || attachments.isNotEmpty())) } }
    suspend fun refreshAttachments() { attachments = call("attachments.list", JSONObject().put("conversationId", chatId)).optJSONArray("attachments")?.objects().orEmpty() }
    suspend fun refresh(older: Boolean = false) {
        if (refreshing) return
        refreshing = true
        val g = generation
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
                    else if (cursor.isBlank()) "/chats/$chatId/events?limit=100" else "/chats/$chatId/changes?cursor=${java.net.URLEncoder.encode(cursor, "UTF-8")}&limit=100"
                val p = business(path); if (g != generation) return
                timeline.merge(p, older); rows = timeline.rows()
                if (p.has("olderCursor")) { olderCursor = p.optString("olderCursor").takeUnless { it == "null" } ?: ""; hasOlder = p.optBoolean("hasOlder") }
                if (!older) cursor = p.optString("nextCursor", p.optString("syncCursor", cursor))
                val current = business("/chats/$chatId").getJSONObject("chat"); if (g != generation) return
                sessionId = current.optString("activeSessionId").takeUnless { it == "null" } ?: ""
                sendAvailable = current.optBoolean("sendAvailable")
                running = current.optBoolean("running") || rows.any { it.optString("type") == "assistant.delta" && it.optJSONObject("data")?.optBoolean("streaming") == true }
                if (sessionId.isNotBlank()) {
                    val a = call("shared.approvals.list", JSONObject().put("sessionId", sessionId)); if (g != generation) return
                    approvals = a.optJSONArray("approvals")?.objects().orEmpty().map { row ->
                        val saved = prefs.getString("decision:$owner:$sessionId:${row.optString("approvalId")}",null)
                        if(row.optString("status")=="pending" && saved!=null) JSONObject(row.toString()).put("nativeDecision",JSONObject(saved)) else row
                    }
                    val q = call("shared.questions.list", JSONObject().put("sessionId", sessionId)); if (g != generation) return
                    questions = q.optJSONArray("questions")?.objects().orEmpty()
                }
                uncertain = call("shared.outbox.list").optJSONArray("commands")?.objects().orEmpty().filter { it.optString("sessionId") == chatId && it.optString("state") == "uncertain" }
                if (uncertain.isNotEmpty() && android.os.SystemClock.elapsedRealtime() >= nextReconcile) {
                    nextReconcile = android.os.SystemClock.elapsedRealtime() + 5000
                    call("shared.outbox.reconcile")
                }
            }
            connected = true; error = ""
        } catch (e: Exception) {
            if (g != generation) return
            connected = false
            if (e is ApiFailure && e.status == 409) { cursor = ""; timeline.reset(); rows = emptyList() }
            if (e is ApiFailure && e.status in listOf(401, 403)) { loggedIn = false; rows = emptyList(); approvals = emptyList(); questions = emptyList(); timeline.reset(); poll?.cancel(); activity.showLogin() }
            else error = "连接暂时中断，正在重连。"
        } finally { refreshing = false }
    }
    fun send() = launch {
        if (sending || !sendAvailable || draft.isBlank() && attachments.isEmpty()) return@launch
        if(standalone && running)return@launch
        scrollVersion++
        sending = true
        val g = generation; val text = draft; val files = attachments.map { it.getString("attachmentId") }
        try {
            if (phoneArchive) {
                val accepted=activity.phonePresentation("send", phoneParams().put("text",text))
                if(g!=generation)return@launch
                check(accepted.optBoolean("ready") && accepted.optString("owner")==phoneOwner) { "ACCOUNT_SWITCHED" }
                draft = ""; saveDraft(); call("native.draft",JSONObject().put("hasDraft",false)); focused = false; activity.hideKeyboard(); running = true
                refresh(); return@launch
            }
            val p = JSONObject().put("text", text).put("attachmentIds", JSONArray(files)).put("requestId", "native-${UUID.randomUUID()}")
            val result = if (phone) call("chat.send", p.put("conversationId", chatId)) else {
                val intent = runCatching { business("/settings/personalization").optJSONObject("settings")?.optString("messageMode", "queue") ?: "queue" }.getOrDefault("queue")
                call("shared.send", p.put("chatId", chatId).put("modelProfileId", modelId).put("intent", intent))
            }
            if (g != generation) return@launch
            if (result.optString("state") == "rejected") { error = "消息没能发送，草稿已保留。"; return@launch }
            draft = ""; saveDraft(); call("native.draft",JSONObject().put("hasDraft",false)); focused = false; activity.hideKeyboard(); running = true
            refreshAttachments(); refresh()
        } finally { sending = false }
    }
    fun stop() = launch { if (phoneArchive) activity.phonePresentation("stop", phoneParams()) else if (phone) call("chat.stop") else if (sessionId.isNotBlank()) call("shared.stop", JSONObject().put("sessionId", sessionId).put("requestId", "stop-${UUID.randomUUID()}")); refresh() }
    fun regenerate() = launch { if (canRegenerate) { scrollVersion++;activity.phonePresentation("regenerate", phoneParams()); refresh() } }
    fun copyReply(text:String) = launch { call("clipboard.copy",JSONObject().put("text",text));copyVersion++ }
    fun newChat() = launch { select(if(standalone) JSONObject().put("id","phone-new").put("nativePhone",true).put("title","小纬") else call("conversations.create")); tab="chat" }
    fun returnToChat() { tab="chat"; launch { readingPreferences(activity.phonePresentation("view"));if(standalone)refreshPhoneModels(); refresh() } }
    fun openModels() { modelSettingsFinished=false; tab="models" }
    fun selectModel(row: JSONObject) = launch {
        val id = row.optString("profileId",row.optString("modelId"))
        if(standalone) { activity.phonePresentation("model", phoneParams().put("endpoint",row.getString("endpoint")).put("modelId",row.getString("modelId"))); refreshPhoneModels() }
        else { if(row.optString("source")=="phone")call("models.select",JSONObject().put("endpoint",row.getString("endpoint")).put("modelId",row.getString("modelId"))) else call("models.selectHost",JSONObject().put("profileId",id)); modelId=id;modelLabel=row.optString("displayName",id) }
    }
    fun pick(kind: String) = launch { call("attachments.pick", JSONObject().put("conversationId", chatId).put("kind", kind)) }
    fun remove(row: JSONObject) = launch { call("attachments.remove", JSONObject().put("conversationId", chatId).put("attachmentId", row.getString("attachmentId"))); refreshAttachments() }
    fun decide(row: JSONObject, outcome: String, decisionScope: String = "once") = launch {
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
            type == "result.app.ready" || type == "result.auth.login" || type == "result.cloud.adopt" || type == "result.auth.logout" -> launch { bootstrap() }
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
