package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Production Compose page + original authenticated native business calls. */
class NativeFeedInstrumentedTest {
    @get:Rule val compose=createEmptyComposeRule()
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val args=InstrumentationRegistry.getArguments()
    private lateinit var activity:NativeActivity
    private val variant get()="${args.getString("and5Width","360")}-${args.getString("and5Theme","light") }"
    private fun main(action:()->Unit)=instrumentation.runOnMainSync(action)
    private fun waitFor(label:String,condition:()->Boolean){val end=System.currentTimeMillis()+30000;while(System.currentTimeMillis()<end){var ok=false;main{ok=condition()};if(ok)return;Thread.sleep(100)};error("Timed out: $label")}
    private fun shot(name:String){compose.waitForIdle();Thread.sleep(250);val image=instrumentation.uiAutomation.takeScreenshot();assertNotNull(image);File(activity.filesDir,"and5-$variant-$name.png").outputStream().use{image.compress(Bitmap.CompressFormat.PNG,100,it)}}
    private fun fixture(command:String){val c=URL(args.getString("and5Origin")+"/__and5/$command").openConnection() as HttpURLConnection;try{assertEquals(200,c.responseCode);c.inputStream.close()}finally{c.disconnect()}}
    private fun refresh(command:String){fixture(command);main{activity.feed.refresh(full=true)};waitFor(command){!activity.feed.loading};Thread.sleep(250)}
    private fun tab(){compose.onNodeWithContentDescription("动态").performClick();waitFor("activity page"){!activity.feed.loading&&activity.model.tab=="activity"}}
    private fun scrollTo(description:String){compose.onNodeWithContentDescription("动态列表").performScrollToNode(hasContentDescription(description))}
    private fun open(title:String){val description="打开动态 $title";scrollTo(description);compose.onNodeWithContentDescription(description).performClick()}
    private fun more(){compose.onNodeWithContentDescription("动态列表").performScrollToNode(hasText("更多动态"));compose.onNodeWithText("更多动态").performClick()}
    @Test fun nativeActivityFlow(){
        check(instrumentation.targetContext.packageName=="com.memoweft.weftmate.mobile.and5qa")
        instrumentation.targetContext.getSharedPreferences("native-ui",0).edit().putBoolean("enabled",true).commit()
        instrumentation.targetContext.getSharedPreferences("native-qa",0).edit().putInt("width",args.getString("and5Width","360").toInt()).commit()
        main{android.webkit.WebView.setWebContentsDebuggingEnabled(true)}
        activity=instrumentation.startActivitySync(Intent(instrumentation.targetContext,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("lg1bHostOrigin",args.getString("and5Origin"))) as NativeActivity
        var booted=false
        waitFor("web login booted"){activity.embeddedWeb.evaluateJavascript("Boolean(typeof state!=='undefined' && state.booted)"){booted=it=="true"};booted}
        if(!activity.model.loggedIn){
            val credentials=JSONObject().put("origin",args.getString("and5Origin")).put("username",args.getString("and5Username")).put("password",args.getString("and5Password")).put("deviceName","Synthetic Android")
            main{activity.embeddedWeb.evaluateJavascript("call('auth.login',$credentials).then(()=>location.reload())",null)}
        }
        waitFor("native signed in"){activity.model.loggedIn&&!activity.model.loading&&activity.model.chatId.isNotBlank()&&activity.model.rows.isNotEmpty()}
        main{activity.model.launch{activity.model.call("settings.appearance",JSONObject().put("value",args.getString("and5Theme","light")));activity.model.dark=args.getString("and5Theme")=="dark";activity.embeddedWeb.evaluateJavascript("applyTheme('${args.getString("and5Theme","light")}')",null)}}
        tab();waitFor("list read"){activity.feed.items.size>=4&&!activity.feed.loading};shot("list-unread-pending")
        assertEquals("pending",activity.feed.items.first().optString("state"));assertTrue(activity.feed.unread>0)
        scrollTo("更多操作 需要审批");compose.onNodeWithContentDescription("更多操作 需要审批").performClick();compose.onNodeWithText("批准").assertExists();compose.onNodeWithText("拒绝").assertExists();shot("row-menu")
        compose.onNodeWithText("标为已读").performClick();waitFor("pending read receipt"){activity.feed.items.find{it.optString("id")=="approval-pending"}?.optBoolean("read")==true};shot("pending-read")
        open("需要审批");waitFor("approval native chat"){activity.model.tab=="chat"&&activity.model.approvals.isNotEmpty()};compose.onNodeWithText("批准",useUnmergedTree=true).assertExists();shot("open-approval")
        tab();open("需要回答");waitFor("question native chat"){activity.model.tab=="chat"&&activity.model.questions.isNotEmpty()};compose.onNodeWithText("把记录放在哪里？").assertExists();shot("open-question")
        tab();open("任务完成");waitFor("task native chat"){activity.model.tab=="chat"};shot("open-task")
        tab();open("喝水提醒");waitFor("reminder native chat"){activity.model.tab=="chat"};shot("open-reminder")
        tab();more();waitFor("pagination"){activity.feed.items.size>=7};shot("more-loaded")
        compose.onNodeWithContentDescription("动态列表").performScrollToNode(hasText("这周主要在整理记录。周末留出了休息时间。"));shot("weekly-inline")
        compose.onNodeWithText("本周计划").performClick();waitFor("weekly source chat"){activity.model.tab=="chat"};shot("weekly-source")
        tab();compose.onNodeWithContentDescription("动态列表").performScrollToNode(hasText("记忆"));compose.onNodeWithText("记忆").performClick();waitFor("memory filter"){!activity.feed.loading&&activity.feed.items.size==2};shot("memory-filter")
        compose.onNodeWithContentDescription("动态列表").performScrollToNode(hasText("你喜欢把周末留给休息。"));shot("memory-inline")
        scrollTo("记忆操作 你喜欢把周末留给休息。");compose.onNodeWithContentDescription("记忆操作 你喜欢把周末留给休息。").performClick();compose.onNodeWithText("不对，改一下").assertExists();compose.onNodeWithText("忘掉").assertExists();shot("memory-menu");instrumentation.uiAutomation.performGlobalAction(1)
        scrollTo("更多操作 这周记住的事");compose.onNodeWithContentDescription("更多操作 这周记住的事").performClick();compose.onNodeWithText("完整操作").performClick();waitFor("embedded report"){activity.model.tab=="activity-web"}
        main{File(activity.filesDir,"and5-$variant-web-reference.json").writeText(JSONObject().put("displayed",activity.displayedFeedWeb!=null).put("same",activity.displayedFeedWeb===activity.embeddedWeb).put("displayedParent",activity.displayedFeedWeb?.parent?.javaClass?.simpleName ?: "none").put("currentParent",activity.embeddedWeb.parent?.javaClass?.simpleName ?: "none").put("webPayload",activity.feed.webDetail!=null).put("finishing",activity.isFinishing).put("destroyed",activity.isDestroyed).toString())}
        var reviewReady=false;try{waitFor("selected report on displayed web"){activity.displayedFeedWeb?.evaluateJavascript("Boolean(window.weftNativeMemoryReady)"){reviewReady=it=="true"};reviewReady}}catch(e:Exception){
            main{val web=activity.displayedFeedWeb ?: activity.embeddedWeb;web.evaluateJavascript("JSON.stringify({stage:window.weftNativeFeedStage,page:state.page,loggedIn:state.loggedIn,booted:state.booted,csrf:!!uiCore.state.csrfToken,filter:uiCore.activity.filter,error:uiCore.activity.error,items:uiCore.activity.items.map(r=>r.id),rows:[...document.querySelectorAll('[data-activity-id]')].map(r=>r.dataset.activityId),route:window.weftNativeRoute})"){File(activity.filesDir,"and5-$variant-web-debug.json").writeText(it)}};Thread.sleep(500);shot("memory-review-failure");throw e
        }
        main{assertSame("Displayed web must be the current authenticated instance",activity.embeddedWeb,activity.displayedFeedWeb)};shot("memory-review-web");compose.onNodeWithContentDescription("返回动态").performClick()
        main{activity.feed.choose("all")};waitFor("all filter"){!activity.feed.loading};compose.onNodeWithContentDescription("动态列表").performScrollToNode(hasContentDescription("全部标为已读"));compose.onNodeWithContentDescription("全部标为已读").performClick();waitFor("all read"){activity.feed.unread==0&&!activity.feed.loading};shot("list-all-read");compose.onAllNodes(hasContentDescription("条动态未读",substring=true)).assertCountEquals(0)
        refresh("empty");shot("empty")
        fixture("slow");main{activity.feed.choose("task")};waitFor("skeleton"){activity.feed.loading&&activity.feed.items.isEmpty()};shot("loading");waitFor("slow complete"){!activity.feed.loading}
        refresh("error");shot("error");compose.onNodeWithText("重试").assertExists()
        fixture("reset");compose.onNodeWithText("重试").performClick();waitFor("retry recovers"){!activity.feed.loading&&activity.feed.items.isNotEmpty()};shot("retry")
        // MOB-4's saved phone identity uses authSource=phone; no cloud or computer is contacted.
        val settings=SecureSettings(activity);val connected=settings.host()!!
        settings.saveHost(connected.copy(authSource="phone"))
        main{activity.model.launch{activity.feed.prepare()}};waitFor("phone-only empty"){activity.feed.noComputer&&!activity.feed.loading}
        compose.onNodeWithText("连上电脑后，提醒和任务进展会出现在这里。").assertExists();assertEquals(0,activity.feed.unread);assertEquals("",activity.feed.error);shot("no-computer")
        settings.saveHost(connected);main{activity.model.launch{activity.feed.prepare()}};waitFor("connected identity restored"){!activity.feed.noComputer&&!activity.feed.loading&&activity.feed.items.isNotEmpty()}
        main{activity.feed.choose("all")};waitFor("reset list"){!activity.feed.loading};shot("final-badge")
        File(activity.filesDir,"and5-$variant-done.json").writeText(JSONObject().put("passed",true).put("widthDp",activity.resources.configuration.screenWidthDp).put("pageDark",activity.model.dark).put("systemDark",activity.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK == android.content.res.Configuration.UI_MODE_NIGHT_YES).put("statusHeight",androidx.core.view.ViewCompat.getRootWindowInsets(activity.presentationContainer)?.getInsets(androidx.core.view.WindowInsetsCompat.Type.statusBars())?.top ?: -1).put("navigationBottom",androidx.core.view.ViewCompat.getRootWindowInsets(activity.presentationContainer)?.getInsets(androidx.core.view.WindowInsetsCompat.Type.navigationBars())?.bottom ?: -1).toString())
        fixture("reset")
        // Existing rollback preference and original HybridActivity, with an app-local QA width.
        instrumentation.targetContext.getSharedPreferences("native-ui",0).edit().putBoolean("enabled",false).commit()
        main{activity.finish()}
        val legacy=instrumentation.startActivitySync(Intent(instrumentation.targetContext,And5LegacyActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("lg1bHostOrigin",args.getString("and5Origin"))) as HybridActivity
        var legacyReady=false
        waitFor("same-account web boot"){legacy.embeddedWeb.evaluateJavascript("Boolean(typeof state!=='undefined'&&state.booted&&state.loggedIn)"){legacyReady=it=="true"};legacyReady}
        main{legacy.embeddedWeb.evaluateJavascript("page('activity');applyTheme('${args.getString("and5Theme","light")}')",null)}
        var webList=false
        waitFor("web list same data"){legacy.embeddedWeb.evaluateJavascript("Boolean(typeof uiCore!=='undefined'&&uiCore.activity.items.length>=4&&!uiCore.activity.loading)"){webList=it=="true"};webList}
        shot("web-list-unread-pending")
        main{legacy.embeddedWeb.evaluateJavascript("document.querySelector('[data-activity-id=\"approval-pending\"] .library-icon').click()",null)};shot("web-row-menu")
        instrumentation.uiAutomation.performGlobalAction(1)
        fixture("empty");main{legacy.embeddedWeb.evaluateJavascript("uiCore.readActivity()",null)}
        var webEmpty=false;waitFor("web empty"){legacy.embeddedWeb.evaluateJavascript("Boolean(!uiCore.activity.loading&&uiCore.activity.items.length===0)"){webEmpty=it=="true"};webEmpty};shot("web-empty")
        main{legacy.finish()}
        instrumentation.targetContext.getSharedPreferences("native-ui",0).edit().putBoolean("enabled",true).commit()
        fixture("reset")
    }
}
