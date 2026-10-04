package com.memoweft.weftmate.mobile

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.view.View
import android.view.ViewGroup
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
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Test APK only: inspect one existing browser task without sending any goal or model request. */
@RunWith(AndroidJUnit4::class)
class Stage14BrowserUiProbeTest {
    private val instrument = InstrumentationRegistry.getInstrumentation()
    private val context = instrument.targetContext
    private val origin = "http://127.0.0.1:18188"
    private val allowedOwners = setOf("Stage14LocalOwner", "Stage14SyntheticOwner")

    private fun findWebView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) for (index in 0 until view.childCount)
            findWebView(view.getChildAt(index))?.let { return it }
        return null
    }
    private fun evaluate(web: WebView, script: String): String {
        val latch = CountDownLatch(1)
        var reply = ""
        instrument.runOnMainSync { web.evaluateJavascript(script) { reply = it; latch.countDown() } }
        assertTrue("Stage14 WebView evaluation timed out", latch.await(8, TimeUnit.SECONDS))
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
    private fun navigate(web: WebView, page: String): Boolean = evaluate(web, """
        (()=>{const menu=document.getElementById('menu-button');
          const item=document.querySelector('[data-page=${JSONObject.quote(page)}]');
          if(!menu||!item)return false;menu.click();item.click();return true})()
    """.trimIndent()) == "true"
    private fun connectPage(web: WebView): Boolean = navigate(web, "settings") &&
        evaluate(web, """
            (()=>{const button=[...document.querySelectorAll('#page-content button')]
              .find(x=>x.textContent.includes('电脑账户与连接'));
              if(!button)return false;button.click();return true})()
        """.trimIndent()) == "true"
    private fun sha(bytes: ByteArray) = MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
    private fun seed(): JSONObject {
        val file = File(context.getExternalFilesDir(null), "stage14-ui-seed.json")
        assertTrue("Private Stage14 app-scoped seed missing", file.isFile && file.length() in 40..4096)
        val value = JSONObject(file.readText(Charsets.UTF_8))
        assertTrue("Stage14 seed must be deleted after one read", file.delete())
        assertTrue("Seed account is outside the two isolated Stage14 accounts",
            value.optString("username") in allowedOwners)
        assertTrue("Seed origin differs from the owned loopback fixture",
            !value.has("origin") || value.optString("origin") == origin)
        assertTrue("Private login seed lacks a valid password",
            value.optString("password").length in 15..128)
        return value
    }
    private fun capture(web: WebView, fileName: String) {
        val visual = CountDownLatch(1)
        instrument.runOnMainSync { web.postVisualStateCallback(System.nanoTime(),
            object : WebView.VisualStateCallback() {
                override fun onComplete(requestId: Long) { visual.countDown() }
            }) }
        assertTrue("Stage14 visual state unavailable", visual.await(5, TimeUnit.SECONDS))
        instrument.waitForIdleSync()
        val image = instrument.uiAutomation.takeScreenshot()
            ?: throw AssertionError("Stage14 screenshot unavailable")
        File(context.getExternalFilesDir(null), fileName).outputStream().use {
            image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        image.recycle()
        System.out.println("STAGE14_BROWSER_CAPTURE " + JSONObject().put("fileName", fileName))
    }
    private fun replyLine(status: String, assistantMessages: Int) = when (status) {
        "waiting" -> "回复：电脑会话正在等待模型输出。"
        "streaming" -> "回复：模型正在生成回复，尚未见到结束记录。"
        "completed" -> if (assistantMessages > 0) "回复：回复回合已正常结束。"
            else "回复：回合已结束，但未见最终文字回复。"
        "aborted" -> "回复：回复回合已中断。"
        "blocked" -> "回复：模型请求被阻断。"
        "failed" -> "回复：模型回合未完成。"
        "unconfirmed" -> "回复：回复是否结束尚无法核对。"
        else -> throw AssertionError("Unknown bounded reply status")
    }

    @Test fun existingBrowserSegmentAndReplyStateAppearInRealPhoneUi() {
        val args = InstrumentationRegistry.getArguments()
        assertEquals("1", args.getString("stage14Probe"))
        val taskId = args.getString("stage14TaskId") ?: ""
        assertTrue("Exact existing task ID required", taskId.matches(
            Regex("cmd-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")))
        val credentials = seed()
        val existingHost = SecureSettings(context).host()
        assertTrue("Switch away from the existing different account through the real UI first",
            existingHost == null || existingHost.origin == origin &&
                existingHost.username == credentials.getString("username"))
        var resumed: HybridActivity? = null
        instrument.runOnMainSync { resumed = ActivityLifecycleMonitorRegistry.getInstance()
            .getActivitiesInStage(Stage.RESUMED).filterIsInstance<HybridActivity>().firstOrNull() }
        val launched = resumed == null
        val activity: Activity = resumed ?: instrument.startActivitySync(Intent(context,
            HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as HybridActivity
        try {
            var selected: WebView? = null
            instrument.runOnMainSync { selected = findWebView(activity.findViewById(android.R.id.content)) }
            val web = selected ?: throw AssertionError("Stage14 HybridActivity WebView unavailable")
            assertTrue("Stage14 UI did not boot", waitFor(web, "typeof state!=='undefined'&&state.booted", 25))
            if (existingHost == null) {
                assertTrue("Real Connect page unavailable", connectPage(web))
                assertTrue("Origin field missing", evaluate(web, """
                    (()=>{const label=[...document.querySelectorAll('#page-content label')]
                      .find(x=>x.textContent.includes('个人服务地址'));
                      const input=label?.querySelector('input');if(!input)return false;
                      input.value=${JSONObject.quote(origin)};
                      input.dispatchEvent(new Event('input',{bubbles:true}));return true})()
                """.trimIndent()) == "true")
                assertTrue("Real service connection check missing", evaluate(web, """
                    (()=>{const button=[...document.querySelectorAll('#page-content button')]
                      .find(x=>x.textContent.trim()==='检查服务连接');
                      if(!button)return false;button.click();return true})()
                """.trimIndent()) == "true")
                assertTrue("Existing account login was not offered", waitFor(web,
                    "[...document.querySelectorAll('#page-content button')].some(x=>x.textContent.trim()==='登录'&&!x.hidden)", 20))
                assertTrue("Real account login form missing", evaluate(web, """
                    (()=>{const labels=[...document.querySelectorAll('#page-content label')];
                      const field=(name)=>labels.find(x=>x.textContent.includes(name))?.querySelector('input');
                      const username=field('账户名'),password=field('密码'),device=field('设备名称');
                      const button=[...document.querySelectorAll('#page-content button')]
                        .find(x=>x.textContent.trim()==='登录');
                      if(!username||!password||!device||!button)return false;
                      username.value=${JSONObject.quote(credentials.getString("username"))};
                      password.value=${JSONObject.quote(credentials.getString("password"))};
                      device.value='Stage14 read-only phone probe';button.click();return true})()
                """.trimIndent()) == "true")
            }
            assertTrue("Exact Stage14 account did not become active", waitFor(web,
                "state.loggedIn&&state.username===${JSONObject.quote(credentials.getString("username"))}", 30))
            val host = SecureSettings(context).host()
                ?: throw AssertionError("Stage14 host identity missing after login")
            assertEquals(origin, host.origin)
            assertEquals(credentials.getString("username"), host.username)
            val api = PersonalApi()
            val task = api.taskDetail(host, taskId)
            assertEquals(taskId, task.getString("taskId"))
            assertEquals("browser", task.getJSONObject("workspace").getString("kind"))
            val sources = task.optJSONArray("sources") ?: JSONArray()
            val readSegments = (0 until sources.length()).map { sources.getJSONObject(it) }
                .filter { it.optString("kind") == "webpage" && it.has("parentSnapshotId") &&
                    it.optInt("segmentIndex", -1) > 0 }
            assertTrue("Task has no actually read later browser segment", readSegments.isNotEmpty())
            val segment = readSegments.first()
            val segmentIndex = segment.getInt("segmentIndex")
            val segmentCount = segment.getInt("segmentCount")
            val parentId = segment.getString("parentSnapshotId")
            assertTrue("Segment metadata is not bounded", segmentIndex in 1..31 &&
                segmentCount in 2..32 && segmentIndex < segmentCount &&
                parentId.matches(Regex("source-[a-f0-9]{48}")))
            val sameCapture = (0 until sources.length()).map { sources.getJSONObject(it) }
                .filter { it.optString("snapshotId") == parentId || it.optString("parentSnapshotId") == parentId }
            val readCount = sameCapture.map { it.getInt("segmentIndex") }.toSet().size
            val replyStatus = task.getJSONObject("replyEvidence").getString("status")
            val observedFiles = (task.optJSONArray("artifacts") ?: JSONArray()).let { rows ->
                (0 until rows.length()).map { rows.getJSONObject(it) }.filter { item ->
                    item.optString("state") == "observed" &&
                        item.optJSONObject("verification")?.optString("status") == "observed" &&
                        item.optString("artifactId").isNotBlank() &&
                        item.optString("sha256").matches(Regex("[a-f0-9]{64}")) &&
                        item.optLong("size", -1) >= 0 } }
            assertTrue("Stage14 phone UI update is not active yet", waitFor(web,
                "typeof state!=='undefined'&&state.booted&&state.ui?.activeVersion==='0.7.1'", 30))
            assertTrue("Real Things navigation missing", navigate(web, "things"))
            val fileName = observedFiles.firstOrNull()?.optString("fileName")?.trim().orEmpty()
            val taskLabel = task.optJSONObject("source")?.optString("taskLabel").orEmpty()
            assertTrue("Task lacks a unique rendered title for safe selection",
                fileName.isNotEmpty() || taskLabel.isNotEmpty())
            val renderedTitles = JSONArray()
            if (fileName.isNotEmpty()) renderedTitles.put("生成：$fileName")
            if (taskLabel.isNotEmpty()) renderedTitles.put("电脑任务：$taskLabel")
            assertTrue("Exact target task card did not appear", waitFor(web,
                "[...document.querySelectorAll('#page-content button.row')].filter(x=>" +
                "${renderedTitles}.some(title=>x.textContent.includes(title))).length===1", 30))
            var openedExact = false
            val clickDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
            while (System.nanoTime() < clickDeadline && !openedExact) {
                val outcome = JSONTokener(evaluate(web, """
                    (()=>{if(typeof state==='undefined'||!state.booted||state.page!=='things')return 'not-ready';
                      const buttons=[...document.querySelectorAll('#page-content button.row')]
                        .filter(x=>${renderedTitles}.some(title=>x.textContent.includes(title)));
                      if(buttons.length!==1)return 'count-'+buttons.length;
                      buttons[0].click();
                      return state.thingsDetail===${JSONObject.quote(taskId)}?'clicked-exact':'clicked-other'})()
                """.trimIndent())).nextValue() as String
                assertTrue("Rendered card selected another task", outcome != "clicked-other")
                if (outcome == "clicked-exact") openedExact = true
                else {
                    if (outcome == "not-ready" && waitFor(web,
                        "typeof state!=='undefined'&&state.booted&&state.ui?.activeVersion==='0.7.1'", 5))
                        navigate(web, "things")
                    Thread.sleep(180)
                }
            }
            if (!openedExact) System.out.println("STAGE14_UI_CARD_DIAGNOSTIC " + evaluate(web, """
                (()=>JSON.stringify({page:typeof state==='undefined'?'unavailable':state.page,
                  booted:typeof state!=='undefined'&&state.booted,
                  generation:typeof state==='undefined'?null:state.generation,
                  activeVersion:typeof state==='undefined'?null:state.ui?.activeVersion,
                  matchingCards:[...document.querySelectorAll('#page-content button.row')]
                    .filter(x=>${renderedTitles}.some(title=>x.textContent.includes(title))).length}))()
            """.trimIndent()))
            assertTrue("Exact rendered task card could not be clicked", openedExact)
            assertTrue("Opened task is not the requested task ID", waitFor(web,
                "state.thingsDetail===${JSONObject.quote(taskId)}", 15))
            val groupLabel = "已读 $readCount/$segmentCount 段"
            val segmentLabel = "第 ${segmentIndex + 1}/$segmentCount 段"
            val range = "已读字节 ${segment.getInt("byteStart") + 1}–${segment.getInt("byteEnd")}"
            assertTrue("Read coverage and segment byte range were not rendered", waitFor(web,
                "document.querySelector('#page-content')?.textContent?.includes(${JSONObject.quote(groupLabel)})&&" +
                "[...document.querySelectorAll('.project-source-entry')].some(x=>" +
                "x.textContent.includes(${JSONObject.quote(segmentLabel)})&&" +
                "x.textContent.includes(${JSONObject.quote(range)}))", 25))
            val expectedReply = replyLine(replyStatus,
                task.getJSONObject("replyEvidence").optInt("assistantMessages"))
            assertTrue("Reply and file status were not shown in independent task rows", waitFor(web,
                "[...document.querySelectorAll('#page-content .group')].some(g=>{" +
                "if(g.querySelector('h2')?.textContent!=='任务进度')return false;" +
                "const file=g.querySelector('p.command-status');" +
                "const replies=[...g.querySelectorAll('p.command-fact')].filter(p=>p.textContent.startsWith('回复：'));" +
                "return !!file&&replies.length===1&&replies[0]!==file&&" +
                "replies[0].textContent===${JSONObject.quote(expectedReply)}&&" +
                (if (observedFiles.isNotEmpty()) "file.textContent.includes('文件已在电脑核验')" else
                    "!file.textContent.includes('文件已在电脑核验')") + "})", 25))
            if (args.getString("stage14Capture") == "1") capture(web, "stage14-task-detail.png")
            val snapshotId = segment.getString("snapshotId")
            val expected = api.sourceDetail(host, taskId, snapshotId).getJSONObject("source")
            assertEquals(snapshotId, expected.getString("snapshotId"))
            val expectedBytes = expected.getInt("byteEnd") - expected.getInt("byteStart")
            assertTrue("Expected source byte range is invalid", expectedBytes in 1..8192)
            assertTrue("Exact read segment's real source button unavailable", evaluate(web, """
                (()=>{const entry=[...document.querySelectorAll('.project-source-entry')]
                  .find(x=>x.textContent.includes(${JSONObject.quote(segmentLabel)})&&
                    x.textContent.includes(${JSONObject.quote(range)}));
                  const button=[...entry?.querySelectorAll('button')||[]]
                    .find(x=>x.textContent.trim()==='查看来源正文');
                  if(!button)return false;button.click();return true})()
            """.trimIndent()) == "true")
            var sourceReady = false
            val sourceDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(25)
            while (System.nanoTime() < sourceDeadline && !sourceReady) {
                val state = JSONTokener(evaluate(web, """
                    (()=>{const entry=[...document.querySelectorAll('.project-source-entry')]
                      .find(x=>x.textContent.includes(${JSONObject.quote(segmentLabel)})&&
                        x.textContent.includes(${JSONObject.quote(range)}));
                      const text=entry?.querySelector('.artifact-preview')?.textContent||'';
                      if(!text||text==='正在读取来源正文…')return 'loading';
                      if(text.startsWith('来源正文未能核对：')||text==='当前账户无法读取这份来源。')
                        return 'source-error';
                      return new TextEncoder().encode(text).length===${expectedBytes}?'ready':'unexpected-size'})()
                """.trimIndent())).nextValue() as String
                assertTrue("Real source preview returned an error", state != "source-error")
                assertTrue("Real source preview had unexpected byte length", state != "unexpected-size")
                if (state == "ready") sourceReady = true else Thread.sleep(150)
            }
            assertTrue("Real native source bridge did not render the read segment", sourceReady)
            val preview = JSONTokener(evaluate(web, """
                (()=>[...document.querySelectorAll('.project-source-entry')]
                  .find(x=>x.textContent.includes(${JSONObject.quote(segmentLabel)})&&
                    x.textContent.includes(${JSONObject.quote(range)}))
                  ?.querySelector('.artifact-preview')?.textContent||'')()
            """.trimIndent())).nextValue() as String
            assertEquals(expected.getString("contentSha256"), sha(preview.toByteArray(Charsets.UTF_8)))
            assertEquals(expectedBytes, preview.toByteArray(Charsets.UTF_8).size)
            if (args.getString("stage14Capture") == "1") capture(web, "stage14-source-preview.png")
            if (args.getString("stage14PreviewArtifact") == "1" && observedFiles.isNotEmpty()) {
                val expectedArtifact = observedFiles.first()
                assertTrue("Existing observed artifact preview button unavailable", evaluate(web, """
                    (()=>{const entry=[...document.querySelectorAll('.artifact-entry')]
                      .find(x=>x.textContent.includes(${JSONObject.quote(fileName)}));
                      const button=[...entry?.querySelectorAll('button')||[]]
                        .find(x=>x.textContent.trim()==='查看内容');
                      if(!button)return false;button.click();return true})()
                """.trimIndent()) == "true")
                var artifactReady = false
                val artifactDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
                while (System.nanoTime() < artifactDeadline && !artifactReady) {
                    val state = JSONTokener(evaluate(web, """
                        (()=>{const entry=[...document.querySelectorAll('.artifact-entry')]
                          .find(x=>x.textContent.includes(${JSONObject.quote(fileName)}));
                          const text=entry?.querySelector('.artifact-preview')?.textContent||'';
                          return !text||text==='正在读取内容…'?'loading':'ready'})()
                    """.trimIndent())).nextValue() as String
                    if (state == "ready") artifactReady = true else Thread.sleep(150)
                }
                assertTrue("Existing artifact preview did not render", artifactReady)
                val artifactText = JSONTokener(evaluate(web, """
                    (()=>[...document.querySelectorAll('.artifact-entry')]
                      .find(x=>x.textContent.includes(${JSONObject.quote(fileName)}))
                      ?.querySelector('.artifact-preview')?.textContent||'')()
                """.trimIndent())).nextValue() as String
                assertEquals(expectedArtifact.getLong("size"), artifactText.toByteArray(Charsets.UTF_8).size.toLong())
                assertEquals(expectedArtifact.getString("sha256"), sha(artifactText.toByteArray(Charsets.UTF_8)))
            }
            System.out.println("STAGE14_BROWSER_UI " + JSONObject().put("taskId", taskId)
                .put("readSegments", readCount).put("segmentCount", segmentCount)
                .put("replyStatus", replyStatus).put("observedFiles", observedFiles.size)
                .put("previewBytes", preview.toByteArray(Charsets.UTF_8).size)
                .put("sourceHash", expected.getString("contentSha256")))
        } finally { if (launched) instrument.runOnMainSync { activity.finish() } }
    }
}
