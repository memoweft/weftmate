package com.memoweft.weftmate.mobile

import android.content.Intent
import android.webkit.WebView
import android.view.WindowInsets
import android.view.WindowInsetsController
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import org.junit.Test
import org.json.JSONObject
import java.io.File

/** Only enables inspection of our isolated test installation. Login uses the real UI. */
class And3ShellProbeTest {
    @Test fun inspectSyntheticShell() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        check(context.packageName == "com.memoweft.weftmate.mobile.and3qa")
        val cacheName = "and3-cache-" + java.util.UUID.randomUUID()
        val cacheRoot = File(context.filesDir, cacheName).apply { check(mkdirs()) }
        val cacheContext = object : android.content.ContextWrapper(context) {
            override fun getFilesDir() = cacheRoot
            override fun getSharedPreferences(name: String, mode: Int) = context.getSharedPreferences(cacheName, mode)
        }
        val prefs = context.getSharedPreferences(cacheName, android.content.Context.MODE_PRIVATE)
        val oldId = "a".repeat(64)
        val oldPage = File(cacheRoot, "mobile-ui-bundles/$oldId/index.html").apply { parentFile!!.mkdirs(); writeText("synthetic old pairing page") }
        prefs.edit().putString("active", oldId).putString("previous", oldId).putString("staged", oldId).putInt("nativeLoginUiVersion",21).commit()
        try {
            val bundles = MobileUiBundles(cacheContext)
            check(bundles.state().active == "builtin" && bundles.state().staged == null)
            check(prefs.getBoolean("verifiedAccountLoginUi", false))
            check(oldPage.readText() == "synthetic old pairing page")
            bundles.close()
        } finally { cacheRoot.deleteRecursively(); context.deleteSharedPreferences(cacheName) }
        val origin = InstrumentationRegistry.getArguments().getString("host")!!
        check(origin.matches(Regex("http://127[.]0[.]0[.]1:[0-9]+")))
        val done = File(context.filesDir, "and3-probe.done"); done.delete()
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
        val activity = instrumentation.startActivitySync(Intent(context, HybridActivity::class.java)
            .putExtra("lg1bHostOrigin", origin).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        try {
            val deadline = System.currentTimeMillis() + 12 * 60_000
            while (!done.exists() && System.currentTimeMillis() < deadline) {
                instrumentation.runOnMainSync {
                    val shown = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED)
                        .filterIsInstance<HybridActivity>().firstOrNull() ?: activity
                    val bars = shown.window.decorView.rootWindowInsets?.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                    val appearance = shown.window.insetsController?.systemBarsAppearance ?: 0
                    File(context.filesDir, "and3-window.json").writeText(JSONObject()
                        .put("statusHeight", bars?.top ?: 0).put("navigationHeight", bars?.bottom ?: 0)
                        .put("darkStatusIcons", appearance and WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS != 0)
                        .put("darkNavigationIcons", appearance and WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS != 0).toString())
                }
                Thread.sleep(200)
            }
            check(done.exists()) { "Synthetic shell driver did not finish" }
        } finally {
            instrumentation.runOnMainSync { activity.finish(); WebView.setWebContentsDebuggingEnabled(false) }
            done.delete()
        }
    }
}
