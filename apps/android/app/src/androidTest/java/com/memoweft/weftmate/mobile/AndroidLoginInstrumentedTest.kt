package com.memoweft.weftmate.mobile

import android.content.Intent
import android.view.WindowInsets
import android.webkit.WebView
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.FrameLayout
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Opt-in synthetic real login -> visible main-chat send. No credentials or UI state are injected. */
class AndroidLoginInstrumentedTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private fun evaluate(web: WebView, script: String): String {
        val done = CountDownLatch(1); var value = ""
        instrumentation.runOnMainSync { web.evaluateJavascript(script) { value = it; done.countDown() } }
        check(done.await(8, TimeUnit.SECONDS)); return value
    }
    private fun wait(web: WebView, expression: String, seconds: Long = 30) {
        val deadline = System.currentTimeMillis() + seconds * 1000
        while (System.currentTimeMillis() < deadline) {
            if (evaluate(web, expression) == "true") return
            Thread.sleep(100)
        }
        throw AssertionError("Real login UI did not reach: $expression; " + evaluate(web, "document.body.innerText"))
    }
    private fun recordBars(activity: android.app.Activity) {
        instrumentation.runOnMainSync {
            val shown = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED)
                .filterIsInstance<HybridActivity>().firstOrNull() ?: activity
            val decor = shown.window.decorView
            val bars = decor.rootWindowInsets?.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            val ime = decor.rootWindowInsets?.getInsets(WindowInsets.Type.ime())
            val darkIcons = (shown.window.insetsController!!.systemBarsAppearance and android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS) != 0
            File(instrumentation.targetContext.filesDir, "and2-window.json").writeText(JSONObject().put("statusHeight", bars?.top ?: 0)
                .put("navigationHeight", bars?.bottom ?: 0).put("imeHeight", ime?.bottom ?: 0).put("darkStatusIcons", darkIcons)
                .put("width", decor.width).put("height", decor.height).toString())
        }
    }
    @Test fun realLoginThenSendMainConversation() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("and2Login") == "1")
        val context = instrumentation.targetContext
        check(context.packageName == "com.memoweft.weftmate.mobile.lg1bqa")
        val mode = args.getString("and2Mode") ?: "cloud"
        val origin = args.getString("lg1bHostOrigin") ?: error("Missing synthetic origin")
        check(origin.startsWith("http://127.0.0.1:"))
        val done = File(context.filesDir, "and2-probe.done"); done.delete()
        if (mode == "local") {
            val native = instrumentation.startActivitySync(Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            val sheet = WeaveTestPaths.openSettings(native, "电脑账户与连接")
            instrumentation.runOnMainSync {
                sheet.findViewById<EditText>(R.id.origin_input).setText(origin)
                sheet.findViewById<EditText>(R.id.username_input).setText(args.getString("and2User"))
                sheet.findViewById<EditText>(R.id.password_input).setText(args.getString("and2Password"))
                sheet.findViewById<Button>(R.id.login_button).performClick()
            }
            val deadline = System.currentTimeMillis() + 30_000
            while (System.currentTimeMillis() < deadline && SecureSettings(context).host() == null) Thread.sleep(100)
            check(SecureSettings(context).host() != null) { "Native local form did not log in" }
            instrumentation.runOnMainSync { sheet.dismiss(); native.finish() }
        }
        instrumentation.runOnMainSync { WebView.setWebContentsDebuggingEnabled(true) }
        val activity = instrumentation.startActivitySync(Intent(context, HybridActivity::class.java)
            .putExtra("lg1bHostOrigin", origin).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity
        val web = (activity.findViewById<FrameLayout>(android.R.id.content).getChildAt(0) as FrameLayout).getChildAt(0) as WebView
        try {
            wait(web, "typeof state!=='undefined'&&state.booted")
            if (mode == "cloud") {
                if (args.getString("and2CaptureLogin") == "1") {
                    val begin = File(context.filesDir, "and2-start-login")
                    val deadline = System.currentTimeMillis() + 30_000
                    while (!begin.exists() && System.currentTimeMillis() < deadline) { recordBars(activity); Thread.sleep(100) }
                    check(begin.exists()) { "Login capture did not finish" }; begin.delete()
                }
                val email = JSONObject.quote(args.getString("and2User"))
                val password = JSONObject.quote(args.getString("and2Password"))
                evaluate(web, "document.getElementById('auth-email').value=$email;document.getElementById('auth-password').value=$password;document.getElementById('cloud-auth-form').requestSubmit();true")
                wait(web, "Boolean(document.getElementById('auth-code'))")
                val code = File(context.filesDir, "and2-code.txt")
                val deadline = System.currentTimeMillis() + 30_000
                while (!code.exists() && System.currentTimeMillis() < deadline) Thread.sleep(100)
                check(code.exists()) { "Synthetic email code missing" }
                evaluate(web, "document.getElementById('auth-code').value=${JSONObject.quote(code.readText().trim())};document.getElementById('cloud-auth-form').requestSubmit();true")
                code.delete()
            }
            wait(web, "state.loggedIn&&!document.body.classList.contains('cloud-auth-active')", 45)
            wait(web, "state.logicalChats&&uiCore.inMainChat()&&!document.getElementById('draft').disabled")
            val message = "AND2_${mode}_native_smoke"
            evaluate(web, "document.getElementById('draft').value=${JSONObject.quote(message)};document.getElementById('draft').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('send-button').click();true")
            wait(web, "document.getElementById('chat-content').innerText.includes(${JSONObject.quote("合成回复：$message")})")
            assertTrue(evaluate(web, "state.loggedIn&&!document.getElementById('draft').disabled") == "true")
            File(context.filesDir, "and2-smoke.json").writeText(JSONObject().put("mode", mode).put("passed", true).put("realLogin", true).put("mainSendReply", true).toString())
            val deadline = System.currentTimeMillis() + 10 * 60_000
            while (!done.exists() && System.currentTimeMillis() < deadline) {
                val showIme = File(context.filesDir, "and2-show-ime")
                if (showIme.exists()) {
                    instrumentation.runOnMainSync {
                        val shown = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED)
                            .filterIsInstance<HybridActivity>().firstOrNull() ?: activity
                        val editor = (shown.findViewById<FrameLayout>(android.R.id.content).getChildAt(0) as FrameLayout).getChildAt(0) as WebView
                        editor.requestFocus()
                        editor.evaluateJavascript("document.getElementById('draft').focus()", null)
                        val ime = shown.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
                        ime.restartInput(editor)
                        editor.postDelayed({
                            val requested = ime.showSoftInput(editor, 0)
                            File(context.filesDir, "and2-ime-request.json").writeText(JSONObject().put("requested", requested)
                                .put("windowFocused", editor.hasWindowFocus()).put("editorFocused", editor.hasFocus()).toString())
                        }, 300)
                    }
                    showIme.delete()
                }
                recordBars(activity)
                Thread.sleep(200)
            }
            check(done.exists()) { "Synthetic driver did not finish" }
        } finally {
            instrumentation.runOnMainSync { activity.finish(); WebView.setWebContentsDebuggingEnabled(false) }
            done.delete()
        }
    }
}
