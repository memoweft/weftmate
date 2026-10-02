package com.memoweft.weftmate.mobile

import android.app.Dialog
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue

/** Click only normal visible controls. Reflection obtains native Dialog references, not product backdoors. */
object WeaveTestPaths {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    fun ui(action: () -> Unit) = instrumentation.runOnMainSync(action)
    fun dialog(activity: MainActivity, field: String): Dialog =
        MainActivity::class.java.getDeclaredField(field).apply { isAccessible = true }.get(activity) as Dialog
    fun byDescription(root: View, value: String): View? {
        if (root.contentDescription?.toString() == value) return root
        if (root is ViewGroup) for (index in 0 until root.childCount) {
            byDescription(root.getChildAt(index), value)?.let { return it }
        }
        return null
    }
    fun byText(root: View, value: String): TextView? {
        if (root is TextView && root.text.toString() == value) return root
        if (root is ViewGroup) for (index in 0 until root.childCount) {
            byText(root.getChildAt(index), value)?.let { return it }
        }
        return null
    }
    fun clickable(view: View?): View {
        var current = view ?: throw AssertionError("Visible control missing")
        while (!current.isClickable && current.parent is View) current = current.parent as View
        assertTrue("Visible row is not clickable", current.isClickable)
        return current
    }
    fun waitUntil(timeoutMs: Long = 5_000, predicate: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            var ready = false
            ui { ready = predicate() }
            if (ready) return
            Thread.sleep(100)
        }
        throw AssertionError("Visible navigation did not settle")
    }
    fun openDrawer(activity: MainActivity): Dialog {
        ui { assertTrue(byDescription(activity.window.decorView, "打开会话导航")?.performClick() == true) }
        val drawer = dialog(activity, "drawerDialog")
        waitUntil { drawer.isShowing }
        return drawer
    }
    fun newChat(activity: MainActivity) {
        val drawer = openDrawer(activity)
        ui { assertTrue(drawer.findViewById<View>(R.id.new_conversation_button)?.performClick() == true) }
        waitUntil { !drawer.isShowing }
    }
    fun openSettings(activity: MainActivity, child: String? = null): Dialog {
        val drawer = openDrawer(activity)
        ui { assertTrue(drawer.findViewById<View>(R.id.settings_toggle)?.performClick() == true) }
        val sheet = dialog(activity, "settingsDialog")
        waitUntil { sheet.isShowing }
        if (child != null) ui { assertTrue(clickable(byText(sheet.window!!.decorView, child)).performClick()) }
        return sheet
    }
    fun openPhoneRecords(activity: MainActivity) {
        val drawer = openDrawer(activity)
        ui { assertTrue(clickable(byText(drawer.window!!.decorView, "手机记录")).performClick()) }
        waitUntil { !drawer.isShowing }
    }
    fun openComputerSessions(activity: MainActivity) {
        val drawer = openDrawer(activity)
        ui { assertTrue(clickable(byText(drawer.window!!.decorView, "电脑会话")).performClick()) }
        waitUntil { !drawer.isShowing }
    }
    fun backToChat(activity: MainActivity) {
        ui { assertTrue(byDescription(activity.window.decorView, "返回对话")?.performClick() == true) }
    }
}
