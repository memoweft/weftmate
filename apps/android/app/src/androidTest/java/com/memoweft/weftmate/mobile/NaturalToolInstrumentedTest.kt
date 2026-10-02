package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

/** One natural-language attempt. A text-only promise fails this test. */
@RunWith(AndroidJUnit4::class)
class NaturalToolInstrumentedTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private fun onUi(block: () -> Unit) = instrumentation.runOnMainSync(block)
    private fun waitUntil(timeoutMs: Long, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            var yes = false
            onUi { yes = condition() }
            if (yes) return
            Thread.sleep(250)
        }
        fail("Native flow timed out")
    }

    @Test fun spokenSettingsGoalRequiresActualToolAndVisibleSettingsWindow() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("Explicit runNaturalTool=1 is required for real model inference", args.getString("runNaturalTool") == "1")
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
            val host = SecureSettings(instrumentation.targetContext).host() ?: throw AssertionError("Login not retained")
            val owner = Endpoints.ownerKey(host.origin, host.ownerId)
            val db = LocalStore(instrumentation.targetContext)
            val before = db.listConversations(owner).map { it.id }.toSet()
            WeaveTestPaths.newChat(activity)
            var conversationId: String? = null
            waitUntil(5_000) {
                conversationId = db.listConversations(owner).firstOrNull { it.id !in before }?.id
                conversationId != null
            }
            onUi {
                activity.findViewById<EditText>(R.id.composer).setText("请打开这台手机的系统设置，完成后简短告诉我结果。")
                activity.findViewById<Button>(R.id.send_button).performClick()
            }
            val id = conversationId ?: throw AssertionError("No local conversation")
            waitUntil(420_000) { db.latestTurnStatus(id)?.let { it != "running" } == true }
            val terminal = db.latestTurnStatus(id)
            val receipts = db.toolReceipts(id, owner)
            assertTrue("Model did not call a phone settings tool",
                receipts.any { it.optString("status") == "dispatched" &&
                    it.optString("toolName") in setOf("open_settings", "open_app") })
            assertEquals("completed", terminal)
            Thread.sleep(1000)
            val target = File(instrumentation.targetContext.getExternalFilesDir(null), "weftmate-natural-settings.png")
            val bitmap: Bitmap = instrumentation.uiAutomation.takeScreenshot()
            FileOutputStream(target).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            println("SCREENSHOT_PATH=${target.absolutePath}")
            val descriptor = instrumentation.uiAutomation.executeShellCommand("dumpsys activity activities")
            val foreground = FileInputStream(descriptor.fileDescriptor).bufferedReader().use { reader ->
                reader.lineSequence().filter { it.contains("topResumedActivity") || it.contains("mResumedActivity") }
                    .take(4).toList()
            }
            descriptor.close()
            assertTrue("Android Settings was not the resumed foreground activity",
                foreground.any { it.contains("com.android.settings") })
            db.close()
        } finally { onUi { activity.finish() } }
    }
}
