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
        val activity = instrumentation.startActivitySync(Intent(context, HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity
        val web = (activity.findViewById<android.widget.FrameLayout>(android.R.id.content).getChildAt(0)
            as android.widget.FrameLayout).getChildAt(0) as WebView
        try {
            val deadline = System.currentTimeMillis() + 30 * 60 * 1000
            while (!done.exists() && System.currentTimeMillis() < deadline) {
                // Gallery fixtures replace business transport. Feed the rendered theme
                // into the same native controller used by the production bridge.
                instrumentation.runOnMainSync {
                    web.evaluateJavascript("document.documentElement.dataset.theme") { value ->
                        if (value == "\"dark\"" || value == "\"light\"") {
                            val dark = value == "\"dark\""
                            activity.reportRenderedSystemBars(dark)
                            File(context.filesDir, "nightly-bars-theme.txt").writeText(if (dark) "dark" else "light")
                        }
                    }
                }
                Thread.sleep(100)
            }
            check(done.exists()) { "Nightly probe timed out" }
        } finally {
            instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(false) }
            done.delete()
        }
    }
}
