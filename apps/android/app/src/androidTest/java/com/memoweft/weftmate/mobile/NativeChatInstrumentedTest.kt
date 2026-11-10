package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.net.Uri
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
import java.io.File

/** Full production UI + original native network; only the package/account/files are synthetic. */
class NativeChatInstrumentedTest {
    @get:Rule val compose = createEmptyComposeRule()
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val args=InstrumentationRegistry.getArguments()
    private lateinit var activity:NativeActivity
    private val variant get()="${args.getString("and4Width","360")}-${args.getString("and4Theme","light") }"
    private fun onMain(action:()->Unit)=instrumentation.runOnMainSync(action)
    private fun waitFor(label:String,condition:()->Boolean){val end=System.currentTimeMillis()+30000;while(System.currentTimeMillis()<end){var ok=false;onMain{ok=condition()};if(ok)return;Thread.sleep(100)};error("Timed out: $label")}
    private fun waitForAction(label: String, condition: () -> Boolean) {
        try {
            compose.waitUntil(30_000) {
                var ready = false
                onMain { ready = condition() }
                ready
            }
        } catch (timeout: ComposeTimeoutException) {
            throw AssertionError("Timed out: $label", timeout)
        }
    }
    private fun shot(name:String){compose.waitForIdle();Thread.sleep(350);val image=instrumentation.uiAutomation.takeScreenshot();assertNotNull(image);File(activity.filesDir,"and4-$variant-$name.png").outputStream().use{image.compress(Bitmap.CompressFormat.PNG,100,it)}}
    private fun send(text:String){onMain{activity.model.edit(text)};compose.onNodeWithContentDescription("发送消息").performClick()}
    private fun addSyntheticAttachments() {
        val syntheticFiles = File(activity.cacheDir,"composer-camera").apply { mkdirs() }
        val png = File(syntheticFiles,"synthetic-image.png")
        val bitmap = Bitmap.createBitmap(320,200,Bitmap.Config.ARGB_8888)
        Canvas(bitmap).drawColor(Color.rgb(150,175,157))
        png.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) }
        bitmap.recycle()
        val txt = File(syntheticFiles,"synthetic-note.txt").apply { writeText("本周计划：整理记录，留出休息时间。") }
        val attachments = AttachmentStore(activity, LocalStore(activity))
        attachments.import(androidx.core.content.FileProvider.getUriForFile(activity,"${activity.packageName}.composer-camera",png),activity.model.owner,activity.model.chatId,"image")
        attachments.import(androidx.core.content.FileProvider.getUriForFile(activity,"${activity.packageName}.composer-camera",txt),activity.model.owner,activity.model.chatId,"file")
        onMain { activity.model.launch { activity.model.refreshAttachments() } }
        waitFor("two attachments") { activity.model.attachments.size == 2 }
    }
    private fun captureComposerDraft(text: String) {
        val dock = compose.onNodeWithContentDescription("聊天输入区")
        val closed = dock.fetchSemanticsNode().boundsInRoot.height
        shot("composer-idle")
        compose.mainClock.autoAdvance = false
        try {
            onMain { activity.model.edit(text) }
            compose.mainClock.advanceTimeByFrame()
            compose.mainClock.advanceTimeBy(48)
            val midway = dock.fetchSemanticsNode().boundsInRoot.height
            shot("composer-transition")
            compose.mainClock.advanceTimeBy(400)
            val expanded = dock.fetchSemanticsNode().boundsInRoot.height
            assertTrue("Composer heights $closed, $midway, $expanded", midway > closed && midway < expanded)
            instrumentation.sendStatus(0, android.os.Bundle().apply { putString("composerHeights", "$closed,$midway,$expanded") })
        } finally {
            compose.mainClock.autoAdvance = true
        }
        shot("composer-draft")
    }
    private fun engineValue(script: String): String {
        val ready = java.util.concurrent.CountDownLatch(1)
        var value = ""
        onMain {
            activity.embeddedWeb.evaluateJavascript(script) {
                value = it
                ready.countDown()
            }
        }
        check(ready.await(5, java.util.concurrent.TimeUnit.SECONDS))
        return value
    }
    private fun launchFixture(waitForHistory: Boolean = true) {
        check(instrumentation.targetContext.packageName=="com.memoweft.weftmate.mobile.and4qa")
        instrumentation.targetContext.getSharedPreferences("native-chat",0).edit().clear().commit()
        instrumentation.targetContext.getSharedPreferences("native-qa",0).edit().putInt("width",args.getString("and4Width","360").toInt()).commit()
        onMain{android.webkit.WebView.setWebContentsDebuggingEnabled(true)}
        activity=instrumentation.startActivitySync(Intent(instrumentation.targetContext,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("lg1bHostOrigin",args.getString("and4Origin")).putExtra("and4Width",args.getString("and4Width","360").toInt())) as NativeActivity
        waitFor("web login available"){activity.embeddedWeb.progress==100};shot("login")
        var booted=false
        waitFor("web booted"){activity.embeddedWeb.evaluateJavascript("Boolean(typeof state!=='undefined' && state.booted)"){booted=it=="true"};booted}
        val credentials=JSONObject().put("origin",args.getString("and4Origin")).put("username",args.getString("and4Username")).put("password",args.getString("and4Password")).put("deviceName","Synthetic Android")
        onMain{activity.embeddedWeb.evaluateJavascript("call('auth.login',${credentials}).then(()=>location.reload()).catch(e=>{window.and4LoginError=e.code||e.message})",null)}
        waitFor("native signed in") {
            val model = activity.model
            model.loggedIn && !model.loading && (if (waitForHistory) model.chatId.isNotBlank() && model.rows.isNotEmpty() else model.connected)
        }
        onMain{activity.model.launch{activity.model.call("settings.appearance",JSONObject().put("value",args.getString("and4Theme","light")));activity.model.dark=args.getString("and4Theme")=="dark";activity.embeddedWeb.evaluateJavascript("applyTheme('${args.getString("and4Theme","light")}')",null)}}
        Thread.sleep(700)
    }

    @Test fun nativeMessageActionsFlow() {
        org.junit.Assume.assumeTrue(args.getString("and4MessageActions") == "1")
        launchFixture(waitForHistory = false)
        try {
            var original = ""
            onMain { original = activity.model.sessionId }
            compose.onNodeWithContentDescription("打开侧栏").performClick()
            compose.onNodeWithText("新建对话").performClick()
            waitFor("new ordinary chat") {
                !activity.model.loading && activity.model.sessionId.isNotBlank() && activity.model.sessionId != original
            }
            val dark = args.getString("and4Theme") == "dark"
            onMain { activity.settings.open("appearance") }
            val themeChoice = if (dark) "颜色模式：深色" else "颜色模式：浅色"
            compose.waitUntil(15000) { compose.onAllNodesWithContentDescription(themeChoice).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithContentDescription(themeChoice).performClick()
            waitForAction("saved native appearance") { !activity.settings.busy && activity.model.dark == dark }
            onMain { activity.model.returnToChat() }
            waitForAction("native chat restored") { activity.model.tab == "chat" && activity.model.dark == dark }
            onMain { original = activity.model.sessionId }
            val prompt = "合成版本验收"
            if (args.getString("and4ContextUsage") == "1") {
                compose.onNodeWithContentDescription("背景信息窗口：86% 已用").assertIsDisplayed()
            }
            if (args.getString("and4Delete") == "1") {
                waitFor("attachment composer ready") { activity.model.canSend }
                captureComposerDraft(prompt)
                addSyntheticAttachments()
                shot("attachments")
                compose.onNodeWithContentDescription("移除附件：synthetic-image.png").performClick()
                waitForAction("image attachment removed") { activity.model.attachments.size == 1 }
                compose.onNodeWithContentDescription("移除附件：synthetic-note.txt").performClick()
                waitForAction("attachment draft cleared") { activity.model.attachments.isEmpty() }
            } else onMain { activity.model.edit(prompt) }
            waitFor("composer ready to send") {
                val model = activity.model
                model.canSend && !model.submitting && !model.workBusy && !model.approvalModeBusy
            }
            compose.onNodeWithContentDescription("发送消息").assertIsEnabled().performTouchInput { click() }
            if (args.getString("and4Delete") == "1") {
                compose.waitUntil(15000) { compose.onAllNodesWithContentDescription("停止回复").fetchSemanticsNodes().isNotEmpty() }
                shot("composer-stop")
            }
            waitForAction("original reply") {
                !activity.model.running && activity.model.rows.any {
                    it.optString("type") == "assistant.message" &&
                        it.optJSONObject("data")?.optString("text")?.contains("收到：$prompt") == true
                }
            }
            engineValue("""
                (() => {
                    const read = uiCore.accessApi;
                    window.nativeActionTrace = [];
                    uiCore.accessApi = async function (path, options) {
                        const route = path.startsWith('/commands/by-request/') ? 'by-request' :
                            path.startsWith('/commands/') ? 'command-receipt' : path.split('/').at(-1);
                        const track = ['me','status','chat','message-branches','commands','by-request','command-receipt'].includes(route);
                        if (!track) return read.call(this, path, options);
                        const entry = { route, method: options?.method || 'GET', before: !!uiCore.state.csrfToken };
                        try { const value = await read.call(this, path, options); entry.ok = true; entry.command = value?.command?.state; return value; }
                        catch (error) { entry.code = error?.code; entry.status = error?.status; throw error; }
                        finally { entry.after = !!uiCore.state.csrfToken; window.nativeActionTrace.push(entry); }
                    };
                })()
            """.trimIndent())
            compose.onAllNodesWithContentDescription("更多回复操作").onLast().performClick()
            shot("reply-menu")
            compose.onNodeWithText("重新生成").performClick()
            waitForAction("regenerated reply in its version") {
                activity.model.sessionId != original && !activity.model.running && activity.model.rows.any {
                    it.optString("type") == "assistant.message" &&
                        it.optJSONObject("data")?.optString("text")?.contains("收到：$prompt") == true
                }
            }
            compose.waitUntil(15000) { compose.onAllNodesWithText("第 2 / 2 版").fetchSemanticsNodes().isNotEmpty() }
            shot("regenerated")
            var regenerated = ""
            onMain { regenerated = activity.model.sessionId }
            fun visibleVersion(id: String): Boolean = activity.model.sessionId == id &&
                !activity.model.loading && activity.model.rows.any { it.optString("type") == "assistant.message" }
            fun chooseVersion(label: String, id: String) {
                compose.waitUntil(15000) { compose.onAllNodesWithContentDescription(label).fetchSemanticsNodes().isNotEmpty() }
                compose.onNodeWithContentDescription(label).assertIsEnabled().performClick()
                waitForAction(label) { visibleVersion(id) }
            }
            chooseVersion("上一版", original)
            chooseVersion("下一版", regenerated)
            chooseVersion("上一版", original)
            waitForAction("original message ready to edit") { visibleVersion(original) && activity.model.connected }
            val longPress = SemanticsMatcher.keyIsDefined(androidx.compose.ui.semantics.SemanticsActions.OnLongClick)
            compose.onNode(hasText(prompt) and longPress).performTouchInput { longClick() }
            compose.onNodeWithText("编辑").performClick()
            compose.onNodeWithText("编辑消息").assertExists()
            shot("edit")
            val changed = "合成编辑后的消息"
            compose.onAllNodes(hasSetTextAction()).onLast().performTextReplacement(changed)
            compose.onNodeWithText("发送修改").performClick()
            waitForAction("edited version reply") {
                activity.model.sessionId != original && !activity.model.running && activity.model.rows.any {
                    it.optString("type") == "assistant.message" &&
                        it.optJSONObject("data")?.optString("text")?.contains("收到：$changed") == true
                }
            }
            shot("edited-version")
            if (args.getString("and4Delete") == "1") {
                var chat = ""
                var session = ""
                onMain { chat = activity.model.chatId; session = activity.model.sessionId }
                instrumentation.sendStatus(0, android.os.Bundle().apply { putString("nativeDeleteExpected", session) })
                compose.onNodeWithContentDescription("打开侧栏").performClick()
                compose.onNodeWithText("全部对话").performClick()
                val row = hasTestTag("native-chat-row-$chat") and longPress
                compose.waitUntil(15000) { compose.onAllNodes(row).fetchSemanticsNodes().isNotEmpty() }
                compose.onAllNodes(row).onFirst().performTouchInput { longClick() }
                compose.onNodeWithText("移到分组").performClick()
                compose.waitUntil(15000) { compose.onAllNodesWithText("合成验收分组").fetchSemanticsNodes().isNotEmpty() }
                shot("groups")
                compose.onNodeWithText("合成验收分组").performClick()
                compose.waitUntil(15000) { compose.onAllNodesWithText("新分组名称").fetchSemanticsNodes().isEmpty() }
                compose.waitUntil(15000) { compose.onAllNodes(row).fetchSemanticsNodes().isNotEmpty() }
                compose.onAllNodes(row).onFirst().performTouchInput { longClick() }
                compose.onNodeWithText("删除").performClick()
                compose.onNodeWithText("同时忘掉从这段对话形成的记忆").performTouchInput { click() }
                compose.waitUntil(15000) { compose.onAllNodesWithText("会一起忘掉 1 条记忆。").fetchSemanticsNodes().isNotEmpty() }
                shot("delete-with-memory")
                compose.onNodeWithText("删除").performClick()
                compose.waitUntil(20000) { compose.onAllNodesWithText("同时忘掉从这段对话形成的记忆").fetchSemanticsNodes().isEmpty() }
                shot("deleted")
            }
            onMain { assertEquals(dark, activity.model.dark) }
        } catch (failure: Throwable) {
            runCatching {
                val trace = engineValue("({calls: window.nativeActionTrace, csrf: !!uiCore.state.csrfToken, online: uiCore.state.online, submitting: uiCore.state.submitting, pending: Object.values(window.weftCoreResults || {}).map(row=>row?.error?.code || (row?.value ? 'ready' : 'waiting'))})")
                val encoded = engineValue("JSON.stringify(Object.values(window.weftCoreResults || {}).find(row=>row?.value) || null)")
                val parseable = runCatching { JSONObject(org.json.JSONTokener(encoded).nextValue().toString()).has("value") }.getOrDefault(false)
                var native = ""
                onMain {
                    val model = activity.model
                    native = JSONObject().put("loading", model.loading).put("running", model.running)
                        .put("chats", model.chats.size).put("session", model.sessionId).toString()
                }
                instrumentation.sendStatus(0, android.os.Bundle().apply {
                    putString("nativeActionTrace", trace)
                    putString("nativeActionView", native)
                    putString("nativeActionResultParseable", parseable.toString())
                })
                shot("failure")
            }
            throw failure
        } finally {
            onMain { activity.finish() }
        }
    }

    @Test fun nativePhoneOnlyFlow() {
        org.junit.Assume.assumeTrue(args.getString("and4PhoneOnly") == "1")
        val context = instrumentation.targetContext
        check(context.packageName == "com.memoweft.weftmate.mobile.and4qa")
        val endpoint = requireNotNull(args.getString("and4PhoneModel"))
        check(endpoint.startsWith("http://127.0.0.1:") && endpoint.endsWith("/v1/chat/completions"))
        val account = PhoneAccount(context, SecureSettings(context))
        check(account.bootstrapIdentity().authSource == "phone-local")
        account.models("configure", JSONObject().put("endpoint", endpoint).put("modelId", "synthetic-phone")
            .put("displayName", "合成手机模型").put("apiKey", "synthetic-phone-key"))
        activity = instrumentation.startActivitySync(Intent(context, NativeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as NativeActivity
        try {
            waitForAction("local-only composer ready") {
                val model = activity.model
                model.localOnly && model.standalone && model.phoneArchive && !model.loading && model.canSend
            }
            fun ask(text: String, answer: String) {
                onMain { activity.model.edit(text) }
                compose.onNodeWithContentDescription("发送消息").assertIsEnabled().performTouchInput { click() }
                waitForAction("phone-only reply") {
                    val model = activity.model
                    !model.running && model.rows.any { it.optString("type") == "assistant.message" &&
                        it.optJSONObject("data")?.optString("text")?.contains(answer) == true }
                }
            }
            ask("手机独立第一问", "合成手机回复 1")
            var selected = ""
            onMain { selected = activity.model.chatId }
            check(selected.isNotBlank() && selected != "phone-new")
            shot("phone-first")
            ask("手机独立继续问", "合成手机回复 2")
            onMain {
                assertEquals(selected, activity.model.chatId)
                assertTrue(activity.model.localOnly)
                assertTrue(activity.model.phoneArchive)
                assertTrue(activity.model.hostId.isBlank())
            }
            shot("phone-continued")
        } finally {
            onMain { activity.finish() }
        }
    }

    @Test fun nativeChatFlow(){
        launchFixture()
        if(args.getString("and4MetricSetup")=="1")return
        compose.onNodeWithContentDescription("语音输入").assertExists();shot("capsule")
        compose.onNodeWithContentDescription("消息输入").performClick();shot("focused")
        compose.onNodeWithContentDescription("消息输入").performTextInput("草稿保持展开")
        onMain{activity.hideKeyboard()};shot("draft")
        compose.onNodeWithContentDescription("模型：MiMo v2.6 Flash").performClick();compose.onNodeWithText("MiMo v2.6 Flash").assertExists();shot("model-menu")
        compose.onNodeWithText("MiMo v2.6 Flash").performClick()
        compose.onNodeWithContentDescription("审批方式：自动").performClick();compose.onNodeWithText("每次询问").assertExists();shot("mode-menu");compose.onNodeWithText("自动").performClick()
        compose.onNodeWithContentDescription("添加附件").performClick();compose.onNodeWithText("照片").assertExists();shot("plus-menu");onMain{activity.hideKeyboard()};instrumentation.uiAutomation.performGlobalAction(1)
        onMain{activity.model.edit("");activity.model.focused=false}
        send("合成流式")
        waitFor("stream snapshot"){activity.model.rows.any{it.optString("type")=="assistant.delta"}};shot("stream")
        waitFor("stream finalized"){!activity.model.running && activity.model.rows.any{it.optString("type")=="assistant.message"&&it.optJSONObject("data")?.optString("text")?.contains("收到。") == true}}
        if(args.getString("and4Regression")=="1") {
            send("三项审批");waitFor("three approval"){activity.model.approvals.any{it.optBoolean("canAlwaysAllow")}};Thread.sleep(700);shot("approval-three")
            compose.onNodeWithText("以后这类都允许").performClick();compose.onNodeWithText("确认",useUnmergedTree=true).performClick()
            waitFor("approval consumed"){activity.model.approvals.any{it.optString("status")!="pending"}};shot("approval-receipt")
            onMain{activity.startActivity(Intent(activity,MainActivity::class.java))};Thread.sleep(900);shot("compat-native-connection")
            onMain{activity.finish()};return
        }
        // System picker test substitute: import synthetic URIs into the production AttachmentStore.
        addSyntheticAttachments();shot("attachments")
        compose.onNodeWithContentDescription("移除附件：synthetic-note.txt").assertExists()
        compose.onNodeWithText("synthetic-image.png",substring=true).let{ /* image accessible via content description */ }
        compose.onNodeWithContentDescription("synthetic-image.png").performClick();shot("image-preview");compose.onNodeWithContentDescription("关闭预览").performClick()
        send("请读取这两个合成附件");waitFor("attachments accepted"){activity.model.attachments.isEmpty()};Thread.sleep(2500);shot("sent-attachments")
        send("两按钮审批");waitFor("pending approval"){activity.model.approvals.any{it.optString("status")=="pending"}};Thread.sleep(700);shot("approval-two");compose.onNodeWithText("批准",useUnmergedTree=true).performClick();waitFor("approval registered"){activity.model.approvals.any{it.optString("status")!="pending"}};shot("receipt")
        send("三项审批");waitFor("three approval"){activity.model.approvals.any{it.optBoolean("canAlwaysAllow")}};Thread.sleep(700);shot("approval-three");compose.onNodeWithText("以后这类都允许").performClick();compose.onNodeWithText("确认",useUnmergedTree=true).performClick()
        send("三选一");waitFor("question"){activity.model.questions.isNotEmpty()};Thread.sleep(700);shot("question");compose.onNodeWithText("本周计划").performClick();compose.onNodeWithText("确认选择").performClick();waitFor("question registered"){activity.model.questions[0].optString("status")!="pending"}
        for(tab in listOf("动态","健康","目标","成果库","聊天")){compose.onNodeWithContentDescription(tab).performClick();Thread.sleep(1100);shot("tab-$tab")}
        compose.onNodeWithContentDescription("更多").performClick();shot("overflow-menu");compose.onNodeWithText("设置").performClick();Thread.sleep(800);shot("settings")
        onMain{activity.model.tab="chat"};compose.onNodeWithContentDescription("打开侧栏").performClick();Thread.sleep(500);shot("sidebar");instrumentation.uiAutomation.performGlobalAction(1)
        if(args.getString("and4Mimo")=="1"){send("真实流式");waitFor("MiMo reply"){activity.model.running};waitFor("MiMo complete"){!activity.model.running};shot("mimo")}
        onMain{activity.model.edit("重开保留的草稿")};shot("retained-draft")
        onMain{activity.model.tab="settings"}
        onMain{activity.fallback()}
        Thread.sleep(1400)
        assertFalse(instrumentation.targetContext.getSharedPreferences("native-ui",0).getBoolean("enabled",true))
        shot("legacy-entry")
        val visible=WeftMateApplication::class.java.getDeclaredField("visible").apply{isAccessible=true}
        var legacy:HybridActivity?=null
        onMain{legacy=(visible.get(instrumentation.targetContext.applicationContext) as Set<*>).filterIsInstance<HybridActivity>().firstOrNull{it !is NativeActivity}}
        assertNotNull("Legacy activity is visible",legacy)
        onMain{legacy!!.embeddedWeb.evaluateJavascript("call('native.presentation',{enabled:true})",null)}
        Thread.sleep(1400)
        assertTrue(instrumentation.targetContext.getSharedPreferences("native-ui",0).getBoolean("enabled",false))
        File(activity.filesDir,"and4-$variant-done.json").writeText(JSONObject().put("variant",variant).put("density",activity.resources.displayMetrics.density).put("widthDp",activity.resources.configuration.screenWidthDp).put("navigationBottom",androidx.core.view.ViewCompat.getRootWindowInsets(activity.presentationContainer)?.getInsets(androidx.core.view.WindowInsetsCompat.Type.navigationBars())?.bottom ?: -1).put("passed",true).toString())
    }
}
