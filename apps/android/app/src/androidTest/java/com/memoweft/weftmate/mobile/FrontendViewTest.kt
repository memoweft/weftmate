package com.memoweft.weftmate.mobile

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Build
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.inputmethod.InputMethodManager
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
import java.io.FileOutputStream

/** Native Weave view regression. Never sends a model request. */
@RunWith(AndroidJUnit4::class)
class FrontendViewTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private fun ui(action: () -> Unit) = instrumentation.runOnMainSync(action)
    private fun activity(): MainActivity = instrumentation.startActivitySync(
        Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    ) as MainActivity
    private fun screenshot(name: String) {
        instrumentation.waitForIdleSync(); Thread.sleep(350)
        val target = File(instrumentation.targetContext.getExternalFilesDir(null), name)
        val bitmap: Bitmap = instrumentation.uiAutomation.takeScreenshot()
        FileOutputStream(target).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        println("SCREENSHOT_PATH=${target.absolutePath}")
    }
    private fun textIn(root: View): String = buildString {
        if (root is TextView) append(root.text.toString()).append('\n')
        if (root is ViewGroup) for (i in 0 until root.childCount) append(textIn(root.getChildAt(i)))
    }

    @Test fun composerAndVisibleStopLayoutStayAboveActuallyDrawnIme() {
        val activity = activity()
        try {
            Thread.sleep(700)
            ui {
                val composer = activity.findViewById<EditText>(R.id.composer)
                composer.setText("输入测试草稿；不发送模型请求")
                composer.requestFocus(); composer.performClick()
                (activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                    .showSoftInput(composer, InputMethodManager.SHOW_IMPLICIT)
            }
            if (Build.VERSION.SDK_INT < 30) { println("IME_NOT_VERIFIED=API_BELOW_30"); assumeTrue(false) }
            var bottom = 0; var stable = 0
            val deadline = System.currentTimeMillis() + 7_000
            while (System.currentTimeMillis() < deadline && stable < 4) {
                var next = 0; var visible = false
                ui {
                    val insets = activity.window.decorView.rootWindowInsets
                    visible = insets?.isVisible(WindowInsets.Type.ime()) == true
                    next = insets?.getInsets(WindowInsets.Type.ime())?.bottom ?: 0
                }
                if (visible && next >= 120 && next == bottom) stable++ else { bottom = next; stable = 0 }
                Thread.sleep(150)
            }
            if (stable < 4) {
                println("IME_NOT_VERIFIED=no_stable_drawn_inset")
                screenshot("weave12-composer-no-drawn-ime.png")
                assumeTrue("IME was not actually drawn on this emulator", false)
            }
            val stop = activity.findViewById<Button>(R.id.stop_button)
            val composerRect = Rect(); val sendRect = Rect(); val stopRect = Rect()
            ui { stop.visibility = View.VISIBLE }
            instrumentation.waitForIdleSync(); Thread.sleep(300)
            ui {
                activity.findViewById<EditText>(R.id.composer).getGlobalVisibleRect(composerRect)
                activity.findViewById<Button>(R.id.send_button).getGlobalVisibleRect(sendRect)
                stop.getGlobalVisibleRect(stopRect)
            }
            assertTrue(composerRect.height() > 0 && sendRect.height() > 0 && stopRect.height() > 0)
            val keyboardTop = activity.window.decorView.rootView.height - bottom
            assertTrue("Composer covered by drawn IME", composerRect.bottom <= keyboardTop + 4)
            assertTrue("Send covered by drawn IME", sendRect.bottom <= keyboardTop + 4)
            assertTrue("Stop layout covered by drawn IME", stopRect.bottom <= keyboardTop + 4)
            println("IME_DRAWN_BOTTOM=$bottom STOP_LAYOUT_ONLY=true")
            screenshot("weave12-ime-drawn-layout.png")
            ui { stop.visibility = View.GONE }
        } finally { ui { activity.finish() } }
    }

    @Test fun sheetDrawerAndReadonlyRecordsPreserveDraft() {
        val activity = activity()
        try {
            Thread.sleep(700)
            val selectedField = MainActivity::class.java.getDeclaredField("selectedConversation").apply { isAccessible = true }
            val selected = selectedField.get(activity)
            ui { activity.findViewById<EditText>(R.id.composer).setText("留在本机会话的草稿") }
            val settings = WeaveTestPaths.openSettings(activity)
            screenshot("weave12-settings-home-real.png")
            ui { WeaveTestPaths.clickable(WeaveTestPaths.byText(settings.window!!.decorView, "电脑账户与连接")).performClick() }
            assertEquals("", settings.findViewById<EditText>(R.id.password_input).text.toString())
            ui { WeaveTestPaths.byDescription(settings.window!!.decorView, "返回设置")?.performClick() }
            ui { WeaveTestPaths.clickable(WeaveTestPaths.byText(settings.window!!.decorView, "对话模型")).performClick() }
            assertEquals("", settings.findViewById<EditText>(R.id.model_key_input).text.toString())
            screenshot("weave12-settings-model-real.png")
            ui { settings.dismiss() }
            assertEquals("留在本机会话的草稿", activity.findViewById<EditText>(R.id.composer).text.toString())
            assertEquals(selected, selectedField.get(activity))

            WeaveTestPaths.openPhoneRecords(activity)
            WeaveTestPaths.waitUntil { textIn(activity.findViewById(R.id.transcript)).contains("手机记录") }
            val recordText = textIn(activity.findViewById(R.id.transcript))
            assertFalse(recordText.contains(" · user · "))
            assertFalse(recordText.contains("回复 completed"))
            screenshot("weave12-phone-records-real.png")
            WeaveTestPaths.backToChat(activity)
            assertEquals("留在本机会话的草稿", activity.findViewById<EditText>(R.id.composer).text.toString())
            assertEquals(selected, selectedField.get(activity))
            WeaveTestPaths.openComputerSessions(activity)
            screenshot("weave12-computer-sessions-real.png")
        } finally { ui { activity.finish() } }
    }

    @Test fun readonlyNavigationCannotSendOrOverwriteChat() {
        val activity = activity(); val db = LocalStore(instrumentation.targetContext)
        try {
            Thread.sleep(700)
            val host = SecureSettings(instrumentation.targetContext).host()
            val owner = host?.let { Endpoints.ownerKey(it.origin, it.ownerId) }
            fun messageCount() = db.listConversations(owner).sumOf { db.messages(it.id, owner).size }
            val before = messageCount()
            val selectedField = MainActivity::class.java.getDeclaredField("selectedConversation").apply { isAccessible = true }
            val selected = selectedField.get(activity)
            ui { activity.findViewById<EditText>(R.id.composer).setText("仍在原会话的草稿") }
            val drawer = WeaveTestPaths.openDrawer(activity)
            ui {
                assertTrue(WeaveTestPaths.clickable(WeaveTestPaths.byText(drawer.window!!.decorView, "手机记录")).performClick())
                assertFalse(activity.findViewById<Button>(R.id.send_button).isShown)
                activity.findViewById<Button>(R.id.send_button).performClick() // Guarded even if invoked programmatically.
                assertTrue(WeaveTestPaths.byDescription(activity.window.decorView, "返回对话")?.performClick() == true)
            }
            Thread.sleep(550)
            assertEquals(before, messageCount())
            assertEquals(selected, selectedField.get(activity))
            assertEquals("仍在原会话的草稿", activity.findViewById<EditText>(R.id.composer).text.toString())
            assertFalse(textIn(activity.findViewById(R.id.transcript)).contains("同一账户下已同步的手机来源内容"))

            val nextDrawer = WeaveTestPaths.openDrawer(activity)
            ui {
                assertTrue(WeaveTestPaths.clickable(WeaveTestPaths.byText(nextDrawer.window!!.decorView, "电脑会话")).performClick())
                assertFalse(activity.findViewById<Button>(R.id.send_button).isShown)
                assertTrue(WeaveTestPaths.byDescription(activity.window.decorView, "返回对话")?.performClick() == true)
            }
            Thread.sleep(1_200)
            assertEquals(before, messageCount())
            assertEquals(selected, selectedField.get(activity))
            assertEquals("仍在原会话的草稿", activity.findViewById<EditText>(R.id.composer).text.toString())
            assertFalse(textIn(activity.findViewById(R.id.transcript)).contains("电脑会话 · 只读"))
        } finally { db.close(); ui { activity.finish() } }
    }
}
