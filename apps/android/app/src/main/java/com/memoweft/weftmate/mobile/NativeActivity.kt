package com.memoweft.weftmate.mobile

import android.content.Intent
import android.os.Bundle
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.core.view.ViewCompat
import kotlinx.coroutines.*
import org.json.JSONObject

/** Default shell. HybridActivity remains the same business implementation and a complete rollback entry. */
class NativeActivity : HybridActivity() {
    internal val fileActions = NativeFileActions(this)
    private val nativeScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    internal var nativeForeground = false
    internal lateinit var model: NativeChatModel
    internal lateinit var feed: NativeFeedModel
    internal lateinit var goals: NativeGoalsModel
    internal lateinit var settings: NativeSettingsModel
    internal lateinit var health: NativeHealthModel
    internal var embeddedFeedLoaded: (() -> Unit)? = null
    internal var embeddedWebIdentity by mutableStateOf<WebView?>(null)
        private set
    internal var displayedFeedWeb: WebView? = null
    private var webRoute="login"
    private var webEmbedded=false
    private var timelineMapperInstalled=false
    internal suspend fun timelinePresentation(events: List<JSONObject>, approvals: List<JSONObject>, questions: List<JSONObject>): List<JSONObject> {
        // A shell upgrade may reopen the previous downloaded UI bundle. Load
        // the same shipped shared mapper when that bundle predates this view.
        while(!timelineMapperInstalled) {
            val shared=assets.open("ui-core/timeline-model.js").bufferedReader().use { it.readText() }
            val ready = suspendCancellableCoroutine<Boolean> { continuation ->
                embeddedWeb.evaluateJavascript("(()=>{if(typeof WeftUiCore==='undefined')return false;if(typeof WeftUiCore.approvalCopy!=='function'){$shared}return typeof WeftUiCore.nativeTimelineRows==='function';})()") { value ->
                    if(continuation.isActive) continuation.resumeWith(Result.success(value=="true"))
                }
            }
            timelineMapperInstalled=ready
            if(!ready) delay(50) // The Compose timeline may mount before the embedded core boots.
        }
        return suspendCancellableCoroutine { continuation ->
            val script = "JSON.stringify(WeftUiCore.nativeTimelineRows(${org.json.JSONArray(events)},${org.json.JSONArray(approvals)},${org.json.JSONArray(questions)}))"
            embeddedWeb.evaluateJavascript(script) { value ->
                if (continuation.isActive) continuation.resumeWith(runCatching {
                    org.json.JSONArray(org.json.JSONArray("[$value]").getString(0)).objects()
                })
            }
        }
    }
    internal suspend fun phonePresentation(action: String, params: JSONObject = JSONObject()): JSONObject {
        val token = java.util.UUID.randomUUID().toString()
        val key = JSONObject.quote(token)
        embeddedWeb.evaluateJavascript("""
          (()=>{window.weftPhoneResults??={};const result=window.weftPhoneResults;result[$key]=null;
          Promise.resolve(globalThis.WeftPhone?.presentation(${JSONObject.quote(action)},$params) || {ready:false})
            .then(value=>{Object.assign(value,{fontSize:typeof mobileAppearanceStore==='undefined'?${DesignTokens.font15}:mobileAppearanceStore.value.fontSize,codeFontSize:typeof mobileAppearanceStore==='undefined'?${DesignTokens.font13}:mobileAppearanceStore.value.codeFontSize});if(Object.hasOwn(result,$key))result[$key]={value}}).catch(()=>{if(Object.hasOwn(result,$key))result[$key]={error:true}});})()
        """.trimIndent(), null)
        try { return withTimeout(15000) {
            while (true) {
                val result = suspendCancellableCoroutine<JSONObject?> { continuation ->
                    embeddedWeb.evaluateJavascript("""(()=>{const result=window.weftPhoneResults?.[$key];if(result)delete window.weftPhoneResults[$key];return result||null})()""") { value ->
                        if (continuation.isActive) continuation.resumeWith(Result.success(runCatching { JSONObject(value) }.getOrNull()))
                    }
                }
                if (result != null) {
                    check(!result.optBoolean("error")) { "PHONE_PRESENTATION_FAILED" }
                    return@withTimeout result.getJSONObject("value")
                }
                delay(50)
            }
            @Suppress("UNREACHABLE_CODE") JSONObject()
        } } finally { embeddedWeb.evaluateJavascript("delete window.weftPhoneResults?.[$key]", null) }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        coveredHostHistory = true
        embeddedWebIdentity = embeddedWeb
        // Ignore the retired user preference; rollback is a build-time choice.
        getSharedPreferences("native-ui", MODE_PRIVATE).edit().remove("enabled").apply()
        if (!BuildConfig.NATIVE_UI) {
            startActivity(Intent(this, HybridActivity::class.java).apply { data = intent.data; putExtras(intent) }); finish(); return
        }
        model = NativeChatModel(this, nativeScope)
        feed = NativeFeedModel(model, this)
        goals = NativeGoalsModel(model, this)
        settings = NativeSettingsModel(model, this)
        health = NativeHealthModel(model)
        nativeObserver = { type, data -> model.event(type, data); feed.event(type, data); goals.event(type, data); health.event(type) }
        // Compose owns system/IME insets; the embedded page receives a zero local safe area.
        presentationContainer.setPadding(0, 0, 0, 0)
        ViewCompat.setOnApplyWindowInsetsListener(presentationContainer) { _, insets -> insets }
        presentationContainer.addView(ComposeView(this).apply {
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            setContent { NativeShell(model, this@NativeActivity) }
        }, ViewGroup.LayoutParams(-1, -1))
        model.start()
    }
    internal fun webPage(name: String, embedded: Boolean = true): WebView {
        webRoute=name;webEmbedded=embedded
        coveredHostHistory = name != "chat" && name != "home"
        val web = embeddedWeb
        (web.parent as? ViewGroup)?.removeView(web)
        web.visibility = android.view.View.VISIBLE
        web.evaluateJavascript("window.weftNativeChatActive=false;if(typeof uiCore!=='undefined')uiCore.connectionVisibility(document.visibilityState==='hidden')", null)
        applyWebFrame()
        return web
    }
    override fun embeddedPageFinished() { timelineMapperInstalled=false;embeddedWebIdentity=embeddedWeb;applyWebFrame();if(::model.isInitialized && model.loggedIn && model.tab=="chat")parkWeb();embeddedFeedLoaded?.invoke() }
    internal fun parkWeb() {
        if (!::model.isInitialized || model.tab !in listOf("chat", "activity", "goals", "health", "settings", "models", "library")) return
        coveredHostHistory = true
        val web = embeddedWeb
        (web.parent as? ViewGroup)?.removeView(web)
        // Keep the shared phone engine attached, but stop painting the covered web UI.
        // evaluateJavascript/native events still drive the existing account/vault engine.
        web.visibility = android.view.View.INVISIBLE
        web.evaluateJavascript("window.weftNativeRoute=null;window.weftNativeChatActive=true;if(typeof stopSharedPoll==='function')stopSharedPoll();if(typeof uiCore!=='undefined')uiCore.connectionVisibility(true)", null)
        presentationContainer.addView(web, 0, ViewGroup.LayoutParams(-1, -1))
    }
    private fun applyWebFrame() {
        val web=embeddedWeb
        val name=webRoute
        val embedded=webEmbedded
        val entry = JSONObject().put("name", name).put("embedded", embedded)
            .put("phone", ::model.isInitialized && model.phone)
            .put("kind", if (::model.isInitialized && !model.phone) model.chatKind else "")
            .put("phoneId", if (::model.isInitialized && model.phone) model.chatId.takeUnless { it == "phone-new" } ?: JSONObject.NULL else JSONObject.NULL)
            .put("sessionId", if (::model.isInitialized && !model.phone) model.sessionId else "")
            .put("chatId", if (::model.isInitialized && !model.phone) model.chatId else "")
        val route = assets.open("native-chat-route.js").bufferedReader().use { it.readText() }
        web.evaluateJavascript("$route\nvoid WeftNativeChatRoute($entry);", null)
    }
    internal fun showLogin() { if (::model.isInitialized) model.loggedIn = false }
    internal fun hideKeyboard() { (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(presentationContainer.windowToken, 0) }
    internal fun fallback() {
        getSharedPreferences("native-ui", MODE_PRIVATE).edit().putBoolean("enabled", false).commit()
        startActivity(Intent(this, HybridActivity::class.java)); finish()
    }
    private var originalLibraryFileId=""
    internal fun originalLibrary(fileId:String?=null) {
        originalLibraryFileId=fileId.orEmpty()
        model.tab="library-web"
    }
    internal fun originalLibraryPage():WebView {
        val web=webPage("library")
        web.evaluateJavascript("""openNativeLibraryFile(${JSONObject.quote(originalLibraryFileId)}).catch(()=>toast('文件暂时没能打开，请在成果库重新点开。',true))""",null)
        return web
    }
    internal fun closeOriginalLibrary() {
        embeddedWeb.evaluateJavascript("window.weftNativeLibraryEntry=false;closeResourcePage({restoreFocus:false})",null)
        model.tab="library"
    }
    internal fun originalFile(row:JSONObject) {
        if(row.optString("libraryId").isNotBlank())originalLibrary(row.getString("libraryId"))
        else startActivity(Intent(this,HybridActivity::class.java)
            .putExtra("openOriginalTextFile",row.toString())
            .putExtra("lg1bHostOrigin",intent.getStringExtra("lg1bHostOrigin")))
    }
    override fun onResume() { super.onResume(); nativeForeground = true }
    override fun onPause() { nativeForeground = false; if (::model.isInitialized) model.saveDraft(); super.onPause() }
    @Suppress("DEPRECATION") override fun onBackPressed() {
        // Open menus, the drawer and confirmations register Compose BackHandlers; they go first.
        if (onBackPressedDispatcher.hasEnabledCallbacks()) { onBackPressedDispatcher.onBackPressed(); return }
        if (!::model.isInitialized || !model.loggedIn) { super.onBackPressed(); return }
        val state = BackState(
            healthCalendar = { health.calendarOpen },
            healthAway = { health.view != "today" },
            goalsDetail = { goals.detail != null || goals.draft != null },
            feedDetail = { feed.detail != null },
        )
        when (nativeBack(model.tab, state)) {
            BackAction.CloseLibraryWeb -> closeOriginalLibrary()
            BackAction.Settings -> settings.back()
            BackAction.CloseHealthWeb -> health.closeWeb()
            BackAction.CloseHealthCalendar -> health.calendarOpen = false
            BackAction.HealthHome -> health.home()
            BackAction.CloseGoalsWeb -> goals.closeWeb()
            BackAction.CloseGoalsDetail -> goals.closeDetail()
            BackAction.CloseFeedWeb -> feed.closeWeb()
            BackAction.CloseFeedDetail -> feed.closeDetail()
            BackAction.ToChat -> model.returnToChat()
            BackAction.Leave -> moveTaskToBack(true)
        }
    }
    override fun onDestroy() { if (::settings.isInitialized) settings.close(); if (::health.isInitialized) health.close(); if (::goals.isInitialized) goals.close(); if (::feed.isInitialized) feed.close(); if (::model.isInitialized) model.close(); nativeObserver = null; nativeScope.cancel(); super.onDestroy() }
}
