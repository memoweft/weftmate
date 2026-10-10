package com.memoweft.weftmate.mobile

import android.content.Intent
import android.webkit.WebView
import android.view.WindowInsets
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import java.io.File
import org.json.JSONObject
import android.graphics.Bitmap
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage

/** Opt-in inspection of this work package's synthetic app only. */
class SystemBarsProbeTest {
    @Test fun nativeFallbackLoginAndPairing() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        check(context.packageName == "com.memoweft.weftmate.mobile.and1")
        val prefs = context.getSharedPreferences("display-settings", android.content.Context.MODE_PRIVATE)
        val scope = prefs.getString("lastScope", "local") ?: "local"
        val previous = prefs.getString("appearance:$scope", "system")
        try {
            for (selected in listOf("light", "dark")) {
                check(prefs.edit().putString("appearance:$scope", selected).commit())
                val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
                try {
                    instrumentation.waitForIdleSync(); Thread.sleep(350)
                    val image = instrumentation.uiAutomation.takeScreenshot()
                    File(context.getExternalFilesDir(null), "android-native-fallback-$selected.png").outputStream()
                        .use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
                    image.recycle()
                    instrumentation.runOnMainSync {
                        val current = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED)
                            .filterIsInstance<MainActivity>().firstOrNull() ?: activity
                        MainActivity::class.java.getDeclaredMethod("showSettings", Boolean::class.javaPrimitiveType, String::class.java)
                            .apply { isAccessible = true }.invoke(current, true, "account")
                    }
                    instrumentation.waitForIdleSync(); Thread.sleep(350)
                    val pairing = instrumentation.uiAutomation.takeScreenshot()
                    File(context.getExternalFilesDir(null), "android-native-pairing-$selected.png").outputStream()
                        .use { pairing.compress(Bitmap.CompressFormat.PNG, 100, it) }
                    pairing.recycle()
                } finally { instrumentation.runOnMainSync {
                    ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED)
                        .filterIsInstance<MainActivity>().forEach { it.finish() }
                    activity.finish()
                } }
            }
        } finally {
            check(prefs.edit().putString("appearance:$scope", previous).commit())
            if (android.os.Build.VERSION.SDK_INT >= 31) context.getSystemService(android.app.UiModeManager::class.java)
                .setApplicationNightMode(applicationAppearanceMode(previous ?: "system"))
        }
    }
    @Test fun inspectBars() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        check(context.packageName == "com.memoweft.weftmate.mobile.and1")
        val done = File(context.filesDir, "and1-probe.done")
        done.delete()
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
        val activity = instrumentation.startActivitySync(Intent(context, HybridActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        try {
            val deadline = System.currentTimeMillis() + 30 * 60 * 1000
            while (!done.exists() && System.currentTimeMillis() < deadline) {
                instrumentation.runOnMainSync {
                    val decor = activity.window.decorView
                    val insets = decor.rootWindowInsets
                    val bars = insets?.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                    val ime = insets?.getInsets(WindowInsets.Type.ime())
                    @Suppress("DEPRECATION")
                    val lightStatus = if (android.os.Build.VERSION.SDK_INT >= 30)
                        (activity.window.insetsController!!.systemBarsAppearance and android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS) != 0
                    else (decor.systemUiVisibility and android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR) != 0
                    File(context.filesDir, "and1-window.json").writeText(JSONObject()
                        .put("statusHeight", bars?.top ?: 0).put("navigationHeight", bars?.bottom ?: 0)
                        .put("imeHeight", ime?.bottom ?: 0).put("darkStatusIcons", lightStatus)
                        .put("width", decor.width).put("height", decor.height).toString())
                }
                Thread.sleep(250)
            }
            check(done.exists()) { "AND-1 probe timed out" }
        } finally {
            instrumentation.runOnMainSync { activity.finish(); WebView.setWebContentsDebuggingEnabled(false) }
            done.delete()
        }
    }
}
