package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.view.Choreographer
import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** One isolated 0.8.0/code13 pass over account boundaries and the complete Weave settings shell. */
@RunWith(AndroidJUnit4::class)
class Stage15ReleaseUiInstrumentedTest {
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
            if (evaluate(web, "Boolean($expression)") == "true") return
            Thread.sleep(75)
        }
        throw AssertionError("Release UI did not stabilize: $expression; body=" +
            evaluate(web, "document.body.innerText"))
    }

    private fun call(web: WebView, method: String, params: JSONObject): JSONObject {
        val key = "__stage15_release_${System.nanoTime()}"
        evaluate(web, "window.$key='pending';call(${JSONObject.quote(method)},$params)" +
            ".then(v=>window.$key=JSON.stringify({ok:true,value:v}))" +
            ".catch(e=>window.$key=JSON.stringify({ok:false,error:String(e&&e.message||e)}))")
        waitFor(web, "typeof window.$key==='string'&&window.$key!=='pending'")
        return JSONObject(decoded(evaluate(web, "window.$key")))
    }

    private fun requireOk(result: JSONObject): JSONObject {
        assertTrue(result.toString(), result.optBoolean("ok"))
        return result.getJSONObject("value")
    }

    private fun start(): HybridActivity = instrumentation.startActivitySync(Intent(instrumentation.targetContext,
        HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity

    private fun waitForThemeFrame(dark: Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(8)
        while (System.nanoTime() < deadline) {
            val image = instrumentation.uiAutomation.takeScreenshot()
            if (image != null) {
                val x = (image.width / 72).coerceIn(1, image.width - 1)
                val y = (image.height / 6).coerceIn(1, image.height - 1)
                val pixel = image.getPixel(x, y)
                val luminance = (Color.red(pixel) + Color.green(pixel) + Color.blue(pixel)) / 3
                image.recycle()
                if ((dark && luminance < 100) || (!dark && luminance > 180)) return
            }
            Thread.sleep(75)
        }
        throw AssertionError("Composited theme pixels did not become ${if (dark) "dark" else "light"}")
    }

    private fun capture(web: WebView, name: String, dark: Boolean) {
        waitForThemeFrame(dark)
        Thread.sleep(600)
        val visual = CountDownLatch(1)
        instrumentation.runOnMainSync { web.postVisualStateCallback(System.nanoTime(),
            object : WebView.VisualStateCallback() {
                override fun onComplete(requestId: Long) { visual.countDown() }
            }) }
        assertTrue("WebView compositor did not acknowledge visual state", visual.await(5, TimeUnit.SECONDS))
        val frames = CountDownLatch(1)
        instrumentation.runOnMainSync { Choreographer.getInstance().postFrameCallback {
            Choreographer.getInstance().postFrameCallback { frames.countDown() } } }
        assertTrue("Two display frames did not complete", frames.await(3, TimeUnit.SECONDS))
        instrumentation.waitForIdleSync()
        val image = instrumentation.uiAutomation.takeScreenshot()
            ?: throw AssertionError("System screenshot unavailable")
        File(instrumentation.targetContext.getExternalFilesDir(null), name).outputStream().use {
            image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        image.recycle()
    }

    private fun openPage(web: WebView, page: String, text: String) {
        evaluate(web, "page(${JSONObject.quote(page)})")
        waitFor(web, "state.page===${JSONObject.quote(page)}&&document.getElementById('page-content').textContent.includes(${JSONObject.quote(text)})")
    }

    private fun loginAndRestart(activity: HybridActivity, currentWeb: WebView, origin: String,
        username: String, password: String): Pair<HybridActivity, WebView> {
        val login = requireOk(call(currentWeb, "auth.login", JSONObject().put("origin", origin)
            .put("username", username).put("password", password).put("deviceName", "Stage15 Release QA")))
        val owner = login.getString("owner")
        instrumentation.runOnMainSync { activity.finish() }
        val restarted = start(); val page = web(restarted)
        waitFor(page, "typeof state!=='undefined'&&state.booted&&state.loggedIn&&state.owner===${JSONObject.quote(owner)}")
        return restarted to page
    }

    @Test fun accountDraftRestartThemesAndSettingsStayStable() {
        assumeTrue("Explicit Stage15 release UI fixture only", args.getString("stage15ReleaseUi") == "1")
        val origin = args.getString("origin") ?: throw AssertionError("origin missing")
        val userA = args.getString("userA") ?: throw AssertionError("userA missing")
        val passwordA = args.getString("passwordA") ?: throw AssertionError("passwordA missing")
        val userB = args.getString("userB") ?: throw AssertionError("userB missing")
        val passwordB = args.getString("passwordB") ?: throw AssertionError("passwordB missing")
        val draft = "Stage15 release draft ${System.nanoTime()}"
        var activity = start()
        try {
            var page = web(activity)
            waitFor(page, "typeof state!=='undefined'&&state.booted&&window.weftNative")
            loginAndRestart(activity, page, origin, userA, passwordA).also { activity = it.first; page = it.second }
            evaluate(page, "document.getElementById('draft').value=${JSONObject.quote(draft)};updateComposer()")
            waitFor(page, "document.getElementById('draft').value===${JSONObject.quote(draft)}&&localStorage.getItem(draftKey())===${JSONObject.quote(draft)}")
            Thread.sleep(600)
            waitFor(page, "localStorage.getItem(draftKey())===${JSONObject.quote(draft)}")
            val ownerA = decoded(evaluate(page, "state.owner"))
            instrumentation.runOnMainSync { activity.finish() }
            activity = start(); page = web(activity)
            waitFor(page, "typeof state!=='undefined'&&state.booted&&state.loggedIn&&state.owner===${JSONObject.quote(ownerA)}")
            evaluate(page, "selectConversation(null)")
            waitFor(page, "state.page==='chat'&&state.chatSource==='phone'")
            val restartedDraft = decoded(evaluate(page, "document.getElementById('draft').value"))
            System.out.println("STAGE15_RELEASE_DRAFT " + JSONObject()
                .put("activityRestartRestored", restartedDraft == draft))
            assertEquals("new-conversation draft must survive an immediate Activity restart", draft, restartedDraft)

            loginAndRestart(activity, page, origin, userB, passwordB).also { activity = it.first; page = it.second }
            assertNotEquals(draft, decoded(evaluate(page, "document.getElementById('draft').value")))
            loginAndRestart(activity, page, origin, userA, passwordA).also { activity = it.first; page = it.second }
            evaluate(page, "selectConversation(null)")
            waitFor(page, "state.page==='chat'&&state.chatSource==='phone'")
            evaluate(page, "document.getElementById('draft').value=${JSONObject.quote(draft)};updateComposer()")
            waitFor(page, "document.getElementById('draft').value===${JSONObject.quote(draft)}&&localStorage.getItem(draftKey())===${JSONObject.quote(draft)}")

            requireOk(call(page, "settings.appearance", JSONObject().put("value", "light")))
            evaluate(page, "applyTheme('light');page('chat')")
            waitFor(page, "document.documentElement.dataset.theme==='light'&&state.page==='chat'")
            capture(page, "stage15-release-shell-light.png", false)

            openPage(page, "account", "账户资料")
            waitFor(page, "document.getElementById('page-content').textContent.includes(${JSONObject.quote(userA)})")
            capture(page, "stage15-release-profile-light.png", false)
            evaluate(page, "handleBack()")
            waitFor(page, "state.page==='chat'&&document.getElementById('draft').value===${JSONObject.quote(draft)}")

            openPage(page, "appearance", "跟随系统")
            assertTrue(evaluate(page, "(()=>{const b=[...document.querySelectorAll('#page-content button')].find(x=>x.textContent.startsWith('深色'));if(!b)return false;b.click();return true})()") == "true")
            waitFor(page, "document.documentElement.dataset.theme==='dark'&&state.page==='appearance'")
            capture(page, "stage15-release-appearance-dark.png", true)
            assertTrue(evaluate(page, "(()=>{const b=[...document.querySelectorAll('#page-content button')].find(x=>x.textContent.startsWith('浅色'));if(!b)return false;b.click();return true})()") == "true")
            waitFor(page, "document.documentElement.dataset.theme==='light'&&state.page==='appearance'")
            waitForThemeFrame(false)

            openPage(page, "models", "配置自定义模型")
            waitFor(page, "!document.getElementById('page-content').textContent.includes('正在读取')")
            capture(page, "stage15-release-models-light.png", false)
            openPage(page, "notifications", "提醒类别")
            capture(page, "stage15-release-notifications-light.png", false)
            openPage(page, "devices", "已登录设备")
            capture(page, "stage15-release-devices-light.png", false)
            openPage(page, "updates", "界面更新")
            waitFor(page, "document.getElementById('page-content').textContent.includes('0.8.0')&&document.getElementById('page-content').textContent.includes('新增原生能力仍需更新应用')")
            waitFor(page, "(()=>{const a=document.querySelector('.native-download-link'),q=document.querySelector('.native-download-qr');return a&&a.href==='https://www.weftmate.com/downloads/?platform=android'&&q&&q.naturalWidth>0})()")
            capture(page, "stage15-release-updates-light.png", false)
            evaluate(page, "document.querySelector('.native-download-qr').scrollIntoView({block:'center'})")
            waitFor(page, "document.querySelector('.native-download-qr').getBoundingClientRect().top>=0")
            capture(page, "stage15-release-update-install-light.png", false)
            evaluate(page, "handleBack()")
            waitFor(page, "state.page==='chat'&&document.getElementById('draft').value===${JSONObject.quote(draft)}")
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
}
