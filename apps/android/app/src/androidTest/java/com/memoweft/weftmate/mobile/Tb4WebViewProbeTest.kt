package com.memoweft.weftmate.mobile

import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Explicit inspection gate for this package's synthetic account and real transport. */
class Tb4WebViewProbeTest {
    @Test fun inspectRealShell() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("tb4Probe") == "1")
        val context = instrumentation.targetContext
        assumeTrue(context.packageName == "com.memoweft.weftmate.mobile.tb4qa")
        val done = File(context.filesDir, "tb4-probe.done")
        done.delete()
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
        instrumentation.startActivitySync(Intent(context, HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val deadline = System.currentTimeMillis() + 30 * 60 * 1000
        while (!done.exists() && System.currentTimeMillis() < deadline) {
            val click = File(context.filesDir, "tb4-notification-click")
            if (click.exists()) {
                val id = click.readText().trim(); click.delete()
                context.getSystemService(android.app.NotificationManager::class.java).activeNotifications
                    .first { it.tag.endsWith(":$id") }.notification.contentIntent.send()
            }
            Thread.sleep(500)
        }
        check(done.exists()) { "TB-4 probe timed out" }
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(false) }
        done.delete()
    }
}
