package com.memoweft.weftmate.mobile

import android.app.NotificationManager
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.ParcelFileDescriptor
import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Runs only in this work package's disposable APK, never the existing debug installation. */
@RunWith(AndroidJUnit4::class)
class IconSystemVisualTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private fun shell(command: String) {
        ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand(command)).use { it.readBytes() }
    }
    private fun evaluate(web: WebView, script: String): String {
        val latch = CountDownLatch(1)
        var result = ""
        instrumentation.runOnMainSync { web.evaluateJavascript(script) { result = it; latch.countDown() } }
        assertTrue(latch.await(8, TimeUnit.SECONDS))
        return result
    }
    private fun waitUntil(web: WebView, expression: String) {
        val until = System.currentTimeMillis() + 20_000
        while (System.currentTimeMillis() < until) {
            if (evaluate(web, expression) == "true") return
            Thread.sleep(100)
        }
        throw AssertionError("Icon fixture did not become visible: $expression")
    }
    private fun capture(web: WebView, name: String) {
        val visual = CountDownLatch(1)
        instrumentation.runOnMainSync {
            web.postVisualStateCallback(System.nanoTime(), object : WebView.VisualStateCallback() {
                override fun onComplete(requestId: Long) { visual.countDown() }
            })
        }
        assertTrue(visual.await(5, TimeUnit.SECONDS))
        Thread.sleep(250)
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        File(context.getExternalFilesDir(null), name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    @Test fun c4LauncherThemeAndNotificationAndBundledUi() {
        assertTrue("Use the dedicated IC-1 package", context.packageName.endsWith(".ic1qa"))
        // Offline synthetic identity: no real account, credential or model request.
        SecureSettings(context).saveHost(HostIdentity("http://127.0.0.1:9", "IconFixture", "icon-fixture-owner",
            "icon-fixture-host", "icon-fixture-device", "synthetic-cookie", "synthetic-csrf"))
        val activity = instrumentation.startActivitySync(Intent(context, HybridActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity
        val web = (activity.findViewById<android.widget.FrameLayout>(android.R.id.content).getChildAt(0)
            as android.widget.FrameLayout).getChildAt(0) as WebView
        try {
            waitUntil(web, "Boolean(typeof state !== 'undefined' && state.booted)")
            evaluate(web, "document.querySelector('[data-action=\"new-chat\"]').click()")
            waitUntil(web, "Boolean(document.querySelector('.welcome')?.getBoundingClientRect().height > 0)")
            for (theme in listOf("light", "dark")) {
                evaluate(web, "applyTheme('$theme')")
                assertTrue(evaluate(web, "getComputedStyle(document.querySelector('.icon-mic')).getPropertyValue('-webkit-mask-image').includes('mic.svg')") == "true")
                capture(web, "android-chat-$theme.png")
                evaluate(web, "document.getElementById('menu-button').click()")
                waitUntil(web, "document.getElementById('drawer').classList.contains('open')")
                capture(web, "android-sidebar-$theme.png")
                evaluate(web, "document.getElementById('drawer-close').click()")
            }
            // Rasterize the actual Android drawables as well as capturing the installed app.
            for ((name, id) in listOf("android-launcher-render.png" to R.mipmap.ic_launcher,
                "android-themed-render.png" to R.drawable.weftmate_monochrome,
                "android-notification-render.png" to R.drawable.ic_stat_weftmate)) {
                val bitmap = Bitmap.createBitmap(216, 216, Bitmap.Config.ARGB_8888)
                context.getDrawable(id)!!.apply { setBounds(0, 0, 216, 216); draw(Canvas(bitmap)) }
                File(context.getExternalFilesDir(null), name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                bitmap.recycle()
            }
            shell("pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS")
            val notices = MobileNotifications(context)
            notices.record("reply", "IC-1 图标测试完成", "合成通知，用于核对 C4 小图标。")
            val manager = context.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as NotificationManager
            val deadline = System.currentTimeMillis() + 5_000
            while (manager.activeNotifications.isEmpty() && System.currentTimeMillis() < deadline) Thread.sleep(100)
            assertTrue(manager.activeNotifications.isNotEmpty())
            assertEquals(R.drawable.ic_stat_weftmate, manager.activeNotifications.last().notification.smallIcon.resId)
            shell("cmd statusbar expand-notifications")
            Thread.sleep(600)
            capture(web, "android-notification.png")
            shell("cmd statusbar collapse")
            notices.cancelVisible()
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
}
