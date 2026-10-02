package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Build
import android.view.WindowInsets
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.content.Context
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream

/** Opt-in real phone process flow. The only model endpoint is caller-provided; no default inference. */
@RunWith(AndroidJUnit4::class)
class NativeFlowInstrumentedTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private fun onUi(action: () -> Unit) = instrumentation.runOnMainSync(action)
    private fun waitUntil(timeoutMs: Long, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            var done = false
            onUi { done = condition() }
            if (done) return
            Thread.sleep(250)
        }
        fail("Timed out waiting for native UI state")
    }
    private fun screenshot(name: String) {
        val target = File(instrumentation.targetContext.getExternalFilesDir(null), name)
        val bitmap: Bitmap = instrumentation.uiAutomation.takeScreenshot()
        FileOutputStream(target).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        println("SCREENSHOT_PATH=${target.absolutePath}")
    }
    private fun visibleText(root: View, value: String): Boolean {
        if (root is TextView && root.text?.contains(value) == true && root.isLaidOut && root.getGlobalVisibleRect(Rect())) return true
        if (root is ViewGroup) for (index in 0 until root.childCount) if (visibleText(root.getChildAt(index), value)) return true
        return false
    }

    @Test fun loginConfigureChatAndDispatchPhoneSettingsFromRealUi() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("Set runInference=1 and synthetic fixture parameters to request real inference",
            args.getString("runInference") == "1")
        val origin = args.getString("syncOrigin") ?: throw AssertionError("Missing synthetic syncOrigin")
        val user = args.getString("syncUser") ?: throw AssertionError("Missing synthetic syncUser")
        val password = args.getString("syncPassword") ?: throw AssertionError("Missing synthetic syncPassword")
        val modelOrigin = args.getString("modelOrigin") ?: throw AssertionError("Missing explicit modelOrigin")
        val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        try {
            Thread.sleep(800)
            val accountSheet = WeaveTestPaths.openSettings(activity, "电脑账户与连接")
            onUi {
                accountSheet.findViewById<EditText>(R.id.origin_input).setText(origin)
                accountSheet.findViewById<EditText>(R.id.username_input).setText(user)
                accountSheet.findViewById<EditText>(R.id.password_input).setText(password)
                accountSheet.findViewById<Button>(R.id.login_button).performClick()
            }
            waitUntil(30_000) { activity.findViewById<TextView>(R.id.status_text).text.contains("已登录") }
            onUi { accountSheet.dismiss() }
            val modelSheet = WeaveTestPaths.openSettings(activity, "对话模型")
            onUi {
                modelSheet.findViewById<EditText>(R.id.model_endpoint_input).setText(modelOrigin)
                modelSheet.findViewById<EditText>(R.id.model_id_input).setText("occamy-miniplus-v21")
                modelSheet.findViewById<Button>(R.id.save_model_button).performClick()
            }
            waitUntil(15_000) { activity.findViewById<TextView>(R.id.status_text).text.contains("手机模型已配置") }
            onUi { modelSheet.dismiss() }
            val host = SecureSettings(instrumentation.targetContext).host() ?: throw AssertionError("Login was not retained")
            val owner = Endpoints.ownerKey(host.origin, host.ownerId)
            val db = LocalStore(instrumentation.targetContext)
            val before = db.listConversations(owner).map { it.id }.toSet()
            WeaveTestPaths.newChat(activity)
            var conversationId: String? = null
            waitUntil(5_000) {
                conversationId = db.listConversations(owner).firstOrNull { it.id !in before }?.id
                conversationId != null
            }
            val id = conversationId ?: throw AssertionError("New conversation not persisted")
            val selectedField = MainActivity::class.java.getDeclaredField("selectedConversation").apply { isAccessible = true }
            waitUntil(5_000) { selectedField.get(activity) == id }
            onUi {
                activity.findViewById<EditText>(R.id.composer).setText("保留的草稿")
            }
            val settingsCheck = WeaveTestPaths.openSettings(activity)
            onUi { settingsCheck.dismiss() }
            assertEquals("保留的草稿", activity.findViewById<EditText>(R.id.composer).text.toString())
            assertEquals(id, selectedField.get(activity))
            assertNotNull(activity.findViewById<LinearLayout>(R.id.transcript))
            onUi {
                val composer = activity.findViewById<EditText>(R.id.composer)
                composer.setText("请用一句话回答：安卓手机助手已经开始独立聊天。不要调用工具。")
                composer.requestFocus()
                composer.performClick()
                (activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                    .showSoftInput(composer, InputMethodManager.SHOW_IMPLICIT)
            }
            val imeDeadline = System.currentTimeMillis() + 3_000
            var imeVisible = false
            while (System.currentTimeMillis() < imeDeadline && !imeVisible) {
                onUi { imeVisible = Build.VERSION.SDK_INT >= 30 &&
                    activity.window.decorView.rootWindowInsets?.isVisible(WindowInsets.Type.ime()) == true }
                if (!imeVisible) Thread.sleep(100)
            }
            var sendVisible = false
            onUi { sendVisible = activity.findViewById<Button>(R.id.send_button).getGlobalVisibleRect(Rect()) }
            assertTrue("Send button must be visible", sendVisible)
            println("IME_VISIBLE=$imeVisible")
            screenshot(if (imeVisible) "weftmate-ime-flow.png" else "weftmate-composer-no-ime.png")
            onUi { activity.findViewById<Button>(R.id.send_button).performClick() }
            waitUntil(420_000) {
                db.latestTurnStatus(id) == "completed" && db.messages(id, owner).any { it.role == "assistant" }
            }
            val assistantText = db.messages(id, owner).last { it.role == "assistant" }.text
            waitUntil(15_000) {
                visibleText(activity.findViewById<LinearLayout>(R.id.transcript), assistantText.take(80))
            }
            instrumentation.waitForIdleSync()
            Thread.sleep(500)
            screenshot("weftmate-real-reply.png")
            onUi { assertTrue(WeaveTestPaths.byDescription(activity.window.decorView, "添加手机动作")?.performClick() == true) }
            val actions = MainActivity::class.java.getDeclaredField("phoneActionsDialog").apply { isAccessible = true }
                .get(activity) as android.app.AlertDialog
            WeaveTestPaths.waitUntil { actions.isShowing && actions.listView.childCount >= 2 }
            onUi { actions.listView.performItemClick(actions.listView.getChildAt(1), 1, actions.listView.adapter.getItemId(1)) }
            Thread.sleep(1200)
            screenshot("weftmate-open-settings.png")
            instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
            Thread.sleep(600)
            assertTrue(db.listConversations(owner).any { conversation ->
                db.toolReceipts(conversation.id, owner).any {
                    it.optString("toolName") == "open_settings" && it.optString("status") == "dispatched"
                }
            })
            db.close()
        } finally { onUi { activity.finish() } }
    }
}
