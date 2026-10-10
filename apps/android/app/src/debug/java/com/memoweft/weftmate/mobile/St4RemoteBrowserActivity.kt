package com.memoweft.weftmate.mobile

import android.app.Activity
import android.os.Bundle
import android.graphics.Color
import android.view.View
import android.webkit.WebView

/** Test-APK-only browser. Own process/profile, no product bridge or shared browser cookies. */
class St4RemoteBrowserActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        check(packageName == "com.memoweft.weftmate.mobile.st4qa")
        val url = intent.getStringExtra("st4Url") ?: error("Missing synthetic origin")
        check(url.matches(Regex("http://127\\.0\\.0\\.1:[0-9]+/personal/v1/ui")))
        WebView.setDataDirectorySuffix("st4-remote")
        WebView.setWebContentsDebuggingEnabled(true)
        val dark = intent.getStringExtra("st4Theme") == "dark"
        val color = if (dark) Color.rgb(32, 34, 31) else Color.WHITE
        window.statusBarColor = color
        window.navigationBarColor = color
        window.decorView.systemUiVisibility = if (dark) 0 else View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        val browser = WebView(this)
        browser.settings.javaScriptEnabled = true
        browser.settings.domStorageEnabled = true
        browser.setBackgroundColor(color)
        setContentView(browser)
        browser.loadUrl(url)
    }
}
