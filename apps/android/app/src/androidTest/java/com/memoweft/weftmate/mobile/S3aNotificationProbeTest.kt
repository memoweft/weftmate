package com.memoweft.weftmate.mobile

import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Real auth/Keystore/bridge; only the isolated opt-in QA package opens CDP. */
class S3aNotificationProbeTest {
    @Test fun inspectRealShell() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("s3aProbe") == "1")
        val context = instrumentation.targetContext
        assumeTrue(context.packageName == "com.memoweft.weftmate.mobile.s3aqa")
        val done = File(context.filesDir, "s3a-probe.done"); done.delete()
        val host = PersonalApi().login(args.getString("host")!!, args.getString("username")!!, args.getString("password")!!, "S3a isolated Android")
        SecureSettings(context).saveHost(host)
        SyncJobService.schedule(context)
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
        instrumentation.startActivitySync(Intent(context, HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        try {
            val deadline = System.currentTimeMillis() + 30 * 60 * 1000
            while (!done.exists() && System.currentTimeMillis() < deadline) {
                val rows = org.json.JSONArray()
                for (item in context.getSystemService(android.app.NotificationManager::class.java).activeNotifications) {
                    val n = item.notification
                    rows.put(org.json.JSONObject().put("tag", item.tag).put("title", n.extras.getString(android.app.Notification.EXTRA_TITLE))
                        .put("channel", n.channelId).put("ongoing", n.flags and android.app.Notification.FLAG_ONGOING_EVENT != 0)
                        .put("actions", org.json.JSONArray((n.actions ?: emptyArray()).map { it.title.toString() })))
                }
                File(context.filesDir, "s3a-notifications.json").writeText(rows.toString())
                val send = File(context.filesDir, "s3a-send-action")
                if (send.exists()) {
                    val id = send.readText().trim(); send.delete()
                    context.getSystemService(android.app.NotificationManager::class.java).activeNotifications
                        .first { it.tag.endsWith(":$id") }.notification.actions.first().actionIntent.send()
                }
                Thread.sleep(500)
            }
            check(done.exists()) { "S3a probe timed out" }
        } finally { instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(false) }; done.delete() }
    }
}
