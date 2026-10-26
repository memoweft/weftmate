package com.memoweft.weftmate.mobile

import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Opt-in inspection of the existing signed-in debug installation. */
class And1PhoneProbeTest {
    @Test fun inspectPhoneWindow() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("and1PhoneProbe") == "1")
        val context = instrumentation.targetContext
        check(context.packageName == "com.memoweft.weftmate.mobile.debug")
        val done = File(context.filesDir, "and1-phone-probe.done")
        done.delete()
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
        val activity = instrumentation.startActivitySync(Intent(context, NativeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        try {
            val deadline = System.currentTimeMillis() + 12 * 60_000
            while (!done.exists() && System.currentTimeMillis() < deadline) Thread.sleep(250)
            check(done.exists()) { "Phone window inspection timed out" }
        } finally {
            instrumentation.runOnMainSync { activity.finish(); WebView.setWebContentsDebuggingEnabled(false) }
            done.delete()
        }
    }
}
