package com.memoweft.weftmate.mobile

import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Test
import java.io.File

/** Disposable installation only. The driver signs in and pairs through the shipped UI/transport. */
class PairingWebViewProbeTest {
    @Test fun cachedSingleStepPairingPageUpgradesToBuiltInWithoutDeletingFiles() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        check(BuildConfig.DEBUG && context.packageName == "com.memoweft.weftmate.mobile.andpairqa")
        val name = "and-pair-cache-" + java.util.UUID.randomUUID()
        val root = File(context.filesDir, name).apply { check(mkdirs()) }
        val isolated = object : android.content.ContextWrapper(context) {
            override fun getFilesDir() = root
            override fun getSharedPreferences(ignored: String, mode: Int) = context.getSharedPreferences(name, mode)
        }
        val prefs = isolated.getSharedPreferences("mobile-ui-bundles", 0)
        val id = "a".repeat(64)
        val page = File(root, "mobile-ui-bundles/$id/index.html").apply { parentFile!!.mkdirs(); writeText("synthetic old pairing page") }
        prefs.edit().putString("active", id).putString("previous", id).putString("staged", id)
            .putInt("nativeLoginUiVersion", 21).putBoolean("verifiedAccountLoginUi", true).commit()
        try {
            val bundles = MobileUiBundles(isolated)
            check(bundles.state().active == "builtin" && bundles.state().previous == "builtin" && bundles.state().staged == null)
            check(page.readText() == "synthetic old pairing page")
            check(prefs.getBoolean("pairingV2Ui", false))
            bundles.close()
        } finally { root.deleteRecursively(); context.deleteSharedPreferences(name) }
    }
    @Test fun inspectPairing() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        check(BuildConfig.DEBUG && context.packageName == "com.memoweft.weftmate.mobile.andpairqa")
        val origin = InstrumentationRegistry.getArguments().getString("host")!!
        check(origin.matches(Regex("http://127[.]0[.]0[.]1:[0-9]+")))
        val done = File(context.filesDir, "and-pair.done"); done.delete()
        val command = File(context.filesDir, "and-pair.route"); command.delete()
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
        val activity = instrumentation.startActivitySync(Intent(context, NativeActivity::class.java)
            .putExtra("lg1bHostOrigin", origin).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as NativeActivity
        var previous = ""
        try {
            val deadline = System.currentTimeMillis() + 18 * 60_000
            while (!done.exists() && System.currentTimeMillis() < deadline) {
                instrumentation.runOnMainSync {
                    File(context.filesDir, "and-pair-state.json").writeText(JSONObject()
                        .put("loggedIn", activity.model.loggedIn).put("tab", activity.model.tab)
                        .put("webPage", activity.settings.webPage).put("webShown", activity.embeddedWeb.isShown)
                        .put("loading", activity.model.loading).toString())
                }
                val value = if (command.exists()) command.readText().trim() else ""
                val route = value.substringBefore(':')
                if (value != previous && route in setOf("login", "devices")) {
                    previous = value
                    instrumentation.runOnMainSync { activity.settings.open(); activity.settings.original(route) }
                }
                Thread.sleep(100)
            }
            check(done.exists()) { "Pairing acceptance timed out" }
        } finally {
            instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(false) }
            command.delete(); done.delete()
        }
    }
}
