package com.memoweft.weftmate.mobile

import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Only the isolated synthetic-account package may expose its WebView to the acceptance driver. */
class Fx9WebViewProbeTest {
    @Test fun inspectRealShell() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val arguments = InstrumentationRegistry.getArguments()
        assumeTrue(arguments.getString("lg1bProbe") == "1")
        val context = instrumentation.targetContext
        assumeTrue(context.packageName == "com.memoweft.weftmate.mobile.fx9qa")
        val done = File(context.filesDir, "lg1b-probe.done"); done.delete()
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
        instrumentation.startActivitySync(Intent(context, HybridActivity::class.java)
            .putExtra("lg1bHostOrigin", arguments.getString("lg1bHostOrigin"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val deadline = System.currentTimeMillis() + 30 * 60 * 1000
        try {
            while (!done.exists() && System.currentTimeMillis() < deadline) Thread.sleep(500)
            check(done.exists()) { "LG-1b probe timed out" }
        } finally {
            instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(false) }
            done.delete()
        }
    }
}
