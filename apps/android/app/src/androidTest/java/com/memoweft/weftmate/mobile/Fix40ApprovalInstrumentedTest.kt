package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File

/** Isolated app + real host/DSH: choose the mode and answer the visible native cards. */
class Fix40ApprovalInstrumentedTest {
    @get:Rule val compose = createEmptyComposeRule()
    private val i = InstrumentationRegistry.getInstrumentation()
    private val args = InstrumentationRegistry.getArguments()
    private val theme get() = args.getString("theme", "light")!!
    private lateinit var activity: NativeActivity
    private fun main(action: () -> Unit) = i.runOnMainSync(action)
    private fun waitFor(label: String, condition: () -> Boolean) {
        val end = System.currentTimeMillis() + 45000
        while (System.currentTimeMillis() < end) { var ok = false; main { ok = condition() }; if (ok) return; Thread.sleep(100) }
        error("Timed out: $label")
    }
    private fun shot(name: String) {
        val image = i.uiAutomation.takeScreenshot()
        try {
            File(i.targetContext.getExternalFilesDir(null), "fix40-$theme-$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        } finally { image.recycle() }
    }
    @Test fun askBeforeFirstMessageThenApproveAndReject() {
        activity = i.startActivitySync(Intent(i.targetContext, NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra("lg1bHostOrigin", args.getString("origin"))) as NativeActivity
        try {
            var booted = false
            waitFor("login boot") { activity.embeddedWeb.evaluateJavascript("Boolean(typeof state!=='undefined' && state.booted)") { booted = it == "true" }; booted }
            val credentials = JSONObject().put("origin", args.getString("origin")).put("username", args.getString("username"))
                .put("password", args.getString("password")).put("deviceName", "FIX-40 synthetic phone")
            main { activity.embeddedWeb.evaluateJavascript("call('auth.login',$credentials).then(()=>location.reload())", null) }
            val workChatId = args.getString("chatId")
            waitFor("native login") { activity.model.loggedIn && !activity.model.loading && !activity.model.approvalModeBusy }
            if (workChatId.isNullOrBlank()) waitFor("native main chat") { activity.model.chatId.isNotBlank() }
            val recovery = args.getString("recovery") == "true"
            if (recovery) {
                var selectedLocal = false
                main { activity.model.launch {
                    val local = activity.model.call("conversations.create")
                    activity.model.select(local); activity.model.setApprovalMode("ask"); selectedLocal = true
                } }
                waitFor("local approval choice") { selectedLocal && activity.model.phone && activity.model.mode == "ask" && !activity.model.approvalModeBusy }
                assertTrue(activity.model.sessionId.isBlank())
            }
            if (!workChatId.isNullOrBlank()) {
                var selected = false
                main { activity.model.launch {
                    val value = activity.model.business("/chats/$workChatId")
                    activity.model.select(value.getJSONObject("chat")); selected = true
                } }
                waitFor("prepared work conversation") { selected && !activity.model.loading && !activity.model.approvalModeBusy }
                assertTrue(activity.model.sessionId.isNotBlank())
            }
            var themeSaved = false
            main { activity.model.launch {
                activity.model.call("settings.appearance", JSONObject().put("value", theme))
                activity.model.dark = theme == "dark"; themeSaved = true
            } }
            waitFor("saved test appearance") { themeSaved }
            compose.waitForIdle()
            if (workChatId.isNullOrBlank()) assertEquals("first choice precedes native session creation", "", activity.model.sessionId)
            assertFalse("first choice precedes any test message", activity.model.rows.toString().contains("FIX40_ANDROID"))
            val editor = compose.onNodeWithContentDescription("消息输入")
            editor.performTextInput("FIX40_ANDROID_ALLOW")
            compose.onNodeWithContentDescription("审批方式：自动").performClick()
            compose.onNodeWithText("每次询问", useUnmergedTree = true).performClick()
            waitFor("saved ask or retryable save") { !activity.model.approvalModeBusy && (activity.model.mode == "ask" || recovery && activity.model.error.contains("审批方式未保存")) }
            compose.waitUntil(10000) { compose.onAllNodesWithText("每次询问", useUnmergedTree = true).fetchSemanticsNodes().isEmpty() }
            compose.waitForIdle()
            shot("selected-before-first-message")
            compose.onNodeWithContentDescription("发送消息").performClick()
            waitFor("allow card") { activity.model.approvals.any { it.optString("status") == "pending" } }
            assertEquals("ask", activity.model.mode)
            assertFalse(activity.model.approvals.first { it.optString("status") == "pending" }.optBoolean("canAlwaysAllow"))
            val approve = compose.onNodeWithText("批准", useUnmergedTree = true)
            approve.performScrollTo().assertIsDisplayed(); compose.waitForIdle(); shot("allow-pending")
            approve.performClick()
            waitFor("approved result") { !activity.model.running && activity.model.rows.toString().contains("FIX40_FINISHED_ANDROID_ALLOW") }
            compose.waitForIdle()
            shot("approved")
            editor.performTextInput("FIX40_ANDROID_REJECT")
            compose.onNodeWithContentDescription("发送消息").performClick()
            waitFor("reject card") { activity.model.approvals.any { it.optString("status") == "pending" } }
            val reject = compose.onNodeWithText("拒绝", useUnmergedTree = true)
            reject.performScrollTo().assertIsDisplayed(); compose.waitForIdle(); shot("reject-pending")
            reject.performClick()
            waitFor("rejected result") { !activity.model.running && activity.model.rows.toString().contains("FIX40_FINISHED_ANDROID_REJECT") }
            compose.waitForIdle()
            shot("rejected")
        } catch (error: Throwable) {
            var state = JSONObject()
            main { val m = activity.model; state = JSONObject().put("mode", m.mode).put("busy", m.approvalModeBusy)
                .put("loggedIn",m.loggedIn).put("loading",m.loading).put("refreshPhase",m.refreshPhase).put("connected",m.connected)
                .put("draft", m.draft).put("sessionId", m.sessionId).put("chatId", m.chatId).put("running", m.running)
                .put("sendAvailable", m.sendAvailable).put("error", m.error).put("approvals", m.approvals.toString()).put("rows", m.rows.toString()) }
            File(i.targetContext.getExternalFilesDir(null), "fix40-failure.json").writeText(state.toString())
            shot("failure")
            throw error
        } finally { main { activity.finish() } }
    }
}
