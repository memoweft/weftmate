package com.memoweft.weftmate.mobile

import android.content.ClipboardManager
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.view.MotionEvent
import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Opt-in synthetic text only; restores the simulator clipboard without printing its contents. */
@RunWith(AndroidJUnit4::class)
class HybridClipboardTest {
    private fun evaluate(web: WebView, code: String): String {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val done = CountDownLatch(1)
        var result = ""
        instrumentation.runOnMainSync { web.evaluateJavascript(code) { result = it; done.countDown() } }
        assertTrue(done.await(3, TimeUnit.SECONDS))
        return result
    }

    @Test fun nativeBridgeCopiesExactCodeAndRestoresClipboard() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue("Synthetic clipboard run only", InstrumentationRegistry.getArguments().getString("clipboardSynthetic") == "1")
        val context = instrumentation.targetContext
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        var original: ClipData? = null
        var originalKnown = false
        val activity = instrumentation.startActivitySync(Intent(context, HybridActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity
        try {
            val web = (activity.findViewById<android.widget.FrameLayout>(android.R.id.content).getChildAt(0)
                as android.widget.FrameLayout).getChildAt(0) as WebView
            val bootDeadline = System.currentTimeMillis() + 8_000
            var booted = false
            while (System.currentTimeMillis() < bootDeadline) {
                val done = CountDownLatch(1)
                var answer = "false"
                instrumentation.runOnMainSync { web.evaluateJavascript(
                    "Boolean(typeof call==='function'&&window.weftNative&&state.booted)") {
                    answer = it; done.countDown() } }
                assertTrue(done.await(2, TimeUnit.SECONDS))
                if (answer == "true") { booted = true; break }
                Thread.sleep(80)
            }
            assertTrue("Hybrid page not ready", booted)
            val focusDeadline = System.currentTimeMillis() + 5_000
            var focused = false
            while (System.currentTimeMillis() < focusDeadline) {
                instrumentation.runOnMainSync { focused = activity.hasWindowFocus() }
                if (focused) break
                Thread.sleep(60)
            }
            assertTrue("App window did not obtain focus before clipboard snapshot", focused)
            original = clipboard.primaryClip
            originalKnown = true
            val text = "first line\n    exact indent\nthird line\n"
            val ready = CountDownLatch(1)
            instrumentation.runOnMainSync {
                web.evaluateJavascript("window.__copyStatus='pending';call('clipboard.copy',{text:${org.json.JSONObject.quote(text)}}).then(()=>window.__copyStatus='ok').catch(()=>window.__copyStatus='error')") {
                    ready.countDown()
                }
            }
            assertTrue(ready.await(8, TimeUnit.SECONDS))
            val deadline = System.currentTimeMillis() + 8_000
            var result = "pending"
            while (System.currentTimeMillis() < deadline) {
                val done = CountDownLatch(1)
                instrumentation.runOnMainSync { web.evaluateJavascript("window.__copyStatus") { result = it.trim('"'); done.countDown() } }
                assertTrue(done.await(2, TimeUnit.SECONDS))
                if (result != "pending") break
                Thread.sleep(80)
            }
            assertEquals("ok", result)
            assertEquals(text, clipboard.primaryClip?.getItemAt(0)?.coerceToText(context)?.toString())
        } finally {
            instrumentation.runOnMainSync {
                if (originalKnown) {
                    val saved = original
                    if (saved != null) clipboard.setPrimaryClip(saved)
                    else if (Build.VERSION.SDK_INT >= 28) clipboard.clearPrimaryClip()
                }
                activity.finish()
            }
        }
    }

    @Test fun renderedCodeCopyButtonPreservesFixtureTextAndRestoresClipboard() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue("Actual synthetic fixture code copy only",
            InstrumentationRegistry.getArguments().getString("clipboardSynthetic") == "1")
        val context = instrumentation.targetContext
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val activity = instrumentation.startActivitySync(Intent(context, HybridActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity
        var original: ClipData? = null
        var originalKnown = false
        try {
            val web = (activity.findViewById<android.widget.FrameLayout>(android.R.id.content).getChildAt(0)
                as android.widget.FrameLayout).getChildAt(0) as WebView
            val deadline = System.currentTimeMillis() + 8_000
            while (System.currentTimeMillis() < deadline &&
                evaluate(web, "Boolean(state.booted&&document.querySelector('.code-block code'))") != "true") Thread.sleep(80)
            assumeTrue("Run only after the real synthetic model reply with a Kotlin code block is visible",
                evaluate(web, "Boolean(document.querySelector('.code-block code'))") == "true")
            val expected = "println(\"WeftMate fixture\")\n"
            val rendered = org.json.JSONObject("{\"value\":" + evaluate(web,
                "document.querySelector('.code-block code').textContent") + "}").getString("value")
            assertEquals("The rendered code must match the fixture reply exactly", expected, rendered)
            val focusDeadline = System.currentTimeMillis() + 5_000
            while (System.currentTimeMillis() < focusDeadline && !activity.hasWindowFocus()) Thread.sleep(60)
            assertTrue(activity.hasWindowFocus())
            original = clipboard.primaryClip
            originalKnown = true
            evaluate(web, "document.querySelector('.code-block .copy-button').scrollIntoView({block:'center'})")
            val encodedCoordinates = evaluate(web,
                "(()=>{const r=document.querySelector('.code-block .copy-button').getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,w:innerWidth,h:innerHeight})})()")
            val decodedCoordinates = org.json.JSONObject("{\"value\":" + encodedCoordinates + "}").getString("value")
            val geometry = org.json.JSONObject(decodedCoordinates)
            assertTrue("Copy control is outside the visible WebView", geometry.getDouble("x") > 0 &&
                geometry.getDouble("x") < geometry.getDouble("w") && geometry.getDouble("y") > 0 &&
                geometry.getDouble("y") < geometry.getDouble("h"))
            val location = IntArray(2)
            instrumentation.runOnMainSync { web.getLocationOnScreen(location) }
            val x = location[0] + (geometry.getDouble("x") * web.width / geometry.getDouble("w")).toFloat()
            val y = location[1] + (geometry.getDouble("y") * web.height / geometry.getDouble("h")).toFloat()
            val at = SystemClock.uptimeMillis()
            instrumentation.sendPointerSync(MotionEvent.obtain(at, at, MotionEvent.ACTION_DOWN, x, y, 0))
            instrumentation.sendPointerSync(MotionEvent.obtain(at, at + 60, MotionEvent.ACTION_UP, x, y, 0))
            val copiedDeadline = System.currentTimeMillis() + 5_000
            while (System.currentTimeMillis() < copiedDeadline &&
                clipboard.primaryClip?.getItemAt(0)?.coerceToText(context)?.toString() != expected) Thread.sleep(80)
            assertEquals(expected, clipboard.primaryClip?.getItemAt(0)?.coerceToText(context)?.toString())
        } finally {
            instrumentation.runOnMainSync {
                if (originalKnown) {
                    val saved = original
                    if (saved != null) clipboard.setPrimaryClip(saved)
                    else if (Build.VERSION.SDK_INT >= 28) clipboard.clearPrimaryClip()
                }
                activity.finish()
            }
        }
    }
}
