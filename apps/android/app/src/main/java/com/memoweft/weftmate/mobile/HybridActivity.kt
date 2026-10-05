package com.memoweft.weftmate.mobile

import android.app.Activity
import android.content.Intent
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.speech.RecognizerIntent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceError
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.ByteArrayInputStream
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ScheduledFuture
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlin.math.abs

internal data class AttachmentPickAttempt(val requestId: String, val owner: String, val conversationId: String,
    val epoch: Long, val page: Int, val activeAtStart: String?, val kind: String,
    val viewGeneration: Int?, val resultReceived: AtomicBoolean = AtomicBoolean(false))

internal data class ArtifactSaveAttempt(val requestId: String, val owner: String, val epoch: Long,
    val artifactId: String, val fileName: String, val size: Int, val sha256: String)

internal fun attachmentPickCurrent(attempt: AttachmentPickAttempt, epoch: Long, page: Int,
    activeConversation: String?, owner: String?): Boolean = attempt.epoch == epoch &&
    attempt.page == page && attempt.activeAtStart == activeConversation && attempt.owner == owner

internal fun attachmentResultBody(attempt: AttachmentPickAttempt, status: String,
    attachment: JSONObject? = null, errorCode: String? = null): JSONObject {
    require(status in setOf("selected", "cancelled", "failed"))
    val body = JSONObject().put("requestId", attempt.requestId).put("conversationId", attempt.conversationId)
        .put("status", status)
    attempt.viewGeneration?.let { body.put("viewGeneration", it) }
    if (status == "selected") body.put("attachment", attachment ?: throw IllegalArgumentException("Missing attachment"))
    if (status == "failed") body.put("errorCode", errorCode ?: "ATTACHMENT_UNREADABLE")
    return body
}

internal fun activityCommandProjection(row: JSONObject): JSONObject {
    val projected = JSONObject().put("source", "host").put("commandId", row.optString("commandId"))
        .put("kind", row.optString("kind")).put("status", row.optString("state"))
        .put("taskId", row.optString("taskId"))
        .put("artifactId", row.optString("artifactId"))
        .put("fileName", row.optString("fileName"))
        .put("size", row.optLong("size"))
        .put("verification", row.optJSONObject("verification"))
        .put("sessionId", row.optString("sessionId"))
        .put("createdAt", row.optString("createdAt"))
    if (row.has("conversationId")) projected.put("conversationId", row.optString("conversationId"))
    if (row.has("rootTaskId")) projected.put("rootTaskId", row.optString("rootTaskId"))
    if (row.has("taskAction")) projected.put("taskAction", row.optString("taskAction"))
    return projected
}

/** The updateable UI is presentation; account secrets, local history, model calls and tools stay native. */
class HybridActivity : Activity() {
    private companion object { const val SPEECH_REQUEST = 2041; const val AVATAR_REQUEST = 2042; const val NOTIFY_REQUEST = 2043; const val ATTACHMENT_REQUEST = 2044; const val ARTIFACT_SAVE_REQUEST = 2045 }
    private val origin = "https://appassets.androidplatform.net"
    private val entry = "$origin/ui/index.html"
    private val worker = Executors.newFixedThreadPool(2)
    private val modelWorker = Executors.newSingleThreadExecutor()
    private val attachmentWorker = Executors.newSingleThreadExecutor()
    private val syncWorker = Executors.newSingleThreadExecutor()
    private val updateWorker = Executors.newSingleThreadExecutor()
    private val streamWorker = Executors.newSingleThreadExecutor()
    private val localTurnRenewWorker = Executors.newSingleThreadScheduledExecutor()
    private val updateChecking = AtomicBoolean(false)
    private val closed = AtomicBoolean(false)
    private val fallbackInProgress = AtomicBoolean(false)
    private val compatShown = AtomicBoolean(false)
    private val authInFlight = AtomicBoolean(false)
    private val sharedReconcileInFlight = AtomicBoolean(false)
    private val accountTransition = AtomicBoolean(false)
    private val syncRegistrationLock = Any()
    private val accountEpoch = AtomicLong(0)
    private val updateSubscriptionEpoch = AtomicLong(0)
    private val updateListening = AtomicBoolean(false)
    private val updateConnection = AtomicReference<HttpURLConnection?>()
    private lateinit var web: WebView
    private lateinit var bundles: MobileUiBundles
    private lateinit var store: LocalStore
    private lateinit var sharedChat: SharedChat
    private lateinit var conversationHandoff: ConversationHandoff
    private lateinit var accountModels: AccountModels
    private lateinit var attachments: AttachmentStore
    private lateinit var secrets: SecureSettings
    private val api = PersonalApi()
    private val noticeCache = ConcurrentHashMap<String, MobileNotifications>()
    private val choices by lazy { getSharedPreferences("model-selection", MODE_PRIVATE) }
    private val displayPrefs by lazy { getSharedPreferences("display-settings", MODE_PRIVATE) }
    private val updatePrefs by lazy { getSharedPreferences("ui-update-preferences", MODE_PRIVATE) }
    @Volatile private var activeScope = "local"
    @Volatile private var uiHasDraft = false
    private val busy = AtomicBoolean(false)
    @Volatile private var activeModel: ModelClient? = null
    @Volatile private var activeTurnScope: String? = null
    @Volatile private var stopped = false
    @Volatile private var currentPageReady = false
    @Volatile private var draftKnowledgeReady = false
    @Volatile private var pageGeneration = 0
    private var events: JavaScriptReplyProxy? = null
    @Volatile private var activeConversation: String? = null
    private var lastUiError: String? = null
    private var pendingSpeech: Pair<SpeechAttempt, Int>? = null
    private var pendingAvatarScope: String? = null
    private var pendingAvatarEpoch = 0L
    @Volatile private var pendingAttachment: AttachmentPickAttempt? = null
    @Volatile private var pendingArtifactSave: ArtifactSaveAttempt? = null
    @Volatile private var foreground = true

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        activeScope = displayPrefs.getString("lastScope", "local")
            ?.takeIf { it == "local" || it.matches(Regex("[a-f0-9]{64}")) } ?: "local"
        uiHasDraft = hasSavedDraft(activeScope)
        applySystemBars()
        bundles = MobileUiBundles(this)
        store = LocalStore(this)
        attachments = AttachmentStore(this, store)
        sharedChat = SharedChat(store, api, attachments)
        conversationHandoff = ConversationHandoff(store, api, attachments)
        secrets = SecureSettings(this)
        accountModels = AccountModels(store, api, secrets)
        worker.execute {
            try { if (!closed.get()) {
                store.recoverInterruptedTurns()
                attachments.reconcileTurns(store)
            } }
            catch (_: Exception) { emit("storage.error", JSONObject()) }
            if (!closed.get()) try {
                synchronized(syncRegistrationLock) {
                    if (!closed.get()) {
                        if (secrets.host() != null) SyncJobService.schedule(this)
                        else SyncJobService.cancel(this)
                    }
                }
            } catch (_: Exception) { /* Manual sync and persisted local records remain available. */ }
        }
        val container = FrameLayout(this)
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
            container.setOnApplyWindowInsetsListener { view, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars())
                val ime = insets.getInsets(WindowInsets.Type.ime())
                val bottom = maxOf(bars.bottom, ime.bottom)
                if (view.paddingLeft != bars.left || view.paddingTop != bars.top ||
                    view.paddingRight != bars.right || view.paddingBottom != bottom)
                    view.setPadding(bars.left, bars.top, bars.right, bottom)
                insets
            }
        }
        web = WebView(this)
        container.addView(web, FrameLayout.LayoutParams(-1, -1))
        setContentView(container)
        configureWeb()
        loadPage()
        checkForUpdate()
        scheduleSharedReconcile()
    }

    private fun configureWeb() {
        val loader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/ui/", bundles.pathHandler)
            .build()
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                return if (request.url.scheme == "https" && request.url.host == "appassets.androidplatform.net")
                    if (request.url.path?.startsWith("/media/session/") == true) mediaSharedImage(request)
                    else if (request.url.path?.startsWith("/media/image/") == true) mediaImage(request)
                    else loader.shouldInterceptRequest(request.url) ?: forbidden()
                else if (request.url.scheme == "data" && request.isForMainFrame.not()) null
                else forbidden()
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (closed.get()) return true
                if (request.url.toString().startsWith("$origin/ui/")) return false
                if (request.isForMainFrame && request.url.scheme == "https") {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                }
                return true
            }
            override fun onPageFinished(view: WebView, url: String) {
                if (closed.get()) return
                if (url != entry) return
                val expected = pageGeneration
                web.postDelayed({
                    if (!closed.get() && !currentPageReady && expected == pageGeneration) {
                        if (bundles.state().active != "builtin") fallbackUi("更新页面未能启动，已返回上一版")
                        else showNativeCompatibility("内置界面未能启动")
                    }
                }, 6_000)
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (closed.get()) return
                if (request.isForMainFrame && request.url.toString() == entry) {
                    if (bundles.state().active != "builtin") fallbackUi("更新页面读取失败，已返回上一版")
                    else showNativeCompatibility("内置界面读取失败")
                }
            }
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            showNativeCompatibility("系统 WebView 缺少安全消息接口")
            return
        }
        WebViewCompat.addWebMessageListener(web, "weftNative", setOf(origin)) { _, message, sourceOrigin, mainFrame, reply ->
            if (closed.get()) return@addWebMessageListener
            val raw = message.data ?: return@addWebMessageListener
            if (!mainFrame || sourceOrigin.toString() != origin || raw.length > 128 * 1024) return@addWebMessageListener
            val request = try { JSONObject(raw) } catch (_: Exception) { return@addWebMessageListener }
            val id = request.optString("id")
            val method = request.optString("method")
            if (!id.matches(Regex("[A-Za-z0-9_-]{1,80}"))) return@addWebMessageListener
            if (!method.matches(Regex("[A-Za-z.]{1,64}"))) {
                respond(reply, id, false, JSONObject().put("code", "INVALID_REQUEST"))
                return@addWebMessageListener
            }
            if (method == "events.subscribe") {
                events = reply
                respond(reply, id, true, JSONObject())
                secrets.host()?.let { queueSync(it, accountEpoch.get(), null) }
                return@addWebMessageListener
            }
            if (method == "updates.check") {
                if (!updateChecking.compareAndSet(false, true)) {
                    respond(reply, id, false, JSONObject().put("code", "UI_UPDATE_IN_PROGRESS"))
                    return@addWebMessageListener
                }
                try { updateWorker.execute {
                    if (closed.get()) { updateChecking.set(false); return@execute }
                    try {
                        val host = secrets.host() ?: throw ApiFailure(401, "LOGIN_REQUIRED")
                        val checked = bundles.check(host)
                        respond(reply, id, true, uiState(checked))
                        if (checked.staged != null) maybeApplyStaged(host)
                    } catch (error: Exception) { respond(reply, id, false, JSONObject().put("code", safeCode(error))) }
                    finally { updateChecking.set(false) }
                } } catch (_: RejectedExecutionException) { updateChecking.set(false) }
                return@addWebMessageListener
            }
            val authMutation = method in setOf("auth.login", "auth.register", "auth.logout", "auth.changePassword", "auth.revokeDevice")
            if (authMutation && !authInFlight.compareAndSet(false, true)) {
                respond(reply, id, false, JSONObject().put("code", "AUTH_IN_PROGRESS"))
                return@addWebMessageListener
            }
            if (authMutation) {
                accountTransition.set(true)
                accountEpoch.incrementAndGet()
                stopped = true
                activeModel?.cancel()
                emit("account.transition", JSONObject().put("pending", true))
            }
            val requestEpoch = accountEpoch.get()
            try { worker.execute {
                if (closed.get()) {
                    if (authMutation) { accountTransition.set(false); authInFlight.set(false) }
                    return@execute
                }
                try {
                    val result = handle(method, request.optJSONObject("params") ?: JSONObject())
                    if (!authMutation && requestEpoch != accountEpoch.get())
                        respond(reply, id, false, JSONObject().put("code", "ACCOUNT_SWITCHED"))
                    else respond(reply, id, true, result)
                    if (method == "app.ready") scheduleStagedApply()
                } catch (error: Exception) {
                    respond(reply, id, false, JSONObject().put("code", safeCode(error)))
                } finally { if (authMutation) {
                    accountTransition.set(false)
                    authInFlight.set(false)
                    emit("account.transition", JSONObject().put("pending", false).put("oldTurnPending", busy.get()))
                    scheduleStagedApply()
                } }
            } } catch (_: RejectedExecutionException) {
                if (authMutation) { accountTransition.set(false); authInFlight.set(false) }
            }
        }
    }

    private fun mediaImage(request: WebResourceRequest): WebResourceResponse {
        try {
            if (closed.get() || request.method != "GET" || accountTransition.get()) return forbidden()
            val epoch = accountEpoch.get()
            val host = secrets.host() ?: return forbidden()
            val scope = owner(host) ?: return forbidden()
            val uri = request.url
            if (uri.authority != "appassets.androidplatform.net" || uri.fragment != null ||
                uri.pathSegments.size != 3 || uri.pathSegments[0] != "media" ||
                uri.pathSegments[1] != "image" ||
                uri.queryParameterNames !in setOf(setOf("conversationId"), setOf("conversationId", "messageId"),
                    setOf("conversationId", "variant"), setOf("conversationId", "messageId", "variant")) ||
                uri.getQueryParameters("conversationId").size != 1 ||
                uri.getQueryParameters("messageId").size > 1 ||
                uri.getQueryParameters("variant").size > 1) return forbidden()
            val attachmentId = uri.lastPathSegment ?: return forbidden()
            val conversationId = uri.getQueryParameter("conversationId") ?: return forbidden()
            val messageId = uri.getQueryParameter("messageId")
            val variant = uri.getQueryParameter("variant")
            if (variant != null && variant != "display") return forbidden()
            if (!validImageScopeId(attachmentId) || !validImageScopeId(conversationId) ||
                messageId != null && !validImageScopeId(messageId)) return forbidden()
            val image = if (messageId == null) attachments.localImage(scope, conversationId, attachmentId, false,
                variant == "display")
            else {
                val state = store.imageForMessage(scope, conversationId, messageId, attachmentId) ?: return forbidden()
                attachments.localImage(scope, conversationId, attachmentId, true, variant == "display") ?:
                    if (state.second) api.downloadImage(host, conversationId, messageId, attachmentId,
                        variant == "display")
                    else return forbidden()
            } ?: return forbidden()
            if (closed.get() || accountTransition.get() || epoch != accountEpoch.get() ||
                secrets.host()?.let { owner(it) } != scope) return forbidden()
            return WebResourceResponse(image.first, null, 200, "OK",
                mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff"),
                ByteArrayInputStream(image.second))
        } catch (_: Exception) { return forbidden() }
    }

    private fun mediaSharedImage(request: WebResourceRequest): WebResourceResponse {
        try {
            if (closed.get() || request.method != "GET" || accountTransition.get()) return forbidden()
            val uri = request.url
            if (uri.authority != "appassets.androidplatform.net" || uri.query != null ||
                uri.fragment != null || uri.encodedPath?.contains('%') == true ||
                uri.pathSegments.size != 4 || uri.pathSegments[0] != "media" ||
                uri.pathSegments[1] != "session") return forbidden()
            val sessionId = uri.pathSegments[2]
            val durableId = uri.pathSegments[3]
            if (!sessionId.matches(Regex("session-[0-9a-f-]{36}")) ||
                !durableId.matches(Regex("sha256:[a-f0-9]{64}"))) return forbidden()
            val epoch = accountEpoch.get()
            val host = secrets.host() ?: return forbidden()
            val scope = owner(host) ?: return forbidden()
            var session = store.sharedSession(scope, host.hostId, sessionId)
            if (session == null) {
                sharedChat.sessions(host)
                session = store.sharedSession(scope, host.hostId, sessionId)
            }
            if (session == null) return forbidden()
            val image = api.downloadSharedImage(host, sessionId, durableId)
            if (closed.get() || accountTransition.get() || epoch != accountEpoch.get() ||
                secrets.host() != host) return forbidden()
            return WebResourceResponse(image.first, null, 200, "OK",
                mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff"),
                ByteArrayInputStream(image.second))
        } catch (_: Exception) { return forbidden() }
    }

    private fun forbidden() = WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), null)

    private fun loadPage() {
        if (closed.get()) return
        pageGeneration++
        currentPageReady = false
        draftKnowledgeReady = false
        events = null
        web.loadUrl(entry)
    }

    private fun fallbackUi(reason: String) {
        if (closed.get()) return
        if (!fallbackInProgress.compareAndSet(false, true)) return
        lastUiError = reason
        try { updateWorker.execute {
            if (closed.get()) { fallbackInProgress.set(false); return@execute }
            try {
                bundles.rejectActive()
                runOnUiThread { if (!closed.get()) loadPage(); fallbackInProgress.set(false) }
            } catch (_: Exception) {
                runOnUiThread { if (!closed.get()) showNativeCompatibility(reason); fallbackInProgress.set(false) }
            }
        } } catch (_: RejectedExecutionException) { fallbackInProgress.set(false) }
    }

    private fun checkForUpdate() {
        if (closed.get()) return
        if (!updateChecking.compareAndSet(false, true)) return
        try { updateWorker.execute {
            if (closed.get()) { updateChecking.set(false); return@execute }
            try {
                val host = secrets.host() ?: return@execute
                val outcome = bundles.check(host)
                if (outcome.staged != null) {
                    emit("update.staged", uiState(outcome))
                    maybeApplyStaged(host)
                }
            } catch (_: Exception) { /* Offline keeps the previously verified UI. */ }
            finally { updateChecking.set(false) }
        } } catch (_: RejectedExecutionException) { updateChecking.set(false) }
    }

    private fun restartUpdateSubscription() {
        if (closed.get()) return
        updateSubscriptionEpoch.incrementAndGet()
        updateConnection.getAndSet(null)?.disconnect()
        if (foreground) listenForUpdates()
    }

    private fun listenForUpdates() {
        if (closed.get()) return
        if (!updateListening.compareAndSet(false, true)) return
        val subscription = updateSubscriptionEpoch.get()
        try { streamWorker.execute {
            try {
                while (foreground && !isDestroyed && !closed.get() &&
                    subscription == updateSubscriptionEpoch.get()) {
                    val host = try { secrets.host() } catch (_: Exception) { null } ?: break
                    val connection = URL("${host.origin}/personal/v1/app/updates").openConnection() as HttpURLConnection
                    updateConnection.set(connection)
                    if (subscription != updateSubscriptionEpoch.get() || !foreground || closed.get()) {
                        updateConnection.compareAndSet(connection, null)
                        connection.disconnect()
                        break
                    }
                    try {
                        connection.instanceFollowRedirects = false
                        connection.connectTimeout = 10_000
                        connection.readTimeout = 90_000
                        connection.setRequestProperty("Cookie", host.cookie)
                        connection.setRequestProperty("Accept", "text/event-stream")
                        val status = connection.responseCode
                        if (status == 401 || status == 403) break
                        if (status != 200) throw ApiFailure(status, "UI_UPDATE_UNAVAILABLE")
                        if (subscription == updateSubscriptionEpoch.get() && !closed.get()) checkForUpdate()
                        connection.inputStream.bufferedReader().use { reader ->
                            while (foreground && !isDestroyed && !closed.get() &&
                                subscription == updateSubscriptionEpoch.get()) {
                                val line = reader.readLine() ?: break
                                if (subscription == updateSubscriptionEpoch.get() && line == "event: ui-update")
                                    checkForUpdate()
                            }
                        }
                    } catch (_: Exception) { /* Reconnect on next foreground or bounded retry. */ }
                    finally { updateConnection.compareAndSet(connection, null); connection.disconnect() }
                    if (foreground && !isDestroyed && !closed.get() &&
                        subscription == updateSubscriptionEpoch.get()) Thread.sleep(5_000)
                }
            } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
            finally {
                updateListening.set(false)
                if (!closed.get() && foreground && subscription != updateSubscriptionEpoch.get())
                    listenForUpdates()
            }
        } } catch (_: RejectedExecutionException) { updateListening.set(false) }
    }

    private fun showNativeCompatibility(reason: String) {
        if (closed.get()) return
        if (!compatShown.compareAndSet(false, true)) return
        runOnUiThread {
            if (closed.get()) return@runOnUiThread
            val message = TextView(this).apply {
                text = "$reason\n打开原生界面继续使用"
                textSize = 16f
                setPadding(48, 96, 48, 48)
                setOnClickListener { startActivity(Intent(this@HybridActivity, MainActivity::class.java)) }
            }
            (web.parent as? FrameLayout)?.addView(message, FrameLayout.LayoutParams(-1, -2))
        }
    }

    private fun respond(reply: JavaScriptReplyProxy, id: String, ok: Boolean, payload: JSONObject) {
        if (closed.get()) return
        val body = JSONObject().put("id", id).put("ok", ok)
            .put(if (ok) "result" else "error", payload).toString()
        runOnUiThread { if (!closed.get()) try { reply.postMessage(body) } catch (_: Exception) { } }
    }

    private fun emit(type: String, data: JSONObject) {
        if (closed.get()) return
        val body = JSONObject().put("event", type).put("data", data).toString()
        runOnUiThread { if (!closed.get()) try { events?.postMessage(body) } catch (_: Exception) { } }
    }
    private fun emitForAccount(epoch: Long, type: String, data: JSONObject) {
        if (closed.get()) return
        val body = JSONObject().put("event", type).put("data", data).toString()
        AccountEventGate.post(epoch, accountEpoch::get, { action -> runOnUiThread { action() } }) {
            if (!closed.get()) try { events?.postMessage(body) } catch (_: Exception) { }
        }
    }

    private fun safeCode(error: Exception) = when (error) {
        is ApiFailure -> error.safeCode.takeIf { it.matches(Regex("[A-Z_0-9]{1,64}")) } ?: "SERVICE_UNAVAILABLE"
        is ModelNotCompleted -> error.code
        is ModelCancelled -> "CANCELLED"
        else -> "OPERATION_FAILED"
    }

    private fun uiState(state: UiBundleState) = JSONObject().put("activeVersion", state.version)
        .put("stagedVersion", state.stagedVersion).put("previousAvailable", state.previous != null)
        .put("releaseNotes", state.releaseNotes ?: "").put("nativeVersion", BuildConfig.VERSION_NAME)
        .put("lastError", lastUiError ?: state.error ?: "")
        .put("autoEnabled", autoUpdates(activeScope))
        .put("pendingReason", if (state.staged == null) "" else if (busy.get()) "running" else
            if (uiHasDraft) "draft" else if (accountTransition.get()) "switching" else "")

    private fun owner(host: HostIdentity?): String? = host?.let { Endpoints.ownerKey(it.origin, it.ownerId) }
    private fun autoUpdates(scope: String): Boolean = updatePrefs.getBoolean("auto:$scope", true)
    private fun hasSavedDraft(scope: String): Boolean = updatePrefs.getBoolean("draft:$scope", false)
    private fun maybeApplyStaged(host: HostIdentity) {
        if (closed.get() || !currentPageReady || !draftKnowledgeReady) return
        val scope = owner(host) ?: return
        if (!autoUpdates(scope) || busy.get() || accountTransition.get() || hasSavedDraft(scope)) return
        if (owner(secrets.host()) != scope || bundles.state().staged == null) return
        try {
            if (closed.get() || !currentPageReady || !draftKnowledgeReady) return
            bundles.apply()
            emit("update.applied", uiState(bundles.state()))
            runOnUiThread { loadPage() }
        } catch (_: Exception) { emit("update.staged", uiState(bundles.state())) }
    }
    private fun scheduleStagedApply() {
        if (closed.get()) return
        try { updateWorker.execute {
            if (closed.get()) return@execute
            val host = try { secrets.host() } catch (_: Exception) { null } ?: return@execute
            maybeApplyStaged(host)
        } } catch (_: RejectedExecutionException) { }
    }
    private fun ensureOpen() { if (closed.get()) throw ApiFailure(503, "SERVICE_CLOSING") }
    private fun scheduleSharedReconcile() {
        if (closed.get() || accountTransition.get() || !sharedReconcileInFlight.compareAndSet(false, true)) return
        val epoch = accountEpoch.get()
        try { worker.execute {
            try {
                val host = secrets.host() ?: return@execute
                val scope = owner(host)
                val result = sharedChat.reconcileOutbox(host) {
                    !closed.get() && !accountTransition.get() && epoch == accountEpoch.get() &&
                        owner(secrets.host()) == scope
                }
                if (epoch == accountEpoch.get() && owner(secrets.host()) == scope)
                    emitForAccount(epoch, "shared.outbox.reconciled", result)
            } catch (_: Exception) { /* Durable records remain visible in shared.outbox.list. */ }
            finally { sharedReconcileInFlight.set(false) }
        } } catch (_: RejectedExecutionException) { sharedReconcileInFlight.set(false) }
    }
    private fun requireHost(): HostIdentity {
        ensureOpen()
        return secrets.host() ?: throw ApiFailure(401, "LOGIN_REQUIRED")
    }
    private fun cancelPreviousNotifications(previous: HostIdentity?, next: HostIdentity?) {
        val before = owner(previous)
        if (before != null && before != owner(next)) notices(before).cancelVisible()
    }
    private fun notices(scope: String = owner(secrets.host()) ?: "local"): MobileNotifications =
        noticeCache.computeIfAbsent(scope) { MobileNotifications(this, it) }
    private fun note(category: String, title: String, summary: String, conversationId: String? = null,
        scope: String = owner(secrets.host()) ?: "local") {
        if (closed.get()) return
        val mayShow = NotificationScopeGate.mayShow(scope, activeScope, foreground, accountTransition.get())
        try { notices(scope).record(category, title, summary, conversationId, mayShow) }
        catch (_: Exception) { /* Notification failure cannot change a persisted model/tool outcome. */ }
    }
    private fun appearance(): String = displayPrefs.getString("appearance:$activeScope", "system")
        ?.takeIf { it in setOf("system", "light", "dark") } ?: "system"
    private fun useScope(host: HostIdentity?) {
        val scope = owner(host) ?: "local"
        if (activeScope == scope) return
        activeScope = scope
        currentPageReady = false
        draftKnowledgeReady = false
        uiHasDraft = hasSavedDraft(scope)
        check(displayPrefs.edit().putString("lastScope", scope).commit())
        runOnUiThread { applySystemBars() }
    }
    private fun applySystemBars() {
        val selected = appearance()
        val dark = selected == "dark" || selected == "system" &&
            (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        val color = if (dark) Color.rgb(22, 31, 47) else Color.WHITE
        window.decorView.setBackgroundColor(color)
        window.statusBarColor = color
        window.navigationBarColor = color
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            val flags = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.decorView.windowInsetsController?.setSystemBarsAppearance(if (dark) 0 else flags, flags)
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (dark) 0 else
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        }
    }
    private data class HostChoice(val profileId: String, val modelId: String, val name: String)
    private fun hostChoice(host: HostIdentity?): HostChoice? = host?.let {
        try {
            val row = JSONObject(choices.getString("host:${owner(it)}", null) ?: return@let null)
            HostChoice(row.getString("profileId"), row.getString("modelId"), row.getString("name"))
        } catch (_: Exception) { null }
    }
    private fun modelStatus(host: HostIdentity?): JSONObject {
        if (host == null) return JSONObject()
        val selected = hostChoice(host)
        return if (selected != null) JSONObject().put("source", "host").put("profileId", selected.profileId)
            .put("modelId", selected.modelId).put("displayName", selected.name)
            else secrets.model(owner(host) ?: "local")?.let(::modelView) ?: JSONObject()
    }
    private fun actualOriginalModel(requestUrl: String, actualModelId: String,
        settings: ModelSettings, hostProfile: HostChoice?): JSONObject? {
        if (!actualModelId.matches(Regex("[A-Za-z0-9._:/-]{1,128}"))) return null
        if (hostProfile != null && !hostProfile.profileId.matches(Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,127}")))
            return null
        val rawName = settings.displayName.map { if (it.isISOControl()) ' ' else it }
            .joinToString("").trim().ifBlank { actualModelId }
        val count = rawName.codePointCount(0, rawName.length)
        val name = rawName.substring(0, rawName.offsetByCodePoints(0, minOf(count, 100)))
        return JSONObject().put("modelId", actualModelId).put("displayName", name)
            .put("routeFingerprint", if (hostProfile == null)
                modelRouteFingerprint(requestUrl, actualModelId) ?: JSONObject.NULL else JSONObject.NULL)
            .apply { if (hostProfile != null) put("hostProfileId", hostProfile.profileId) }
    }

    private fun accountView(body: JSONObject): JSONObject {
        val account = body.optJSONObject("account") ?: JSONObject()
        val avatar = account.optJSONObject("avatar")
        return JSONObject().put("loggedIn", true).put("username", account.optString("username"))
            .put("displayName", account.optString("displayName", account.optString("username")))
            .put("avatar", avatar?.let { JSONObject().put("mimeType", it.optString("mimeType"))
                .put("dataBase64", it.optString("dataBase64")) } ?: JSONObject.NULL)
            .put("profileRevision", account.optLong("profileRevision", 0))
            .put("device", body.optJSONObject("device")?.let {
                JSONObject().put("id", it.optString("id")).put("name", it.optString("name"))
                    .put("expiresAt", it.optString("expiresAt")) } ?: JSONObject.NULL)
    }
    private fun rememberProfile(host: HostIdentity, body: JSONObject): JSONObject {
        val view = accountView(body)
        val saved = if (closed.get()) false else try { secrets.saveProfile(owner(host)!!, view); true } catch (_: Exception) { false }
        view.put("localCacheSaved", saved)
        return view
    }
    private fun profileFor(host: HostIdentity): JSONObject {
        val remote = try { api.me(host) } catch (error: Exception) {
            if (error is ApiFailure && (error.status == 401 || error.safeCode == "ACCOUNT_IDENTITY_MISMATCH"))
                throw error
            return secrets.cachedProfile(owner(host)!!)?.put("connectionVerified", false) ?: throw error
        }
        return rememberProfile(host, remote).put("connectionVerified", true)
    }
    private fun savedIdentityView(identity: HostIdentity): JSONObject = try {
        profileFor(identity).put("owner", owner(identity))
    } catch (_: Exception) {
        JSONObject().put("loggedIn", true).put("username", identity.username)
            .put("displayName", identity.username).put("owner", owner(identity))
            .put("connectionVerified", false)
    }
    private fun publicBusiness(value: Any?, depth: Int = 0): Any {
        if (depth > 8) throw ApiFailure(502, "BUSINESS_RESPONSE_INVALID")
        return when (value) {
            is JSONObject -> {
                val result = JSONObject()
                val forbidden = setOf("token", "password", "secret", "credential", "cookie", "csrftoken", "apikey",
                    "authorization", "salt", "hash")
                for (key in value.keys()) {
                    if (key.lowercase() in forbidden) continue
                    result.put(key, publicBusiness(value.get(key), depth + 1))
                }
                result
            }
            is JSONArray -> {
                if (value.length() > 1000) throw ApiFailure(502, "BUSINESS_RESPONSE_INVALID")
                val result = JSONArray()
                for (index in 0 until value.length()) result.put(publicBusiness(value.get(index), depth + 1))
                result
            }
            is String -> value.take(16_384)
            is Number, is Boolean -> value
            else -> JSONObject.NULL
        }
    }
    private fun readAvatar(uri: Uri): JSONObject {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        val probe = contentResolver.openInputStream(uri) ?: throw ApiFailure(400, "AVATAR_INVALID")
        probe.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth !in 1..10000 || bounds.outHeight !in 1..10000)
            throw ApiFailure(400, "AVATAR_INVALID")
        var sample = 1
        while (bounds.outWidth / sample > 768 || bounds.outHeight / sample > 768) sample *= 2
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        val original = contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
            ?: throw ApiFailure(400, "AVATAR_INVALID")
        try {
            val edge = minOf(original.width, original.height)
            var size = minOf(512, edge)
            while (size >= 96) {
                val thumbnail = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
                try {
                    val canvas = Canvas(thumbnail)
                    canvas.drawColor(Color.WHITE)
                    val source = android.graphics.Rect((original.width-edge)/2,(original.height-edge)/2,
                        (original.width+edge)/2,(original.height+edge)/2)
                    canvas.drawBitmap(original, source, android.graphics.Rect(0,0,size,size), null)
                    for (quality in listOf(86,72,56,42)) {
                        val output = ByteArrayOutputStream()
                        thumbnail.compress(Bitmap.CompressFormat.JPEG, quality, output)
                        if (output.size() <= 128 * 1024) return JSONObject().put("mimeType", "image/jpeg")
                            .put("dataBase64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP))
                    }
                } finally { thumbnail.recycle() }
                size /= 2
            }
            throw ApiFailure(413, "AVATAR_TOO_LARGE")
        } finally { original.recycle() }
    }

    private fun handle(method: String, params: JSONObject): JSONObject = when (method) {
        "app.ready" -> {
            ensureOpen()
            val host = secrets.host()
            val scope = owner(host) ?: ""
            if (params.optString("owner") != scope || !params.has("hasDraft"))
                throw ApiFailure(400, "INVALID_REQUEST")
            val draft = params.getBoolean("hasDraft")
            if (host != null) {
                ensureOpen()
                check(updatePrefs.edit().putBoolean("draft:$scope", draft).commit())
            }
            uiHasDraft = draft
            draftKnowledgeReady = true
            currentPageReady = true
            if (bundles.state().active != "builtin") lastUiError = null
            JSONObject().put("bridgeVersion", 1)
        }
        "app.activity" -> {
            val scope = owner(requireHost())!!
            if (params.optString("owner") != scope) throw ApiFailure(409, "ACCOUNT_SWITCHED")
            val draft = params.getBoolean("hasDraft")
            ensureOpen()
            check(updatePrefs.edit().putBoolean("draft:$scope", draft).commit())
            uiHasDraft = draft
            if (!draft) scheduleStagedApply()
            JSONObject().put("saved", true)
        }
        "app.failed" -> {
            runOnUiThread {
                if (bundles.state().active != "builtin") fallbackUi("更新页面启动失败，已返回上一版")
                else showNativeCompatibility("内置界面启动失败")
            }
            JSONObject().put("reported", true)
        }
        "app.bootstrap" -> {
            val host = secrets.host()
            ensureOpen()
            useScope(host)
            val scope = owner(host) ?: "local"
            val launch = if (intent?.getStringExtra("ownerScope") == scope)
                intent?.getStringExtra("conversationId") ?: "" else ""
            JSONObject().put("loggedIn", host != null).put("username", host?.username ?: "")
                .put("owner", scope.takeUnless { it == "local" } ?: "").put("model", modelStatus(host))
                .put("busy", busy.get() && host != null && activeTurnScope == scope)
                .put("backgroundSync", SyncJobService.status(this))
                .put("ui", uiState(bundles.state()))
                .put("launchConversationId", launch)
                .put("notificationOtherAccount", intent?.getStringExtra("conversationId")?.isNotBlank() == true &&
                    intent?.getStringExtra("ownerScope") != scope)
        }
        "conversations.list" -> {
            val host = requireHost()
            val rows = JSONArray()
            for (item in store.listConversations(owner(host))) {
                val linked = store.sharedConversationSnapshot(owner(host)!!, host.hostId, item.id)
                rows.put(JSONObject().put("id", item.id).put("title", item.title)
                    .put("createdAt", item.createdAt).put("source", "phone")
                    .apply { if (linked?.optString("status") == "active")
                        put("binding", linked.optJSONObject("binding")) })
            }
            JSONObject().put("conversations", rows).put("source", "phone")
        }
        "shared.sessions.list" -> {
            val host = requireHost()
            sharedChat.sessions(host)
        }
        "shared.conversations.get" -> {
            val host = requireHost()
            val epoch = accountEpoch.get()
            conversationHandoff.status(host, params.getString("conversationId")) {
                !closed.get() && !accountTransition.get() && epoch == accountEpoch.get() &&
                    owner(secrets.host()) == owner(host)
            }
        }
        "shared.conversations.adopt" -> {
            if (busy.get()) throw ApiFailure(409, "TURN_RUNNING")
            val host = requireHost()
            val epoch = accountEpoch.get()
            conversationHandoff.adopt(host, params.getString("conversationId"),
                params.getString("modelProfileId"), params.getString("requestId")) {
                !busy.get() && !closed.get() && !accountTransition.get() &&
                    epoch == accountEpoch.get() && owner(secrets.host()) == owner(host)
            }
        }
        "shared.projects.list" -> {
            val host = requireHost()
            val epoch = accountEpoch.get()
            val result = api.projects(host)
            val hostId = api.status(host).getString("hostId")
            if (closed.get() || accountTransition.get() || epoch != accountEpoch.get() ||
                owner(secrets.host()) != owner(host)) throw ApiFailure(403, "ACCOUNT_SWITCHED")
            result.put("source", "host").put("hostId", hostId)
        }
        "shared.projects.createSession" -> {
            val host = requireHost()
            val epoch = accountEpoch.get()
            val result = api.createProjectSession(host, params.getString("projectId"),
                params.getString("modelProfileId"), params.getString("requestId"))
            if (closed.get() || accountTransition.get() || epoch != accountEpoch.get() ||
                owner(secrets.host()) != owner(host)) throw ApiFailure(403, "ACCOUNT_SWITCHED")
            result.put("source", "host")
        }
        "shared.sessions.events" -> {
            val host = requireHost()
            val sessionId = params.getString("sessionId")
            val after = params.optLong("afterSeq", -1)
            val result = sharedChat.history(host, sessionId, after)
            val events = result.getJSONArray("events")
            for (i in 0 until events.length()) {
                val images = events.getJSONObject(i).optJSONObject("data")?.optJSONArray("images") ?: continue
                for (j in 0 until images.length()) {
                    val image = images.getJSONObject(j)
                    val durableId = image.optString("attachmentId")
                    if (durableId.matches(Regex("sha256:[a-f0-9]{64}")))
                        image.put("previewUrl", sharedImagePreviewUrl(sessionId, durableId))
                }
            }
            result.put("source", "host").put("sessionId", sessionId)
        }
        "shared.send" -> {
            val host = requireHost()
            val attachmentIds = params.optJSONArray("attachmentIds")?.let { array ->
                (0 until array.length()).map { array.getString(it) }
            } ?: emptyList()
            val epoch = accountEpoch.get()
            sharedChat.submit(host, params.getString("sessionId"), params.getString("text"),
                "session.message", params.optString("requestId").takeIf { it.isNotBlank() }, attachmentIds,
                sourceSyncEventId = params.optString("sourceSyncEventId").takeIf { it.isNotBlank() }, current = {
                !closed.get() && !accountTransition.get() && epoch == accountEpoch.get() &&
                    owner(secrets.host()) == owner(host)
            })
        }
        "shared.stop" -> {
            val host = requireHost()
            val epoch = accountEpoch.get()
            sharedChat.submit(host, params.getString("sessionId"), null,
                "session.cancel", params.optString("requestId").takeIf { it.isNotBlank() }, current = {
                !closed.get() && !accountTransition.get() && epoch == accountEpoch.get() &&
                    owner(secrets.host()) == owner(host)
            })
        }
        "shared.outbox.list" -> sharedChat.outbox(requireHost())
        "shared.outbox.reconcile" -> {
            val host = requireHost()
            val epoch = accountEpoch.get()
            sharedChat.reconcileOutbox(host) {
                !closed.get() && !accountTransition.get() && epoch == accountEpoch.get() &&
                    owner(secrets.host()) == owner(host)
            }
        }
        "shared.commands.detail" -> {
            val host = requireHost()
            JSONObject().put("source", "host")
                .put("command", api.commandDetail(host, params.getString("commandId")))
        }
        "shared.commands.byRequest" -> {
            val host = requireHost()
            JSONObject().put("source", "host")
                .put("command", api.commandByRequest(host, params.getString("requestId")))
        }
        "shared.tasks.detail" -> {
            val host = requireHost()
            api.taskDetail(host, params.getString("taskId"))
        }
        "shared.sources.detail" -> {
            val host = requireHost()
            val epoch = accountEpoch.get()
            val result = api.sourceDetail(host, params.getString("taskId"), params.getString("snapshotId"))
            if (closed.get() || accountTransition.get() || epoch != accountEpoch.get() ||
                owner(secrets.host()) != owner(host)) throw ApiFailure(403, "ACCOUNT_SWITCHED")
            result
        }
        "shared.tasks.supplement", "shared.tasks.stop", "shared.tasks.resume" -> {
            val host = requireHost()
            val epoch = accountEpoch.get()
            val action = when (method) {
                "shared.tasks.supplement" -> "supplements"
                "shared.tasks.stop" -> "stop"
                else -> "resume"
            }
            if (closed.get() || accountTransition.get() || epoch != accountEpoch.get() ||
                owner(secrets.host()) != owner(host)) throw ApiFailure(403, "ACCOUNT_SWITCHED")
            val result = api.taskControl(host, params.getString("taskId"), action,
                params.getString("requestId"), if (params.has("text")) params.getString("text") else null)
            if (closed.get() || accountTransition.get() || epoch != accountEpoch.get() ||
                owner(secrets.host()) != owner(host)) throw ApiFailure(403, "ACCOUNT_SWITCHED")
            result
        }
        "shared.artifacts.preview" -> {
            val host = requireHost()
            api.artifactPreview(host, params.getString("artifactId"))
        }
        "shared.artifacts.save" -> startArtifactSave(requireHost(), params)
        "conversations.create" -> {
            val host = requireHost()
            val title = params.optString("title", "新对话").take(120)
            val item = store.createConversation(title, owner(host))
            activeConversation = item.id
            JSONObject().put("id", item.id).put("title", item.title).put("source", "phone")
        }
        "conversations.messages" -> {
            val host = requireHost()
            val id = params.getString("conversationId")
            if (store.listConversations(owner(host)).none { it.id == id })
                throw ApiFailure(404, "SESSION_UNAVAILABLE")
            activeConversation = id
            val rows = JSONArray()
            for (item in store.messages(id, owner(host)))
                rows.put(JSONObject().put("id", item.id).put("role", item.role).put("text", item.text)
                    .put("thumbnails", store.messageThumbnails(id, owner(host), item.id))
                    .apply { item.serverSeq?.let { put("serverSeq", it) }
                        item.sourceEventId?.let { put("sourceEventId", it) } })
            val result = JSONObject().put("messages", rows).put("source", "phone")
                .put("turnStatus", store.latestTurnStatus(id) ?: "")
                .put("receipts", JSONArray(store.toolReceipts(id, owner(host))))
            store.latestTurnFailure(id, owner(host))?.let { failure ->
                result.put("turnErrorCode", failure.getString("turnErrorCode"))
                if (failure.has("upstreamHttpStatus"))
                    result.put("upstreamHttpStatus", failure.getInt("upstreamHttpStatus"))
            }
            result
        }
        "activity.list" -> {
            val host = requireHost()
            val currentOwner = owner(host)
            val rows = JSONArray()
            for (conversation in store.listConversations(currentOwner).take(50)) {
                val status = store.latestTurnStatus(conversation.id)
                val receipts = store.toolReceipts(conversation.id, currentOwner)
                if (status == null && receipts.isEmpty()) continue
                rows.put(JSONObject().put("source", "phone").put("conversationId", conversation.id)
                    .put("title", conversation.title).put("status", status ?: "tool")
                    .put("summary", receipts.lastOrNull()?.optString("summary") ?: "")
                    .put("createdAt", conversation.createdAt))
            }
            var hostAvailable = false
            if (host != null) try {
                val commands = api.recentCommands(host).optJSONArray("commands") ?: JSONArray()
                for (i in 0 until commands.length()) {
                    val row = commands.optJSONObject(i) ?: continue
                    rows.put(activityCommandProjection(row))
                }
                hostAvailable = true
            } catch (_: Exception) { }
            JSONObject().put("activities", rows).put("hostAvailable", hostAvailable)
        }
        "records.unboundSummary" -> {
            val host = requireHost()
            val eligible = secrets.legacyOwnerScope() == owner(host)
            JSONObject().put("eligible", eligible)
                .put("conversationCount", if (eligible) store.unboundConversationCount() else 0)
        }
        "records.claimUnbound" -> {
            if (busy.get()) throw ApiFailure(409, "TURN_RUNNING")
            val host = requireHost()
            if (secrets.legacyOwnerScope() != owner(host)) throw ApiFailure(403, "FORBIDDEN")
            val count = store.unboundConversationCount()
            if (count <= 0 || params.optInt("expectedCount", -1) != count ||
                params.optString("confirmAccountName") != host.username) throw ApiFailure(409, "REQUEST_CONFLICT")
            store.bindUnboundTo(owner(host)!!)
            JSONObject().put("claimedConversations", count)
        }
        "chat.send" -> send(params)
        "attachments.pick" -> pickAttachment(params)
        "attachments.remove" -> {
            val host = requireHost()
            val scope = owner(host) ?: throw ApiFailure(401, "LOGIN_REQUIRED")
            val conversationId = if (params.has("conversationId")) params.getString("conversationId") else null
            if (conversationId != null && conversationId.isNotEmpty() && !attachmentScopeAllowed(host, conversationId))
                throw ApiFailure(404, "SESSION_UNAVAILABLE")
            attachments.removeDraft(scope, conversationId, params.getString("attachmentId"), store)
            JSONObject().put("removed", true)
        }
        "attachments.list" -> {
            val host = requireHost()
            val scope = owner(host) ?: throw ApiFailure(401, "LOGIN_REQUIRED")
            val conversationId = params.optString("conversationId")
            if (conversationId.isNotEmpty() && !attachmentScopeAllowed(host, conversationId))
                throw ApiFailure(404, "SESSION_UNAVAILABLE")
            attachments.reconcileTurns(store)
            JSONObject().put("attachments", JSONArray(attachments.list(scope, conversationId).map {
                attachments.bridge(scope, conversationId, it.id)
            }))
        }
        "chat.stop" -> { stopped = true; activeModel?.cancel(); JSONObject().put("requested", busy.get()) }
        "voice.start" -> {
            requireHost()
            if (busy.get()) throw ApiFailure(409, "TURN_RUNNING")
            val attempt = SpeechAttempt(owner(secrets.host()), params.optString("conversationId").takeIf { it.isNotEmpty() },
                pageGeneration, params.optInt("viewGeneration"))
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_PROMPT, "语音输入到草稿")
            }
            val started = CountDownLatch(1)
            val failure = AtomicReference<Exception?>()
            runOnUiThread {
                try { pendingSpeech = attempt to params.optInt("viewGeneration");
                    @Suppress("DEPRECATION")
                    startActivityForResult(intent, SPEECH_REQUEST) }
                catch (error: Exception) { pendingSpeech = null; failure.set(error) }
                finally { started.countDown() }
            }
            if (!started.await(3, TimeUnit.SECONDS)) throw ApiFailure(503, "VOICE_UNAVAILABLE")
            if (failure.get() != null) throw ApiFailure(503, "VOICE_UNAVAILABLE")
            JSONObject().put("started", true)
        }
        "tools.apps" -> {
            requireHost()
            val all = DeviceTools(this).launchableApps()
            JSONObject().put("apps", all)
        }
        "tools.execute" -> {
            requireHost()
            val name = params.getString("name")
            if (name !in setOf("open_settings", "open_app")) throw ApiFailure(400, "TOOL_UNAVAILABLE")
            val currentOwner = owner(secrets.host())
            val requested = params.optString("conversationId")
            val conversation = if (requested.isBlank()) store.createConversation("手机操作", currentOwner).id
                else requested.also { require(store.listConversations(currentOwner).any { row -> row.id == it }) }
            val args = if (name == "open_app") JSONObject().put("packageName", params.getString("packageName")) else JSONObject()
            val result = DeviceTools(this).execute(name, args)
            store.toolReceipt(conversation, "tool-${UUID.randomUUID()}", name, result.status, result.summary)
            note("action", "手机动作${if (result.status == "failed") "未完成" else "已请求"}", result.summary,
                conversation, currentOwner ?: "local")
            JSONObject().put("conversationId", conversation).put("name", name)
                .put("status", result.status).put("summary", result.summary)
        }
        "notifications.state" -> { requireHost(); notices().state() }
        "notifications.inbox" -> { requireHost(); JSONObject().put("items", notices().inbox()) }
        "notifications.set" -> { requireHost(); notices().setEnabled(params.getString("category"), params.getBoolean("enabled")) }
        "notifications.requestPermission" -> {
            requireHost()
            if (android.os.Build.VERSION.SDK_INT >= 33) runOnUiThread {
                requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), NOTIFY_REQUEST)
            }
            JSONObject().put("requested", android.os.Build.VERSION.SDK_INT >= 33)
        }
        "clipboard.copy" -> {
            val value = params.getString("text")
            require(value.length <= 32_768)
            val done = CountDownLatch(1)
            val failure = AtomicReference<Exception?>()
            runOnUiThread {
                try { (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                    .setPrimaryClip(ClipData.newPlainText("WeftMate", value)) }
                catch (error: Exception) { failure.set(error) }
                finally { done.countDown() }
            }
            if (!done.await(3, TimeUnit.SECONDS)) throw ApiFailure(503, "CLIPBOARD_UNAVAILABLE")
            if (failure.get() != null) throw ApiFailure(503, "CLIPBOARD_UNAVAILABLE")
            JSONObject().put("copied", true)
        }
        "models.list" -> {
            val host = requireHost()
            val scope = owner(host) ?: "local"
            val selected = secrets.model(scope)
            val hostSelected = hostChoice(host) != null
            val rows = JSONArray()
            for (profile in secrets.modelProfiles(scope)) rows.put(modelView(profile,
                !hostSelected && selected?.endpoint == profile.endpoint && selected.modelId == profile.modelId))
            JSONObject().put("models", rows).put("selected", modelStatus(host))
        }
        "models.account.list" -> {
            val host = requireHost()
            val epoch = accountEpoch.get()
            accountModels.list(host) { !closed.get() && !accountTransition.get() &&
                epoch == accountEpoch.get() && secrets.host() == host }
        }
        "models.account.byRequest" -> {
            val host = requireHost()
            val epoch = accountEpoch.get()
            accountModels.byRequest(host, params.getString("requestId")) {
                !closed.get() && !accountTransition.get() && epoch == accountEpoch.get() && secrets.host() == host }
        }
        "models.account.publishSaved" -> {
            val host = requireHost()
            val epoch = accountEpoch.get()
            accountModels.publishSaved(host, params.getString("endpoint"), params.getString("modelId"),
                params.getString("requestId")) { !closed.get() && !accountTransition.get() &&
                epoch == accountEpoch.get() && secrets.host() == host }
        }
        "models.account.transfer" -> {
            if (busy.get()) throw ApiFailure(409, "TURN_RUNNING")
            val host = requireHost()
            val epoch = accountEpoch.get()
            accountModels.importToPhone(host, params.getString("accountModelId"),
                params.getLong("expectedRevision"), params.getString("requestId"),
                params.optBoolean("replaceExistingKey", false)) { !busy.get() && !closed.get() &&
                !accountTransition.get() && epoch == accountEpoch.get() && secrets.host() == host }
        }
        "models.account.test", "models.account.stopUsing", "models.account.remove" -> {
            val host = requireHost()
            val epoch = accountEpoch.get()
            val action = when (method) { "models.account.test" -> "test"
                "models.account.stopUsing" -> "stop-using"; else -> "remove" }
            accountModels.control(host, params.getString("accountModelId"), action,
                params.getString("requestId"), params.getLong("expectedRevision")) {
                !closed.get() && !accountTransition.get() && epoch == accountEpoch.get() &&
                    secrets.host() == host }
        }
        "models.account.removeLocal" -> {
            if (busy.get()) throw ApiFailure(409, "TURN_RUNNING")
            val host = requireHost()
            val scope = owner(host) ?: throw ApiFailure(401, "LOGIN_REQUIRED")
            val endpoint = params.getString("endpoint")
            val modelId = params.getString("modelId")
            val item = secrets.modelProfiles(scope).firstOrNull {
                Endpoints.modelUrl(it.endpoint) == Endpoints.modelUrl(endpoint) && it.modelId == modelId }
                ?: throw ApiFailure(404, "MODEL_NOT_FOUND")
            if (secrets.model(scope)?.let { Endpoints.modelUrl(it.endpoint) == Endpoints.modelUrl(endpoint) &&
                    it.modelId == modelId } == true) throw ApiFailure(409, "MODEL_IN_USE")
            secrets.removeModelProfile(endpoint, modelId, scope)
            JSONObject().put("removed", true).put("endpoint", item.endpoint).put("modelId", item.modelId)
        }
        "models.configure" -> {
            requireHost()
            if (busy.get()) throw ApiFailure(409, "TURN_RUNNING")
            val host = secrets.host()
            val scope = owner(host) ?: "local"
            val endpoint = params.getString("endpoint")
            val id = params.getString("modelId")
            val key = params.optString("apiKey", "")
            ensureOpen()
            if (host != null) choices.edit().remove("host:$scope").commit()
            modelView(secrets.saveModel(ModelSettings(endpoint, id, key, params.optString("displayName", id)), scope))
        }
        "models.select" -> {
            requireHost()
            if (busy.get()) throw ApiFailure(409, "TURN_RUNNING")
            val host = secrets.host()
            val scope = owner(host) ?: "local"
            ensureOpen()
            if (host != null) choices.edit().remove("host:$scope").commit()
            modelView(secrets.selectModel(params.getString("endpoint"), params.getString("modelId"), scope))
        }
        "models.host" -> {
            val host = secrets.host() ?: throw ApiFailure(401, "LOGIN_REQUIRED")
            val source = api.hostModels(host).optJSONArray("models") ?: JSONArray()
            val rows = JSONArray()
            for (i in 0 until source.length()) {
                val item = source.optJSONObject(i) ?: continue
                val id = item.optString("id")
                if (!id.matches(Regex("[A-Za-z0-9._-]{1,128}"))) continue
                rows.put(JSONObject().put("source", "host").put("profileId", id)
                    .put("displayName", item.optString("name", id).take(100))
                    .put("sourceKind", item.optString("sourceKind"))
                    .put("configured", item.optBoolean("configured"))
                    .put("modelId", item.optString("model"))
                    .put("routeFingerprint", item.optString("routeFingerprint")
                        .takeIf { it.matches(Regex("[a-f0-9]{64}")) } ?: JSONObject.NULL)
                    .put("selected", hostChoice(host)?.profileId == id))
            }
            JSONObject().put("models", rows)
        }
        "models.selectHost" -> {
            if (busy.get()) throw ApiFailure(409, "TURN_RUNNING")
            val host = secrets.host() ?: throw ApiFailure(401, "LOGIN_REQUIRED")
            val id = params.getString("profileId")
            require(id.matches(Regex("[A-Za-z0-9._-]{1,128}")))
            val items = api.hostModels(host).optJSONArray("models") ?: JSONArray()
            val match = (0 until items.length()).mapNotNull { items.optJSONObject(it) }
                .firstOrNull { it.optString("id") == id && it.optBoolean("configured") }
                ?: throw ApiFailure(404, "MODEL_NOT_CONFIGURED")
            val verification = api.verifyHostModel(host, id)
            if (!verification.optBoolean("configured") || !verification.optBoolean("reachable") ||
                !verification.optBoolean("modelListed")) throw ApiFailure(503, "MODEL_UNAVAILABLE")
            ensureOpen()
            if (busy.get()) throw ApiFailure(409, "TURN_RUNNING")
            val modelId = match.optString("model")
            require(modelId.matches(Regex("[A-Za-z0-9._:/-]{1,128}")))
            val name = match.optString("name", id).take(100)
            check(choices.edit().putString("host:${owner(host)}", JSONObject().put("profileId", id)
                .put("modelId", modelId).put("name", name).toString()).commit())
            JSONObject().put("source", "host").put("profileId", id)
                .put("modelId", modelId).put("displayName", name)
        }
        "models.verifyHost" -> {
            val host = secrets.host() ?: throw ApiFailure(401, "LOGIN_REQUIRED")
            val result = api.verifyHostModel(host, params.getString("profileId"))
            JSONObject().put("available", result.optBoolean("configured") && result.optBoolean("reachable") &&
                result.optBoolean("modelListed"))
                .put("configured", result.optBoolean("configured"))
                .put("reachable", result.optBoolean("reachable"))
                .put("modelListed", result.optBoolean("modelListed"))
                .put("inferenceVerified", false)
        }
        "models.discover" -> {
            requireHost()
            val profile = secrets.model(owner(secrets.host()) ?: "local") ?: throw ApiFailure(409, "MODEL_NOT_CONFIGURED")
            val rows = JSONArray()
            for (model in ModelCatalogClient().discover(profile)) rows.put(JSONObject().put("id", model.id).put("displayName", model.displayName))
            JSONObject().put("models", rows)
        }
        "models.chooseDiscovered" -> {
            requireHost()
            if (busy.get()) throw ApiFailure(409, "TURN_RUNNING")
            val scope = owner(secrets.host()) ?: "local"
            val current = secrets.model(scope) ?: throw ApiFailure(409, "MODEL_NOT_CONFIGURED")
            val id = params.getString("modelId")
            val discovered = ModelCatalogClient().discover(current).firstOrNull { it.id == id }
                ?: throw ApiFailure(404, "MODEL_NOT_FOUND")
            ensureOpen()
            if (busy.get()) throw ApiFailure(409, "TURN_RUNNING")
            modelView(secrets.saveModel(current.copy(modelId = id, displayName = discovered.displayName), scope))
        }
        "models.verifyPhone" -> {
            requireHost()
            val current = secrets.model(owner(secrets.host()) ?: "local") ?: throw ApiFailure(409, "MODEL_NOT_CONFIGURED")
            val items = ModelCatalogClient().discover(current)
            JSONObject().put("modelListed", items.any { it.id == current.modelId })
                .put("inferenceVerified", false)
        }
        "settings.appearance" -> {
            val host = secrets.host()
            if (host != null) useScope(host)
            if (params.has("value")) {
                if (host == null) throw ApiFailure(401, "LOGIN_REQUIRED")
                ensureOpen()
                val selected = params.getString("value")
                require(selected in setOf("system", "light", "dark"))
                check(displayPrefs.edit().putString("appearance:$activeScope", selected).commit())
                runOnUiThread { applySystemBars() }
            }
            JSONObject().put("value", appearance())
        }
        "auth.state" -> {
            val state = api.accountState(params.getString("origin"))
            JSONObject().put("configured", state.optBoolean("configured"))
                .put("registrationAvailable", state.optBoolean("registrationAvailable"))
        }
        "auth.register" -> {
            val previous = secrets.host()
            val identity = api.register(params.getString("origin"), params.getString("username"),
                params.getString("password"), params.optString("deviceName", "Android"), params.optString("displayName"))
            ensureOpen()
            synchronized(syncRegistrationLock) {
                ensureOpen()
                if (previous != null) SyncJobService.cancel(this)
                secrets.saveHost(identity)
                SyncJobService.schedule(this)
            }
            useScope(identity)
            queueSync(identity, accountEpoch.get(), null)
            cancelPreviousNotifications(previous, identity)
            checkForUpdate()
            restartUpdateSubscription()
            activeConversation = null
            savedIdentityView(identity).put("backgroundSync", SyncJobService.status(this))
        }
        "auth.login" -> {
            val previous = secrets.host()
            val identity = api.login(params.getString("origin"), params.getString("username"),
                params.getString("password"), params.optString("deviceName", "Android"))
            ensureOpen()
            synchronized(syncRegistrationLock) {
                ensureOpen()
                if (previous != null) SyncJobService.cancel(this)
                secrets.saveHost(identity)
                SyncJobService.schedule(this)
            }
            useScope(identity)
            queueSync(identity, accountEpoch.get(), null)
            cancelPreviousNotifications(previous, identity)
            checkForUpdate()
            restartUpdateSubscription()
            activeConversation = null
            savedIdentityView(identity).put("backgroundSync", SyncJobService.status(this))
        }
        "auth.me" -> secrets.host()?.let { profileFor(it).put("owner", owner(it)) }
            ?: JSONObject().put("loggedIn", false)
        "auth.profile" -> {
            val host = requireHost()
            val displayName = params.optString("displayName").takeIf { params.has("displayName") }
            val changed = api.updateProfile(host, params.getLong("expectedRevision"), displayName,
                params.optJSONObject("avatar"), params.has("avatar"))
            ensureOpen()
            rememberProfile(host, changed)
        }
        "auth.chooseAvatar" -> {
            val scope = owner(requireHost())!!
            val launched = CountDownLatch(1)
            val failure = AtomicReference<Exception?>()
            runOnUiThread {
                try {
                    pendingAvatarScope = scope
                    pendingAvatarEpoch = accountEpoch.get()
                    startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        type = "image/*"; addCategory(Intent.CATEGORY_OPENABLE)
                    }, AVATAR_REQUEST)
                } catch (error: Exception) { pendingAvatarScope = null; failure.set(error) }
                finally { launched.countDown() }
            }
            if (!launched.await(3, TimeUnit.SECONDS) || failure.get() != null)
                throw ApiFailure(503, "PHOTO_PICKER_UNAVAILABLE")
            JSONObject().put("started", true)
        }
        "auth.devices" -> {
            val host = secrets.host() ?: throw ApiFailure(401, "LOGIN_REQUIRED")
            val entries = api.devices(host).optJSONArray("devices") ?: JSONArray()
            val rows = JSONArray()
            for (i in 0 until entries.length()) {
                val item = entries.optJSONObject(i) ?: continue
                rows.put(JSONObject().put("id", item.optString("id")).put("name", item.optString("name"))
                    .put("current", item.optBoolean("current")).put("revoked", item.optBoolean("revoked"))
                    .put("createdAt", item.optString("createdAt"))
                    .put("lastSeenAt", item.optString("lastSeenAt"))
                    .put("expiresAt", item.optString("expiresAt")))
            }
            JSONObject().put("devices", rows)
        }
        "host.modules" -> {
            val host = secrets.host() ?: throw ApiFailure(401, "LOGIN_REQUIRED")
            moduleProjection(api.status(host))
        }
        "auth.renameDevice" -> {
            val host = secrets.host() ?: throw ApiFailure(401, "LOGIN_REQUIRED")
            api.renameDevice(host, params.getString("deviceId"), params.getString("name"))
            JSONObject().put("renamed", true)
        }
        "auth.revokeDevice" -> {
            val host = secrets.host() ?: throw ApiFailure(401, "LOGIN_REQUIRED")
            val id = params.getString("deviceId")
            api.revokeDevice(host, id)
            ensureOpen()
            if (id == host.deviceId) {
                synchronized(syncRegistrationLock) { ensureOpen(); secrets.clearHost(); SyncJobService.cancel(this) }
                useScope(null); cancelPreviousNotifications(host, null)
                restartUpdateSubscription()
            }
            JSONObject().put("revoked", true).put("loggedIn", id != host.deviceId)
        }
        "auth.changePassword" -> {
            val host = secrets.host() ?: throw ApiFailure(401, "LOGIN_REQUIRED")
            val changed = api.changePassword(host, params.getString("currentPassword"), params.getString("newPassword"))
            ensureOpen()
            synchronized(syncRegistrationLock) { ensureOpen(); secrets.saveHost(changed); SyncJobService.schedule(this) }
            restartUpdateSubscription()
            profileFor(changed).put("owner", owner(changed))
                .put("backgroundSync", SyncJobService.status(this))
        }
        "auth.logout" -> {
            val identity = secrets.host()
            var revoked = true
            if (identity != null) try { api.logout(identity) } catch (_: Exception) { revoked = false }
            ensureOpen()
            synchronized(syncRegistrationLock) { ensureOpen(); secrets.clearHost(); SyncJobService.cancel(this) }
            useScope(null)
            cancelPreviousNotifications(identity, null)
            restartUpdateSubscription()
            activeConversation = null
            JSONObject().put("loggedIn", false).put("serverRevoked", revoked)
        }
        "sync.run" -> {
            val identity = secrets.host() ?: throw ApiFailure(401, "LOGIN_REQUIRED")
            val epoch = accountEpoch.get()
            val result = try { SyncManager(store, api, attachments).syncOnce(identity,
                { !closed.get() && !accountTransition.get() && epoch == accountEpoch.get() &&
                    secrets.host() == identity }) } catch (error: Exception) {
                note("sync", "同步未完成", "本机记录仍保留，请检查连接后重试", scope = owner(identity) ?: "local")
                throw error
            }
            if (result.uploaded > 0 || result.downloaded > 0) emitForAccount(epoch, "sync.finished",
                JSONObject().put("uploaded", result.uploaded).put("downloaded", result.downloaded))
            JSONObject().put("uploaded", result.uploaded).put("downloaded", result.downloaded).put("hasMore", result.hasMore)
        }
        "sync.status" -> {
            requireHost()
            JSONObject().put("backgroundSync", SyncJobService.status(this))
        }
        "host.business" -> {
            val host = secrets.host() ?: throw ApiFailure(401, "LOGIN_REQUIRED")
            val result = api.business(host, params.getString("path"), params.optString("method", "GET"),
                params.optJSONObject("body"))
            require(result.toString().length <= 256 * 1024)
            publicBusiness(result) as JSONObject
        }
        "updates.status" -> uiState(bundles.state())
        "updates.preference" -> {
            val scope = owner(requireHost())!!
            if (params.has("autoEnabled")) {
                val enabled = params.getBoolean("autoEnabled")
                ensureOpen()
                check(updatePrefs.edit().putBoolean("auto:$scope", enabled).commit())
                if (enabled) scheduleStagedApply()
            }
            JSONObject().put("autoEnabled", autoUpdates(scope))
        }
        "updates.check" -> {
            val host = secrets.host() ?: throw ApiFailure(401, "LOGIN_REQUIRED")
            val checked = bundles.check(host)
            if (checked.staged != null) scheduleStagedApply()
            uiState(checked)
        }
        "updates.apply" -> {
            if (busy.get() || uiHasDraft || params.optBoolean("hasDraft", false)) throw ApiFailure(409, "UPDATE_DEFERRED")
            val result = uiState(bundles.apply())
            runOnUiThread { loadPage() }
            result
        }
        "updates.rollback" -> {
            if (busy.get() || uiHasDraft || params.optBoolean("hasDraft", false)) throw ApiFailure(409, "UPDATE_DEFERRED")
            val result = uiState(bundles.rollback())
            runOnUiThread { loadPage() }
            result
        }
        "updates.retryRejected" -> {
            bundles.retryRejected()
            JSONObject().put("ready", true)
        }
        "compat.openNative" -> { runOnUiThread { startActivity(Intent(this, MainActivity::class.java)) }; JSONObject() }
        else -> throw ApiFailure(404, "METHOD_UNKNOWN")
    }

    private fun modelView(profile: ModelSettings, selected: Boolean? = null) = JSONObject().put("source", "phone")
        .put("endpoint", profile.endpoint).put("modelId", profile.modelId)
        .put("displayName", profile.displayName).put("selected", selected ?: secrets.model()?.let {
            it.endpoint == profile.endpoint && it.modelId == profile.modelId
        } ?: false)

    private fun pickAttachment(params: JSONObject): JSONObject {
        if (accountTransition.get()) throw ApiFailure(409, "ACCOUNT_SWITCHING")
        val scope = owner(requireHost()) ?: throw ApiFailure(401, "LOGIN_REQUIRED")
        val kind = params.getString("kind")
        if (kind !in setOf("image", "file")) throw ApiFailure(400, "ATTACHMENT_INVALID")
        val conversationId = params.optString("conversationId")
        if (conversationId.isNotEmpty() && !attachmentScopeAllowed(requireHost(), conversationId))
            throw ApiFailure(404, "SESSION_UNAVAILABLE")
        val attempt = AttachmentPickAttempt("pick-${UUID.randomUUID()}", scope, conversationId,
            accountEpoch.get(), pageGeneration, activeConversation, kind,
            if (params.has("viewGeneration")) params.optInt("viewGeneration") else null)
        synchronized(this) {
            if (pendingAttachment != null) throw ApiFailure(409, "ATTACHMENT_PICK_IN_PROGRESS")
            pendingAttachment = attempt
        }
        runOnUiThread {
            if (!attachmentPickCurrent(attempt, accountEpoch.get(), pageGeneration, activeConversation,
                    currentAttachmentOwner())) {
                clearAttachmentPick(attempt)
                return@runOnUiThread
            }
            try {
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = if (kind == "image") "image/*" else "text/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, if (kind == "image")
                        arrayOf("image/png", "image/jpeg", "image/webp", "image/gif")
                        else arrayOf("text/plain", "text/markdown"))
                }
                @Suppress("DEPRECATION")
                startActivityForResult(intent, ATTACHMENT_REQUEST)
            } catch (_: Exception) {
                clearAttachmentPick(attempt)
                emitAttachmentResult(attempt, "failed", errorCode = "ATTACHMENT_PICK_UNAVAILABLE")
            }
        }
        return JSONObject().put("pending", true).put("requestId", attempt.requestId)
    }

    private fun attachmentScopeAllowed(host: HostIdentity, conversationId: String): Boolean {
        val scope = owner(host) ?: return false
        if (store.listConversations(scope).any { it.id == conversationId }) return true
        if (!conversationId.matches(Regex("session-[0-9a-f-]{36}"))) return false
        var shared = store.sharedSession(scope, host.hostId, conversationId)
        if (shared == null) {
            val listing = sharedChat.sessions(host)
            if (!listing.optBoolean("hostAvailable")) return false
            shared = store.sharedSession(scope, host.hostId, conversationId)
        }
        return shared?.optBoolean("sendAvailable") == true
    }

    private fun clearAttachmentPick(attempt: AttachmentPickAttempt) {
        synchronized(this) { if (pendingAttachment === attempt) pendingAttachment = null }
    }

    private fun currentAttachmentOwner(): String? = try { owner(secrets.host()) } catch (_: Exception) { null }

    private fun emitAttachmentResult(attempt: AttachmentPickAttempt, status: String,
        attachment: JSONObject? = null, errorCode: String? = null) {
        val body = attachmentResultBody(attempt, status, attachment, errorCode)
        val message = JSONObject().put("event", "attachment.result").put("data", body).toString()
        AccountEventGate.post(attempt.epoch, accountEpoch::get, { action -> runOnUiThread { action() } }) {
            if (!closed.get() && pageGeneration == attempt.page && activeConversation == attempt.activeAtStart)
                try { events?.postMessage(message) } catch (_: Exception) { }
        }
    }

    private fun settleAttachmentPick(attempt: AttachmentPickAttempt, resultCode: Int, uri: Uri?) {
        try {
            if (!attachmentPickCurrent(attempt, accountEpoch.get(), pageGeneration, activeConversation,
                    currentAttachmentOwner())) return
            if (resultCode != RESULT_OK) {
                emitAttachmentResult(attempt, "cancelled")
                return
            }
            if (uri == null) throw ApiFailure(400, "ATTACHMENT_UNREADABLE")
            val row = attachments.import(uri, attempt.owner, attempt.conversationId, attempt.kind)
            if (!attachmentPickCurrent(attempt, accountEpoch.get(), pageGeneration, activeConversation,
                    currentAttachmentOwner())) {
                try { attachments.remove(attempt.owner, row.id) } catch (_: Exception) { }
                return
            }
            emitAttachmentResult(attempt, "selected", attachment =
                attachments.bridge(attempt.owner, attempt.conversationId, row.id))
        } catch (error: Exception) {
            if (attachmentPickCurrent(attempt, accountEpoch.get(), pageGeneration, activeConversation,
                    currentAttachmentOwner()))
                emitAttachmentResult(attempt, "failed", errorCode = if (error is ApiFailure) error.safeCode
                    else "ATTACHMENT_UNREADABLE")
        } finally { clearAttachmentPick(attempt) }
    }

    private fun send(params: JSONObject): JSONObject {
        if (accountTransition.get()) throw ApiFailure(409, "ACCOUNT_SWITCHING")
        requireHost()
        val text = params.getString("text").trim()
        val attachmentIds = params.optJSONArray("attachmentIds")?.let { array ->
            (0 until array.length()).map { index -> array.getString(index) }
        } ?: emptyList()
        if ((text.isBlank() && attachmentIds.isEmpty()) || text.length > 16_384) throw ApiFailure(400, "MESSAGE_INVALID")
        if (!busy.compareAndSet(false, true)) throw ApiFailure(409, "TURN_RUNNING")
        val turnEpoch = accountEpoch.get()
        data class Setup(val host: HostIdentity?, val owner: String?, val profile: HostChoice?,
            val configured: ModelSettings?, val conversationId: String, val files: List<ChatAttachment>)
        val setup = try {
            val host = secrets.host()
            val owner = owner(host)
            val hostProfile = hostChoice(host)
            val configured = if (hostProfile == null) secrets.model(owner ?: "local") else ModelSettings(
                "${host!!.origin}/personal/v1/models/${hostProfile.profileId}/chat/completions",
                hostProfile.modelId, "", hostProfile.name)
            val requestedId = params.optString("conversationId").takeIf { it.isNotBlank() }
            if (attachmentIds.isNotEmpty() && hostProfile != null) throw ApiFailure(415, "HOST_ATTACHMENTS_UNSUPPORTED")
            if (attachmentIds.isNotEmpty() && configured == null) throw ApiFailure(409, "MODEL_NOT_CONFIGURED")
            if (requestedId != null && store.listConversations(owner).none { it.id == requestedId })
                throw ApiFailure(404, "SESSION_UNAVAILABLE")
            val draftFiles = if (attachmentIds.isNotEmpty())
                attachments.get(owner!!, requestedId ?: "", attachmentIds) else emptyList()
            if (draftFiles.any { it.kind == "image" } && !supportsAttachmentImage(configured!!))
                throw ApiFailure(415, "MODEL_IMAGE_UNSUPPORTED")
            ensureOpen()
            val conversationId =
            if (requestedId == null) store.createConversation(text.take(40), owner).id
            else {
                if (store.listConversations(owner).none { it.id == requestedId }) throw ApiFailure(404, "SESSION_UNAVAILABLE")
                requestedId
            }
            if (requestedId == null && draftFiles.isNotEmpty()) attachments.claimDraft(owner!!, attachmentIds, conversationId)
            Setup(host, owner, hostProfile, configured, conversationId,
                if (draftFiles.isNotEmpty()) attachments.get(owner!!, conversationId, attachmentIds) else emptyList())
        } catch (error: Exception) { busy.set(false); throw error }
        val (host, owner, hostProfile, configured, conversationId, files) = setup
        activeTurnScope = owner ?: "local"
        data class SavedTurn(val turnId: String, val messageId: String)
        val saved = try {
            ensureOpen()
            val note = if (files.none { it.kind == "file" }) "" else
                "\n[本机文件：${files.filter { it.kind == "file" }.joinToString("、") { it.name }}]"
            val recordText = (text + note).trim()
            if (recordText.length > 16_384) throw ApiFailure(413, "MESSAGE_TOO_LARGE")
            val messageId = store.addMessage(conversationId, "user", recordText,
                thumbnails = attachments.messageThumbnails(owner!!, conversationId, files),
                images = files.filter { it.kind == "image" })
            ensureOpen()
            val started = store.startTurn(conversationId)
            if (files.isNotEmpty()) try { attachments.recordAttempt(owner!!, conversationId, attachmentIds, started, store) }
                catch (error: Exception) {
                    store.finishTurn(started, "failed", "ATTACHMENT_STORAGE_ERROR")
                    throw error
                }
            SavedTurn(started, messageId)
        } catch (error: Exception) { busy.set(false); throw error }
        val turnId = saved.turnId
        host?.let { queueSync(it, turnEpoch, conversationId) }
        activeConversation = conversationId
        stopped = false
        emitForAccount(turnEpoch, "chat.started", JSONObject().put("conversationId", conversationId).put("turnId", turnId)
            .put("messageId", saved.messageId).put("userText", text))
        try { modelWorker.execute {
            var reservationRequestId: String? = null
            var renewal: ScheduledFuture<*>? = null
            var actualModel: JSONObject? = null
            val stillCurrent = { !closed.get() && !accountTransition.get() &&
                turnEpoch == accountEpoch.get() && secrets.host() == host && !stopped }
            try {
                ensureOpen()
                if (stopped) throw ModelCancelled()
                if (host != null) {
                    when (val route = conversationHandoff.routeNewUserTurn(host, conversationId,
                        turnId, saved.messageId, stillCurrent)) {
                        is ConversationSendRoute.Host -> {
                            if (files.isNotEmpty()) throw ApiFailure(415, "HOST_ATTACHMENTS_UNSUPPORTED")
                            store.finishTurn(turnId, "interrupted")
                            queueSync(host, turnEpoch, conversationId)
                            sharedChat.sessions(host)
                            val sent = sharedChat.submit(host, route.sessionId, route.acceptedText, "session.message",
                                "phone-sync:${route.sourceSyncEventId}", sourceSyncEventId = route.sourceSyncEventId,
                                current = stillCurrent)
                            emitForAccount(turnEpoch, "chat.delegated", JSONObject()
                                .put("conversationId", conversationId).put("sessionId", route.sessionId)
                                .put("sourceSyncEventId", route.sourceSyncEventId)
                                .put("requestId", sent.optString("requestId"))
                                .put("state", sent.optString("state")))
                            return@execute
                        }
                        is ConversationSendRoute.Unconfirmed ->
                            throw ApiFailure(409, "CONVERSATION_ROUTING_UNCONFIRMED")
                        is ConversationSendRoute.Phone -> if (route.reserved) {
                            reservationRequestId = route.requestId
                            val requestId = route.requestId!!
                            renewal = localTurnRenewWorker.scheduleAtFixedRate({
                                if (!stillCurrent()) return@scheduleAtFixedRate
                                if (!conversationHandoff.renew(host, conversationId, turnId,
                                        requestId, stillCurrent)) {
                                    stopped = true
                                    activeModel?.cancel()
                                }
                            }, 10, 10, TimeUnit.SECONDS)
                        }
                    }
                }
                if (configured == null) throw ApiFailure(409, "MODEL_NOT_CONFIGURED")
                val guardedTools = object : DeviceToolExecutor {
                    private val device = DeviceTools(this@HybridActivity)
                    override fun execute(name: String, arguments: JSONObject): ToolResult {
                        if (turnEpoch != accountEpoch.get() || stopped) throw ModelCancelled()
                        return device.execute(name, arguments)
                    }
                }
                val client = ModelClient(this, if (hostProfile == null) JsonHttp() else api.hostModelTransport(host!!),
                    guardedTools)
                activeModel = client
                if (stopped) client.cancel()
                var lastProgressAt = 0L
                var lastProgressLength = 0
                val answer = client.complete(configured, store.messages(conversationId, owner),
                    receipt = { callId, name, status, summary ->
                        ensureOpen()
                        store.toolReceipt(conversationId, callId, name, status, summary)
                        emitForAccount(turnEpoch, "tool.receipt", JSONObject().put("conversationId", conversationId).put("toolName", name)
                            .put("status", status).put("summary", summary))
                    }, onProgress = { partial ->
                        val now = android.os.SystemClock.elapsedRealtime()
                        if (now-lastProgressAt >= 60 || partial.length-lastProgressLength >= 512) {
                            lastProgressAt = now; lastProgressLength = partial.length
                            emitForAccount(turnEpoch, "chat.progress", JSONObject().put("conversationId", conversationId)
                                .put("turnId", turnId).put("text", partial))
                        }
                    }, onPhase = { phase ->
                        emitForAccount(turnEpoch, "chat.phase", JSONObject().put("conversationId", conversationId)
                            .put("turnId", turnId).put("phase", phase))
                    }, attachments = files, attachmentStore = attachments,
                    onRequestStart = { requestUrl, actualModelId ->
                        actualModel = actualOriginalModel(requestUrl, actualModelId, configured, hostProfile)
                    })
                if (stopped) throw ModelCancelled(answer)
                ensureOpen()
                store.addMessage(conversationId, "assistant", answer, turnId)
                ensureOpen()
                store.finishTurn(turnId, "completed", originalModel = actualModel)
                if (files.isNotEmpty()) try { attachments.markUsed(owner!!, conversationId, attachmentIds, turnId, store) }
                    catch (_: Exception) { emitForAccount(turnEpoch, "storage.error", JSONObject()) }
                host?.let { queueSync(it, turnEpoch, conversationId) }
                note("reply", "回复已完成", "点此回到对话查看", conversationId, owner ?: "local")
                emitForAccount(turnEpoch, "chat.finished", JSONObject().put("conversationId", conversationId).put("turnId", turnId)
                    .put("status", "completed").put("text", answer))
            } catch (error: Exception) {
                if (closed.get()) return@execute
                val status = if (error is ModelCancelled || stopped) "cancelled" else "failed"
                val partial = (when (error) {
                    is ModelCancelled -> error.partialText
                    is ModelNotCompleted -> error.partialText
                    else -> ""
                }).trim().take(16_384)
                if (partial.isNotBlank()) try {
                    store.addMessage(conversationId, "assistant", partial, turnId)
                } catch (_: Exception) { }
                val code = if (status == "failed") safeCode(error) else null
                val upstreamStatus = if (status == "failed") upstreamHttpStatus(error) else null
                try { store.finishTurn(turnId, status, code, upstreamStatus, actualModel) } catch (_: Exception) { }
                val finished = JSONObject().put("conversationId", conversationId).put("turnId", turnId)
                    .put("status", status).put("partialSaved", partial.isNotBlank())
                    .put("errorCode", code ?: "")
                if (code == "CONVERSATION_ROUTING_UNCONFIRMED") finished.put("retryText", text)
                if (upstreamStatus != null) finished.put("upstreamHttpStatus", upstreamStatus)
                emitForAccount(turnEpoch, "chat.finished", finished)
                if (status == "failed") note("reply", "回复未完成", "点此查看状态与重试", conversationId,
                    owner ?: "local")
            } finally {
                renewal?.cancel(false)
                if (host != null && reservationRequestId != null) {
                    val finished = conversationHandoff.finish(host, conversationId, turnId,
                        reservationRequestId!!, { !closed.get() && !accountTransition.get() &&
                            turnEpoch == accountEpoch.get() && secrets.host() == host })
                    if (!finished) emitForAccount(turnEpoch, "chat.reservation.uncertain", JSONObject()
                        .put("conversationId", conversationId).put("turnId", turnId))
                }
                activeModel = null
                activeTurnScope = null
                busy.set(false)
                if (turnEpoch != accountEpoch.get()) emit("account.retired", JSONObject())
                scheduleStagedApply()
            }
        } } catch (_: RejectedExecutionException) {
            activeTurnScope = null
            busy.set(false)
            throw ApiFailure(503, "SERVICE_CLOSING")
        }
        return JSONObject().put("conversationId", conversationId).put("turnId", turnId)
            .put("messageId", saved.messageId).put("accepted", true).put("source", "phone")
    }

    private fun queueSync(host: HostIdentity, epoch: Long, conversationId: String?) {
        try { syncWorker.execute {
            try { val result = SyncManager(store, api, attachments).syncOnce(host,
                { !closed.get() && !accountTransition.get() && accountEpoch.get() == epoch &&
                    secrets.host() == host })
                if (result.uploaded > 0 || result.downloaded > 0) {
                    val data = JSONObject().put("uploaded", result.uploaded).put("downloaded", result.downloaded)
                    if (conversationId != null) data.put("conversationId", conversationId)
                    emitForAccount(epoch, "sync.finished", data)
                }
            }
            catch (_: Exception) { /* Durable outbox retries via the scheduled Job and manual sync. */ }
        } } catch (_: RejectedExecutionException) { }
    }

    override fun onBackPressed() {
        if (!closed.get()) web.evaluateJavascript("window.dispatchEvent(new Event('weft-back'))", null)
    }

    override fun onResume() { super.onResume(); if (closed.get()) return; foreground = true; checkForUpdate(); restartUpdateSubscription(); scheduleSharedReconcile();
        preferHighDisplayRefreshRate()
        secrets.host()?.let { queueSync(it, accountEpoch.get(), null) } }

    @Suppress("DEPRECATION")
    private fun preferHighDisplayRefreshRate() {
        val screen = windowManager.defaultDisplay
        val current = screen.mode
        val preferred = selectPreferredRefreshRate(current.physicalWidth, current.physicalHeight,
            screen.supportedModes.map { DisplayRefreshMode(it.physicalWidth, it.physicalHeight, it.refreshRate) })
            ?: 0f
        val attributes = window.attributes
        if (abs(attributes.preferredRefreshRate - preferred) < 0.01f) return
        attributes.preferredRefreshRate = preferred
        window.attributes = attributes
    }
    override fun onPause() {
        foreground = false
        updateSubscriptionEpoch.incrementAndGet()
        updateConnection.getAndSet(null)?.disconnect()
        super.onPause()
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (closed.get()) return
        setIntent(intent)
        val id = intent.getStringExtra("conversationId")?.takeIf { it.isNotBlank() }
        val notificationScope = intent.getStringExtra("ownerScope")
        if (id != null && notificationScope == (owner(secrets.host()) ?: "local"))
            emit("navigation.conversation", JSONObject().put("conversationId", id))
        else if (id != null) emit("notification.otherAccount", JSONObject())
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (closed.get()) return
        applySystemBars()
        web.requestLayout()
        emit("theme.system", JSONObject().put("dark",
            (newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES))
    }

    @Deprecated("Runtime permission callback")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (closed.get()) return
        if (requestCode == NOTIFY_REQUEST) emit("notifications.permission", notices().state())
    }

    private fun startArtifactSave(host: HostIdentity, params: JSONObject): JSONObject {
        val artifactId = params.getString("artifactId")
        if (!artifactId.matches(Regex("[A-Za-z0-9_-]{1,128}"))) throw ApiFailure(400, "INVALID_REQUEST")
        val record = api.artifactPreview(host, artifactId).optJSONObject("artifact")
            ?: throw ApiFailure(502, "ARTIFACT_UNVERIFIED")
        val fileName = record.optString("fileName")
        val sha = record.optString("sha256")
        val size = record.optInt("size", -1)
        if (record.optString("artifactId") != artifactId || record.optString("state") != "observed" ||
            record.optJSONObject("verification")?.optString("status") != "observed" ||
            !fileName.matches(Regex("[^\\p{Cntrl}/\\\\]{1,180}")) ||
            size !in 1..131072 || !sha.matches(Regex("[0-9a-fA-F]{64}")))
            throw ApiFailure(409, "ARTIFACT_UNVERIFIED")
        val mimeType = when {
            fileName.endsWith(".md", ignoreCase = true) -> "text/markdown"
            fileName.endsWith(".txt", ignoreCase = true) -> "text/plain"
            else -> throw ApiFailure(409, "ARTIFACT_UNVERIFIED")
        }
        val attempt = synchronized(this) {
            if (pendingArtifactSave != null) throw ApiFailure(409, "ARTIFACT_SAVE_IN_PROGRESS")
            ArtifactSaveAttempt(UUID.randomUUID().toString(), owner(host)!!, accountEpoch.get(),
                artifactId, fileName, size, sha.lowercase()).also { pendingArtifactSave = it }
        }
        runOnUiThread {
            if (!artifactSaveCurrent(attempt)) { if (pendingArtifactSave === attempt) pendingArtifactSave = null; return@runOnUiThread }
            try {
                val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = mimeType
                    putExtra(Intent.EXTRA_TITLE, fileName)
                }
                @Suppress("DEPRECATION")
                startActivityForResult(intent, ARTIFACT_SAVE_REQUEST)
            } catch (_: Exception) {
                if (pendingArtifactSave === attempt) pendingArtifactSave = null
                emitArtifactSave(attempt, "failed", "ARTIFACT_SAVE_UNAVAILABLE")
            }
        }
        return JSONObject().put("pending", true).put("requestId", attempt.requestId)
    }

    private fun artifactSaveCurrent(attempt: ArtifactSaveAttempt): Boolean =
        !closed.get() && !accountTransition.get() && accountEpoch.get() == attempt.epoch &&
            owner(secrets.host()) == attempt.owner

    private fun emitArtifactSave(attempt: ArtifactSaveAttempt, status: String, code: String? = null) {
        val body = JSONObject().put("requestId", attempt.requestId).put("artifactId", attempt.artifactId)
            .put("status", status)
        if (code != null) body.put("code", code)
        emitForAccount(attempt.epoch, "artifact.save", body)
    }

    private fun settleArtifactSave(attempt: ArtifactSaveAttempt, uri: Uri) {
        var saved = false
        try {
            if (!artifactSaveCurrent(attempt)) return
            val host = requireHost()
            val bytes = api.artifactBytes(host, attempt.artifactId)
            val hash = MessageDigest.getInstance("SHA-256")
                .digest(bytes).joinToString("") { "%02x".format(it) }
            if (bytes.size != attempt.size || hash != attempt.sha256) throw ApiFailure(409, "ARTIFACT_CHANGED")
            if (!artifactSaveCurrent(attempt)) return
            contentResolver.openOutputStream(uri, "w")?.use { it.write(bytes) }
                ?: throw ApiFailure(500, "ARTIFACT_SAVE_FAILED")
            if (!artifactSaveCurrent(attempt)) return
            val digest = MessageDigest.getInstance("SHA-256")
            var readSize = 0
            contentResolver.openInputStream(uri)?.use { input ->
                val buffer = ByteArray(4096)
                while (true) {
                    if (!artifactSaveCurrent(attempt)) return
                    val n = input.read(buffer)
                    if (n < 0) break
                    readSize += n
                    if (readSize > 131072) throw ApiFailure(409, "ARTIFACT_CHANGED")
                    digest.update(buffer, 0, n)
                }
            } ?: throw ApiFailure(500, "ARTIFACT_SAVE_FAILED")
            val readHash = digest.digest().joinToString("") { "%02x".format(it) }
            if (readSize != attempt.size || readHash != attempt.sha256)
                throw ApiFailure(409, "ARTIFACT_CHANGED")
            if (!artifactSaveCurrent(attempt)) return
            saved = true
            emitArtifactSave(attempt, "saved")
        } catch (error: Exception) {
            if (artifactSaveCurrent(attempt)) emitArtifactSave(attempt, "failed", safeCode(error))
        } finally {
            if (!saved) try { android.provider.DocumentsContract.deleteDocument(contentResolver, uri) }
                catch (_: Exception) { }
        }
    }

    @Deprecated("System recognition activity uses the platform result callback")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (closed.get()) return
        if (requestCode == ARTIFACT_SAVE_REQUEST) {
            val attempt = pendingArtifactSave ?: return
            pendingArtifactSave = null
            if (resultCode != RESULT_OK || data?.data == null) {
                emitForAccount(attempt.epoch, "artifact.save", JSONObject().put("requestId", attempt.requestId)
                    .put("status", "cancelled")); return
            }
            try { attachmentWorker.execute { settleArtifactSave(attempt, data.data!!) } }
            catch (_: RejectedExecutionException) { emitArtifactSave(attempt, "failed", "OPERATION_FAILED") }
            return
        }
        if (requestCode == ATTACHMENT_REQUEST) {
            val attempt = pendingAttachment ?: return
            if (!attempt.resultReceived.compareAndSet(false, true)) return
            try { attachmentWorker.execute { settleAttachmentPick(attempt, resultCode, data?.data) } }
            catch (_: RejectedExecutionException) { clearAttachmentPick(attempt) }
            return
        }
        if (requestCode == AVATAR_REQUEST) {
            val scope = pendingAvatarScope ?: return
            val epoch = pendingAvatarEpoch
            pendingAvatarScope = null
            val uri = data?.data
            if (resultCode != RESULT_OK || uri == null) { emit("profile.photo", JSONObject().put("status", "cancelled")); return }
            try { worker.execute {
                try {
                    ensureOpen()
                    val host = secrets.host()
                    if (owner(host) != scope || accountEpoch.get() != epoch) {
                        emit("profile.photo", JSONObject().put("status", "stale")); return@execute
                    }
                    val avatar = readAvatar(uri)
                    ensureOpen()
                    val current = profileFor(host!!)
                    ensureOpen()
                    val profile = rememberProfile(host, api.updateProfile(host, current.getLong("profileRevision"), null, avatar, true))
                    emitForAccount(epoch, "profile.photo", JSONObject().put("status", "saved").put("profile", profile))
                } catch (error: Exception) {
                    val code = if (error is ApiFailure) error.safeCode else "PHOTO_UNREADABLE"
                    emitForAccount(epoch, "profile.photo", JSONObject().put("status", "failed").put("code", code))
                }
            } } catch (_: RejectedExecutionException) { }
            return
        }
        if (requestCode != SPEECH_REQUEST) return
        val (attempt, viewGeneration) = pendingSpeech ?: return
        pendingSpeech = null
        val recognized = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        val currentOwner = try { owner(secrets.host()) } catch (_: Exception) { null }
        val result = SpeechDraftGate.settle(attempt, currentOwner, activeConversation,
            pageGeneration, viewGeneration, !busy.get(), resultCode == RESULT_OK, recognized, "")
        val outcome = when (result) {
            is SpeechDraftResult.Text -> "text"
            SpeechDraftResult.Cancelled -> "cancelled"
            SpeechDraftResult.Empty -> "empty"
            SpeechDraftResult.TooLong -> "too_long"
            SpeechDraftResult.Stale -> "stale"
        }
        val body = JSONObject().put("outcome", outcome).put("viewGeneration", viewGeneration)
            .put("conversationId", attempt.conversationId ?: "")
        if (result is SpeechDraftResult.Text) body.put("text", result.draft)
        emit("voice.result", body)
    }

    override fun onDestroy() {
        closed.set(true)
        stopped = true
        activeModel?.cancel()
        if (::bundles.isInitialized) bundles.close()
        events = null
        if (::web.isInitialized) {
            try { if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))
                WebViewCompat.removeWebMessageListener(web, "weftNative") } catch (_: Exception) { }
            web.webViewClient = WebViewClient()
        }
        worker.shutdownNow()
        attachmentWorker.shutdownNow()
        syncWorker.shutdownNow()
        localTurnRenewWorker.shutdownNow()
        modelWorker.shutdownNow()
        updateConnection.getAndSet(null)?.disconnect()
        updateWorker.shutdownNow()
        streamWorker.shutdownNow()
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }
}
