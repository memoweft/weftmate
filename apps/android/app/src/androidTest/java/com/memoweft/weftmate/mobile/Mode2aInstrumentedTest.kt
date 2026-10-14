package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Real native controls -> cloud login -> isolated computer and its native tool pauses. */
class Mode2aInstrumentedTest {
    @get:Rule val compose=createEmptyComposeRule()
    private val i=InstrumentationRegistry.getInstrumentation()
    private val args=InstrumentationRegistry.getArguments()
    private lateinit var a:NativeActivity
    private val report=JSONObject()
    private fun main(action:()->Unit)=i.runOnMainSync(action)
    private fun waitFor(label:String,timeout:Long=60000,test:()->Boolean){
        val end=System.currentTimeMillis()+timeout
        while(System.currentTimeMillis()<end){var ok=false;main{ok=test()};if(ok)return;Thread.sleep(100)}
        error("Timed out: $label")
    }
    private fun js(script:String):String {val done=CountDownLatch(1);var value="";main{a.embeddedWeb.evaluateJavascript(script){value=it;done.countDown()}};check(done.await(10,TimeUnit.SECONDS));return value}
    private fun shot(name:String){compose.waitForIdle();Thread.sleep(300);val image=i.uiAutomation.takeScreenshot();try{File(i.targetContext.getExternalFilesDir(null),"mode2a-$name.png").outputStream().use{image.compress(Bitmap.CompressFormat.PNG,100,it)}}finally{image.recycle()}}
    private fun click(label:String)=compose.onNodeWithText(label,useUnmergedTree=true).performClick()
    private fun newConversation(mode:String){
        compose.onNodeWithContentDescription("打开侧栏").performClick()
        compose.onNodeWithContentDescription(if(mode=="work")"工作" else "对话").performClick()
        click(if(mode=="work")"新建工作" else "新建对话")
        waitFor("new $mode"){!a.model.workChoicesBusy && if(mode=="work")a.model.newWork else a.model.chatId.isNotEmpty() && a.model.canSend && !a.model.submitting}
    }
    private fun send(text:String){compose.onNodeWithContentDescription("消息输入").performTextInput(text);compose.onNodeWithContentDescription("发送消息").performClick()}
    private fun completed(tag:String){waitFor("completed $tag",90000){!a.model.running && a.model.rows.any{it.optString("type")=="assistant.message" && it.optJSONObject("data")?.stringOrEmpty("text")?.contains("MODE2A_DONE_$tag")==true}}}
    @Test fun nativeModesSwitchAndPublicLookupKeepTheirHistory() {
        check(i.targetContext.packageName=="com.memoweft.weftmate.mobile.lg1bqa")
        a=i.startActivitySync(Intent(i.targetContext,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("lg1bHostOrigin",args.getString("origin"))) as NativeActivity
        try {
            var booted=false
            waitFor("cloud login boot"){a.embeddedWeb.evaluateJavascript("Boolean(typeof state!=='undefined' && state.booted && document.getElementById('auth-email'))"){booted=it=="true"};booted}
            val email=JSONObject.quote(args.getString("email"));val password=JSONObject.quote(args.getString("password"))
            js("document.getElementById('auth-email').value=$email;document.getElementById('auth-password').value=$password;document.getElementById('cloud-auth-form').requestSubmit();true")
            val code=File(i.targetContext.filesDir,"mode2a-code.txt")
            val deadline=System.currentTimeMillis()+60000
            while(!code.exists() && System.currentTimeMillis()<deadline)Thread.sleep(100)
            check(code.exists()){"Synthetic email code missing"}
            js("document.getElementById('auth-code').value=${JSONObject.quote(code.readText().trim())};document.getElementById('cloud-auth-form').requestSubmit();true");code.delete()
            waitFor("native authenticated modes",90000){a.model.loggedIn && a.model.workAndChat && a.model.chatId.isNotEmpty() && !a.model.loading && !a.model.submitting}
            var quiet=false;main{a.model.launch{for(category in listOf("reply","action","sync"))a.model.call("notifications.set",JSONObject().put("category",category).put("enabled",false));quiet=true}}
            waitFor("quiet synthetic notifications"){quiet}
            report.put("realCloudLogin",true).put("workAndChat",true)
            for(theme in listOf("light","dark")) {
                var saved=false;main{a.model.launch{a.model.call("settings.appearance",JSONObject().put("value",theme));a.model.dark=theme=="dark";saved=true}}
                waitFor("theme"){saved};compose.waitForIdle()
                compose.onNodeWithContentDescription("打开侧栏").performClick()
                compose.onNodeWithContentDescription("对话").performClick();shot("$theme-sidebar-chat")
                compose.onNodeWithContentDescription("工作").performClick();shot("$theme-sidebar-work")
                click("新建工作");waitFor("fresh work"){a.model.newWork && !a.model.workChoicesBusy}
                assertFalse(a.model.canSend)
                compose.onNodeWithContentDescription("项目或文件夹：选择项目或文件夹").performClick()
                waitFor("project choices"){!a.model.workChoicesBusy && a.model.projects.isNotEmpty()}
                shot("$theme-folder-menu")
                click("MODE-2A 测试文件夹")
                waitFor("project bound"){!a.model.newWork && a.model.conversationMode=="work" && a.model.workProject!=null && !a.model.submitting}
                assertEquals(args.getString("hostId"),a.model.hostId)
                val workSession=a.model.sessionId
                send("MODE2A_NEW_WORK_${theme.uppercase()} 请在选好的文件夹中实际创建文件。")
                completed("NEW_WORK_${theme.uppercase()}");shot("$theme-new-work-completed")
                assertEquals(workSession,a.model.sessionId)
                newConversation("chat")
                val chat=a.model.chatId
                send("MODE2A_SWITCH_${theme.uppercase()} 请动手建文件，先让我选择是否切换到工作。")
                waitFor("work switch card"){a.model.approvals.any{it.optString("status")=="pending" && it.stringOrEmpty("intent")=="work-switch"}}
                val session=a.model.sessionId
                val source=a.model.rows.first{it.optString("type")=="user.message"}.toString()
                compose.onNodeWithText("切换到工作",useUnmergedTree=true).performScrollTo();compose.waitForIdle()
                waitFor("switch choices ready"){!a.model.workChoicesBusy && a.model.projects.isNotEmpty()};shot("$theme-switch-pending")
                click("切换到工作")
                completed("SWITCH_${theme.uppercase()}")
                assertEquals(chat,a.model.chatId);assertEquals(session,a.model.sessionId);assertEquals("work",a.model.conversationMode)
                assertEquals("work",a.model.sidebarMode)
                assertTrue(a.model.rows.any{it.toString()==source})
                assertEquals(1,a.model.rows.count{it.optString("type")=="user.message"})
                shot("$theme-switch-completed")
                compose.onNodeWithContentDescription("打开侧栏").performClick();shot("$theme-converted-in-work")
                assertTrue(a.model.visibleChats.any{it.stringOrEmpty("chatId")==chat})
                compose.onNodeWithContentDescription("关闭侧栏").performClick()
                newConversation("chat")
                send("MODE2A_LOOKUP_${theme.uppercase()} 请联网查公开资料。")
                completed("LOOKUP_${theme.uppercase()}")
                assertEquals("chat",a.model.conversationMode)
                assertFalse(a.model.approvals.any{it.stringOrEmpty("intent")=="work-switch"})
                shot("$theme-lookup-no-switch")
                newConversation("chat")
                send("MODE2A_REJECT_${theme.uppercase()} 需要电脑动手时先问我。")
                waitFor("reject switch"){a.model.approvals.any{it.optString("status")=="pending" && it.stringOrEmpty("intent")=="work-switch"}}
                compose.onNodeWithText("先不用",useUnmergedTree=true).performScrollTo();click("先不用")
                completed("REJECT_${theme.uppercase()}")
                assertEquals("chat",a.model.conversationMode);shot("$theme-rejected")
            }
            // The original main entry is ordinary history, and still uses logical chat.message.
            var selectedMain=false
            main{a.model.launch{a.model.refreshChats();val entry=a.model.chats.first{it.stringOrEmpty("kind")=="main"};a.model.select(entry);selectedMain=true}}
            waitFor("ordinary main history"){selectedMain && !a.model.submitting}
            val originalMain=a.model.chatId
            send("MODE2A_MAIN_CONTEXT 这是之前的对话历史。")
            waitFor("first main context"){!a.model.running && a.model.rows.any{it.optString("type")=="assistant.message"}}
            val mainSource=a.model.rows.first{it.optString("type")=="user.message"}.toString()
            val mainSession=a.model.sessionId
            send("MODE2A_MAIN_DARK 请在这段历史中继续建文件。")
            waitFor("main switch"){a.model.approvals.any{it.stringOrEmpty("intent")=="work-switch" && it.optString("status")=="pending"}}
            compose.onNodeWithText("切换到工作",useUnmergedTree=true).performScrollTo();compose.waitForIdle()
            waitFor("main choices ready"){!a.model.workChoicesBusy && a.model.projects.isNotEmpty()};click("切换到工作")
            completed("MAIN_DARK")
            assertEquals(originalMain,a.model.chatId);assertEquals(mainSession,a.model.sessionId)
            assertEquals("main",a.model.chatKind);assertTrue(a.model.rows.any{it.toString()==mainSource})
            shot("main-same-logical-history");report.put("originalMainHistory",true)
            if(!args.getString("secondHostId").isNullOrBlank()) {
                newConversation("work")
                assertEquals(2,a.model.computers.size)
                compose.onNodeWithContentDescription("消息输入").performTextInput("MODE2A_SECOND_DARK 请在第二台电脑选好的文件夹中建文件。")
                compose.onNodeWithContentDescription("审批方式：自动").performClick();click("每次询问")
                waitFor("draft approval choice"){a.model.mode=="ask" && !a.model.approvalModeBusy}
                compose.onNodeWithContentDescription("电脑：${a.model.hostName}").performClick();shot("two-computers-menu")
                click("MODE-2A 第二台电脑")
                waitFor("second computer draft",90000){a.model.hostId==args.getString("secondHostId") && a.model.newWork && !a.model.workChoicesBusy}
                assertEquals("ask",a.model.mode)
                assertTrue(a.model.draft.startsWith("MODE2A_SECOND_DARK"))
                compose.waitForIdle()
                val picker=compose.onNodeWithContentDescription("项目或文件夹：选择项目或文件夹")
                compose.waitUntil(20000){picker.fetchSemanticsNode().config.getOrNull(SemanticsProperties.Disabled)==null}
                picker.assertIsEnabled().performClick()
                waitFor("second projects"){!a.model.workChoicesBusy && a.model.projects.isNotEmpty()}
                compose.waitForIdle()
                click("MODE-2A 第二台文件夹")
                waitFor("second work bound"){!a.model.newWork && a.model.canSend && !a.model.submitting}
                assertEquals("ask",a.model.mode)
                compose.onNodeWithContentDescription("发送消息").performClick()
                waitFor("second computer normal approval"){a.model.approvals.any{it.optString("status")=="pending" && it.stringOrEmpty("intent")!="work-switch"}}
                compose.onNodeWithText("批准",useUnmergedTree=true).performScrollTo();click("批准")
                completed("SECOND_DARK");shot("second-computer-completed")
                assertEquals(args.getString("secondHostId"),a.model.hostId);report.put("secondComputer",true)
            }
            args.getString("mimoProfileId")?.takeIf{it.isNotBlank()}?.let { profile ->
                main{a.model.selectModel(a.model.models.first{it.stringOrEmpty("profileId")==profile})}
                waitFor("MiMo selected"){a.model.modelId==profile}
                newConversation("chat")
                val original=a.model.chatId
                send("请实际使用 write 工具在当前项目文件夹中创建 mode2a-mimo.txt，内容只有 MODE2A_MIMO_PROOF。请动手执行，这是一次测试，不要只说明做法。")
                waitFor("real MiMo computer tool",120000){a.model.approvals.any{it.stringOrEmpty("intent")=="work-switch" && it.optString("status")=="pending"}}
                val before=a.model.rows.first{it.optString("type")=="user.message"}.toString()
                val tool=a.model.approvals.first{it.stringOrEmpty("intent")=="work-switch" && it.optString("status")=="pending"}.stringOrEmpty("toolName")
                compose.onNodeWithText("切换到工作",useUnmergedTree=true).performScrollTo();compose.waitForIdle()
                waitFor("MiMo switch project"){!a.model.workChoicesBusy && a.model.projects.isNotEmpty()}
                shot("mimo-real-tool-pending");click("切换到工作")
                waitFor("MiMo work completed",120000){a.model.conversationMode=="work" && !a.model.running && a.model.rows.any{it.optString("type")=="assistant.message"}}
                assertEquals(original,a.model.chatId);assertTrue(a.model.rows.any{it.toString()==before})
                shot("mimo-real-file-completed");report.put("realMiMo",true).put("mimoTool",tool)
            }
            report.put("newWork",true).put("sameChatAndSession",true).put("singleUserMessage",true).put("publicLookupNoSwitch",true).put("rejection",true)
        } catch(e:Throwable){shot("failure");main{report.put("failure",e.javaClass.simpleName).put("choicesBusy",a.model.workChoicesBusy).put("projectCount",a.model.projects.size).put("projectNames",org.json.JSONArray(a.model.projects.map{it.stringOrEmpty("name")})).put("computerCount",a.model.computers.size).put("newWork",a.model.newWork).put("running",a.model.running).put("connected",a.model.connected).put("error",a.model.error).put("choiceError",a.model.workChoicesError)};throw e}
        finally {File(i.targetContext.getExternalFilesDir(null),"mode2a-report.json").writeText(report.toString());main{a.finish()}}
    }
}
