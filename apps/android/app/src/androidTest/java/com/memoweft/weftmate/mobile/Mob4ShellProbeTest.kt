package com.memoweft.weftmate.mobile

import android.content.Intent
import android.webkit.WebView
import android.view.WindowInsets
import android.view.WindowInsetsController
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import org.junit.Test
import org.junit.Rule
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import org.json.JSONObject
import java.io.File

/** Only enables inspection of our isolated test installation. Login uses the real UI. */
class Mob4ShellProbeTest {
    @get:Rule val compose = createEmptyComposeRule()
    @Test fun inspectSyntheticShell() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val args = InstrumentationRegistry.getArguments()
        val nativeEntry = args.getString("nativeEntry") == "true"
        check(context.packageName == if(nativeEntry) "com.memoweft.weftmate.mobile.and4qa" else "com.memoweft.weftmate.mobile.mob4qa")
        if(nativeEntry) context.getSharedPreferences("native-qa",0).edit().putInt("width",args.getString("width","390").toInt()).commit()
        val scopeId = java.util.UUID.randomUUID().toString()
        val settingsName = "mob4-isolation-$scopeId"
        val alias = "mob4-isolation-key-$scopeId"
        val isolated = SecureSettings(context, settingsName, alias)
        val phone = PhoneAccount(context, isolated)
        fun credentials(subject: String) = isolated.saveAppValue("credentials",JSONObject().put("app-tokens:synthetic",JSONObject().put("sub",subject)).toString())
        fun account(subject: String) = JSONObject().put("origin","https://cloud.example").put("accountId",subject).put("email","synthetic@example.com").put("deviceId","synthetic-device")
        val aId="mob4-a-$scopeId";val bId="mob4-b-$scopeId"
        credentials(aId);val a=phone.adopt(account(aId))
        phone.models("configure",JSONObject().put("endpoint","https://model.example/v1").put("modelId","synthetic-a").put("apiKey","synthetic-key-a"))
        OfflineVault(context,a).save(JSONObject().put("snapshot",JSONObject.NULL).put("turns",org.json.JSONArray()).put("conversations",org.json.JSONArray().put(JSONObject().put("id","synthetic-private-a"))))
        credentials(bId)
        try { phone.identity();error("Another cloud account must not read the prior phone scope") } catch(expected:ApiFailure){check(expected.safeCode=="ACCOUNT_SWITCHED")}
        val b=phone.adopt(account(bId));check(phone.models("list",JSONObject()).getJSONArray("models").length()==0)
        check(OfflineVault(context,a).load().getJSONArray("conversations").length()==0)
        OfflineVault(context,a).clear();OfflineVault(context,b).clear();context.deleteSharedPreferences(settingsName)
        java.security.KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)}
        // Only this isolated instrumentation process trusts its generated CA.
        // Hostname checks remain standard; product trust configuration is untouched.
        val ca = InstrumentationRegistry.getArguments().getString("cloudCa")!!
        val certificate = java.security.cert.CertificateFactory.getInstance("X.509")
            .generateCertificate(java.io.ByteArrayInputStream(android.util.Base64.decode(ca, android.util.Base64.DEFAULT)))
        val trustStore = java.security.KeyStore.getInstance(java.security.KeyStore.getDefaultType()).apply { load(null); setCertificateEntry("mob4-cloud", certificate) }
        val system = javax.net.ssl.TrustManagerFactory.getInstance(javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm()).apply { init(null as java.security.KeyStore?) }.trustManagers.filterIsInstance<javax.net.ssl.X509TrustManager>().first()
        system.acceptedIssuers.forEachIndexed { index, cert -> trustStore.setCertificateEntry("system-$index",cert) }
        val managers = javax.net.ssl.TrustManagerFactory.getInstance(javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm()).apply { init(trustStore) }.trustManagers
        val tls = javax.net.ssl.SSLContext.getInstance("TLS").apply { init(null, managers, null) }
        val previousTls = javax.net.ssl.HttpsURLConnection.getDefaultSSLSocketFactory()
        val localTls = tls.socketFactory
        fun factory(host: String) = if(host in setOf("127.0.0.1","localhost","::1")) localTls else previousTls
        javax.net.ssl.HttpsURLConnection.setDefaultSSLSocketFactory(object : javax.net.ssl.SSLSocketFactory() {
            override fun getDefaultCipherSuites() = previousTls.defaultCipherSuites
            override fun getSupportedCipherSuites() = previousTls.supportedCipherSuites
            override fun createSocket(socket: java.net.Socket, host: String, port: Int, close: Boolean) = factory(host).createSocket(socket,host,port,close)
            override fun createSocket(host: String, port: Int) = factory(host).createSocket(host,port)
            override fun createSocket(host: String, port: Int, address: java.net.InetAddress, localPort: Int) = factory(host).createSocket(host,port,address,localPort)
            override fun createSocket(address: java.net.InetAddress, port: Int) = factory(address.hostAddress ?: "").createSocket(address,port)
            override fun createSocket(address: java.net.InetAddress, port: Int, local: java.net.InetAddress, localPort: Int) = factory(address.hostAddress ?: "").createSocket(address,port,local,localPort)
        })
        val origin = InstrumentationRegistry.getArguments().getString("host")!!
        check(origin.matches(Regex("http://127[.]0[.]0[.]1:[0-9]+")))
        val done = File(context.filesDir, "mob4-probe.done"); done.delete()
        File(context.filesDir,"mob4-command.json").delete(); File(context.filesDir,"mob4-response.json").delete()
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
        val activity = instrumentation.startActivitySync(Intent(context, if(nativeEntry) NativeActivity::class.java else HybridActivity::class.java)
            .putExtra("lg1bHostOrigin", origin).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        try {
            var lastCommand = ""
            val transitions=org.json.JSONArray()
            var previousState=""
            if(nativeEntry) instrumentation.runOnMainSync {
                val nativeActivity=activity as NativeActivity
                val observer=nativeActivity.nativeObserver
                nativeActivity.nativeObserver={type,data->
                    if(type !in setOf("result.settings.appearance","result.phone.models.list"))transitions.put("event:$type")
                    observer?.invoke(type,data)
                }
            }
            val deadline = System.currentTimeMillis() + 12 * 60_000
            while (!done.exists() && System.currentTimeMillis() < deadline) {
                if(nativeEntry) {
                    compose.mainClock.advanceTimeBy(220)
                    compose.waitForIdle()
                    val file = File(context.filesDir,"mob4-command.json")
                    if(file.exists()) {
                        val command = runCatching { JSONObject(file.readText()) }.getOrNull()
                        if(command != null && command.optString("id") != lastCommand) {
                            lastCommand = command.getString("id")
                            var failure = ""
                            try {
                                when(command.getString("action")) {
                                    "input" -> compose.onNodeWithContentDescription("消息输入").performTextReplacement(command.getString("text"))
                                    "click" -> compose.onNodeWithContentDescription(command.getString("label")).performClick()
                                    "text" -> compose.onAllNodesWithText(command.getString("label"),useUnmergedTree=true).onLast().performClick()
                                    "copy" -> {
                                        var before=0;instrumentation.runOnMainSync{before=(activity as NativeActivity).model.copyVersion}
                                        compose.onAllNodesWithContentDescription("复制回复").onLast().performClick()
                                        val limit=System.currentTimeMillis()+10000;var acknowledged=false
                                        while(!acknowledged && System.currentTimeMillis()<limit){instrumentation.runOnMainSync{acknowledged=(activity as NativeActivity).model.copyVersion>before};Thread.sleep(50)}
                                        check(acknowledged){"Copy request was not acknowledged"}
                                    }
                                    "back" -> instrumentation.runOnMainSync { (activity as NativeActivity).onBackPressed() }
                                    "new" -> compose.onNodeWithContentDescription("更多").performClick().also { compose.onNodeWithText("新对话").performClick() }
                                    "legacy" -> instrumentation.runOnMainSync { (activity as NativeActivity).fallback() }
                                    "nativePreference" -> context.getSharedPreferences("native-ui",0).edit().putBoolean("enabled",true).commit()
                                    "theme" -> instrumentation.runOnMainSync { (activity as NativeActivity).model.dark=command.getBoolean("dark") }
                                    "state" -> Unit
                                    else -> error("Unknown test action")
                                }
                            } catch(error:Throwable) { failure=error.javaClass.simpleName }
                            compose.mainClock.advanceTimeBy(220)
                            compose.waitForIdle()
                            instrumentation.runOnMainSync {
                                val m = (activity as NativeActivity).model
                                File(context.filesDir,"mob4-response.json").writeText(JSONObject().put("id",lastCommand).put("failure",failure)
                                    .put("loggedIn",m.loggedIn).put("standalone",m.standalone).put("phoneArchive",m.phoneArchive).put("loading",m.loading)
                                    .put("tab",m.tab).put("chatId",m.chatId).put("draft",m.draft).put("running",m.running).put("error",m.error)
                                    .put("modelId",m.modelId).put("modelLabel",m.modelLabel).put("sendAvailable",m.sendAvailable).put("canRegenerate",m.canRegenerate)
                                    .put("rows",org.json.JSONArray(m.rows)).put("chats",org.json.JSONArray(m.chats))
                                    .put("copyVersion",m.copyVersion).put("scrollVersion",m.scrollVersion).toString())
                            }
                        }
                    }
                }
                instrumentation.runOnMainSync {
                    if(nativeEntry) {
                        val m=(activity as NativeActivity).model
                        val current="${m.owner}:${m.loggedIn}:${m.loading}:${m.tab}:${m.chatId}:${m.modelId}"
                        if(current!=previousState){transitions.put(current);previousState=current}
                        File(context.filesDir,"mob4-native-state.json").writeText(JSONObject().put("tab",m.tab).put("owner",m.owner).put("loggedIn",m.loggedIn).put("loading",m.loading).put("transitions",transitions).toString())
                    }
                    val shown = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED)
                        .firstOrNull { it.packageName == context.packageName } ?: activity
                    val bars = shown.window.decorView.rootWindowInsets?.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                    val statusVisible = shown.window.decorView.rootWindowInsets?.isVisible(WindowInsets.Type.statusBars()) == true
                    val statusHeight = bars?.top?.takeIf { it > 0 } ?: if (statusVisible) {
                        val id = context.resources.getIdentifier("status_bar_height", "dimen", "android")
                        if (id > 0) context.resources.getDimensionPixelSize(id) else 0
                    } else 0
                    val appearance = shown.window.insetsController?.systemBarsAppearance ?: 0
                    val measurement = File(context.filesDir, "mob4-window.next")
                    measurement.writeText(JSONObject()
                        .put("statusHeight", statusHeight).put("statusHeightFromResource", (bars?.top ?: 0) == 0).put("statusVisible", statusVisible).put("navigationHeight", bars?.bottom ?: 0)
                        .put("windowFocused", shown.window.decorView.hasWindowFocus())
                        .put("keyboardVisible", shown.window.decorView.rootWindowInsets?.isVisible(WindowInsets.Type.ime()) == true)
                        .put("darkStatusIcons", appearance and WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS != 0)
                        .put("darkNavigationIcons", appearance and WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS != 0).toString())
                    check(measurement.renameTo(File(context.filesDir, "mob4-window.json")))
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
