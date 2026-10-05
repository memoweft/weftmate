package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.view.accessibility.AccessibilityNodeInfo
import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Explicit isolated-host acceptance for persisted ordinary-file cards and the native save stream. */
@RunWith(AndroidJUnit4::class)
class Stage15FileBridgeInstrumentedTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val args = InstrumentationRegistry.getArguments()

    private fun web(activity: HybridActivity): WebView =
        (activity.findViewById<android.widget.FrameLayout>(android.R.id.content).getChildAt(0)
            as android.widget.FrameLayout).getChildAt(0) as WebView

    private fun evaluate(web: WebView, script: String): String {
        val done = CountDownLatch(1)
        var result = ""
        instrumentation.runOnMainSync { web.evaluateJavascript(script) { value -> result = value; done.countDown() } }
        assertTrue("WebView evaluation timed out", done.await(10, TimeUnit.SECONDS))
        return result
    }

    private fun decoded(value: String): String = JSONArray("[$value]").getString(0)

    private fun waitFor(web: WebView, expression: String, seconds: Long = 35) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds)
        while (System.nanoTime() < deadline) {
            if (evaluate(web, expression) == "true") return
            Thread.sleep(100)
        }
        capture("stage15-files-failure.png")
        throw AssertionError("WebView state did not stabilize: $expression; body=" +
            evaluate(web, "document.body.innerText"))
    }

    private fun waitForVisualIdle(web: WebView) {
        val key = "__stage15_visual_${System.nanoTime()}"
        evaluate(web, "window.$key='pending';requestAnimationFrame(()=>requestAnimationFrame(()=>{" +
            "const done=()=>window.$key='ready';" +
            "if(window.requestIdleCallback)requestIdleCallback(done,{timeout:500});else setTimeout(done,100)}))")
        waitFor(web, "window.$key==='ready'", 5)
    }

    private fun call(web: WebView, method: String, params: JSONObject): JSONObject {
        val key = "__stage15_file_${System.nanoTime()}"
        evaluate(web, "window.$key='pending';call(${JSONObject.quote(method)},$params)" +
            ".then(v=>window.$key=JSON.stringify({ok:true,value:v}))" +
            ".catch(e=>window.$key=JSON.stringify({ok:false,error:String(e&&e.message||e)}))")
        waitFor(web, "typeof window.$key==='string'&&window.$key!=='pending'")
        return JSONObject(decoded(evaluate(web, "window.$key")))
    }

    private fun start(): HybridActivity = instrumentation.startActivitySync(Intent(instrumentation.targetContext,
        HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity

    private fun capture(name: String) {
        val image = instrumentation.uiAutomation.takeScreenshot()
        assertNotNull(image)
        File(instrumentation.targetContext.getExternalFilesDir(null), name).outputStream().use {
            image!!.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        image.recycle()
    }

    private fun shell(command: String): String {
        val descriptor = instrumentation.uiAutomation.executeShellCommand(command)
        return ParcelFileDescriptor.AutoCloseInputStream(descriptor).bufferedReader().use { it.readText().trim() }
    }

    @Test fun fileCardSurvivesRestartAndSavesVerifiedOriginal() {
        assumeTrue("Explicit stage-15 isolated fixture only", args.getString("stage15FileBridge") == "1")
        val origin = args.getString("origin") ?: throw AssertionError("origin missing")
        val username = args.getString("username") ?: throw AssertionError("username missing")
        val password = args.getString("password") ?: throw AssertionError("password missing")
        val sessionId = args.getString("sessionId") ?: throw AssertionError("sessionId missing")
        val sourceName = args.getString("fileName") ?: throw AssertionError("fileName missing")
        val expectedSize = args.getString("fileSize")?.toLongOrNull() ?: throw AssertionError("fileSize missing")
        val expectedSha = args.getString("fileSha256") ?: throw AssertionError("fileSha256 missing")
        val savedName = "stage15-file-${UUID.randomUUID()}.bin"
        var activity = start()
        try {
            var page = web(activity)
            waitFor(page, "Boolean(typeof state!=='undefined'&&state.booted&&window.weftNative)")
            val login = call(page, "auth.login", JSONObject().put("origin", origin).put("username", username)
                .put("password", password).put("deviceName", "Stage15 Files QA"))
            assertTrue(login.toString(), login.optBoolean("ok"))
            val expectedOwner = login.getJSONObject("value").getString("owner")
            instrumentation.runOnMainSync { activity.finish() }
            activity = start(); page = web(activity)
            waitFor(page, "Boolean(typeof state!=='undefined'&&state.booted&&state.loggedIn===true&&state.owner===${JSONObject.quote(expectedOwner)})")
            evaluate(page, "selectSharedSession(${JSONObject.quote(sessionId)})")
            waitFor(page, "state.chatSource==='host'&&document.getElementById('chat-content').textContent.includes(${JSONObject.quote(sourceName)})")
            waitForVisualIdle(page)
            assertEquals("0", decoded(evaluate(page, "String(document.querySelectorAll('.message.user .message-thumbnails img').length)")))
            assertEquals("1", decoded(evaluate(page, "String([...document.querySelectorAll('.message.user .attachment-chip')].filter(b=>b.textContent.includes(${JSONObject.quote(sourceName)})).length)")))
            capture("stage15-files-card-first.png")

            instrumentation.runOnMainSync { activity.finish() }
            activity = start(); page = web(activity)
            waitFor(page, "Boolean(typeof state!=='undefined'&&state.booted&&window.weftNative)")
            evaluate(page, "selectSharedSession(${JSONObject.quote(sessionId)})")
            waitFor(page, "state.chatSource==='host'&&[...document.querySelectorAll('.message.user .attachment-chip')].some(b=>b.offsetParent!==null&&b.textContent.includes(${JSONObject.quote(sourceName)}))&&document.getElementById('chat-content').textContent.includes('请保存这个验收文件。')")
            waitForVisualIdle(page)
            capture("stage15-files-card-reopened-confirmed.png")
            if (args.getString("reopenOnly") == "1") return
            assertEquals("true", evaluate(page, "(()=>{const b=[...document.querySelectorAll('.attachment-chip')].find(x=>x.textContent.includes(${JSONObject.quote(sourceName)}));if(!b)return false;b.click();return true})()"))

            val pickerDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(12)
            var picker: AccessibilityNodeInfo? = null
            while (System.nanoTime() < pickerDeadline) {
                val candidate = instrumentation.uiAutomation.rootInActiveWindow
                if (candidate?.packageName?.toString() == "com.android.documentsui") { picker = candidate; break }
                Thread.sleep(100)
            }
            assertNotNull("Expected DocumentsUI save picker", picker)
            capture("stage15-files-save-picker.png")
            val root = picker!!
            val breadcrumbs = root.findAccessibilityNodeInfosByViewId("com.android.documentsui:id/breadcrumb_text")
                .filter { it.isVisibleToUser }
            assertTrue("File save did not open Downloads",
                breadcrumbs.isNotEmpty() && breadcrumbs.last().text?.toString() == "Download")
            val fields = root.findAccessibilityNodeInfosByViewId("android:id/title")
                .filter { it.isVisibleToUser && it.className?.toString() == "android.widget.EditText" }
            assertEquals(1, fields.size)
            val setName = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, savedName)
            }
            assertTrue(fields.single().performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, setName))
            val ready = instrumentation.uiAutomation.rootInActiveWindow!!
            val buttons = ready.findAccessibilityNodeInfosByViewId("android:id/button1")
                .filter { it.isVisibleToUser && it.className?.toString() == "android.widget.Button" &&
                    it.text?.toString() == "保存" && it.isClickable }
            assertEquals(1, buttons.size)
            assertTrue(buttons.single().performAction(AccessibilityNodeInfo.ACTION_CLICK))

            val saveDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(90)
            var saved = false
            while (System.nanoTime() < saveDeadline) {
                val size = shell("stat -c %s /sdcard/Download/$savedName")
                if (size == expectedSize.toString()) { saved = true; break }
                Thread.sleep(250)
            }
            assertTrue("Downloaded file did not reach its exact size", saved)
            assertEquals(expectedSha, shell("sha256sum /sdcard/Download/$savedName").substringBefore(' '))
            waitFor(page, "document.getElementById('toast').textContent.includes('文件已保存')", 10)
            capture("stage15-files-saved.png")
        } finally {
            shell("rm -f /sdcard/Download/$savedName")
            instrumentation.runOnMainSync { activity.finish() }
        }
    }
}
