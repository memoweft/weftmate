package com.memoweft.weftmate.mobile

import android.app.Activity
import android.content.Intent
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.UUID

/** Read-only geometry probe for the existing Stage 10 WebView. */
@RunWith(AndroidJUnit4::class)
class Stage10UiProbeTest {
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
        assertTrue("Read-only WebView probe timed out", done.await(8, TimeUnit.SECONDS))
        return value
    }

    private fun waitFor(web: WebView, expression: String, seconds: Long = 12): Boolean {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds)
        while (System.nanoTime() < deadline) {
            if (evaluate(web, "Boolean($expression)") == "true") return true
            Thread.sleep(100)
        }
        return false
    }

    @Test fun readCurrentGeometryWithoutChangingUi() {
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
            instrumentation.runOnMainSync {
                web = findWebView(activity.findViewById(android.R.id.content))
            }
            assertNotNull("HybridActivity has no WebView", web)
            val view = web!!
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            while (System.nanoTime() < deadline &&
                evaluate(view, "Boolean(document.getElementById('drawer'))") != "true") {
                Thread.sleep(80)
            }
            val script = """
                (() => {
                  const safeTitles = new Set([
                    '项目与成果','在此项目开始对话','设置','关闭导航','对话','事情',
                    '记忆','能力与扩展','设备','通知','查看来源正文','查看内容','保存到手机',
                    '返回最近活动','刷新任务','打开原电脑会话','关闭'
                  ]);
                  const rect = (node) => {
                    if (!node) return null;
                    const r = node.getBoundingClientRect();
                    return { x:r.x, y:r.y, width:r.width, height:r.height,
                      top:r.top, right:r.right, bottom:r.bottom, left:r.left };
                  };
                  const label = (node) => {
                    if (!node) return null;
                    const aria = (node.getAttribute('aria-label') || '').trim();
                    if (safeTitles.has(aria)) return aria;
                    if (node.dataset?.page) {
                      const labels = { chat:'对话', things:'事情', memory:'记忆',
                        capabilities:'能力与扩展', workspaces:'项目与成果', devices:'设备',
                        notifications:'通知', settings:'设置' };
                      return labels[node.dataset.page] || '[dynamic]';
                    }
                    if (node.classList.contains('primary') && node.closest('#page-content') &&
                        document.querySelector('.page-title')?.textContent?.trim() === '项目与成果') {
                      const title = (node.textContent || '').trim();
                      return safeTitles.has(title) ? title : '[dynamic]';
                    }
                    return '[dynamic]';
                  };
                  const node = (item) => item ? {
                    tag:item.tagName.toLowerCase(), id:item.id || null,
                    dataPage:item.dataset?.page || null, className:String(item.className || '').slice(0,120),
                    title:label(item), rect:rect(item)
                  } : null;
                  const visible = [...document.querySelectorAll('button')].filter((button) => {
                    const r = button.getBoundingClientRect(), style = getComputedStyle(button);
                    return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' &&
                      style.display !== 'none' && r.bottom > 0 && r.top < innerHeight;
                  }).slice(0,20).map(node);
                  const dpr = window.devicePixelRatio;
                  const hit = (x,y) => node(document.elementFromPoint(x,y));
                  return JSON.stringify({
                    href:location.origin + location.pathname,
                    innerWidth:window.innerWidth, innerHeight:window.innerHeight,
                    devicePixelRatio:dpr, activeElementId:document.activeElement?.id || null,
                    drawer:node(document.getElementById('drawer')),
                    workspacesButton:node(document.querySelector('[data-page="workspaces"]')),
                    visibleButtons:visible,
                    elementFromPoint119x632:hit(119,632),
                    elementFromPoint119DivDprx632DivDpr:hit(119/dpr,632/dpr)
                  });
                })()
            """.trimIndent()
            val raw = evaluate(view, script)
            val decoded = JSONTokener(raw).nextValue() as String
            val result = JSONObject(decoded)
            val location = IntArray(2)
            instrumentation.runOnMainSync { view.getLocationOnScreen(location) }
            result.put("webViewScreen", JSONObject().put("x", location[0]).put("y", location[1])
                .put("width", view.width).put("height", view.height))
            System.out.println("STAGE10_UI_PROBE ${result}")
        } finally {
            if (launched) instrumentation.runOnMainSync { activity.finish() }
        }
    }

    /** Opt-in synthetic account UI proof. Uses the rendered controls and sends no model request. */
    @Test fun openActualSourceAndArtifactFromTaskDetail() {
        val taskId = InstrumentationRegistry.getArguments().getString("stage10TaskId") ?: ""
        val autoSave = InstrumentationRegistry.getArguments().getString("stage10AutoSave") == "1"
        val launchSave = autoSave || InstrumentationRegistry.getArguments().getString("stage10LaunchSave") == "1"
        assumeTrue("Stage 10 task ID was not supplied", taskId.matches(Regex("cmd-[0-9a-f-]{36}")))
        val host = SecureSettings(instrumentation.targetContext).host()
        assumeTrue("Only the isolated 18188 synthetic host is eligible",
            host?.origin == "http://127.0.0.1:18188" && host?.username == "Stage10SyntheticOwner")
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
            instrumentation.runOnMainSync {
                web = findWebView(activity.findViewById(android.R.id.content))
            }
            assertNotNull("HybridActivity has no WebView", web)
            val view = web!!
            assertTrue("Synthetic account UI was not ready", waitFor(view,
                "typeof state !== 'undefined' && state.booted && state.username === 'Stage10SyntheticOwner'"))
            val quotedTaskId = JSONObject.quote(taskId)
            evaluate(view, "page('things');showTaskDetail($quotedTaskId);true")
            assertTrue("Task detail did not show a source and an artifact", waitFor(view,
                "document.querySelector('.project-source-entry') && document.querySelector('.artifact-entry')", 18))
            val clickedSource = evaluate(view, """
                (() => {
                  const entry = [...document.querySelectorAll('.project-source-entry')].find(
                    item => item.querySelector('.artifact-name')?.textContent?.includes('brief.md'));
                  const button = entry && [...entry.querySelectorAll('button')].find(
                    item => item.textContent.trim() === '查看来源正文');
                  if (!button) return false;
                  button.click();
                  return true;
                })()
            """.trimIndent())
            assertTrue("Actual source button was not found", clickedSource == "true")
            assertTrue("Native source bridge did not render the saved brief", waitFor(view,
                "[...document.querySelectorAll('.project-source-entry')].some(item => item.querySelector('.artifact-preview')?.textContent?.includes('合成项目'))", 18))
            val clickedArtifact = evaluate(view, """
                (() => {
                  const entry = [...document.querySelectorAll('.artifact-entry')].find(
                    item => [...item.querySelectorAll('button')].some(button => button.textContent.trim() === '查看内容'));
                  const button = entry && [...entry.querySelectorAll('button')].find(
                    item => item.textContent.trim() === '查看内容');
                  if (!button) return false;
                  button.click();
                  return true;
                })()
            """.trimIndent())
            assertTrue("Actual artifact preview button was not found", clickedArtifact == "true")
            assertTrue("Artifact preview did not render the host provenance footer", waitFor(view,
                "[...document.querySelectorAll('.artifact-entry')].some(item => item.querySelector('.artifact-preview')?.textContent?.includes('来源'))", 18))
            val lengths = evaluate(view, """
                (() => JSON.stringify({
                  sourceTextLength:[...document.querySelectorAll('.project-source-entry')]
                    .map(item => item.querySelector('.artifact-preview')?.textContent?.length || 0)
                    .reduce((a,b) => Math.max(a,b), 0),
                  artifactTextLength:[...document.querySelectorAll('.artifact-entry')]
                    .map(item => item.querySelector('.artifact-preview')?.textContent?.length || 0)
                    .reduce((a,b) => Math.max(a,b), 0)
                }))()
            """.trimIndent())
            val metrics = JSONObject(JSONTokener(lengths).nextValue() as String)
            assertTrue("Source text is empty", metrics.getInt("sourceTextLength") > 0)
            assertTrue("Artifact text is empty", metrics.getInt("artifactTextLength") > 0)
            System.out.println("STAGE10_SOURCE_UI_ACCEPTANCE " + JSONObject()
                .put("sourceButtonClicked", true).put("sourceRendered", true)
                .put("artifactButtonClicked", true).put("provenanceFooterRendered", true)
                .put("sourceTextLength", metrics.getInt("sourceTextLength"))
                .put("artifactTextLength", metrics.getInt("artifactTextLength")))
            if (launchSave) {
                val clickedSave = evaluate(view, """
                    (() => {
                      const entry = [...document.querySelectorAll('.artifact-entry')].find(
                        item => [...item.querySelectorAll('button')].some(button =>
                          button.textContent.trim() === '保存到手机'));
                      const button = entry && [...entry.querySelectorAll('button')].find(
                        item => item.textContent.trim() === '保存到手机');
                      if (!button) return false;
                      button.click();
                      return true;
                    })()
                """.trimIndent())
                assertTrue("Actual Save to phone button was not found", clickedSave == "true")
                val field = HybridActivity::class.java.getDeclaredField("pendingArtifactSave")
                field.isAccessible = true
                val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
                var pickerPending = false
                while (System.nanoTime() < deadline) {
                    instrumentation.runOnMainSync { pickerPending = field.get(activity) != null }
                    if (pickerPending) break
                    Thread.sleep(100)
                }
                assertTrue("Native artifact save did not create a pending picker", pickerPending)
                Thread.sleep(400)
                instrumentation.runOnMainSync { pickerPending = field.get(activity) != null }
                assertTrue("Native picker did not remain pending for user selection", pickerPending)
                System.out.println("STAGE10_SAVE_UI_REQUESTED " + JSONObject()
                    .put("saveRequested", true).put("pickerPending", true))
                if (autoSave) {
                    val automation = instrumentation.uiAutomation
                    val pickerDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
                    var picker: AccessibilityNodeInfo? = null
                    while (System.nanoTime() < pickerDeadline) {
                        val candidate = automation.rootInActiveWindow
                        if (candidate?.packageName?.toString() == "com.android.documentsui") {
                            picker = candidate
                            break
                        }
                        Thread.sleep(100)
                    }
                    assertNotNull("Expected the system DocumentsUI save picker", picker)
                    val root = picker!!
                    val breadcrumbs = root.findAccessibilityNodeInfosByViewId(
                        "com.android.documentsui:id/breadcrumb_text").filter { it.isVisibleToUser }
                    assertTrue("Download breadcrumb is not the current save directory",
                        breadcrumbs.isNotEmpty() && breadcrumbs.last().text?.toString() == "Download")
                    val filenameNodes = root.findAccessibilityNodeInfosByViewId("android:id/title")
                        .filter { it.isVisibleToUser && it.className?.toString() == "android.widget.EditText" }
                    assertTrue("Expected one visible system filename field", filenameNodes.size == 1)
                    val fileName = "stage10-verified-${UUID.randomUUID()}.md"
                    val arguments = Bundle().apply {
                        putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, fileName)
                    }
                    assertTrue("System filename field rejected ACTION_SET_TEXT",
                        filenameNodes.single().performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments))
                    val readyRoot = automation.rootInActiveWindow
                    assertTrue("DocumentsUI changed before Save",
                        readyRoot?.packageName?.toString() == "com.android.documentsui")
                    val confirmedName = readyRoot!!.findAccessibilityNodeInfosByViewId("android:id/title")
                        .filter { it.isVisibleToUser && it.className?.toString() == "android.widget.EditText" }
                    assertTrue("System filename was not set to the new isolated name",
                        confirmedName.size == 1 && confirmedName.single().text?.toString() == fileName)
                    val currentBreadcrumbs = readyRoot.findAccessibilityNodeInfosByViewId(
                        "com.android.documentsui:id/breadcrumb_text").filter { it.isVisibleToUser }
                    assertTrue("Save directory changed away from Download",
                        currentBreadcrumbs.isNotEmpty() && currentBreadcrumbs.last().text?.toString() == "Download")
                    val saveButtons = readyRoot.findAccessibilityNodeInfosByViewId("android:id/button1")
                        .filter { it.isVisibleToUser && it.className?.toString() == "android.widget.Button" &&
                            it.text?.toString() == "保存" && it.isClickable }
                    assertTrue("Expected one visible Save button in Download", saveButtons.size == 1)
                    assertTrue("System Save button rejected ACTION_CLICK",
                        saveButtons.single().performAction(AccessibilityNodeInfo.ACTION_CLICK))
                    val verifiedDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
                    var nativeSavedAndVerified = false
                    while (System.nanoTime() < verifiedDeadline) {
                        var pending = true
                        instrumentation.runOnMainSync { pending = field.get(activity) != null }
                        if (!pending && evaluate(view,
                                "Boolean([...document.querySelectorAll('.artifact-save-state')].some(node => node.textContent.includes('已保存到手机并核对内容')))") == "true") {
                            nativeSavedAndVerified = true
                            break
                        }
                        Thread.sleep(100)
                    }
                    assertTrue("Native save callback and SHA readback were not observed", nativeSavedAndVerified)
                    System.out.println("STAGE10_SAVE_UI_ACCEPTANCE " + JSONObject()
                        .put("nativeSavedAndVerified", true).put("fileName", fileName))
                }
            }
        } finally {
            if (launched && !launchSave) instrumentation.runOnMainSync { activity.finish() }
        }
    }
}
