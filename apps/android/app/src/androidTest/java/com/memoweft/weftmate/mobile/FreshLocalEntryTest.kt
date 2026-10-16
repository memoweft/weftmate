package com.memoweft.weftmate.mobile

import android.content.Intent
import androidx.test.platform.app.InstrumentationRegistry
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import android.graphics.Bitmap
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.Rule

/** Opt-in on a disposable fresh installation; never changes an existing account. */
class FreshLocalEntryTest {
    @get:Rule val compose = createEmptyComposeRule()
    @Test fun freshInstallOpensLocalChatWithoutCloudCredentials() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("freshLocal") == "1")
        check(instrumentation.targetContext.packageName == "com.memoweft.weftmate.mobile.g7c1qa")
        val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext, NativeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as NativeActivity
        try {
            val deadline = System.currentTimeMillis() + 25000
            var ready = false
            while (!ready && System.currentTimeMillis() < deadline) {
                instrumentation.runOnMainSync { ready = activity.model.loggedIn && activity.model.standalone && !activity.model.loading }
                if (!ready) Thread.sleep(100)
            }
            assertTrue("A fresh installation must reach standalone chat without cloud login", ready)
            val bootstrap = runBlocking { activity.model.call("app.bootstrap") }
            assertEquals("phone-local", bootstrap.getString("authSource"))
            assertTrue(bootstrap.getString("owner").isNotBlank())
            assertTrue(SecureSettings(activity).appValue("credentials").isNullOrBlank())
            assertTrue(SecureSettings(activity).host()!!.cookie.isBlank())
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    @Test fun realModelSetupChatAndColdStart() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val args = InstrumentationRegistry.getArguments()
        val phase = args.getString("realLocal")
        assumeTrue(phase in listOf("configure", "resume"))
        check(instrumentation.targetContext.packageName == "com.memoweft.weftmate.mobile.g7c1qa")
        val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext, NativeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as NativeActivity
        fun main(action: () -> Unit) = instrumentation.runOnMainSync(action)
        fun waitFor(label: String, condition: () -> Boolean) {
            val end = System.currentTimeMillis() + 90000
            while (System.currentTimeMillis() < end) { compose.mainClock.advanceTimeByFrame(); var ready = false; main { ready = condition() }; if (ready) return; Thread.sleep(100) }
            main {
                println("LOCAL_ENTRY_STATE: tab=${activity.model.tab}, page=${activity.settings.page}, web=${activity.settings.webPage}, local=${activity.model.localOnly}")
                activity.embeddedWeb.evaluateJavascript("JSON.stringify({booted:state.booted,page:state.page,local:state.profile?.localOnly,modal:WeftMobileCloud.core.cloudAuthView().modal,route:window.weftNativeRoute,dialogs:document.querySelectorAll('dialog').length,login:document.getElementById('cloud-login-dialog')?.open})") { println("LOCAL_ENTRY_WEB: $it") }
            }
            Thread.sleep(200)
            fail("Timed out: $label")
        }
        fun shot(name: String) {
            val image = instrumentation.uiAutomation.takeScreenshot()
            assertNotNull(image)
            File(activity.filesDir, "g7-c1-$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        try {
            waitFor("local chat") { activity.model.loggedIn && activity.model.localOnly && !activity.model.loading && activity.model.phone }
            compose.waitForIdle()
            if (phase == "configure") {
                val key = args.getString("modelKey") ?: error("Model credential missing")
                check(key.isNotBlank())
                main { activity.settings.open("models", true) }
                waitFor("model editor") { activity.settings.page == "models" && activity.settings.adding && !activity.settings.loading && activity.settings.home.length() > 0 }
                compose.waitUntil(10000) { compose.onAllNodesWithContentDescription("服务名称").fetchSemanticsNodes().size == 1 }
                compose.onNodeWithContentDescription("服务名称").performScrollTo().performTextReplacement("MiMo")
                compose.onNodeWithContentDescription("服务地址").performScrollTo().performTextReplacement("https://api.xiaomimimo.com/v1")
                compose.onNodeWithContentDescription("密钥").performScrollTo().performTextReplacement(key)
                compose.onNodeWithText("查询模型并继续").performScrollTo().performClick()
                waitFor("model catalog") { !activity.settings.busy && activity.settings.services.isNotEmpty() }
                main { activity.settings.run {
                    val service = activity.settings.services.first()
                    val model = service.getJSONArray("models").objects().first { it.getString("modelId") == "mimo-v2.6-flash" }
                    activity.settings.chooseModel(service, model)
                } }
                waitFor("MiMo selected") { !activity.settings.busy && activity.model.modelId == "mimo-v2.6-flash" }
                shot("model-configured")
                main { activity.model.returnToChat() }
                waitFor("chat visible") { activity.model.tab == "chat" && activity.model.canSend }
                compose.onNodeWithContentDescription("消息输入").performTextInput("请只回复：本机聊天可用。")
                compose.onNodeWithContentDescription("发送消息").performClick()
                waitFor("real model reply") { !activity.model.running && activity.model.rows.any { it.toString().contains("本机聊天可用") && it.toString().contains("assistant") } }
            } else {
                assertEquals("mimo-v2.6-flash", activity.model.modelId)
                waitFor("persisted model reply") { activity.model.rows.any { it.toString().contains("本机聊天可用") && it.toString().contains("assistant") } }
            }
            for (theme in listOf("light", "dark")) {
                runBlocking(Dispatchers.Main) { activity.settings.bridge.call("appearance", JSONObject().put("theme", theme)); activity.model.dark = theme == "dark" }
                compose.mainClock.advanceTimeByFrame()
                main { activity.hideKeyboard() }
                Thread.sleep(250)
                shot("$phase-chat-$theme")
                main { activity.settings.open("account") }
                waitFor("local account") { !activity.settings.loading }
                compose.onNodeWithText("登录以使用云端功能").assertExists()
                shot("$phase-account-$theme")
                main { activity.settings.open("devices") }
                waitFor("local devices") { !activity.settings.loading }
                compose.onNodeWithText("登录以连接设备").assertExists()
                shot("$phase-devices-$theme")
                compose.onNodeWithText("登录以连接设备").performClick()
                var loginOpen = false
                waitFor("optional cloud login") {
                    activity.embeddedWeb.evaluateJavascript("Boolean(document.getElementById('cloud-login-dialog')?.open)") { loginOpen = it == "true" }
                    loginOpen
                }
                shot("$phase-login-$theme")
                main { activity.embeddedWeb.evaluateJavascript("document.querySelector('[aria-label=\"关闭登录\"]')?.click()", null) }
                waitFor("close optional login") {
                    activity.embeddedWeb.evaluateJavascript("Boolean(document.getElementById('cloud-login-dialog')?.open)") { loginOpen = it == "true" }
                    !loginOpen
                }
                main { activity.settings.back(); activity.model.returnToChat() }
                waitFor("return to local chat") { activity.model.tab == "chat" && activity.model.localOnly }
            }
            assertTrue(SecureSettings(activity).host()!!.cookie.isBlank())
            assertTrue(SecureSettings(activity).appValue("credentials").isNullOrBlank())
            try {
                runBlocking(Dispatchers.Main) { activity.model.call("host.business", JSONObject().put("path", "/personal/v1/status")) }
                fail("Local identity must not access a computer")
            } catch (error: ApiFailure) { assertEquals(401, error.status) }
        } finally { main { activity.finish() } }
    }
}
