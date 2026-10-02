package com.memoweft.weftmate.mobile

import android.app.Dialog
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Rect
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.ScrollView
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream

/** Four native Weave screens, reached through visible controls. No model request. */
@RunWith(AndroidJUnit4::class)
class WeaveVisualProbeTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private fun ui(action: () -> Unit) = instrumentation.runOnMainSync(action)
    private fun dialog(activity: MainActivity, field: String): Dialog =
        MainActivity::class.java.getDeclaredField(field).apply { isAccessible = true }.get(activity) as Dialog

    private fun byDescription(root: View, value: String): View? {
        if (root.contentDescription?.toString() == value) return root
        if (root is ViewGroup) for (i in 0 until root.childCount) {
            byDescription(root.getChildAt(i), value)?.let { return it }
        }
        return null
    }
    private fun byText(root: View, value: String): TextView? {
        if (root is TextView && root.isShown && root.text.toString() == value) return root
        if (root is ViewGroup) for (i in 0 until root.childCount) {
            byText(root.getChildAt(i), value)?.let { return it }
        }
        return null
    }
    private fun clickRow(view: View?) {
        var current = view ?: throw AssertionError("Visible setting row not found")
        while (!current.isClickable && current.parent is View) current = current.parent as View
        assertTrue("Setting row is not actionable", current.isClickable)
        assertTrue(current.performClick())
    }
    private fun waitUntil(timeoutMs: Long, check: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            var passed = false
            ui { passed = check() }
            if (passed) return
            Thread.sleep(100)
        }
        fail("Native visible screen did not settle")
    }
    private fun capture(name: String, required: View) {
        waitUntil(3_000) { required.isShown && required.isLaidOut && required.getGlobalVisibleRect(Rect()) }
        instrumentation.waitForIdleSync()
        Thread.sleep(400)
        val path = File(instrumentation.targetContext.getExternalFilesDir(null), name)
        val image: Bitmap = instrumentation.uiAutomation.takeScreenshot()
        FileOutputStream(path).use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        println("SCREENSHOT_PATH=${path.absolutePath}")
    }

    @Test fun emptyChatDrawerSettingsHomeAndModelChildMatchVisibleNavigation() {
        val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        val drawer = dialog(activity, "drawerDialog")
        val settings = dialog(activity, "settingsDialog")
        val composer = activity.findViewById<EditText>(R.id.composer)
        val originalDraft = composer.text.toString()
        try {
            ui { assertTrue(byDescription(activity.window.decorView, "打开会话导航")?.performClick() == true) }
            waitUntil(3_000) { drawer.isShowing }
            ui { assertTrue(drawer.findViewById<View>(R.id.new_conversation_button)?.performClick() == true) }
            val welcome = activity.findViewById<View>(R.id.transcript)
            waitUntil(5_000) { byText(welcome, "你好，慢慢聊。")?.isShown == true }
            val connection = activity.findViewById<TextView>(R.id.welcome_connection)
            val chatScroll = activity.findViewById<ScrollView>(R.id.chat_scroll)
            waitUntil(5_000) {
                val line = Rect(); val viewport = Rect()
                connection.isShown && connection.height > 0 && connection.getGlobalVisibleRect(line) &&
                    chatScroll.getGlobalVisibleRect(viewport) &&
                    line.top >= viewport.top && line.bottom <= viewport.bottom && line.height() >= connection.height - 2
            }
            capture("weave12-empty-chat.png", byText(welcome, "你好，慢慢聊。")!!)

            ui { assertTrue(byDescription(activity.window.decorView, "打开会话导航")?.performClick() == true) }
            waitUntil(3_000) { drawer.isShowing }
            capture("weave12-drawer.png", drawer.findViewById<View>(R.id.drawer_search)
                ?: throw AssertionError("Drawer search missing"))

            ui { assertTrue(drawer.findViewById<View>(R.id.settings_toggle)?.performClick() == true) }
            waitUntil(3_000) { settings.isShowing }
            val settingsHome = byText(settings.window!!.decorView, "设置")
                ?: throw AssertionError("Settings sheet title missing")
            capture("weave12-settings-home.png", settingsHome)

            ui { clickRow(byText(settings.window!!.decorView, "对话模型")) }
            val model = settings.findViewById<View>(R.id.model_endpoint_input)
                ?: throw AssertionError("Model setting input missing")
            capture("weave12-settings-model.png", model)
            assertTrue("Model child did not replace home", model.isShown)
            ui { assertTrue(byDescription(settings.window!!.decorView, "返回设置")?.performClick() == true) }
            ui { clickRow(byText(settings.window!!.decorView, "能力与规划")) }
            val planned = byText(settings.window!!.decorView, "能力与规划")
                ?: throw AssertionError("Planning page title missing")
            capture("weave12-settings-plan.png", planned)
        } finally {
            ui {
                composer.setText(originalDraft)
                if (settings.isShowing) settings.dismiss()
                if (drawer.isShowing) drawer.dismiss()
                activity.finish()
            }
        }
    }
}
