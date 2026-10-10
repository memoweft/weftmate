package com.memoweft.weftmate.mobile

import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Explicit inspection gate for the UX-9 synthetic account and isolated APK. */
class Ux9WebViewProbeTest {
    @Test fun inspectRealShell() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("ux9Probe") == "1")
        val context = instrumentation.targetContext
        assumeTrue(context.packageName == "com.memoweft.weftmate.mobile.ux9qa")
        val done = File(context.filesDir, "ux-9-probe.done")
        done.delete()
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
        instrumentation.startActivitySync(Intent(context, HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val deadline = System.currentTimeMillis() + 10 * 60 * 1000
        while (!done.exists() && System.currentTimeMillis() < deadline) Thread.sleep(500)
        check(done.exists()) { "UX-9 probe timed out" }
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(false) }
        done.delete()
    }
}
