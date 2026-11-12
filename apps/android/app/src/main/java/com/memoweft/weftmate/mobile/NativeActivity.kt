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
    internal val core by lazy { NativeCore(this) }
    internal lateinit var settings: NativeSettingsModel
    internal lateinit var health: NativeHealthModel
    internal lateinit var pages: NativePageModel
    internal var nativeFile by mutableStateOf<JSONObject?>(null)
    private val qrPicker by lazy { NativeQrPicker(this) }
    internal var embeddedWebIdentity by mutableStateOf<WebView?>(null)
        private set
    private var timelineMapperInstalled=false
    internal suspend fun timelinePresentation(events: List<JSONObject>, approvals: List<JSONObject>, questions: List<JSONObject>): List<JSONObject> {
        // A shell upgrade may reopen the previous downloaded UI bundle. Load
        // the same shipped shared mapper when that bundle predates this view.
        while (true) {
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
            val script = "JSON.stringify(WeftUiCore.nativeTimelineRows(${org.json.JSONArray(events)},${org.json.JSONArray(approvals)},${org.json.JSONArray(questions)}))"
            val value = suspendCancellableCoroutine<String> { continuation ->
                embeddedWeb.evaluateJavascript(script) { if (continuation.isActive) continuation.resumeWith(Result.success(it)) }
            }
            // The engine reloads on login, account switch and UI bundle updates; wait for it to boot again.
            if (value == "null") { timelineMapperInstalled = false; delay(50); continue }
            return org.json.JSONArray(org.json.JSONArray("[$value]").getString(0)).objects()
        }
    }
    internal suspend fun phonePresentation(action: String, params: JSONObject = JSONObject()): JSONObject {
        val token = java.util.UUID.randomUUID().toString()
        val key = JSONObject.quote(token)
        embeddedWeb.evaluateJavascript("""
          (()=>{window.weftPhoneResults??={};const result=window.weftPhoneResults;result[$key]=null;
          Promise.resolve(globalThis.WeftPhone?.presentation(${JSONObject.quote(action)},$params) || {ready:false})
            .then(value=>{const style=getComputedStyle(document.documentElement),custom=document.documentElement.dataset.accent!=='neutral';Object.assign(value,{palette:custom?{accent:style.getPropertyValue('--accent').trim(),soft:style.getPropertyValue('--accent-soft').trim()}:{},fontSize:typeof mobileAppearanceStore==='undefined'?${DesignTokens.font15}:mobileAppearanceStore.value.fontSize,codeFontSize:typeof mobileAppearanceStore==='undefined'?${DesignTokens.font13}:mobileAppearanceStore.value.codeFontSize,reducedMotion:globalThis.WeftReplyMotion?.reduced===true});if(Object.hasOwn(result,$key))result[$key]={value}}).catch(()=>{if(Object.hasOwn(result,$key))result[$key]={error:true}});})()
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
        model.dark = resolvedAppearanceDark(savedAppearance(this), systemAppearanceDark())
        feed = NativeFeedModel(model, this)
        goals = NativeGoalsModel(model, this)
        settings = NativeSettingsModel(model, this)
        health = NativeHealthModel(model)
        pages = NativePageModel(this,model)
        nativeObserver = { type, data -> model.event(type, data); feed.event(type, data); goals.event(type, data); health.event(type)
            if(type=="profile.photo") {settings.refresh();if(pages.page=="profile")pages.refresh()}
        }
        // Compose owns system/IME insets; the embedded page receives a zero local safe area.
        presentationContainer.setPadding(0, 0, 0, 0)
        ViewCompat.setOnApplyWindowInsetsListener(presentationContainer) { _, insets -> insets }
        parkWeb()
        presentationContainer.addView(ComposeView(this).apply {
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            setContent { NativeShell(model, this@NativeActivity) }
        }, ViewGroup.LayoutParams(-1, -1))
        model.start()
    }
    override fun embeddedPageFinished() {
        timelineMapperInstalled = false
        embeddedWebIdentity = embeddedWeb
        parkWeb()
    }
    internal fun parkWeb() {
        coveredHostHistory = true
        val web = embeddedWeb
        (web.parent as? ViewGroup)?.removeView(web)
        // Keep the shared phone engine attached, but stop painting the covered web UI.
        // evaluateJavascript/native events still drive the existing account/vault engine.
        web.visibility = android.view.View.INVISIBLE
        web.evaluateJavascript("window.weftNativeRoute=null;window.weftNativeChatActive=true;if(typeof stopSharedPoll==='function')stopSharedPoll();if(typeof uiCore!=='undefined')uiCore.connectionVisibility(true)", null)
        presentationContainer.addView(web, 0, ViewGroup.LayoutParams(-1, -1))
    }
    internal fun showLogin() { if (::model.isInitialized) model.loggedIn = false }
    internal fun hideKeyboard() { (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(presentationContainer.windowToken, 0) }
    internal suspend fun scanPairing() = qrPicker.pick()
    @Suppress("DEPRECATION") override fun onActivityResult(requestCode:Int,resultCode:Int,data:Intent?) {
        super.onActivityResult(requestCode,resultCode,data)
        qrPicker.result(requestCode,resultCode,data)
    }
    internal fun openNativeFile(file:JSONObject) { nativeFile=file }
    internal suspend fun openNativeSource(source:JSONObject) {
        if(source.stringOrEmpty("phoneId").isNotBlank()) {
            model.refreshChats()
            model.chats.find{it.optString("chatId",it.optString("id"))==source.getString("phoneId")}?.let{model.select(it)} ?: throw IllegalStateException("原话对话暂时找不到，请在全部对话中查看。")
            model.tab="chat";return
        }
        val host=source.stringOrEmpty("hostId")
        if(host.isNotBlank()) {
            core.call("await uiCore.selectExecutionComputer(${JSONObject.quote(host)});return {};")
            model.bootstrap()
        }
        var id=source.stringOrEmpty("chatId")
        if(id.isBlank()&&source.stringOrEmpty("sessionId").isNotBlank())id=model.business("/sessions/${source.getString("sessionId")}/chat").stringOrEmpty("chatId")
        if(id.isBlank()) {model.returnToChat();return}
        val row=model.business("/chats/$id").getJSONObject("chat")
        model.select(row)
        if(source.has("seq")||source.stringOrEmpty("eventId").isNotBlank())model.locateActivityTarget(source)
        model.tab="chat"
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
            BackAction.Page -> pages.back()
            BackAction.Settings -> settings.back()
            BackAction.CloseHealthCalendar -> health.calendarOpen = false
            BackAction.HealthHome -> health.home()
            BackAction.CloseGoalsDetail -> goals.closeDetail()
            BackAction.CloseFeedDetail -> feed.closeDetail()
            BackAction.ToChat -> model.returnToChat()
            BackAction.Leave -> moveTaskToBack(true)
        }
    }
    override fun onDestroy() { if (::pages.isInitialized) pages.reset(); if (::settings.isInitialized) settings.close(); if (::health.isInitialized) health.close(); if (::goals.isInitialized) goals.close(); if (::feed.isInitialized) feed.close(); if (::model.isInitialized) model.close(); nativeObserver = null; nativeScope.cancel(); super.onDestroy() }
}
