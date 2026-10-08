package com.memoweft.weftmate.mobile

import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Opt-in CDP access to the real shell; no bridge or network response replacement. */
class Ui2vWebViewProbeTest {
    @Test fun inspectRealShell() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("ui2vProbe") == "1")
        val context = instrumentation.targetContext
        assumeTrue("Use the isolated UI-2v package", context.packageName == "com.memoweft.weftmate.mobile.ui2vqa")
        val done = File(context.filesDir, "ui2v-probe.done")
        done.delete()
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
        instrumentation.startActivitySync(Intent(context, HybridActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val deadline = System.currentTimeMillis() + 15 * 60 * 1000
        while (!done.exists() && System.currentTimeMillis() < deadline) Thread.sleep(500)
        check(done.exists()) { "UI-2v probe timed out" }
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(false) }
        done.delete()
    }
}
