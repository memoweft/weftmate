package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import android.view.View
import android.widget.Button
import android.widget.EditText
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** One real UI Stop against a blocked synthetic model socket. No external model request. */
@RunWith(AndroidJUnit4::class)
class StopActualInstrumentedTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private fun ui(action: () -> Unit) = instrumentation.runOnMainSync(action)
    private fun waitUntil(timeoutMs: Long, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            var ready = false
            ui { ready = condition() }
            if (ready) return
            Thread.sleep(100)
        }
        fail("Timed out waiting for actual Stop lifecycle")
    }
    private fun screenshot(name: String) {
        instrumentation.waitForIdleSync()
        val target = File(instrumentation.targetContext.getExternalFilesDir(null), name)
        val bitmap: Bitmap = instrumentation.uiAutomation.takeScreenshot()
        FileOutputStream(target).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        println("SCREENSHOT_PATH=${target.absolutePath}")
    }

    @Test fun visibleStopCancelsBlockedRequestAndPersistsCancelledTurn() {
        val context = instrumentation.targetContext
        val settings = SecureSettings(context)
        val host = settings.host()
        val previousModel = settings.model()
        assumeTrue("Only the isolated synthetic account is allowed",
            host?.username == "android-acceptance" && host.origin == "http://127.0.0.1:18187" && previousModel != null)
        val encrypted = context.getSharedPreferences("private-settings", android.content.Context.MODE_PRIVATE)
        val oldModelBlob = encrypted.getString("model", null)
        val oldLibraryBlob = encrypted.getString("models_v2", null)
        val modelScopeKey = "models_v3:${Endpoints.ownerKey(host!!.origin, host.ownerId)}"
        val oldScopedBlob = encrypted.getString(modelScopeKey, null)
        val oldMigrationMarker = encrypted.getBoolean("models_v3_migrated", false)
        val owner = Endpoints.ownerKey(host!!.origin, host.ownerId)
        val accepted = CountDownLatch(1)
        val release = CountDownLatch(1)
        ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { server ->
            var clientSocket: Socket? = null
            val listener = Thread {
                try {
                    clientSocket = server.accept()
                    accepted.countDown()
                    release.await(20, TimeUnit.SECONDS) // Intentionally no HTTP response headers.
                } catch (_: Exception) { }
                finally { clientSocket?.close() }
            }.apply { start() }
            val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            val db = LocalStore(context)
            try {
                Thread.sleep(700)
                val modelSheet = WeaveTestPaths.openSettings(activity, "对话模型")
                ui {
                    modelSheet.findViewById<EditText>(R.id.model_endpoint_input)
                        .setText("http://127.0.0.1:${server.localPort}/v1")
                    modelSheet.findViewById<EditText>(R.id.model_id_input).setText("synthetic-blocked-model")
                    modelSheet.findViewById<EditText>(R.id.model_key_input).setText("")
                    modelSheet.findViewById<Button>(R.id.save_model_button).performClick()
                }
                val modelDeadline = System.currentTimeMillis() + 5_000
                while (System.currentTimeMillis() < modelDeadline && settings.model()?.modelId != "synthetic-blocked-model") {
                    Thread.sleep(100)
                }
                assertEquals("synthetic-blocked-model", settings.model()?.modelId)
                val before = db.listConversations(owner).map { it.id }.toSet()
                ui { modelSheet.dismiss() }
                WeaveTestPaths.newChat(activity)
                var conversationId: String? = null
                waitUntil(5_000) {
                    conversationId = db.listConversations(owner).firstOrNull { it.id !in before }?.id
                    conversationId != null
                }
                val id = conversationId ?: throw AssertionError("No synthetic conversation")
                ui {
                    activity.findViewById<EditText>(R.id.composer).setText("这是取消验证，不应得到模型回复")
                    activity.findViewById<Button>(R.id.send_button).performClick()
                }
                assertTrue("Synthetic model socket was not reached", accepted.await(7, TimeUnit.SECONDS))
                waitUntil(3_000) {
                    activity.findViewById<Button>(R.id.stop_button).isShown
                }
                WeaveTestPaths.openPhoneRecords(activity)
                val readonlyStop = WeaveTestPaths.byDescription(activity.window.decorView, "停止当前手机回复")
                ui { assertFalse(activity.findViewById<Button>(R.id.send_button).isShown) }
                assertTrue("Stop must remain available in readonly records", readonlyStop?.isShown == true)
                screenshot("weftmate-stop-readonly-live-blocked.png")
                ui { assertTrue(readonlyStop!!.performClick()) }
                waitUntil(10_000) { db.latestTurnStatus(id) == "cancelled" }
                assertEquals(0, db.messages(id, owner).count { it.role == "assistant" })
                waitUntil(3_000) { readonlyStop?.visibility == View.GONE }
                var sendReady = false
                WeaveTestPaths.backToChat(activity)
                ui { sendReady = activity.findViewById<Button>(R.id.send_button).isShown }
                assertTrue("Composer did not recover after Stop", sendReady)
                println("STOP_VERIFIED=actual_ui_cancelled_no_assistant")
            } finally {
                release.countDown()
                clientSocket?.close()
                server.close()
                listener.join(3_000)
                db.close()
                val restore = encrypted.edit()
                if (oldModelBlob == null) restore.remove("model") else restore.putString("model", oldModelBlob)
                if (oldLibraryBlob == null) restore.remove("models_v2") else restore.putString("models_v2", oldLibraryBlob)
                if (oldScopedBlob == null) restore.remove(modelScopeKey) else restore.putString(modelScopeKey, oldScopedBlob)
                restore.putBoolean("models_v3_migrated", oldMigrationMarker)
                assertTrue("Encrypted model settings were not restored", restore.commit())
                ui { activity.finish() }
            }
        }
    }
}
