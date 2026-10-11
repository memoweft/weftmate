package com.memoweft.weftmate.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.RenderProcessGoneDetail

/** Debug-only test injection, inert in every package except this work package's APK. */
class DiagnosticQaReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (context.packageName != "com.memoweft.weftmate.mobile.diag2qa") return
        if (intent.getBooleanExtra("rendererCrash", false)) {
            // Inspect only our own activity fields. This uses no hidden Android
            // APIs and is inert outside the isolated debug package above.
            val visible = WeftMateApplication::class.java.getDeclaredField("visible").apply { isAccessible = true }
                .get(context.applicationContext) as Set<*>
            val activity = visible.filterIsInstance<HybridActivity>().single()
            val view = HybridActivity::class.java.getDeclaredField("web").apply { isAccessible = true }.get(activity) as WebView
            val original = view.webViewClient
            view.webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    if (request.url.toString() == "chrome://crash") null else original.shouldInterceptRequest(view, request)
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    request.url.toString() != "chrome://crash" && original.shouldOverrideUrlLoading(view, request)
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean =
                    original.onRenderProcessGone(view, detail)
            }
            view.loadUrl("chrome://crash")
        } else if (intent.getBooleanExtra("crash", false)) {
            Thread({ throw IllegalStateException("synthetic private content must not reach any log") }, "diag2-injection").start()
        } else WebView.setWebContentsDebuggingEnabled(true)
    }
}
