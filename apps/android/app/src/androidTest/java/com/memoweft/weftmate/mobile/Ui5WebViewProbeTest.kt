package com.memoweft.weftmate.mobile

import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Opt-in probe for the UI-5 isolated package, with the real native transport. */
class Ui5WebViewProbeTest {
    @Test fun inspectSessionMenu() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("ui5Probe") == "1")
        val context = instrumentation.targetContext
        assumeTrue(context.packageName == "com.memoweft.weftmate.mobile.ui5qa")
        val done = File(context.filesDir, "ui5-probe.done")
        done.delete()
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
        instrumentation.startActivitySync(Intent(context, HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val deadline = System.currentTimeMillis() + 10 * 60 * 1000
        while (!done.exists() && System.currentTimeMillis() < deadline) Thread.sleep(500)
        check(done.exists()) { "UI-5 probe timed out" }
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(false) }
        done.delete()
    }
}
