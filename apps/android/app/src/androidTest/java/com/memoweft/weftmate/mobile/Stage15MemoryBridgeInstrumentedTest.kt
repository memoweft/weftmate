package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.io.File

/** Explicit isolated-host acceptance for the actual WebView -> weftNative -> host.business path. */
@RunWith(AndroidJUnit4::class)
class Stage15MemoryBridgeInstrumentedTest {
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

    private fun decodedJsonString(value: String): String = JSONArray("[$value]").getString(0)

    private fun waitFor(web: WebView, expression: String) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(35)
        while (System.nanoTime() < deadline) {
            if (evaluate(web, expression) == "true") return
            Thread.sleep(75)
        }
        val failure = evaluate(web, "JSON.stringify({page:window.state&&state.page,text:document.body.innerText,buttons:[...document.querySelectorAll('button')].filter(b=>!b.hidden&&b.offsetParent!==null).map(b=>b.textContent.trim()).filter(Boolean)})")
        File(instrumentation.targetContext.getExternalFilesDir(null), "stage15-memory-ui-failure.json").writeText(failure)
        capture("stage15-memory-ui-failure.png")
        assertTrue("WebView state did not stabilize: $expression; failure=$failure", false)
    }

    private fun call(web: WebView, method: String, params: JSONObject): JSONObject {
        val key = "__stage15_${System.nanoTime()}"
        val script = "window.$key='pending';call(${JSONObject.quote(method)},${params}).then(v=>window.$key=JSON.stringify({ok:true,value:v})).catch(e=>window.$key=JSON.stringify({ok:false,error:String(e&&e.message||e)}))"
        evaluate(web, script)
        waitFor(web, "typeof window.$key==='string'&&window.$key!=='pending'")
        return JSONObject(decodedJsonString(evaluate(web, "window.$key")))
    }

    private fun requireOk(result: JSONObject): JSONObject {
        assertEquals(result.toString(), true, result.optBoolean("ok"))
        return result.getJSONObject("value")
    }

    private fun start(): HybridActivity = instrumentation.startActivitySync(Intent(instrumentation.targetContext,
        HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity

    private fun capture(name: String) {
        val image = instrumentation.uiAutomation.takeScreenshot()
        assertTrue(image != null)
        val file = File(instrumentation.targetContext.getExternalFilesDir(null), name)
        file.outputStream().use { image!!.compress(Bitmap.CompressFormat.PNG, 100, it) }
        image.recycle()
    }

    @Test fun realWebViewBridgeReadsSourcesMutesAndKeepsAccountIsolationAfterRestart() {
        assumeTrue("Explicit stage-15 isolated fixture only", args.getString("stage15MemoryBridge") == "1")
        val origin = args.getString("origin") ?: throw AssertionError("origin missing")
        val userA = args.getString("userA") ?: throw AssertionError("userA missing")
        val passwordA = args.getString("passwordA") ?: throw AssertionError("passwordA missing")
        val userB = args.getString("userB") ?: throw AssertionError("userB missing")
        val passwordB = args.getString("passwordB") ?: throw AssertionError("passwordB missing")
        val itemId = args.getString("itemId") ?: throw AssertionError("itemId missing")
        val text = args.getString("memoryText") ?: throw AssertionError("memoryText missing")
        var activity = start()
        try {
            var page = web(activity)
            waitFor(page, "Boolean(typeof state!=='undefined'&&state.booted&&window.weftNative)")
            evaluate(page, "document.getElementById('menu-button').click()")
            waitFor(page, "document.getElementById('drawer').classList.contains('open')")
            evaluate(page, "[...document.querySelectorAll('#drawer button[data-page=\\\"settings\\\"]')][0].click()")
            waitFor(page, "state.page==='settings'")
            evaluate(page, "[...document.querySelectorAll('#page-content button')].find(b=>b.textContent.includes('电脑账户与连接')).click()")
            waitFor(page, "state.page==='connect'")
            if (evaluate(page, "String(state.loggedIn===true)") == "\"true\"") {
                evaluate(page, "[...document.querySelectorAll('#page-content button')].find(b=>b.textContent.includes('退出登录')).click()")
                waitFor(page, "state.loggedIn===false&&state.page==='connect'")
            }
            assertTrue(evaluate(page, "(()=>{const i=[...document.querySelectorAll('#page-content input')],labels=[...document.querySelectorAll('#page-content .field span')].map(x=>x.textContent);return i.length>=3&&labels.some(x=>x.includes('个人服务地址'))&&labels.some(x=>x.includes('账户名'))&&labels.some(x=>x.includes('密码'))})()") == "true")
            evaluate(page, "(()=>{const i=[...document.querySelectorAll('#page-content input')];i[0].value=${JSONObject.quote(origin)};i[1].value=${JSONObject.quote(userA)};i[2].value=${JSONObject.quote(passwordA)};[...document.querySelectorAll('#page-content button')].find(b=>b.textContent.trim()==='登录').click()})()")
            waitFor(page, "state.loggedIn===true")
            evaluate(page, "document.querySelector('[data-page=\"memory\"]').click()")
            waitFor(page, "state.page==='memory'&&document.getElementById('page-content').textContent.includes(${JSONObject.quote(text)})")
            evaluate(page, "[...document.querySelectorAll('#page-content button')].find(b=>b.textContent.includes(${JSONObject.quote(text)})).click()")
            capture("stage15-memory-detail-light.png")
            waitFor(page, "document.getElementById('page-content').textContent.includes('来源与读取状态')&&document.getElementById('page-content').textContent.includes('支持该理解')")
            val detail = requireOk(call(page, "host.business", JSONObject().put("path",
                "/personal/v1/memory/items/cognition/$itemId").put("method", "GET")))
            assertEquals(itemId, detail.getJSONObject("item").getString("id"))
            val sources = requireOk(call(page, "host.business", JSONObject().put("path",
                "/personal/v1/memory/items/cognition/$itemId/sources").put("method", "GET")))
            assertTrue(sources.getJSONArray("sources").length() > 0)
            evaluate(page, "[...document.querySelectorAll('#page-content button')].find(b=>b.textContent==='停用这项记忆').click()")
            waitFor(page, "[...document.querySelectorAll('#page-content button')].some(b=>b.textContent==='确认停用')")
            evaluate(page, "[...document.querySelectorAll('#page-content button')].find(b=>b.textContent==='确认停用').click()")
            waitFor(page, "document.getElementById('page-content').textContent.includes('记忆已停用')")
            capture("stage15-memory-mute-light.png")
            instrumentation.runOnMainSync { activity.finish() }
            activity = start(); page = web(activity)
            waitFor(page, "Boolean(typeof state!=='undefined'&&state.booted&&window.weftNative)")
            assertTrue(requireOk(call(page, "app.bootstrap", JSONObject())).optBoolean("loggedIn"))
            val afterRestart = requireOk(call(page, "host.business", JSONObject().put("path",
                "/personal/v1/memory/items?kind=cognition&query=${java.net.URLEncoder.encode(text, "UTF-8")}").put("method", "GET")))
            val mutedItem = afterRestart.getJSONArray("items").getJSONObject(0)
            assertEquals("not_current", mutedItem.getString("currentState"))
            assertTrue(mutedItem.getJSONObject("lifecycle").optString("mutedAt").isNotBlank())
            requireOk(call(page, "auth.login", JSONObject().put("origin", origin).put("username", userB)
                .put("password", passwordB).put("deviceName", "Stage15 Memory QA")))
            val foreign = requireOk(call(page, "host.business", JSONObject().put("path",
                "/personal/v1/memory/items?kind=cognition&query=${java.net.URLEncoder.encode(text, "UTF-8")}").put("method", "GET")))
            assertEquals(0, foreign.getJSONArray("items").length())
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
}
