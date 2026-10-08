package com.memoweft.weftmate.mobile

import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Explicitly enabled inspection of the isolated shell; product transport stays intact. */
class Ui3mWebViewProbeTest {
    @Test fun inspectRealShell() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("ui3mProbe") == "1")
        val context = instrumentation.targetContext
        assumeTrue("Use the isolated UI-3m package", context.packageName == "com.memoweft.weftmate.mobile.ui3mqa")
        val done = File(context.filesDir, "ui3m-probe.done")
        done.delete()
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
        instrumentation.startActivitySync(Intent(context, HybridActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val deadline = System.currentTimeMillis() + 30 * 60 * 1000
        while (!done.exists() && System.currentTimeMillis() < deadline) Thread.sleep(500)
        check(done.exists()) { "UI-3m probe timed out" }
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(false) }
        done.delete()
    }
}
