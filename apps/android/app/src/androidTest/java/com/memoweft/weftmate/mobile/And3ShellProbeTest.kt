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
        // Only this isolated instrumentation process trusts its generated CA.
        // Hostname checks remain standard; product trust configuration is untouched.
        val ca = InstrumentationRegistry.getArguments().getString("cloudCa")!!
        val certificate = java.security.cert.CertificateFactory.getInstance("X.509")
            .generateCertificate(java.io.ByteArrayInputStream(android.util.Base64.decode(ca, android.util.Base64.DEFAULT)))
        val trustStore = java.security.KeyStore.getInstance(java.security.KeyStore.getDefaultType()).apply { load(null); setCertificateEntry("and3-cloud", certificate) }
        val managers = javax.net.ssl.TrustManagerFactory.getInstance(javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm()).apply { init(trustStore) }
        val tls = javax.net.ssl.SSLContext.getInstance("TLS").apply { init(null, managers.trustManagers, null) }
        val previousTls = javax.net.ssl.HttpsURLConnection.getDefaultSSLSocketFactory()
        javax.net.ssl.HttpsURLConnection.setDefaultSSLSocketFactory(tls.socketFactory)
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
                    val measurement = File(context.filesDir, "and3-window.next")
                    measurement.writeText(JSONObject()
                        .put("statusHeight", bars?.top ?: 0).put("navigationHeight", bars?.bottom ?: 0)
                        .put("windowFocused", shown.window.decorView.hasWindowFocus())
                        .put("keyboardVisible", shown.window.decorView.rootWindowInsets?.isVisible(WindowInsets.Type.ime()) == true)
                        .put("darkStatusIcons", appearance and WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS != 0)
                        .put("darkNavigationIcons", appearance and WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS != 0).toString())
                    check(measurement.renameTo(File(context.filesDir, "and3-window.json")))
                }
                Thread.sleep(200)
            }
            check(done.exists()) { "Synthetic shell driver did not finish" }
        } finally {
            instrumentation.runOnMainSync { activity.finish(); WebView.setWebContentsDebuggingEnabled(false) }
            javax.net.ssl.HttpsURLConnection.setDefaultSSLSocketFactory(previousTls)
            done.delete()
        }
    }
}
