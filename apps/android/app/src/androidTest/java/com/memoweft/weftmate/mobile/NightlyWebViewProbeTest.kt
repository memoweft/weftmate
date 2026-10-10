package com.memoweft.weftmate.mobile

import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Inspection only for the separately installed nightly synthetic package. */
class NightlyWebViewProbeTest {
    @Test fun inspectSyntheticGallery() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        assumeTrue(context.packageName == "com.memoweft.weftmate.mobile.nightly")
        assumeTrue(InstrumentationRegistry.getArguments().getString("nightlyProbe") == "1")
        val done = File(context.filesDir, "nightly-probe.done")
        done.delete()
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
        instrumentation.startActivitySync(Intent(context, HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        try {
            val deadline = System.currentTimeMillis() + 30 * 60 * 1000
            while (!done.exists() && System.currentTimeMillis() < deadline) Thread.sleep(500)
            check(done.exists()) { "Nightly probe timed out" }
        } finally {
            instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(false) }
            done.delete()
        }
    }
}
