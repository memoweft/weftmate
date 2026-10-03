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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Test APK only. Uses the real phone form, native bridge, account host, DSH and SAF. */
@RunWith(AndroidJUnit4::class)
class Stage12HandoffUiProbeTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    private fun webView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) for (index in 0 until view.childCount)
            webView(view.getChildAt(index))?.let { return it }
        return null
    }

    private fun evaluate(web: WebView, script: String): String {
        val done = CountDownLatch(1)
        var result = ""
        instrumentation.runOnMainSync {
            web.evaluateJavascript(script) { value -> result = value; done.countDown() }
        }
        assertTrue("Stage12 WebView evaluation timed out", done.await(8, TimeUnit.SECONDS))
        return result
    }

    private fun waitFor(web: WebView, expression: String, seconds: Long = 30): Boolean {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds)
        while (System.nanoTime() < deadline) {
            if (evaluate(web, "Boolean($expression)") == "true") return true
            Thread.sleep(150)
        }
        return false
    }

    private fun <T> until(seconds: Long = 60, value: () -> T?): T {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds)
        while (System.nanoTime() < deadline) {
            value()?.let { return it }
            Thread.sleep(200)
        }
        throw AssertionError("Stage12 bounded host observation timed out")
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }

    private fun navigate(web: WebView, page: String): Boolean = evaluate(web, """
        (() => { const menu=document.getElementById('menu-button');
          const item=document.querySelector('[data-page=${JSONObject.quote(page)}]');
          if(!menu||!item)return false;menu.click();item.click();return true })()
    """.trimIndent()) == "true"

    private fun capture(web: WebView, filename: String) {
        val target = context.getExternalFilesDir(null) ?: throw AssertionError("Screenshot directory unavailable")
        val frame = CountDownLatch(1)
        instrumentation.runOnMainSync { web.postVisualStateCallback(System.nanoTime(),
            object : WebView.VisualStateCallback() {
                override fun onComplete(requestId: Long) { frame.countDown() }
            }) }
        assertTrue("Stage12 visual state unavailable", frame.await(5, TimeUnit.SECONDS))
        instrumentation.waitForIdleSync()
        val image = instrumentation.uiAutomation.takeScreenshot()
            ?: throw AssertionError("Screenshot unavailable")
        File(target, filename).outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        image.recycle()
    }

    private fun saveThroughSaf(activity: Activity, web: WebView): String {
        assertTrue("Rendered save action missing", evaluate(web, """
            (() => { const button=[...document.querySelectorAll('.artifact-entry button')]
              .find(item=>item.textContent.trim()==='保存到手机');
              if(!button)return false;button.click();return true })()
        """.trimIndent()) == "true")
        val pendingField = HybridActivity::class.java.getDeclaredField("pendingArtifactSave")
        pendingField.isAccessible = true
        val pending = until(10) {
            var current = false
            instrumentation.runOnMainSync { current = pendingField.get(activity) != null }
            if (current) true else null
        }
        assertTrue(pending)
        val root = until(10) {
            instrumentation.uiAutomation.rootInActiveWindow?.takeIf {
                it.packageName?.toString() == "com.android.documentsui" }
        }
        val breadcrumb = root.findAccessibilityNodeInfosByViewId("com.android.documentsui:id/breadcrumb_text")
            .filter { it.isVisibleToUser }
        assertTrue("SAF is not in Download", breadcrumb.isNotEmpty() &&
            breadcrumb.last().text?.toString() == "Download")
        val filename = "stage12-verified-${UUID.randomUUID()}.md"
        val fields = root.findAccessibilityNodeInfosByViewId("android:id/title")
            .filter { it.isVisibleToUser && it.className?.toString() == "android.widget.EditText" }
        assertEquals("Expected exactly one SAF filename field", 1, fields.size)
        assertTrue("SAF filename set failed", fields.single().performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,
            Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, filename) }))
        val ready = instrumentation.uiAutomation.rootInActiveWindow
            ?: throw AssertionError("SAF disappeared before save")
        assertEquals("com.android.documentsui", ready.packageName?.toString())
        val confirmed = ready.findAccessibilityNodeInfosByViewId("android:id/title")
            .filter { it.isVisibleToUser && it.className?.toString() == "android.widget.EditText" }
        assertTrue("SAF filename changed unexpectedly", confirmed.size == 1 &&
            confirmed.single().text?.toString() == filename)
        val save = ready.findAccessibilityNodeInfosByViewId("android:id/button1")
            .filter { it.isVisibleToUser && it.className?.toString() == "android.widget.Button" &&
                it.text?.toString() == "保存" && it.isClickable }
        assertEquals("Expected exactly one SAF Save action", 1, save.size)
        assertTrue("SAF Save failed", save.single().performAction(AccessibilityNodeInfo.ACTION_CLICK))
        until(30) {
            var current = false
            instrumentation.runOnMainSync { current = pendingField.get(activity) != null }
            if (!current && evaluate(web,
                "Boolean([...document.querySelectorAll('.artifact-save-state')].some(node=>node.textContent.includes('已保存到手机并核对内容')))") == "true") true else null
        }
        return filename
    }

    @Test fun realPhoneTurnDesktopAdoptionAndOfflineCachedReply() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("Explicit Stage12 probe not requested", args.getString("stage12Probe") == "1")
        val phase = args.getString("stage12Phase") ?: "initial"
        assertTrue("Unknown Stage12 phase", phase in setOf("initial", "offline"))
        val host = SecureSettings(context).host()
        assumeTrue("Only the isolated Stage12 synthetic host/account is eligible",
            host?.origin == "http://127.0.0.1:18188" && host?.username == "Stage12SyntheticOwner")
        var existing: HybridActivity? = null
        instrumentation.runOnMainSync {
            existing = ActivityLifecycleMonitorRegistry.getInstance()
                .getActivitiesInStage(Stage.RESUMED).filterIsInstance<HybridActivity>().firstOrNull()
        }
        val launched = existing == null
        val activity: Activity = existing ?: instrumentation.startActivitySync(
            Intent(context, HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity
        try {
            var selected: WebView? = null
            instrumentation.runOnMainSync { selected = webView(activity.findViewById(android.R.id.content)) }
            assertNotNull("HybridActivity WebView unavailable", selected)
            val web = selected!!
            assertTrue("Stage12 account UI not ready", waitFor(web,
                "typeof state!=='undefined'&&state.booted&&state.username==='Stage12SyntheticOwner'", 25))
            if (phase == "offline") {
                val conversationId = args.getString("stage12ConversationId") ?: ""
                assertTrue("Exact synthetic conversation required",
                    conversationId.matches(Regex("conversation-[0-9a-f-]{36}")))
                assertTrue("Original conversation did not return from local storage", waitFor(web,
                    "state.conversations.some(item=>item.id===${JSONObject.quote(conversationId)})", 20))
                assertTrue("Original conversation could not be opened", evaluate(web, """
                    (() => { const button=[...document.querySelectorAll('#conversation-list button[data-conversation-id]')]
                      .find(item=>item.dataset.conversationId===${JSONObject.quote(conversationId)});if(!button)return false;
                      button.click();return true })()
                """.trimIndent()) == "true")
                assertTrue("Cached DSH answer did not survive offline restart", waitFor(web,
                    "state.conversationId===${JSONObject.quote(conversationId)}&&state.linkedEvents.get(${JSONObject.quote(conversationId)})?.cached===true&&document.getElementById('chat-content')?.textContent?.includes('电脑已接上手机记录')", 25))
                System.out.println("STAGE12_HANDOFF_OFFLINE " + JSONObject()
                    .put("conversationId", conversationId).put("sameCard", true)
                    .put("cachedHostReply", true))
                return
            }
            val existingConversationId = args.getString("stage12ExistingConversationId")
            val existingTaskId = args.getString("stage12ExistingTaskId")
            if (existingConversationId != null || existingTaskId != null) {
                assertTrue("Existing Stage12 IDs must be exact and paired",
                    existingConversationId?.matches(Regex("conversation-[0-9a-f-]{36}")) == true &&
                        existingTaskId?.matches(Regex("cmd-[0-9a-f-]{36}")) == true)
                assertTrue("Original phone conversation not listed", waitFor(web,
                    "state.conversations.some(item=>item.id===${JSONObject.quote(existingConversationId)})", 20))
                assertTrue("Original conversation card not clickable", evaluate(web, """
                    (() => {const button=[...document.querySelectorAll('#conversation-list button[data-conversation-id]')]
                      .find(item=>item.dataset.conversationId===${JSONObject.quote(existingConversationId)});
                      if(!button)return false;button.click();return true})()
                """.trimIndent()) == "true")
                assertTrue("Existing DSH reply missing from the linked card", waitFor(web,
                    "state.handoffViews.get(${JSONObject.quote(existingConversationId)})?.status==='active'&&state.linkedEvents.get(${JSONObject.quote(existingConversationId)})?.events?.some(item=>item.type==='assistant.message'&&item.data?.text?.includes('电脑已接上手机记录'))", 35))
                if (args.getString("stage12Capture") == "1") capture(web, "stage12-linked-chat.png")
                assertTrue("Things navigation missing", navigate(web, "things"))
                assertTrue("Original task card missing", waitFor(web,
                    "[...document.querySelectorAll('#page-content button.row')].some(item=>item.textContent.includes('接续摘要.md'))", 25))
                assertTrue("Original task card unavailable", evaluate(web, """
                    (() => {const button=[...document.querySelectorAll('#page-content button.row')]
                      .find(item=>item.textContent.includes('接续摘要.md'));
                      if(!button)return false;button.click();return true})()
                """.trimIndent()) == "true")
                assertTrue("Opened task differs from requested old task", waitFor(web,
                    "state.thingsDetail===${JSONObject.quote(existingTaskId)}", 10))
                assertTrue("Old artifact preview action unavailable", waitFor(web,
                    "[...document.querySelectorAll('.artifact-entry button')].some(item=>item.textContent.trim()==='查看内容')", 20))
                assertTrue("Old artifact preview did not return", evaluate(web,
                    "(() => {const button=[...document.querySelectorAll('.artifact-entry button')].find(item=>item.textContent.trim()==='查看内容');if(!button)return false;button.click();return true})()") == "true" &&
                    waitFor(web, "[...document.querySelectorAll('.artifact-preview')].some(item=>item.textContent.includes('the violet lantern'))", 15))
                if (args.getString("stage12Capture") == "1") capture(web, "stage12-artifact.png")
                val fileName = saveThroughSaf(activity, web)
                var followupTaskId: String? = null
                if (args.getString("stage12Followup") == "1") {
                    val fixedRequestId = args.getString("stage12FollowupRequestId") ?: ""
                    assertTrue("Fixed synthetic follow-up request ID required",
                        fixedRequestId.matches(Regex("ui-stage12-[0-9a-f-]{36}")))
                    assertTrue("Chat navigation missing after SAF", navigate(web, "chat"))
                    assertTrue("Linked composer did not become writable", waitFor(web,
                        "state.conversationId===${JSONObject.quote(existingConversationId)}&&selectedBinding()?.sessionId&&document.getElementById('send-button')&&!document.getElementById('draft')?.disabled&&document.getElementById('device-line')?.textContent?.includes('已连接')", 30))
                    val followup = "请只回复手机续聊已收到，不需要生成文件。$fixedRequestId"
                    assertTrue("Real linked send button was unavailable", evaluate(web, """
                        (() => { const binding=selectedBinding();const draft=document.getElementById('draft');
                          const send=document.getElementById('send-button');
                          if(!binding||!draft||!send)return false;
                          localStorage.setItem('weftmate-linked-send:'+state.owner+':'+${JSONObject.quote(existingConversationId)},
                            JSON.stringify({requestId:${JSONObject.quote(fixedRequestId)},sessionId:binding.sessionId,
                              text:${JSONObject.quote(followup)}}));
                          draft.value=${JSONObject.quote(followup)};
                          draft.dispatchEvent(new Event('input',{bubbles:true}));
                          if(send.disabled)return false;send.click();return true })()
                    """.trimIndent()) == "true")
                    val phoneApi = PersonalApi()
                    val sentFollowup = until(45) {
                        try { phoneApi.commandByRequest(host!!, fixedRequestId)
                            .takeIf { it.optString("state") == "accepted_by_dsh" } }
                        catch (_: Exception) { null }
                    }
                    followupTaskId = sentFollowup.getString("commandId")
                    assertEquals(existingConversationId, sentFollowup.getString("conversationId"))
                    until(60) {
                        val events = phoneApi.remoteHistory(host!!,
                            sentFollowup.getString("sessionId"), -1).getJSONArray("events")
                        val rows = (0 until events.length()).map { events.getJSONObject(it) }
                        val user = rows.firstOrNull { it.optString("type") == "user.message" &&
                            it.optJSONObject("data")?.optString("receiptId") == sentFollowup.optString("receiptId") }
                        val start = rows.lastOrNull { it.optString("type") == "turn.started" &&
                            it.optLong("seq") < (user?.optLong("seq") ?: -1) }
                        val end = rows.firstOrNull { it.optString("type") == "turn.ended" &&
                            it.optJSONObject("data")?.optLong("turn") == start?.optJSONObject("data")?.optLong("turn") }
                        if (end?.optJSONObject("data")?.optString("reason") == "completed") true else null
                    }
                    assertEquals(0, phoneApi.taskDetail(host!!, followupTaskId).getJSONArray("artifacts").length())
                }
                System.out.println("STAGE12_HANDOFF_UI " + JSONObject()
                    .put("conversationId", existingConversationId).put("taskId", existingTaskId)
                    .put("existingTaskReused", true).put("sameCard", true)
                    .put("nativeSavedAndVerified", true).put("savedFileName", fileName)
                    .apply { if (followupTaskId != null) {
                        put("followupTaskId", followupTaskId)
                        put("followupRequestId", args.getString("stage12FollowupRequestId"))
                        put("followupCompletedWithoutFile", true) } })
                return
            }
            val modelOrigin = args.getString("stage12ModelOrigin") ?: ""
            val modelUrl = try { java.net.URI(modelOrigin) } catch (_: Exception) { null }
            assumeTrue("Only owned loopback synthetic model fixture is eligible", modelUrl?.scheme == "http" &&
                modelUrl.host == "127.0.0.1" && modelUrl.path == "/v1" &&
                modelUrl.port in 1..65535 && modelUrl.port !in setOf(18186, 18188, 8080, 8081))
            val fact = args.getString("stage12Fact") ?: ""
            assertTrue("Synthetic fact must be bounded and fixture-shaped",
                fact.matches(Regex("the violet lantern is numbered [0-9a-f]{8}")))
            assertTrue("Models page not reachable through UI", navigate(web, "settings") &&
                evaluate(web, """
                    (() => {const button=[...document.querySelectorAll('#page-content button')]
                      .find(item=>item.textContent.includes('对话模型'));
                      if(!button)return false;button.click();return true})()
                """.trimIndent()) == "true")
            assertTrue("Phone model form did not render", waitFor(web,
                "[...document.querySelectorAll('#page-content .group')].some(item=>item.querySelector('h2')?.textContent==='配置自定义模型')", 15))
            assertTrue("Phone model form not fillable", evaluate(web, """
                (() => { const group=[...document.querySelectorAll('#page-content .group')]
                    .find(item=>item.querySelector('h2')?.textContent==='配置自定义模型');
                  const fields=group?.querySelectorAll('input');const save=[...group?.querySelectorAll('button')||[]]
                    .find(item=>item.textContent.trim()==='保存并选择');
                  if(!fields||fields.length<3||!save)return false;
                  fields[0].value=${JSONObject.quote(modelOrigin)};
                  fields[1].value='synthetic-stop-model';fields[2].value='synthetic-fixture-only';
                  fields.forEach(item=>item.dispatchEvent(new Event('input',{bubbles:true})));
                  save.click();return true })()
            """.trimIndent()) == "true")
            assertTrue("Phone fixture model was not selected", waitFor(web,
                "state.model?.modelId==='synthetic-stop-model'", 20))
            assertTrue("Chat navigation missing", navigate(web, "chat"))
            val phoneGoal = "请记住这个仅用于测试的事实：$fact"
            assertTrue("Real phone composer unavailable", evaluate(web, """
                (() => { const draft=document.getElementById('draft');const send=document.getElementById('send-button');
                  if(!draft||!send)return false;draft.value=${JSONObject.quote(phoneGoal)};
                  draft.dispatchEvent(new Event('input',{bubbles:true}));if(send.disabled)return false;
                  send.click();return true })()
            """.trimIndent()) == "true")
            assertTrue("Phone local model did not complete its real turn", waitFor(web,
                "state.lastTerminal?.status==='completed'&&/^conversation-[0-9a-f-]{36}$/.test(state.conversationId||'')&&document.getElementById('chat-content')?.textContent?.includes('电脑已接上手机记录')", 90))
            val conversationRaw = evaluate(web, "state.conversationId")
            val conversationId = JSONTokener(conversationRaw).nextValue() as String
            assertTrue("Local conversation ID invalid", conversationId.matches(Regex("conversation-[0-9a-f-]{36}")))
            val api = PersonalApi()
            val cut = until(45) {
                try { api.sharedConversation(host!!, conversationId).takeIf { it.optBoolean("canAdopt") } }
                catch (_: Exception) { null }
            }
            val seed = File(context.getExternalFilesDir(null), "stage12-login.json")
            assertTrue("Isolated credential seed missing", seed.isFile && seed.length() in 1..4096)
            val credentials = JSONObject(seed.readText(Charsets.UTF_8))
            assertEquals("Stage12SyntheticOwner", credentials.getString("username"))
            val desktop = api.login(host!!.origin, credentials.getString("username"),
                credentials.getString("password"), "Stage12 desktop test client")
            seed.delete()
            val requestId = UUID.randomUUID().toString()
            val submitted = api.adoptSharedConversation(desktop, conversationId, requestId,
                "synthetic-stop-fixture", cut.getLong("syncThroughSeq"))
            assertEquals(requestId, submitted.getJSONObject("command").getString("requestId"))
            val binding = until(45) { api.sharedConversation(desktop, conversationId)
                .takeIf { it.optString("status") == "active" }?.getJSONObject("binding") }
            val sessionId = binding.getString("sessionId")
            val goal = "请用先前手机对话中的特别事实回答，并保存一份简短 Markdown 摘要。"
            val sent = api.postCommand(desktop, JSONObject().put("requestId", UUID.randomUUID().toString())
                .put("kind", "session.message").put("targetDeviceId", desktop.hostId)
                .put("sessionId", sessionId).put("mode", "queue").put("text", goal))
            val taskId = sent.getString("commandId")
            val accepted = until(45) { api.commandDetail(desktop, taskId)
                .takeIf { it.optString("state") == "accepted_by_dsh" && it.optString("receiptId").isNotBlank() } }
            val receiptId = accepted.getString("receiptId")
            val detail = until(90) { api.taskDetail(desktop, taskId).takeIf { result ->
                (result.optJSONArray("artifacts") ?: org.json.JSONArray()).let { rows ->
                    (0 until rows.length()).any { rows.getJSONObject(it).optString("state") == "observed" } } } }
            assertEquals(conversationId, detail.getString("conversationId"))
            val artifacts = detail.getJSONArray("artifacts")
            val artifact = (0 until artifacts.length()).map { artifacts.getJSONObject(it) }
                .first { it.optString("state") == "observed" }
            val bytes = api.artifactBytes(desktop, artifact.getString("artifactId"))
            assertEquals(artifact.getString("sha256"), sha256(bytes))
            assertTrue("Frozen phone fact did not reach the actual host output",
                String(bytes, Charsets.UTF_8).contains(fact))
            until(90) {
                val events = api.remoteHistory(desktop, sessionId, -1).getJSONArray("events")
                val rows = (0 until events.length()).map { events.getJSONObject(it) }
                val user = rows.firstOrNull { it.optString("type") == "user.message" &&
                    it.optJSONObject("data")?.optString("receiptId") == receiptId }
                val start = rows.lastOrNull { it.optString("type") == "turn.started" &&
                    it.optLong("seq") < (user?.optLong("seq") ?: -1) }
                val ended = rows.firstOrNull { it.optString("type") == "turn.ended" &&
                    it.optJSONObject("data")?.optLong("turn") == start?.optJSONObject("data")?.optLong("turn") }
                if (ended?.optJSONObject("data")?.optString("reason") == "completed") true else null
            }
            val linkedReady = waitFor(web,
                "state.conversationId===${JSONObject.quote(conversationId)}&&state.handoffViews.get(${JSONObject.quote(conversationId)})?.binding?.sessionId===${JSONObject.quote(sessionId)}&&state.linkedEvents.get(${JSONObject.quote(conversationId)})?.events?.some(item=>item.type==='assistant.message'&&item.data?.text?.includes('电脑已接上手机记录'))&&document.getElementById('chat-content')?.textContent?.includes('电脑已接上手机记录')&&document.querySelectorAll('#conversation-list button[data-conversation-id=${JSONObject.quote(conversationId)}]').length===1&&document.querySelectorAll('#conversation-list button[data-session-id=${JSONObject.quote(sessionId)}]').length===0", 45)
            if (!linkedReady) {
                val diagnostic = JSONTokener(evaluate(web, """
                    (() => JSON.stringify({selectedExact:state.conversationId===${JSONObject.quote(conversationId)},
                      bindingExact:state.handoffViews.get(${JSONObject.quote(conversationId)})?.binding?.sessionId===${JSONObject.quote(sessionId)},
                      hostEventCount:state.linkedEvents.get(${JSONObject.quote(conversationId)})?.events?.length||0,
                      hostAssistantSeen:!!state.linkedEvents.get(${JSONObject.quote(conversationId)})?.events?.some(item=>item.type==='assistant.message'&&item.data?.text?.includes('电脑已接上手机记录')),
                      originalCardCount:document.querySelectorAll('#conversation-list button[data-conversation-id=${JSONObject.quote(conversationId)}]').length,
                      duplicateHostCardCount:document.querySelectorAll('#conversation-list button[data-session-id=${JSONObject.quote(sessionId)}]').length}))()
                """.trimIndent())).nextValue() as String
                System.out.println("STAGE12_LINKED_DIAGNOSTIC $diagnostic")
            }
            assertTrue("Phone UI did not render the same linked conversation", linkedReady)
            if (args.getString("stage12Capture") == "1") capture(web, "stage12-linked-chat.png")
            assertTrue("Things navigation missing", navigate(web, "things"))
            assertTrue("Linked task card did not render", waitFor(web,
                "[...document.querySelectorAll('#page-content button.row')].some(item=>item.textContent.includes('接续摘要.md'))", 35))
            assertTrue("Linked task card could not be opened", evaluate(web, """
                (() => {const button=[...document.querySelectorAll('#page-content button.row')]
                  .find(item=>item.textContent.includes('接续摘要.md'));
                  if(!button)return false;button.click();return true})()
            """.trimIndent()) == "true")
            assertTrue("Artifact preview action unavailable", waitFor(web,
                "[...document.querySelectorAll('.artifact-entry button')].some(item=>item.textContent.trim()==='查看内容')", 20))
            assertTrue("Real artifact preview did not render", evaluate(web,
                "(() => { const button=[...document.querySelectorAll('.artifact-entry button')].find(item=>item.textContent.trim()==='查看内容');if(!button)return false;button.click();return true })()") == "true" &&
                waitFor(web, "[...document.querySelectorAll('.artifact-preview')].some(item=>item.textContent.includes('the violet lantern'))", 15))
            if (args.getString("stage12Capture") == "1") capture(web, "stage12-artifact.png")
            val filename = saveThroughSaf(activity, web)
            System.out.println("STAGE12_HANDOFF_UI " + JSONObject().put("conversationId", conversationId)
                .put("taskId", taskId).put("sessionId", sessionId).put("model", "synthetic-stop-model")
                .put("phoneTurnCompleted", true).put("hostArtifactSha256", artifact.getString("sha256"))
                .put("nativeSavedAndVerified", true).put("savedFileName", filename)
                .put("factSha256", sha256(fact.toByteArray(Charsets.UTF_8))))
        } finally {
            if (launched) instrumentation.runOnMainSync { activity.finish() }
        }
    }
}
