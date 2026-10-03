package com.memoweft.weftmate.mobile

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.net.URI
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Opt-in synthetic browser task through the rendered mobile controls and native SAF. */
@RunWith(AndroidJUnit4::class)
class Stage11BrowserUiProbeTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private fun findWebView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) for (index in 0 until view.childCount) {
            findWebView(view.getChildAt(index))?.let { return it }
        }
        return null
    }

    private fun evaluate(web: WebView, script: String): String {
        val done = CountDownLatch(1)
        var value = ""
        instrumentation.runOnMainSync {
            web.evaluateJavascript(script) { result -> value = result; done.countDown() }
        }
        assertTrue("Stage 11 WebView evaluation timed out", done.await(8, TimeUnit.SECONDS))
        return value
    }

    private fun waitFor(web: WebView, expression: String, seconds: Long = 15): Boolean {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds)
        while (System.nanoTime() < deadline) {
            if (evaluate(web, "Boolean($expression)") == "true") return true
            Thread.sleep(150)
        }
        return false
    }

    private fun capture(web: WebView, name: String) {
        val base = instrumentation.targetContext.getExternalFilesDir(null)
        assertNotNull("Synthetic screenshot directory unavailable", base)
        val visual = CountDownLatch(1)
        instrumentation.runOnMainSync {
            web.postVisualStateCallback(System.nanoTime(), object : WebView.VisualStateCallback() {
                override fun onComplete(requestId: Long) { visual.countDown() }
            })
        }
        assertTrue("WebView did not acknowledge the source/summary frame", visual.await(5, TimeUnit.SECONDS))
        instrumentation.waitForIdleSync()
        val image = instrumentation.uiAutomation.takeScreenshot()
        assertNotNull("MuMu screenshot unavailable", image)
        File(base!!, name).outputStream().use { image!!.compress(Bitmap.CompressFormat.PNG, 100, it) }
        image!!.recycle()
    }

    @Test fun browserGoalSourcePreviewAndVerifiedSafSave() {
        val arguments = InstrumentationRegistry.getArguments()
        val captureScreens = arguments.getString("stage11Capture") == "1"
        assumeTrue("Explicit Stage 11 save probe was not requested",
            arguments.getString("stage11AutoSave") == "1")
        val existingTaskId = arguments.getString("stage11TaskId")
        if (existingTaskId != null) assertTrue("Stage 11 task ID must be an exact command UUID",
            existingTaskId.matches(Regex("cmd-[0-9a-f-]{36}")))
        val pageA = arguments.getString("stage11PageA") ?: ""
        val page = try { URI(pageA) } catch (_: Exception) { null }
        if (existingTaskId == null) assumeTrue("Only the owned synthetic page-a URL is eligible",
            page?.scheme == "http" && page.host == "page-a.weftmate.invalid" &&
                page.path == "/page-a" && page.port in 1..65535 &&
                page.port !in setOf(18186, 18188, 443, 8443, 8080, 8081) &&
                page.userInfo == null && page.query == null && page.fragment == null &&
                pageA.length <= 2048)
        val host = SecureSettings(instrumentation.targetContext).host()
        assumeTrue("Only the isolated synthetic host/account is eligible",
            host?.origin == "http://127.0.0.1:18188" && host?.username == "Stage11SyntheticOwner")
        var existing: HybridActivity? = null
        instrumentation.runOnMainSync {
            existing = ActivityLifecycleMonitorRegistry.getInstance()
                .getActivitiesInStage(Stage.RESUMED).filterIsInstance<HybridActivity>().firstOrNull()
        }
        val launched = existing == null
        val activity: Activity = existing ?: instrumentation.startActivitySync(
            Intent(instrumentation.targetContext, HybridActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity
        try {
            var web: WebView? = null
            instrumentation.runOnMainSync { web = findWebView(activity.findViewById(android.R.id.content)) }
            assertNotNull("HybridActivity has no WebView", web)
            val view = web!!
            assertTrue("Stage 11 synthetic account UI was not ready", waitFor(view,
                "typeof state !== 'undefined' && state.booted && state.username === 'Stage11SyntheticOwner'", 20))

            var taskId = existingTaskId ?: ""
            if (existingTaskId == null) {
            val openedWorkspace = evaluate(view, """
                (() => {
                  const menu = document.getElementById('menu-button');
                  const workspaces = document.querySelector('[data-page="workspaces"]');
                  if (!menu || !workspaces) return false;
                  menu.click(); workspaces.click(); return true;
                })()
            """.trimIndent())
            assertTrue("Rendered Workspaces navigation was unavailable", openedWorkspace == "true")
            assertTrue("Rendered browser form did not load", waitFor(view,
                "[...document.querySelectorAll('#page-content .group')].some(group => group.querySelector('h2')?.textContent === '网页资料' && group.querySelectorAll('textarea').length === 2 && [...group.querySelectorAll('button')].some(button => button.textContent.trim() === '开始网页任务'))", 20))
            val marker = "Stage11合成网页验收-${UUID.randomUUID().toString().take(8)}"
            val formReady = evaluate(view, """
                (() => {
                  const group = [...document.querySelectorAll('#page-content .group')].find(
                    item => item.querySelector('h2')?.textContent === '网页资料');
                  if (!group) return false;
                  const fields = group.querySelectorAll('textarea');
                  const model = group.querySelector('select.workspace-model-select');
                  const start = [...group.querySelectorAll('button')].find(
                    item => item.textContent.trim() === '开始网页任务');
                  if (fields.length !== 2 || !model || !start || ![...model.options].some(
                      option => option.value === 'synthetic-stop-fixture')) return false;
                  fields[0].value = ${JSONObject.quote(pageA)};
                  fields[1].value = ${JSONObject.quote("$marker：阅读网页甲与已观察的页内链接，保存带来源摘要。")};
                  fields[0].dispatchEvent(new Event('input',{bubbles:true}));
                  fields[1].dispatchEvent(new Event('input',{bubbles:true}));
                  model.value = 'synthetic-stop-fixture';
                  model.dispatchEvent(new Event('change',{bubbles:true}));
                  return !start.disabled && fields[0].value === ${JSONObject.quote(pageA)};
                })()
            """.trimIndent())
            assertTrue("Browser URL, goal or synthetic model could not be entered", formReady == "true")
            val started = evaluate(view, """
                (() => {
                  const group = [...document.querySelectorAll('#page-content .group')].find(
                    item => item.querySelector('h2')?.textContent === '网页资料');
                  const button = group && [...group.querySelectorAll('button')].find(
                    item => item.textContent.trim() === '开始网页任务');
                  if (!button || button.disabled) return false;
                  button.click(); return true;
                })()
            """.trimIndent())
            assertTrue("Rendered browser Start button was unavailable", started == "true")
            assertTrue("Browser session was not opened through the shared UI", waitFor(view,
                "state.page === 'chat' && state.chatSource === 'host' && /^session-[A-Za-z0-9-]+$/.test(state.sharedSessionId || '')", 45))
            assertTrue("Submitted browser goal did not reach the shared conversation", waitFor(view,
                "document.getElementById('chat-content')?.textContent?.includes(${JSONObject.quote(marker)})", 35))

            val openedThings = evaluate(view, """
                (() => {
                  const menu = document.getElementById('menu-button');
                  const things = document.querySelector('[data-page="things"]');
                  if (!menu || !things) return false;
                  menu.click(); things.click(); return true;
                })()
            """.trimIndent())
            assertTrue("Rendered Things navigation was unavailable", openedThings == "true")
            assertTrue("Browser task card did not appear", waitFor(view,
                "[...document.querySelectorAll('#page-content button.row')].some(button => button.textContent.includes(${JSONObject.quote(marker)}) || button.textContent.includes('合成网页摘要.md'))", 45))
            val openedTask = evaluate(view, """
                (() => {
                  const button = [...document.querySelectorAll('#page-content button.row')].find(
                    item => item.textContent.includes(${JSONObject.quote(marker)}) || item.textContent.includes('合成网页摘要.md'));
                  if (!button) return false;
                  button.click(); return true;
                })()
            """.trimIndent())
            assertTrue("Rendered browser task card was unavailable", openedTask == "true")
            val taskIdRaw = evaluate(view, "state.thingsDetail || null")
            taskId = JSONTokener(taskIdRaw).nextValue() as String
            assertTrue("Task detail identity invalid", taskId.matches(Regex("cmd-[0-9a-f-]{36}")))
            } else {
                val openedThings = evaluate(view, """
                    (() => {
                      const menu = document.getElementById('menu-button');
                      const things = document.querySelector('[data-page="things"]');
                      if (!menu || !things) return false;
                      menu.click(); things.click(); return true;
                    })()
                """.trimIndent())
                assertTrue("Rendered Things navigation was unavailable", openedThings == "true")
                assertTrue("Exact existing task could not be opened in Things", evaluate(view,
                    "Boolean(state.page === 'things' && (showTaskDetail(${JSONObject.quote(existingTaskId)}), state.thingsDetail === ${JSONObject.quote(existingTaskId)}))") == "true")
            }
            var detailReady = waitFor(view,
                "[...document.querySelectorAll('.project-source-entry')].some(item => item.textContent.includes('page-a.weftmate.invalid')) && [...document.querySelectorAll('.artifact-entry')].some(item => [...item.querySelectorAll('button')].some(button => button.textContent.trim() === '查看内容'))", 25)
            for (attempt in 0 until 15) {
                if (detailReady) break
                evaluate(view, "[...document.querySelectorAll('#page-content button')].find(button => button.textContent.trim() === '刷新任务')?.click(); true")
                detailReady = waitFor(view,
                    "[...document.querySelectorAll('.project-source-entry')].some(item => item.textContent.includes('page-a.weftmate.invalid')) && [...document.querySelectorAll('.artifact-entry')].some(item => [...item.querySelectorAll('button')].some(button => button.textContent.trim() === '查看内容'))", 3)
            }
            assertTrue("Browser source and checked artifact did not appear in task detail", detailReady)

            val clickedSource = evaluate(view, """
                (() => {
                  const entry = [...document.querySelectorAll('.project-source-entry')].find(
                    item => item.textContent.includes('page-a.weftmate.invalid'));
                  const button = entry && [...entry.querySelectorAll('button')].find(
                    item => item.textContent.trim() === '查看来源正文');
                  if (!button) return false;
                  button.click(); return true;
                })()
            """.trimIndent())
            assertTrue("Rendered browser source button was unavailable", clickedSource == "true")
            assertTrue("Full browser source did not return through the native source bridge", waitFor(view,
                "[...document.querySelectorAll('.project-source-entry')].some(item => item.querySelector('.artifact-preview')?.textContent?.includes('脚本渲染的网页甲正文'))", 18))
            if (captureScreens) {
                assertTrue("Drawer remained visible over the source", waitFor(view,
                    "!state.drawer && !document.getElementById('drawer')?.classList.contains('open') && !document.getElementById('drawer-scrim')?.classList.contains('open')", 4))
                assertTrue("Source entry unavailable for screenshot", evaluate(view,
                    "(() => { const entry=[...document.querySelectorAll('.project-source-entry')].find(item => item.textContent.includes('page-a.weftmate.invalid')); if(!entry)return false; entry.scrollIntoView({block:'center'}); return true })()") == "true")
                capture(view, "stage11-source.png")
            }
            val clickedArtifact = evaluate(view, """
                (() => {
                  const entry = [...document.querySelectorAll('.artifact-entry')].find(item =>
                    [...item.querySelectorAll('button')].some(button => button.textContent.trim() === '查看内容'));
                  const button = entry && [...entry.querySelectorAll('button')].find(
                    item => item.textContent.trim() === '查看内容');
                  if (!button) return false;
                  button.click(); return true;
                })()
            """.trimIndent())
            assertTrue("Rendered artifact preview button was unavailable", clickedArtifact == "true")
            assertTrue("Browser summary did not include the host provenance footer", waitFor(view,
                "[...document.querySelectorAll('.artifact-entry')].some(item => item.querySelector('.artifact-preview')?.textContent?.includes('已读取网页来源'))", 18))
            if (captureScreens) {
                assertTrue("Drawer remained visible over the summary", waitFor(view,
                    "!state.drawer && !document.getElementById('drawer')?.classList.contains('open') && !document.getElementById('drawer-scrim')?.classList.contains('open')", 4))
                assertTrue("Summary entry unavailable for screenshot", evaluate(view,
                    "(() => { const entry=[...document.querySelectorAll('.artifact-entry')].find(item => item.querySelector('.artifact-preview')?.textContent?.includes('已读取网页来源')); if(!entry)return false; entry.scrollIntoView({block:'center'}); return true })()") == "true")
                capture(view, "stage11-summary.png")
                System.out.println("STAGE11_BROWSER_UI_CAPTURE " + JSONObject()
                    .put("source", "stage11-source.png").put("summary", "stage11-summary.png"))
            }
            val lengths = JSONObject(JSONTokener(evaluate(view, """
                (() => JSON.stringify({
                  sourceLength:[...document.querySelectorAll('.project-source-entry')]
                    .map(item => item.querySelector('.artifact-preview')?.textContent?.length || 0)
                    .reduce((a,b) => Math.max(a,b), 0),
                  artifactLength:[...document.querySelectorAll('.artifact-entry')]
                    .map(item => item.querySelector('.artifact-preview')?.textContent?.length || 0)
                    .reduce((a,b) => Math.max(a,b), 0)
                }))()
            """.trimIndent())).nextValue() as String)

            val clickedSave = evaluate(view, """
                (() => {
                  const entry = [...document.querySelectorAll('.artifact-entry')].find(item =>
                    [...item.querySelectorAll('button')].some(button => button.textContent.trim() === '保存到手机'));
                  const button = entry && [...entry.querySelectorAll('button')].find(
                    item => item.textContent.trim() === '保存到手机');
                  if (!button) return false;
                  button.click(); return true;
                })()
            """.trimIndent())
            assertTrue("Rendered Save to phone button was unavailable", clickedSave == "true")
            val pendingField = HybridActivity::class.java.getDeclaredField("pendingArtifactSave")
            pendingField.isAccessible = true
            val pendingDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
            var pending = false
            while (System.nanoTime() < pendingDeadline) {
                instrumentation.runOnMainSync { pending = pendingField.get(activity) != null }
                if (pending) break
                Thread.sleep(100)
            }
            assertTrue("Native SAF attempt was not pending", pending)
            val automation = instrumentation.uiAutomation
            val pickerDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
            var picker: AccessibilityNodeInfo? = null
            while (System.nanoTime() < pickerDeadline) {
                val candidate = automation.rootInActiveWindow
                if (candidate?.packageName?.toString() == "com.android.documentsui") {
                    picker = candidate; break
                }
                Thread.sleep(100)
            }
            assertNotNull("Expected DocumentsUI save picker", picker)
            val root = picker!!
            val breadcrumb = root.findAccessibilityNodeInfosByViewId("com.android.documentsui:id/breadcrumb_text")
                .filter { it.isVisibleToUser }
            assertTrue("Save destination is not Download",
                breadcrumb.isNotEmpty() && breadcrumb.last().text?.toString() == "Download")
            val filename = "stage11-verified-${UUID.randomUUID()}.md"
            val nameNodes = root.findAccessibilityNodeInfosByViewId("android:id/title")
                .filter { it.isVisibleToUser && it.className?.toString() == "android.widget.EditText" }
            assertTrue("Expected one filename field", nameNodes.size == 1)
            val saveName = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, filename)
            }
            assertTrue("New isolated filename was not set",
                nameNodes.single().performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, saveName))
            val readyRoot = automation.rootInActiveWindow
            assertTrue("DocumentsUI changed before save", readyRoot?.packageName?.toString() == "com.android.documentsui")
            val confirmed = readyRoot!!.findAccessibilityNodeInfosByViewId("android:id/title")
                .filter { it.isVisibleToUser && it.className?.toString() == "android.widget.EditText" }
            assertTrue("Filename field differs from new isolated name",
                confirmed.size == 1 && confirmed.single().text?.toString() == filename)
            val readyBreadcrumb = readyRoot.findAccessibilityNodeInfosByViewId("com.android.documentsui:id/breadcrumb_text")
                .filter { it.isVisibleToUser }
            assertTrue("Download context changed before save",
                readyBreadcrumb.isNotEmpty() && readyBreadcrumb.last().text?.toString() == "Download")
            val saveButtons = readyRoot.findAccessibilityNodeInfosByViewId("android:id/button1")
                .filter { it.isVisibleToUser && it.className?.toString() == "android.widget.Button" &&
                    it.text?.toString() == "保存" && it.isClickable }
            assertTrue("Expected one Save button", saveButtons.size == 1)
            assertTrue("DocumentsUI Save action failed", saveButtons.single().performAction(AccessibilityNodeInfo.ACTION_CLICK))
            val verifiedDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
            var savedAndChecked = false
            while (System.nanoTime() < verifiedDeadline) {
                instrumentation.runOnMainSync { pending = pendingField.get(activity) != null }
                if (!pending && evaluate(view,
                        "Boolean([...document.querySelectorAll('.artifact-save-state')].some(node => node.textContent.includes('已保存到手机并核对内容')))") == "true") {
                    savedAndChecked = true; break
                }
                Thread.sleep(100)
            }
            assertTrue("Native save callback and SHA readback were not observed", savedAndChecked)
            System.out.println("STAGE11_BROWSER_UI_ACCEPTANCE " + JSONObject()
                .put("browserFormSubmitted", existingTaskId == null)
                .put("sharedGoalSent", existingTaskId == null)
                .put("existingTaskReused", existingTaskId != null)
                .put("sourceRendered", true).put("artifactRendered", true)
                .put("nativeSavedAndVerified", true).put("sourceTextLength", lengths.getInt("sourceLength"))
                .put("artifactTextLength", lengths.getInt("artifactLength"))
                .put("taskId", taskId).put("fileName", filename))
        } finally {
            if (launched) instrumentation.runOnMainSync { activity.finish() }
        }
    }
}
