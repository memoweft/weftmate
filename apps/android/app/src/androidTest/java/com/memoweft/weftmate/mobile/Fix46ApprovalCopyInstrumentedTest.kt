package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import android.view.WindowInsetsController
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.platform.ComposeView
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Real native UI + isolated real DSH host. The installed account and its preferences are untouched. */
class Fix46ApprovalCopyInstrumentedTest {
    @get:Rule val compose = createEmptyComposeRule()
    private val i = InstrumentationRegistry.getInstrumentation()
    private val args = InstrumentationRegistry.getArguments()
    private lateinit var activity: NativeActivity
    private fun main(action: () -> Unit) = i.runOnMainSync(action)
    private fun waitFor(label: String, condition: () -> Boolean) {
        val end = System.currentTimeMillis() + 45000
        while (System.currentTimeMillis() < end) { var ok = false; main { ok = condition() }; if (ok) return; Thread.sleep(100) }
        error("Timed out: $label")
    }
    private suspend fun request(method: String, params: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val connection = URL(args.getString("origin") + "/request").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"; connection.doOutput = true; connection.connectTimeout = 10000; connection.readTimeout = 30000
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(JSONObject().put("method", method).put("params", params).toString().toByteArray()) }
            check(connection.responseCode == 200) { "FIX46_TEST_HOST_REQUEST_FAILED: $method" }
            JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally { connection.disconnect() }
    }
    private fun shot(name: String) {
        compose.waitForIdle()
        main { activity.window.insetsController?.setSystemBarsAppearance(
            if(args.getString("theme") == "dark") 0 else WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS) }
        Thread.sleep(300)
        val bitmap = i.uiAutomation.takeScreenshot()
        try { File(activity.getExternalFilesDir(null), "fix46-${args.getString("theme") }-$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } }
        finally { bitmap.recycle() }
    }
    @Test fun humanCardDetailsAndRejectedSummary() {
        assertEquals("com.memoweft.weftmate.mobile.debug", i.targetContext.packageName)
        activity = i.startActivitySync(Intent(i.targetContext, NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as NativeActivity
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        try {
            waitFor("existing account") { activity.model.loggedIn && !activity.model.loading }
            val preferences = activity.getSharedPreferences("fix46-isolated-presentation", 0)
            val environment = object : NativeChatEnvironment {
                override val preferences = preferences
                override val foreground = false
                override suspend fun request(method: String, params: JSONObject) = this@Fix46ApprovalCopyInstrumentedTest.request(method, params)
                override suspend fun phone(action: String, params: JSONObject) = JSONObject()
                override suspend fun presentation(script: String) = JSONObject()
                override suspend fun directory() = JSONObject()
                override fun showLogin() = error("Unexpected test login")
            }
            var selected = false
            main {
                activity.model.close()
                val model = NativeChatModel(environment, scope)
                model.owner = "FIX46-synthetic"; model.loggedIn = true; model.loading = false
                model.workAndChat = true; model.dark = args.getString("theme") == "dark"
                activity.model = model
                activity.presentationContainer.removeAllViews()
                activity.presentationContainer.addView(ComposeView(activity).apply { setContent { NativeShell(model, activity) } })
                scope.launch {
                    val chat = model.business("/chats/${args.getString("chatId")}").getJSONObject("chat")
                    model.select(chat); selected = true
                }
            }
            waitFor("pending approval") { selected && activity.model.approvals.any { it.optString("status") == "pending" } }
            compose.onNodeWithText("批准", useUnmergedTree = true).performScrollTo().assertIsDisplayed()
            compose.onAllNodesWithText("[weftmate:", substring = true, useUnmergedTree = true).assertCountEquals(0)
            compose.onAllNodesWithText("file_path", substring = true, useUnmergedTree = true).assertCountEquals(0)
            compose.onAllNodesWithText("write", useUnmergedTree = true).assertCountEquals(0)
            shot("card")
            compose.onNodeWithText("查看详情", useUnmergedTree = true).performClick()
            compose.onNodeWithText("file_path", substring = true, useUnmergedTree = true).assertExists()
            shot("details")
            compose.onNodeWithText("查看详情", useUnmergedTree = true).performClick()
            compose.onNodeWithText("拒绝", useUnmergedTree = true).performScrollTo().performClick()
            waitFor("rejection receipt") { activity.model.approvals.any { it.optString("outcome", it.optString("decisionOutcome")) == "rejected" } }
            main { scope.launch { repeat(30) { delay(500); activity.model.refresh(); if(!activity.model.running) return@launch } } }
            waitFor("completed reply") { !activity.model.running && activity.model.rows.any { it.optString("type") == "assistant.message" } }
            compose.waitUntil(15000) { compose.onAllNodesWithText("你拒绝了", substring = true, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
            var summary = ""
            main { scope.launch { summary = activity.timelinePresentation(activity.model.rows, activity.model.approvals, activity.model.questions)
                .first { it.optString("type") == "native.progress" }.getJSONObject("data").getString("summary") } }
            waitFor("shared rejection summary") { summary.isNotEmpty() }
            assertTrue(summary.contains("fix46-android_reject.txt")); assertTrue(summary.contains("没有做"))
            compose.onNodeWithText(summary, useUnmergedTree = true).performScrollTo().assertIsDisplayed()
            compose.onAllNodesWithText("步重试", substring = true, useUnmergedTree = true).assertCountEquals(0)
            shot("rejected")
        } finally {
            main { activity.model.close(); activity.finish() }; scope.cancel()
            // Only this test's separate presentation preferences are cleared.
            i.targetContext.getSharedPreferences("fix46-isolated-presentation", 0).edit().clear().commit()
        }
    }
}
