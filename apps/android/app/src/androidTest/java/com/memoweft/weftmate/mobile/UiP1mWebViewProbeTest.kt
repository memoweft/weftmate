package com.memoweft.weftmate.mobile

import android.content.Intent
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.net.Uri
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Isolated motion evidence shell; never exposes a daily application's WebView. */
class UiP1mWebViewProbeTest {
    @Test fun inspectRealShell() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("uiP1mProbe") == "1")
        val context = instrumentation.targetContext
        assumeTrue(context.packageName == "com.memoweft.weftmate.mobile.uip1mqa")
        val done = File(context.filesDir, "ui-p1m-probe.done"); done.delete()
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
        val activity = instrumentation.startActivitySync(Intent(context, HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val origin = InstrumentationRegistry.getArguments().getString("uiP1mAssetOrigin")!!
        val uri = Uri.parse(origin)
        require(uri.scheme == "http" && uri.host == "127.0.0.1")
        // Test-only asset transport makes both committed baseline and current production
        // components inspectable in the same real shell without changing its native bridge.
        instrumentation.runOnMainSync {
            val ready = HybridActivity::class.java.getDeclaredField("currentPageReady"); ready.isAccessible = true
            ready.setBoolean(activity, true)
            val field = HybridActivity::class.java.getDeclaredField("web"); field.isAccessible = true
            val web = field.get(activity) as WebView
            val production = web.webViewClient
            web.webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    if (request.url.scheme == "http" && request.url.host == "127.0.0.1" && request.url.port == uri.port) null
                    else production.shouldInterceptRequest(view, request)
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    if (request.url.scheme == "http" && request.url.host == "127.0.0.1" && request.url.port == uri.port) false
                    else production.shouldOverrideUrlLoading(view, request)
                override fun onPageFinished(view: WebView, url: String) {
                    val sync = HybridActivity::class.java.getDeclaredMethod("syncMotionPreference"); sync.isAccessible = true
                    sync.invoke(activity)
                }
            }
            web.loadUrl(origin)
        }
        val deadline = System.currentTimeMillis() + 30 * 60 * 1000
        try {
            while (!done.exists() && System.currentTimeMillis() < deadline) Thread.sleep(500)
            check(done.exists()) { "Motion probe timed out" }
        } finally {
            instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(false) }
            done.delete()
        }
    }
}
