package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import android.view.Choreographer
import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.Before
import org.junit.After
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Synthetic profile only: capture the actual launcher WebView without a model request. */
@RunWith(AndroidJUnit4::class)
class HybridVisualSmokeTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private var pausedPreference: Pair<String, Boolean?>? = null

    @Before fun pauseAutomaticUiSwitchOnlyDuringVisualCapture() {
        val context = instrumentation.targetContext
        val host = SecureSettings(context).host() ?: return
        val scope = Endpoints.ownerKey(host.origin, host.ownerId)
        val key = "auto:$scope"
        val prefs = context.getSharedPreferences("ui-update-preferences", android.content.Context.MODE_PRIVATE)
        pausedPreference = key to if (prefs.contains(key)) prefs.getBoolean(key, true) else null
        assertTrue(prefs.edit().putBoolean(key, false).commit())
    }

    @After fun restoreAutomaticUiPreference() {
        val (key, previous) = pausedPreference ?: return
        val prefs = instrumentation.targetContext.getSharedPreferences("ui-update-preferences",
            android.content.Context.MODE_PRIVATE)
        val editor = prefs.edit()
        if (previous == null) editor.remove(key) else editor.putBoolean(key, previous)
        assertTrue(editor.commit())
    }

    private fun evaluate(web: WebView, script: String): String {
        val done = CountDownLatch(1)
        var result = ""
        instrumentation.runOnMainSync { web.evaluateJavascript(script) { value -> result = value; done.countDown() } }
        assertTrue("JavaScript result timed out", done.await(8, TimeUnit.SECONDS))
        return result
    }

    private fun capture(web: WebView, name: String): File {
        val file = File(instrumentation.targetContext.getExternalFilesDir(null), name)
        val visual = CountDownLatch(1)
        instrumentation.runOnMainSync {
            web.postVisualStateCallback(System.nanoTime(), object : WebView.VisualStateCallback() {
                override fun onComplete(requestId: Long) { visual.countDown() }
            })
        }
        assertTrue("WebView compositor did not acknowledge the visual state", visual.await(4, TimeUnit.SECONDS))
        val frames = CountDownLatch(1)
        instrumentation.runOnMainSync {
            Choreographer.getInstance().postFrameCallback {
                Choreographer.getInstance().postFrameCallback { frames.countDown() }
            }
        }
        assertTrue("Two display frames did not complete", frames.await(3, TimeUnit.SECONDS))
        val image = instrumentation.uiAutomation.takeScreenshot()
        assertTrue("System screenshot unavailable", image != null && image.width > 0 && image.height > 0)
        file.outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        image.recycle()
        return file
    }

    private fun waitUntil(web: WebView, expression: String) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(8)
        while (System.nanoTime() < deadline) {
            if (evaluate(web, expression) == "true") return
            Thread.sleep(50)
        }
        assertTrue("Visible state did not stabilize: $expression", false)
    }

    @Test fun bundledChatDrawerSettingsAndPickerRender() {
        val context = instrumentation.targetContext
        val activity = instrumentation.startActivitySync(Intent(context, HybridActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity
        try {
            val web = (activity.findViewById<android.widget.FrameLayout>(android.R.id.content).getChildAt(0)
                as android.widget.FrameLayout).getChildAt(0) as WebView
            waitUntil(web, "Boolean(typeof state!=='undefined'&&state.booted&&window.weftNative&&document.getElementById('draft').getBoundingClientRect().height>0)")
            evaluate(web, "document.querySelector('[data-action=\"new-chat\"]').click()")
            waitUntil(web, "Boolean(document.querySelector('.welcome')&&document.querySelector('.welcome').getBoundingClientRect().height>0)")
            instrumentation.waitForIdleSync()
            assertTrue(web.width > 0 && web.height > 0)
            assertTrue(capture(web, "hybrid-0-chat.png").isFile)
            evaluate(web, "document.getElementById('menu-button').click()")
            waitUntil(web, "(()=>{const d=document.getElementById('drawer');return d.classList.contains('open')&&d.getBoundingClientRect().width>0&&getComputedStyle(d).transform==='matrix(1, 0, 0, 1, 0, 0)'})()")
            assertTrue(capture(web, "hybrid-1-drawer.png").isFile)
            evaluate(web, "document.getElementById('profile-link').click()")
            waitUntil(web, "(()=>{const p=document.getElementById('generic-page'),d=document.getElementById('drawer'),s=document.getElementById('drawer-scrim');return p.classList.contains('active')&&p.getBoundingClientRect().height>0&&document.querySelector('.page-title')?.textContent==='设置'&&!d.classList.contains('open')&&s.hidden&&document.elementFromPoint(innerWidth/2,innerHeight/2)?.closest('#drawer')===null})()")
            assertTrue(capture(web, "hybrid-2-settings.png").isFile)
            evaluate(web, "document.querySelector('[data-page=\"chat\"]').click()")
            evaluate(web, "document.getElementById('model-button').click()")
            waitUntil(web, "(()=>{const p=document.getElementById('model-popover');return !p.hidden&&p.getBoundingClientRect().height>0&&getComputedStyle(p).opacity==='1'&&!p.textContent.includes('正在读取已保存模型')})()")
            assertTrue(capture(web, "hybrid-3-models.png").isFile)
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    @Test fun camelCaseBridgeRequestReceivesResponseInsteadOfTimingOut() {
        val context = instrumentation.targetContext
        val activity = instrumentation.startActivitySync(Intent(context, HybridActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity
        try {
            val web = (activity.findViewById<android.widget.FrameLayout>(android.R.id.content).getChildAt(0)
                as android.widget.FrameLayout).getChildAt(0) as WebView
            waitUntil(web, "Boolean(typeof state!=='undefined'&&state.booted&&window.weftNative)")
            evaluate(web, "window.__caseResult='pending';call('records.unboundSummary').then(()=>window.__caseResult='ok').catch(e=>window.__caseResult=e.message)")
            waitUntil(web, "typeof window.__caseResult==='string'&&window.__caseResult.length>0&&window.__caseResult!=='pending'")
            val result = evaluate(web, "window.__caseResult").trim('"')
            assertTrue("Camel-case bridge was filtered: $result", result == "ok" || result == "LOGIN_REQUIRED")
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    @Test fun markdownTableAndCodeRenderWithPackagedLibrary() {
        val context = instrumentation.targetContext
        val activity = instrumentation.startActivitySync(Intent(context, HybridActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity
        try {
            val web = (activity.findViewById<android.widget.FrameLayout>(android.R.id.content).getChildAt(0)
                as android.widget.FrameLayout).getChildAt(0) as WebView
            waitUntil(web, "Boolean(typeof state!=='undefined'&&state.booted&&window.WeftFormat)")
            val markdown = "| 名称 | 状态 |\n|---|---|\n| WeftMate | 可用 |\n\n```kotlin\nprintln(\"WeftMate fixture\")\n```"
            val check = "(()=>{const box=document.createElement('div');box.innerHTML=WeftFormat.render(${org.json.JSONObject.quote(markdown)});return Boolean(box.querySelector('table')&&box.querySelector('pre code')&&box.querySelector('code').textContent.includes('println'))})()"
            assertTrue("Packaged Markdown table/code renderer failed", evaluate(web, check) == "true")
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    @Test fun storedSyntheticReplyShowsTableAndCopyableCode() {
        assumeTrue("Run after root's synthetic fixture reply only",
            InstrumentationRegistry.getArguments().getString("renderFixture") == "1")
        val context = instrumentation.targetContext
        val activity = instrumentation.startActivitySync(Intent(context, HybridActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity
        try {
            val web = (activity.findViewById<android.widget.FrameLayout>(android.R.id.content).getChildAt(0)
                as android.widget.FrameLayout).getChildAt(0) as WebView
            waitUntil(web, "Boolean(typeof state!=='undefined'&&state.booted)")
            waitUntil(web, "Boolean(document.querySelector('.markdown table')&&document.querySelector('.code-block .copy-button'))")
            assertTrue(capture(web, "hybrid-fixture-table-code.png").isFile)
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
}
