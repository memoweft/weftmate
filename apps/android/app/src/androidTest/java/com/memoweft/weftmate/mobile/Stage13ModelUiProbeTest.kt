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
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Test APK only: real UI buttons, Native bridge, owner HTTP, DSH and SAF. */
@RunWith(AndroidJUnit4::class)
class Stage13ModelUiProbeTest {
    private val instrument = InstrumentationRegistry.getInstrumentation()
    private val context = instrument.targetContext
    private val origin = "http://127.0.0.1:18188"
    private val ownerName = "Stage13SyntheticOwner"
    private val stageFile get() = File(context.getExternalFilesDir(null), "stage13-progress.json")

    private fun webView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) for (index in 0 until view.childCount)
            webView(view.getChildAt(index))?.let { return it }
        return null
    }
    private fun evaluate(web: WebView, script: String): String {
        val latch = CountDownLatch(1)
        var reply = ""
        instrument.runOnMainSync { web.evaluateJavascript(script) { reply = it; latch.countDown() } }
        assertTrue("Stage13 UI evaluation timed out", latch.await(8, TimeUnit.SECONDS))
        return reply
    }
    private fun waitFor(web: WebView, expression: String, seconds: Long = 25): Boolean {
        val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds)
        while (System.nanoTime() < end) {
            if (evaluate(web, "Boolean($expression)") == "true") return true
            Thread.sleep(180)
        }
        return false
    }
    private fun <T> until(seconds: Long = 45, check: () -> T?): T {
        val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds)
        while (System.nanoTime() < end) {
            check()?.let { return it }
            Thread.sleep(250)
        }
        throw AssertionError("Stage13 bounded observation timed out")
    }
    private fun navigate(web: WebView, page: String): Boolean {
        if (page == "connect") return navigate(web, "settings") && evaluate(web, """
            (()=>{const button=[...document.querySelectorAll('#page-content button')]
              .find(x=>x.textContent.includes('电脑账户与连接'));
              if(!button)return false;button.click();return true})()
        """.trimIndent()) == "true" && waitFor(web,
            "document.querySelector('#page-content')?.textContent?.includes('电脑账户与连接')")
        return evaluate(web, """
        (()=>{const menu=document.getElementById('menu-button');
          const item=document.querySelector('[data-page=${JSONObject.quote(page)}]');
          if(!menu||!item)return false;menu.click();item.click();return true})()
        """.trimIndent()) == "true"
    }
    private fun modelPage(web: WebView): Boolean {
        if (!navigate(web, "settings")) return false
        return evaluate(web, """
            (()=>{const button=[...document.querySelectorAll('#page-content button')]
              .find(item=>item.textContent.includes('对话模型'));
              if(!button)return false;button.click();return true})()
        """.trimIndent()) == "true" && waitFor(web,
            "document.querySelector('#page-content')?.textContent?.includes('手机已保存模型')")
    }
    private fun digest(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
    private fun capture(web: WebView, name: String) {
        if (InstrumentationRegistry.getArguments().getString("stage13Capture") != "1") return
        val frame = CountDownLatch(1)
        instrument.runOnMainSync { web.postVisualStateCallback(System.nanoTime(),
            object : WebView.VisualStateCallback() {
                override fun onComplete(requestId: Long) { frame.countDown() }
            }) }
        assertTrue("Stage13 visual state unavailable", frame.await(5, TimeUnit.SECONDS))
        instrument.waitForIdleSync()
        val image = instrument.uiAutomation.takeScreenshot()
            ?: throw AssertionError("Stage13 screenshot unavailable")
        File(context.getExternalFilesDir(null), name).outputStream().use {
            image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        image.recycle()
        System.out.println("STAGE13_MODEL_CAPTURE " + JSONObject().put("fileName", name))
    }
    private fun privateSeed(): JSONObject {
        val file = File(context.getExternalFilesDir(null), "stage13-private-seed.json")
        assertTrue("Stage13 app-scoped seed missing", file.isFile && file.length() in 100..8192)
        val seed = JSONObject(file.readText(Charsets.UTF_8))
        assertTrue("Stage13 seed must be deleted after one read", file.delete())
        assertEquals(ownerName, seed.getString("username"))
        assertEquals("https://api.xiaomimimo.com/v1", seed.getString("modelEndpoint"))
        assertEquals("mimo-v2.6-flash", seed.getString("modelId"))
        assertTrue("Stage13 seed key missing", seed.getString("apiKey").length > 10)
        return seed
    }
    private fun host(): HostIdentity {
        val host = SecureSettings(context).host()
        assumeTrue("Only Stage13 isolated account may run this probe",
            host?.origin == origin && host.username == ownerName)
        return host!!
    }
    private fun exactEventCompleted(api: PersonalApi, desktop: HostIdentity,
        sessionId: String, receiptId: String) {
        until(180) {
            val events = api.remoteHistory(desktop, sessionId, -1).getJSONArray("events")
            val rows = (0 until events.length()).map { events.getJSONObject(it) }
            val user = rows.firstOrNull { it.optString("type") == "user.message" &&
                it.optJSONObject("data")?.optString("receiptId") == receiptId }
            val start = rows.lastOrNull { it.optString("type") == "turn.started" &&
                it.optLong("seq") < (user?.optLong("seq") ?: -1) }
            val end = rows.firstOrNull { it.optString("type") == "turn.ended" &&
                it.optJSONObject("data")?.optLong("turn") == start?.optJSONObject("data")?.optLong("turn") }
            if (end?.optJSONObject("data")?.optString("reason") == "completed") true else null
        }
    }
    private fun saveThroughSaf(activity: Activity, web: WebView): String {
        assertTrue("Real artifact Save button missing", evaluate(web, """
            (()=>{const button=[...document.querySelectorAll('.artifact-entry button')]
              .find(item=>item.textContent.trim()==='保存到手机');
              if(!button)return false;button.click();return true})()
        """.trimIndent()) == "true")
        val pendingField = HybridActivity::class.java.getDeclaredField("pendingArtifactSave")
        pendingField.isAccessible = true
        until(10) {
            var pending = false
            instrument.runOnMainSync { pending = pendingField.get(activity) != null }
            if (pending) true else null
        }
        val picker = until(10) { instrument.uiAutomation.rootInActiveWindow?.takeIf {
            it.packageName?.toString() == "com.android.documentsui" } }
        val crumbs = picker.findAccessibilityNodeInfosByViewId("com.android.documentsui:id/breadcrumb_text")
            .filter { it.isVisibleToUser }
        assertTrue("SAF must remain in Download", crumbs.isNotEmpty() &&
            crumbs.last().text?.toString() == "Download")
        val filename = "stage13-verified-${UUID.randomUUID()}.md"
        val fields = picker.findAccessibilityNodeInfosByViewId("android:id/title")
            .filter { it.isVisibleToUser && it.className?.toString() == "android.widget.EditText" }
        assertEquals(1, fields.size)
        assertTrue(fields.single().performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,
            Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                filename) }))
        val ready = instrument.uiAutomation.rootInActiveWindow ?: throw AssertionError("SAF closed")
        assertEquals("com.android.documentsui", ready.packageName?.toString())
        val save = ready.findAccessibilityNodeInfosByViewId("android:id/button1")
            .filter { it.isVisibleToUser && it.text?.toString() == "保存" && it.isClickable }
        assertEquals(1, save.size)
        assertTrue(save.single().performAction(AccessibilityNodeInfo.ACTION_CLICK))
        until(30) {
            var pending = false
            instrument.runOnMainSync { pending = pendingField.get(activity) != null }
            if (!pending && evaluate(web,
                "Boolean([...document.querySelectorAll('.artifact-save-state')].some(x=>x.textContent.includes('已保存到手机并核对内容')))") == "true") true else null
        }
        return filename
    }

    @Test fun accountModelAcrossRealPhoneAndDesktop() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("Explicit Stage13 UI probe opt-in required", args.getString("stage13Probe") == "1")
        val phase = args.getString("stage13Phase") ?: "initial"
        assertTrue("Unknown Stage13 phase", phase in setOf("initial", "reuse", "import", "offline"))
        val existingHost = SecureSettings(context).host()
        val replacePriorSynthetic = phase == "initial" &&
            args.getString("stage13ReplacePriorSynthetic") == "1" &&
            existingHost?.origin == origin && existingHost.username == "Stage12SyntheticOwner"
        assumeTrue("Refuse non-synthetic account", existingHost == null ||
            (existingHost.origin == origin && existingHost.username == ownerName) || replacePriorSynthetic)
        var resumed: HybridActivity? = null
        instrument.runOnMainSync { resumed = ActivityLifecycleMonitorRegistry.getInstance()
            .getActivitiesInStage(Stage.RESUMED).filterIsInstance<HybridActivity>().firstOrNull() }
        if (replacePriorSynthetic) {
            assertTrue("Force-stop old synthetic Activity before replacing its login", resumed == null)
            SecureSettings(context).clearHost()
            assertTrue("Old synthetic login was not cleared", SecureSettings(context).host() == null)
        }
        val launched = resumed == null
        val activity: Activity = resumed ?: instrument.startActivitySync(Intent(context,
            HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity
        try {
            var selected: WebView? = null
            instrument.runOnMainSync { selected = webView(activity.findViewById(android.R.id.content)) }
            val web = selected ?: throw AssertionError("Stage13 WebView unavailable")
            assertTrue("Stage13 app not ready", waitFor(web, "typeof state!=='undefined'&&state.booted", 25))
            when (phase) {
                "initial" -> initial(activity, web)
                "reuse" -> reuse(activity, web, args.getString("stage13ConversationId") ?: "",
                    args.getString("stage13TaskId") ?: "")
                "import" -> importSecond(web)
                "offline" -> offlineDirect(web)
            }
        } finally { if (launched) instrument.runOnMainSync { activity.finish() } }
    }

    private fun initial(activity: Activity, web: WebView) {
        val previous = if (stageFile.isFile) JSONObject(stageFile.readText(Charsets.UTF_8)) else null
        assertTrue("Initial goal already attempted; use exact reuse phase",
            previous == null || previous.optString("phase") == "publish_started")
        val seed = privateSeed()
        if (SecureSettings(context).host() == null) {
            assertTrue("Account page unavailable", navigate(web, "connect"))
            assertTrue("Synthetic account origin field missing", evaluate(web, """
                (()=>{const label=[...document.querySelectorAll('#page-content label')]
                  .find(x=>x.textContent.includes('个人服务地址'));
                  const input=label?.querySelector('input');if(!input)return false;
                  input.value=${JSONObject.quote(origin)};
                  input.dispatchEvent(new Event('input',{bubbles:true}));return true})()
            """.trimIndent()) == "true")
            assertTrue("Synthetic host connection check missing", evaluate(web, """
                (()=>{const button=[...document.querySelectorAll('#page-content button')]
                  .find(x=>x.textContent.trim()==='检查服务连接');
                  if(!button)return false;button.click();return true})()
            """.trimIndent()) == "true")
            assertTrue("Synthetic login not offered", waitFor(web,
                "[...document.querySelectorAll('#page-content button')].some(x=>x.textContent.trim()==='登录'&&!x.hidden)", 20))
            assertTrue("Synthetic login form missing", evaluate(web, """
                (()=>{const labels=[...document.querySelectorAll('#page-content label')];
                  const field=(name)=>labels.find(x=>x.textContent.includes(name))?.querySelector('input');
                  const username=field('账户名'),password=field('密码'),device=field('设备名称');
                  const login=[...document.querySelectorAll('#page-content button')].find(x=>x.textContent.trim()==='登录');
                  if(!username||!password||!device||!login)return false;
                  username.value=${JSONObject.quote(seed.getString("username"))};
                  password.value=${JSONObject.quote(seed.getString("password"))};
                  device.value='Stage13 instrumented phone';login.click();return true})()
            """.trimIndent()) == "true")
            assertTrue("Synthetic login failed", waitFor(web,
                "state.loggedIn&&state.username===${JSONObject.quote(ownerName)}", 30))
        }
        val host = host()
        val api = PersonalApi()
        val desktop = api.login(origin, seed.getString("username"), seed.getString("password"),
            "Stage13 desktop probe")
        assertTrue("Model settings page unavailable", modelPage(web))
        if (previous == null) {
        assertTrue("Real phone model form missing", evaluate(web, """
            (()=>{const group=[...document.querySelectorAll('#page-content .group')]
              .find(x=>x.textContent.includes('配置自定义模型'));
              const inputs=group?.querySelectorAll('input');const button=[...group?.querySelectorAll('button')||[]]
                .find(x=>x.textContent.trim()==='保存并选择');
              if(!inputs||inputs.length<3||!button)return false;
              inputs[0].value=${JSONObject.quote(seed.getString("modelEndpoint"))};
              inputs[1].value=${JSONObject.quote(seed.getString("modelId"))};
              inputs[2].value=${JSONObject.quote(seed.getString("apiKey"))};
              inputs.forEach(x=>x.dispatchEvent(new Event('input',{bubbles:true})));
              button.click();return true})()
        """.trimIndent()) == "true")
        assertTrue("Phone model was not selected", waitFor(web,
            "state.model?.source==='phone'&&state.model?.modelId==='mimo-v2.6-flash'", 20))
        assertTrue("Fresh phone model page unavailable after save", modelPage(web))
        val publishVisible = waitFor(web,
            "[...document.querySelectorAll('#page-content .model-library-entry')].some(card=>card.textContent.includes('mimo-v2.6-flash')&&[...card.querySelectorAll('button')].some(button=>button.textContent.includes('在电脑使用这个模型')))", 20)
        if (!publishVisible) System.out.println("STAGE13_MODEL_DIAGNOSTIC " + evaluate(web, """
            (()=>JSON.stringify({phase:'publish_button',page:state.page,generation:state.generation,
              modelCardCount:document.querySelectorAll('#page-content .model-library-entry').length,
              hasPublishButton:[...document.querySelectorAll('#page-content button')]
                .some(x=>x.textContent.includes('在电脑使用这个模型')),
              hasPendingPublishButton:[...document.querySelectorAll('#page-content button')]
                .some(x=>x.textContent.includes('核对电脑配置'))}))()
        """.trimIndent()))
        assertTrue("One-click publish button missing on fresh model page", publishVisible)
        val publishedRequest = JSONTokener(evaluate(web, """
            (()=>{const button=[...document.querySelectorAll('#page-content button')]
              .find(x=>x.textContent.includes('在电脑使用这个模型'));
              if(!button)return '';button.click();
              const marker=[...Array(localStorage.length)].map((_,i)=>localStorage.key(i))
                .filter(k=>k?.startsWith('weftmate-account-model:publish:'))
                .map(k=>{try{return JSON.parse(localStorage.getItem(k))}catch{return null}})
                .find(x=>x?.owner===state.owner&&x?.modelId==='mimo-v2.6-flash');
              return marker?.requestId||''})()
        """.trimIndent())).nextValue() as String
        assertTrue("One-click publish request ID missing",
            publishedRequest.matches(Regex("[0-9a-f-]{36}")))
        stageFile.writeText(JSONObject().put("phase", "publish_started")
            .put("publishRequestId", publishedRequest).toString(), Charsets.UTF_8)
        System.out.println("STAGE13_MODEL_PROGRESS " + JSONObject().put("phase", "publish_started")
            .put("publishRequestId", publishedRequest))
        } else {
            assertTrue("Resume requires saved original phone model", waitFor(web,
                "state.model?.source==='phone'&&state.model?.modelId==='mimo-v2.6-flash'", 20))
        }
        val accountModel = until(90) {
            val rows = api.accountModels(desktop).optJSONArray("models") ?: JSONArray()
            (0 until rows.length()).map { rows.getJSONObject(it) }.firstOrNull {
                it.optString("modelId") == "mimo-v2.6-flash" && it.optString("status") == "active" &&
                    it.optBoolean("configured") && it.optString("profileId").isNotBlank() }
        }
        assertTrue("Publish changed the active phone route", evaluate(web,
            "Boolean(state.model?.source==='phone'&&state.model?.modelId==='mimo-v2.6-flash')") == "true")
        assertTrue("Chat navigation missing", navigate(web, "chat"))
        val fact = "stage13-${UUID.randomUUID().toString().take(8)}"
        val adoptRequestId = UUID.randomUUID().toString()
        val goalRequestId = UUID.randomUUID().toString()
        stageFile.writeText(JSONObject().put("phase", "phone_send_started")
            .put("publishRequestId", JSONObject(stageFile.readText(Charsets.UTF_8))
                .getString("publishRequestId"))
            .put("fact", fact).put("adoptRequestId", adoptRequestId)
            .put("goalRequestId", goalRequestId).toString(), Charsets.UTF_8)
        System.out.println("STAGE13_MODEL_PROGRESS " + JSONObject().put("phase", "phone_send_started")
            .put("adoptRequestId", adoptRequestId).put("goalRequestId", goalRequestId)
            .put("factSha256", digest(fact.toByteArray(Charsets.UTF_8))))
        val phoneGoal = "请记住这条仅用于测试的事实：$fact。请简短回复已记住。"
        assertTrue("Real phone send button unavailable", evaluate(web, """
            (()=>{const draft=document.getElementById('draft'),send=document.getElementById('send-button');
              if(!draft||!send)return false;draft.value=${JSONObject.quote(phoneGoal)};
              draft.dispatchEvent(new Event('input',{bubbles:true}));if(send.disabled)return false;
              send.click();return true})()
        """.trimIndent()) == "true")
        assertTrue("Actual phone direct turn did not complete", waitFor(web,
            "state.lastTerminal?.status==='completed'&&/^conversation-[0-9a-f-]{36}$/.test(state.conversationId||'')", 150))
        val conversationId = JSONTokener(evaluate(web, "state.conversationId")).nextValue() as String
        val progress = JSONObject(stageFile.readText()).put("phase", "phone_completed")
            .put("conversationId", conversationId).put("accountModelId", accountModel.getString("accountModelId"))
        stageFile.writeText(progress.toString(), Charsets.UTF_8)
        val snapshot = until(60) { api.sharedConversation(desktop, conversationId)
            .takeIf { it.optBoolean("canAdopt") } }
        val adopted = api.adoptSharedConversation(desktop, conversationId, adoptRequestId,
            accountModel.getString("profileId"), snapshot.getLong("syncThroughSeq"))
        assertEquals(adoptRequestId, adopted.getJSONObject("command").getString("requestId"))
        val binding = until(60) { api.sharedConversation(desktop, conversationId)
            .takeIf { it.optString("status") == "active" }?.getJSONObject("binding") }
        assertEquals(accountModel.getString("profileId"), binding.getString("modelProfileId"))
        val sessionId = binding.getString("sessionId")
        val goal = "请根据先前手机对话中的测试事实生成简短 Markdown 摘要，原样写入那个标记。"
        val sent = api.postCommand(desktop, JSONObject().put("requestId", goalRequestId)
            .put("kind", "session.message").put("targetDeviceId", desktop.hostId)
            .put("sessionId", sessionId).put("mode", "queue").put("text", goal))
        val taskId = sent.getString("commandId")
        stageFile.writeText(progress.put("phase", "host_sent").put("sessionId", sessionId)
            .put("taskId", taskId).toString(), Charsets.UTF_8)
        System.out.println("STAGE13_MODEL_PROGRESS " + JSONObject().put("phase", "host_sent")
            .put("conversationId", conversationId).put("sessionId", sessionId)
            .put("taskId", taskId).put("goalRequestId", goalRequestId))
        val accepted = until(60) { api.commandDetail(desktop, taskId)
            .takeIf { it.optString("state") == "accepted_by_dsh" && it.optString("receiptId").isNotBlank() } }
        exactEventCompleted(api, desktop, sessionId, accepted.getString("receiptId"))
        val detail = until(60) { api.taskDetail(desktop, taskId).takeIf { result ->
            val rows = result.optJSONArray("artifacts") ?: JSONArray()
            (0 until rows.length()).any { rows.getJSONObject(it).optString("state") == "observed" } } }
        assertEquals(conversationId, detail.getString("conversationId"))
        val artifacts = detail.getJSONArray("artifacts")
        val artifact = (0 until artifacts.length()).map { artifacts.getJSONObject(it) }
            .first { it.optString("state") == "observed" }
        val bytes = api.artifactBytes(desktop, artifact.getString("artifactId"))
        assertEquals(artifact.getString("sha256"), digest(bytes))
        assertTrue("Actual host output omitted the prior phone fact", String(bytes, Charsets.UTF_8).contains(fact))
        stageFile.writeText(progress.put("phase", "artifact_observed")
            .put("artifactSha256", artifact.getString("sha256")).toString(), Charsets.UTF_8)
        val fileName = inspectArtifactAndSave(activity, web, conversationId, taskId, fact)
        stageFile.writeText(progress.put("phase", "verified").toString(), Charsets.UTF_8)
        System.out.println("STAGE13_MODEL_UI " + JSONObject().put("phase", "initial")
            .put("conversationId", conversationId).put("taskId", taskId).put("sessionId", sessionId)
            .put("accountModelId", accountModel.getString("accountModelId"))
            .put("artifactSha256", artifact.getString("sha256"))
            .put("savedFileName", fileName).put("factSha256", digest(fact.toByteArray())))
    }

    private fun inspectArtifactAndSave(activity: Activity, web: WebView,
        conversationId: String, taskId: String, fact: String): String {
        assertTrue("Original phone card did not show host continuation", waitFor(web,
            "state.conversationId===${JSONObject.quote(conversationId)}&&state.handoffViews.get(${JSONObject.quote(conversationId)})?.status==='active'&&state.linkedEvents.get(${JSONObject.quote(conversationId)})?.events?.some(x=>x.type==='assistant.message')", 50))
        capture(web, "stage13-linked-chat.png")
        assertTrue("Task navigation missing", navigate(web, "things"))
        assertTrue("Task card missing", waitFor(web,
            "[...document.querySelectorAll('#page-content button.row')].some(x=>/生成：|电脑任务：/.test(x.textContent))", 35))
        assertTrue("Task detail missing", evaluate(web, """
            (()=>{const button=[...document.querySelectorAll('#page-content button.row')]
              .find(x=>/生成：|电脑任务：/.test(x.textContent));if(!button)return false;button.click();return true})()
        """.trimIndent()) == "true")
        assertTrue("Wrong task detail selected", waitFor(web,
            "state.thingsDetail===${JSONObject.quote(taskId)}", 15))
        assertTrue("Preview button missing", waitFor(web,
            "[...document.querySelectorAll('.artifact-entry button')].some(x=>x.textContent.trim()==='查看内容')", 20))
        assertTrue("Preview did not show exact prior fact", evaluate(web, """
            (()=>{const button=[...document.querySelectorAll('.artifact-entry button')]
              .find(x=>x.textContent.trim()==='查看内容');if(!button)return false;button.click();return true})()
        """.trimIndent()) == "true" && waitFor(web,
            "[...document.querySelectorAll('.artifact-preview')].some(x=>x.textContent.includes(${JSONObject.quote(fact)}))", 20))
        capture(web, "stage13-artifact.png")
        return saveThroughSaf(activity, web)
    }

    private fun reuse(activity: Activity, web: WebView, conversationId: String, taskId: String) {
        assertTrue(conversationId.matches(Regex("conversation-[0-9a-f-]{36}")) &&
            taskId.matches(Regex("cmd-[0-9a-f-]{36}")))
        host()
        val progress = JSONObject(stageFile.readText())
        assertEquals(conversationId, progress.getString("conversationId"))
        assertEquals(taskId, progress.getString("taskId"))
        assertTrue("Original phone conversation missing", waitFor(web,
            "state.conversations.some(x=>x.id===${JSONObject.quote(conversationId)})", 25))
        assertTrue("Original phone card not clickable", evaluate(web, """
            (()=>{const button=[...document.querySelectorAll('#conversation-list button[data-conversation-id]')]
              .find(x=>x.dataset.conversationId===${JSONObject.quote(conversationId)});
              if(!button)return false;button.click();return true})()
        """.trimIndent()) == "true")
        val fileName = inspectArtifactAndSave(activity, web, conversationId, taskId,
            progress.getString("fact"))
        System.out.println("STAGE13_MODEL_UI " + JSONObject().put("phase", "reuse")
            .put("conversationId", conversationId).put("taskId", taskId)
            .put("savedFileName", fileName).put("sameOriginalCard", true))
    }

    private fun importSecond(web: WebView) {
        val seed = privateSeed()
        val host = host()
        val api = PersonalApi()
        val desktop = api.login(origin, seed.getString("username"), seed.getString("password"),
            "Stage13 second model desktop")
        val progress = if (stageFile.isFile) JSONObject(stageFile.readText(Charsets.UTF_8))
            else JSONObject()
        val requestId = progress.optString("secondCreateRequestId").ifBlank {
            "stage13-second-${UUID.randomUUID()}" }
        assertTrue(requestId.matches(Regex("stage13-second-[0-9a-f-]{36}")))
        stageFile.writeText(progress.put("secondCreateRequestId", requestId).toString(), Charsets.UTF_8)
        System.out.println("STAGE13_MODEL_PROGRESS " + JSONObject().put("phase", "second_create")
            .put("requestId", requestId))
        val created = try { api.accountModelByRequest(desktop, requestId) }
            catch (error: ApiFailure) { if (error.status != 404) throw error else
                api.createAccountModel(desktop, requestId, "Stage13 第二个账户配置",
                    seed.getString("modelEndpoint"), seed.getString("modelId"), seed.getString("apiKey")) }
        assertEquals(requestId, created.getJSONObject("operation").getString("requestId"))
        val model = until(90) { api.accountModelByRequest(desktop, requestId).let { reply ->
            if (reply.getJSONObject("operation").optString("status") == "succeeded")
                reply.optJSONObject("model") else null } }
        assertEquals("active", model.getString("status"))
        assertTrue("Model page unavailable", modelPage(web))
        assertTrue("Second account card not shown", waitFor(web,
            "document.querySelector('#page-content')?.textContent?.includes('Stage13 第二个账户配置')", 25))
        assertTrue("Actual account import button missing", evaluate(web, """
            (()=>{const card=[...document.querySelectorAll('.model-library-entry')]
              .find(x=>x.textContent.includes('Stage13 第二个账户配置'));
              const button=[...card?.querySelectorAll('button')||[]]
                .find(x=>x.textContent.trim()==='保存到手机');
              if(!button)return false;button.click();return true})()
        """.trimIndent()) == "true")
        assertTrue("Native account import did not save locally", waitFor(web,
            "document.querySelector('#toast')?.textContent?.includes('已加密存到手机')", 30))
        // Select a different saved route first, then explicitly choose the imported MiMo route.
        assertTrue("Fixture route form missing", evaluate(web, """
            (()=>{const group=[...document.querySelectorAll('#page-content .group')]
              .find(x=>x.textContent.includes('配置自定义模型'));
              const fields=group?.querySelectorAll('input');const save=[...group?.querySelectorAll('button')||[]]
                .find(x=>x.textContent.trim()==='保存并选择');
              if(!fields||fields.length<3||!save)return false;
              fields[0].value='http://127.0.0.1:55353/v1';fields[1].value='synthetic-stage13-unused';
              fields[2].value='fixture-only-unused';save.click();return true})()
        """.trimIndent()) == "true")
        assertTrue("Fixture route was not selected", waitFor(web,
            "state.model?.modelId==='synthetic-stage13-unused'", 20))
        assertTrue("Fresh model page unavailable after switching routes", modelPage(web))
        assertTrue("Imported direct MiMo card missing", waitFor(web,
            "[...document.querySelectorAll('.model-library-entry')].some(x=>x.textContent.includes('mimo-v2.6-flash'))", 20))
        assertTrue("Imported direct route not explicitly selected", evaluate(web, """
            (()=>{const card=[...document.querySelectorAll('.model-library-entry')]
              .find(x=>x.textContent.includes('mimo-v2.6-flash')&&x.textContent.includes('手机直连云'));
              const button=[...card?.querySelectorAll('button')||[]]
                .find(x=>x.textContent.trim()==='在手机使用');
              if(!button||button.disabled)return false;button.click();return true})()
        """.trimIndent()) == "true")
        assertTrue("Imported MiMo route not selected for phone direct", waitFor(web,
            "state.model?.source==='phone'&&state.model?.modelId==='mimo-v2.6-flash'", 20))
        System.out.println("STAGE13_MODEL_UI " + JSONObject().put("phase", "import")
            .put("accountModelId", model.getString("accountModelId"))
            .put("revision", model.getLong("revision"))
            .put("importedAndExplicitlySelected", true))
    }

    private fun offlineDirect(web: WebView) {
        host()
        assertTrue("Offline phase requires selected phone MiMo", waitFor(web,
            "state.model?.source==='phone'&&state.model?.modelId==='mimo-v2.6-flash'", 20))
        assertTrue("Offline host must actually be unavailable", runCatching {
            PersonalApi().me(host()); false }.getOrElse { true })
        assertTrue("Chat navigation missing", navigate(web, "chat"))
        assertTrue("New chat UI button missing", evaluate(web, """
            (()=>{const button=document.querySelector('[data-action="new-chat"]');
              if(!button)return false;button.click();return true})()
        """.trimIndent()) == "true")
        val text = "请用一句话回答：手机离线直连 MiMo 是否收到这条测试消息？"
        assertTrue("Offline direct send missing", evaluate(web, """
            (()=>{const draft=document.getElementById('draft'),send=document.getElementById('send-button');
              if(!draft||!send)return false;draft.value=${JSONObject.quote(text)};
              draft.dispatchEvent(new Event('input',{bubbles:true}));if(send.disabled)return false;
              send.click();return true})()
        """.trimIndent()) == "true")
        assertTrue("Offline direct provider did not complete", waitFor(web,
            "state.lastTerminal?.status==='completed'&&state.model?.source==='phone'", 150))
        System.out.println("STAGE13_MODEL_UI " + JSONObject().put("phase", "offline")
            .put("directPhoneCompleted", true)
            .put("conversationId", JSONTokener(evaluate(web, "state.conversationId")).nextValue()))
    }
}
