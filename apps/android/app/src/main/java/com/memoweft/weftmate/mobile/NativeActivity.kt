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
    private val nativeScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    internal var nativeForeground = false
    internal lateinit var model: NativeChatModel
    internal lateinit var feed: NativeFeedModel
    internal var embeddedFeedLoaded: (() -> Unit)? = null
    internal var embeddedWebIdentity by mutableStateOf<WebView?>(null)
        private set
    internal var displayedFeedWeb: WebView? = null
    private var webRoute="login"
    private var webEmbedded=false
    override fun attachBaseContext(base: android.content.Context) {
        if (BuildConfig.DEBUG && base.packageName in setOf("com.memoweft.weftmate.mobile.and4qa", "com.memoweft.weftmate.mobile.and5qa")) {
            val width = base.getSharedPreferences("native-qa", MODE_PRIVATE).getInt("width", 360)
            val configuration = android.content.res.Configuration(base.resources.configuration)
            configuration.densityDpi = (base.resources.displayMetrics.widthPixels * 160f / width).toInt()
            configuration.screenWidthDp = width
            configuration.screenHeightDp = (base.resources.displayMetrics.heightPixels * 160f / configuration.densityDpi).toInt()
            super.attachBaseContext(base.createConfigurationContext(configuration))
        } else super.attachBaseContext(base)
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        embeddedWebIdentity = embeddedWeb
        if (!getSharedPreferences("native-ui", MODE_PRIVATE).getBoolean("enabled", BuildConfig.NATIVE_UI)) {
            startActivity(Intent(this, HybridActivity::class.java).apply { data = intent.data; putExtras(intent) }); finish(); return
        }
        model = NativeChatModel(this, nativeScope)
        feed = NativeFeedModel(model, this)
        nativeObserver = { type, data -> model.event(type, data); feed.event(type, data) }
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
        val web = embeddedWeb
        (web.parent as? ViewGroup)?.removeView(web)
        applyWebFrame()
        return web
    }
    override fun embeddedPageFinished() { embeddedWebIdentity=embeddedWeb;applyWebFrame(); embeddedFeedLoaded?.invoke() }
    private fun applyWebFrame() {
        val web=embeddedWeb
        val name=webRoute
        val embedded=webEmbedded
        web.evaluateJavascript("""
            (() => {
              const route=${JSONObject.quote(name)};window.weftNativeRoute=route;
              function apply(){
              if(window.weftNativeRoute!==route)return;
              // The page permits style attributes, while its CSP blocks inline style elements.
              document.querySelectorAll('.topbar,#mobile-bottom-tabs').forEach(el=>el.style.setProperty('display',${JSONObject.quote(if(embedded)"none" else "")},'important'));
              const app=document.getElementById('app');if(app)app.style.setProperty('padding',${JSONObject.quote(if(embedded)"0" else "")},'important');
              for(const edge of ['top','bottom','left','right'])document.documentElement.style.setProperty('--safe-'+edge,${JSONObject.quote(if(embedded)"0px" else "")},'important');
              if(typeof page==='function' && state.booted && ${JSONObject.quote(name)}!=='login') page(${JSONObject.quote(name)});
              else if(route!=='login')setTimeout(apply,100);
              }apply();
            })()
        """.trimIndent(), null)
    }
    internal fun showLogin() { if (::model.isInitialized) model.loggedIn = false }
    internal fun hideKeyboard() { (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(presentationContainer.windowToken, 0) }
    internal fun fallback() {
        getSharedPreferences("native-ui", MODE_PRIVATE).edit().putBoolean("enabled", false).commit()
        startActivity(Intent(this, HybridActivity::class.java)); finish()
    }
    override fun onResume() { super.onResume(); nativeForeground = true }
    override fun onPause() { nativeForeground = false; if (::model.isInitialized) model.saveDraft(); super.onPause() }
    @Suppress("DEPRECATION") override fun onBackPressed() {
        if (!::model.isInitialized || !model.loggedIn) { super.onBackPressed(); return }
        if (model.tab == "activity-web") feed.closeWeb()
        else if (model.tab == "activity" && feed.detail != null) feed.closeDetail()
        else if (model.tab != "chat") model.tab = "chat" else moveTaskToBack(true)
    }
    override fun onDestroy() { if (::feed.isInitialized) feed.close(); if (::model.isInitialized) model.close(); nativeObserver = null; nativeScope.cancel(); super.onDestroy() }
}
