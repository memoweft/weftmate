package com.memoweft.weftmate.mobile

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.SystemClock
import android.view.Choreographer
import android.view.MotionEvent
import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Opt-in, real Hybrid controls and synthetic 18187 SSE fixture; never touches a private model. */
@RunWith(AndroidJUnit4::class)
class HybridStopFixtureTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private fun evaluate(web: WebView, code: String): String {
        val done = CountDownLatch(1)
        var value = ""
        instrumentation.runOnMainSync { web.evaluateJavascript(code) { value = it; done.countDown() } }
        assertTrue("WebView evaluation did not finish", done.await(4, TimeUnit.SECONDS))
        return value
    }

    private fun string(web: WebView, expression: String): String = JSONObject(
        "{\"value\":" + evaluate(web, expression) + "}").getString("value")

    private fun waitUntil(timeoutMs: Long, label: String, condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (SystemClock.elapsedRealtime() < deadline) {
            if (condition()) return
            Thread.sleep(70)
        }
        fail("Timed out waiting for $label")
    }

    private fun waitForDom(web: WebView, expression: String, label: String, timeoutMs: Long = 12_000) =
        waitUntil(timeoutMs, label) { evaluate(web, expression) == "true" }

    private fun tap(web: WebView, selector: String) {
        evaluate(web, "document.querySelector(${JSONObject.quote(selector)}).scrollIntoView({block:'nearest'})")
        waitForDom(web, "(()=>{const e=document.querySelector(${JSONObject.quote(selector)}),r=e?.getBoundingClientRect();if(!e||e.disabled||e.hidden||!r||r.width<=0||r.height<=0||r.top<0||r.bottom>innerHeight)return false;const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return e===hit||e.contains(hit)})()",
            "visible enabled $selector")
        val encoded = evaluate(web, "(()=>{const r=document.querySelector(${JSONObject.quote(selector)}).getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,w:innerWidth,h:innerHeight})})()")
        val rectangle = JSONObject(JSONObject("{\"value\":" + encoded + "}").getString("value"))
        val location = IntArray(2)
        instrumentation.runOnMainSync { web.getLocationOnScreen(location) }
        val x = location[0] + (rectangle.getDouble("x") * web.width / rectangle.getDouble("w")).toFloat()
        val y = location[1] + (rectangle.getDouble("y") * web.height / rectangle.getDouble("h")).toFloat()
        val at = SystemClock.uptimeMillis()
        instrumentation.sendPointerSync(MotionEvent.obtain(at, at, MotionEvent.ACTION_DOWN, x, y, 0))
        instrumentation.sendPointerSync(MotionEvent.obtain(at, at + 58, MotionEvent.ACTION_UP, x, y, 0))
    }

    private fun screenshot(web: WebView, name: String): File {
        val visible = CountDownLatch(1)
        instrumentation.runOnMainSync {
            web.postVisualStateCallback(System.nanoTime(), object : WebView.VisualStateCallback() {
                override fun onComplete(requestId: Long) { visible.countDown() }
            })
        }
        assertTrue("WebView compositor did not draw $name", visible.await(4, TimeUnit.SECONDS))
        val frames = CountDownLatch(1)
        instrumentation.runOnMainSync { Choreographer.getInstance().postFrameCallback {
            Choreographer.getInstance().postFrameCallback { frames.countDown() }
        } }
        assertTrue(frames.await(3, TimeUnit.SECONDS))
        val bitmap: Bitmap = instrumentation.uiAutomation.takeScreenshot()
        val file = File(instrumentation.targetContext.getExternalFilesDir(null), name)
        file.outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
        assertTrue(file.isFile && file.length() > 1000)
        return file
    }

    private fun enter(web: WebView, text: String) {
        evaluate(web, "(()=>{const input=document.getElementById('draft');input.value=${JSONObject.quote(text)};input.dispatchEvent(new Event('input',{bubbles:true}));return input.value})()")
        assertEquals(text, string(web, "document.getElementById('draft').value"))
        waitForDom(web, "!document.getElementById('send-button').disabled", "send ready")
    }

    @Test fun blockedSseStopsWithPartialThenSameConversationCompletes() {
        assumeTrue("Explicit synthetic SSE fixture run only",
            InstrumentationRegistry.getArguments().getString("hybridStopFixture") == "1")
        val context = instrumentation.targetContext
        val host = SecureSettings(context).host() ?: throw AssertionError("Synthetic fixture account is not logged in")
        assertEquals("http://127.0.0.1:18187", host.origin)
        assertTrue("Refuse non-synthetic account", host.username.matches(Regex("root-phone-[A-Za-z0-9_-]+")))
        val owner = Endpoints.ownerKey(host.origin, host.ownerId)
        val choice = context.getSharedPreferences("model-selection", Context.MODE_PRIVATE)
            .getString("host:$owner", null) ?: throw AssertionError("Synthetic host model not selected")
        assertEquals("synthetic-personal-profile", JSONObject(choice).getString("profileId"))
        val updatePrefs = context.getSharedPreferences("ui-update-preferences", Context.MODE_PRIVATE)
        val updateKey = "auto:$owner"
        val oldAuto = if (updatePrefs.contains(updateKey)) updatePrefs.getBoolean(updateKey, true) else null
        assertTrue(updatePrefs.edit().putBoolean(updateKey, false).commit())
        val database = LocalStore(context)
        var activity: HybridActivity? = null
        try {
            activity = instrumentation.startActivitySync(Intent(context, HybridActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity
            val web = (activity.findViewById<android.widget.FrameLayout>(android.R.id.content).getChildAt(0)
                as android.widget.FrameLayout).getChildAt(0) as WebView
            waitForDom(web, "Boolean(typeof state!=='undefined'&&state.booted&&state.loggedIn&&document.getElementById('draft'))", "Hybrid login/bootstrap")
            tap(web, "#menu-button")
            tap(web, "[data-action='new-chat']")
            waitForDom(web, "Boolean(state.page==='chat'&&state.conversationId===null&&document.querySelector('.welcome'))", "new synthetic conversation")
            enter(web, "合成阻塞")
            tap(web, "#send-button")
            waitForDom(web, "Boolean(state.busy&&state.conversationId&&!document.getElementById('stop-button').hidden&&document.querySelector('#live-progress .markdown')?.textContent.trim())",
                "visible partial SSE and Stop", 30_000)
            val id = string(web, "state.conversationId")
            val partial = string(web, "state.progressText").trim()
            assertTrue("The fixture must send partial body before Stop", partial.isNotEmpty())
            val partialShot = screenshot(web, "hybrid-stop-partial.png")
            tap(web, "#stop-button")
            waitUntil(15_000, "cancelled persisted turn") { database.latestTurnStatus(id) == "cancelled" }
            val afterStop = database.messages(id, owner)
            val savedPartial = afterStop.lastOrNull { it.role == "assistant" }?.text
            assertEquals("Stopping must retain exactly the generated text", partial, savedPartial)
            waitForDom(web, "Boolean(!state.busy&&document.getElementById('stop-button').hidden)", "composer restored")
            assertTrue("Stop screenshot missing", partialShot.isFile)
            enter(web, "普通合成回复")
            tap(web, "#send-button")
            waitUntil(45_000, "second completed turn") { database.latestTurnStatus(id) == "completed" }
            waitForDom(web, "Boolean(!state.busy&&document.querySelector('.markdown table')&&document.querySelector('.code-block .copy-button'))",
                "same-conversation assistant reply", 10_000)
            val all = database.messages(id, owner)
            assertEquals(2, all.count { it.role == "user" })
            assertEquals(2, all.count { it.role == "assistant" })
            val finalShot = screenshot(web, "hybrid-stop-resumed.png")
            println("HYBRID_STOP_PARTIAL_SCREENSHOT=${partialShot.absolutePath}")
            println("HYBRID_STOP_RESUMED_SCREENSHOT=${finalShot.absolutePath}")
        } finally {
            activity?.let { current -> instrumentation.runOnMainSync { current.finish() } }
            database.close()
            val editor = updatePrefs.edit()
            if (oldAuto == null) editor.remove(updateKey) else editor.putBoolean(updateKey, oldAuto)
            assertTrue(editor.commit())
        }
    }
}
