package com.memoweft.weftmate.mobile

import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/** Exercises the production signed downloader and asset loader in an isolated real shell. */
class Upd1BundlesInstrumentedTest {
    @Test fun signedBundleSwitchAndRollback() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val args = InstrumentationRegistry.getArguments()
        val context = instrumentation.targetContext
        assumeTrue(args.getString("upd1") == "1" && context.packageName == "com.memoweft.weftmate.mobile.upd1qa")
        val activity = instrumentation.startActivitySync(Intent(context, HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity
        val bundleField = HybridActivity::class.java.getDeclaredField("bundles").apply { isAccessible = true }
        val bundles = bundleField.get(activity) as MobileUiBundles
        val webField = HybridActivity::class.java.getDeclaredField("web").apply { isAccessible = true }
        val web = webField.get(activity) as WebView
        fun evaluate(script: String): String {
            val done = CountDownLatch(1); var result = ""
            instrumentation.runOnMainSync { web.evaluateJavascript(script) { result = it; done.countDown() } }
            assertTrue(done.await(10, TimeUnit.SECONDS)); return result
        }
        fun waitFor(text: String) {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
            while (System.nanoTime() < deadline) {
                if (evaluate("document.body.innerText.includes(${JSONObject.quote(text)})") == "true") return
                Thread.sleep(100)
            }
            fail("UI text not found: $text: ${evaluate("document.body.innerText")}")
        }
        fun capture(name: String) {
            Thread.sleep(350)
            val screenshot = instrumentation.uiAutomation.takeScreenshot()!!
            File(context.filesDir, name).outputStream().use { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
            screenshot.recycle()
        }
        waitFor("登录 WeftMate"); capture("upd-1-native-v1.png")
        val host = HostIdentity(args.getString("origin")!!, "Upd1Mobile", args.getString("ownerId")!!,
            args.getString("hostId")!!, args.getString("deviceId")!!, args.getString("cookie")!!, args.getString("csrf")!!)
        val checked = bundles.check(host)
        assertEquals("0.9.0", checked.stagedVersion)
        assertTrue(checked.version.contains("内置"))
        val installed = bundles.apply(); assertEquals("0.9.0", installed.version)
        val load = HybridActivity::class.java.getDeclaredMethod("loadPage").apply { isAccessible = true }
        instrumentation.runOnMainSync { load.invoke(activity) }
        waitFor("UPD mobile v2"); capture("upd-1-native-v2.png")
        bundles.rollback(); instrumentation.runOnMainSync { load.invoke(activity) }
        val rollbackDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
        while (evaluate("document.body.innerText.includes('UPD mobile v2')") == "true" && System.nanoTime() < rollbackDeadline) Thread.sleep(100)
        waitFor("登录 WeftMate"); assertFalse(evaluate("document.body.innerText.includes('UPD mobile v2')") == "true")
        capture("upd-1-native-rollback.png")
        // Cross-runtime canonical JSON and signature validation are exercised by bundles.check above.
        File(context.filesDir, "upd-1-native-report.json").writeText(JSONObject().put("signedNativeDownload", true)
            .put("version", installed.version).put("rollback", true).toString())
        instrumentation.runOnMainSync { activity.finish() }
    }
}
