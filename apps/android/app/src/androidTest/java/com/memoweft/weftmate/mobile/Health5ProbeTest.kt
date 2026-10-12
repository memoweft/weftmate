package com.memoweft.weftmate.mobile

import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Only the separately installed synthetic HEALTH-5 package can expose its WebView. */
class Health5ProbeTest {
    @Test fun inspectHealthSettingsWithRealBusinessTransport() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(context.packageName == "com.memoweft.weftmate.mobile.health5qa")
        assumeTrue(args.getString("health5Probe") == "1")
        SecureSettings(context).saveHost(PersonalApi().login(args.getString("host")!!,
            args.getString("username")!!, args.getString("password")!!, "Synthetic health phone"))
        val done = File(context.filesDir, "health5-probe.done")
        done.delete()
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
        val activity = instrumentation.startActivitySync(Intent(context, HybridActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity
        val web = (activity.findViewById<android.widget.FrameLayout>(android.R.id.content).getChildAt(0)
            as android.widget.FrameLayout).getChildAt(0) as WebView
        try {
            val deadline = System.currentTimeMillis() + 10 * 60 * 1000
            while (!done.exists() && System.currentTimeMillis() < deadline) {
                instrumentation.runOnMainSync {
                    web.evaluateJavascript("document.documentElement?.dataset?.theme") { value ->
                        if (value == "\"dark\"" || value == "\"light\"") activity.reportRenderedSystemBars(value == "\"dark\"")
                    }
                }
                Thread.sleep(100)
            }
            check(done.exists()) { "Synthetic health probe timed out" }
        } finally {
            instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(false) }
            done.delete()
        }
    }
}
