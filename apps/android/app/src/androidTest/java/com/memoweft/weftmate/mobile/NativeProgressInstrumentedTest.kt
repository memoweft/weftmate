package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File

class NativeProgressInstrumentedTest {
    @get:Rule val compose=createEmptyComposeRule()
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val args=InstrumentationRegistry.getArguments()
    private lateinit var activity:NativeActivity
    private fun onMain(action:()->Unit)=instrumentation.runOnMainSync(action)
    private fun waitFor(label:String,condition:()->Boolean){val end=System.currentTimeMillis()+30000;while(System.currentTimeMillis()<end){var ok=false;onMain{ok=condition()};if(ok)return;Thread.sleep(80)};error("Timed out: $label; loggedIn=${activity.model.loggedIn}; loading=${activity.model.loading}; chat=${activity.model.chatId}; error=${activity.model.error}")}
    private fun shot(name:String){compose.waitForIdle();Thread.sleep(300);val image=instrumentation.uiAutomation.takeScreenshot();File(activity.getExternalFilesDir(null),"fix36-${args.getString("theme") }-$name.png").outputStream().use{image.compress(Bitmap.CompressFormat.PNG,100,it)}}
    @Test fun foldedProgressAndSameDataWebComparison() {
        check(instrumentation.targetContext.packageName=="com.memoweft.weftmate.mobile.fix36qa")
        activity=instrumentation.startActivitySync(Intent(instrumentation.targetContext,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("lg1bHostOrigin",args.getString("origin"))) as NativeActivity
        if(args.getString("reopen")!="1") {
            var booted=false
            waitFor("web login"){activity.embeddedWeb.evaluateJavascript("Boolean(typeof state!=='undefined' && state.booted)"){booted=it=="true"};booted}
            // The previous downloaded UI has no native projection entry point.
            // The new shell must use its bundled shared mapper on first render.
            onMain{activity.embeddedWeb.evaluateJavascript("delete WeftUiCore.nativeTimelineRows",null)}
            val credentials=JSONObject().put("origin",args.getString("origin")).put("username",args.getString("username")).put("password",args.getString("password")).put("deviceName","synthetic-phone")
            var signedIn=false
            onMain{activity.embeddedWeb.evaluateJavascript("call('auth.login',$credentials).then(()=>{window.fix36SignedIn=true}).catch(e=>{window.fix36LoginError=e.code||e.message})",null)}
            waitFor("login receipt"){activity.embeddedWeb.evaluateJavascript("Boolean(window.fix36SignedIn)"){signedIn=it=="true"};signedIn}
            onMain{activity.model.launch{activity.model.bootstrap()}}
        }
        waitFor("native connected"){activity.model.loggedIn && !activity.model.loading && activity.model.chatId.isNotBlank()}
        val dark=args.getString("theme")=="dark"
        onMain{activity.model.dark=dark;activity.model.launch{activity.model.call("settings.appearance",JSONObject().put("value",if(dark)"dark" else "light"))}}
        if(args.getString("reopen")!="1") {
            onMain{activity.model.edit("现在几点？顺便查一下今天的日历和健康记录。")}
            compose.onNodeWithContentDescription("发送消息").performClick()
        }
        waitFor("completed tools"){!activity.model.running && activity.model.rows.any{it.optString("type")=="turn.ended"}}
        compose.waitUntil(15000){compose.onAllNodesWithContentDescription("展开回复进展").fetchSemanticsNodes().size==1}
        compose.onNodeWithText("现在是下午 1 点 20 分。今天有一项日程，健康记录已查到。",substring=true).assertExists()
        compose.onAllNodesWithText("准备可用工具",substring=true).assertCountEquals(0)
        shot(if(args.getString("reopen")=="1")"reopened-collapsed" else "collapsed")
        compose.onNodeWithContentDescription("展开回复进展").performClick()
        compose.onNodeWithContentDescription("收起回复进展").assertExists()
        compose.onAllNodesWithText("准备可用工具",substring=true).assertCountEquals(4)
        shot("expanded")
        compose.onNodeWithContentDescription("收起回复进展").performClick();compose.onAllNodesWithText("准备可用工具",substring=true).assertCountEquals(0)
        // Comparison renders the already-authenticated source records using the
        // shipped mobile message/timeline renderers. It does not navigate the
        // synthetic account through the unrelated cloud identity journey.
        val events=org.json.JSONArray(activity.model.rows)
        var webReady=false
        onMain{
            for(i in 0 until activity.presentationContainer.childCount) activity.presentationContainer.getChildAt(i).visibility=android.view.View.INVISIBLE
            activity.embeddedWeb.visibility=android.view.View.VISIBLE
            activity.embeddedWeb.evaluateJavascript("""
                (()=>{try{
                  stopSharedPoll();uiCore.state.selectedChatId=null;state.page='chat';state.sharedError='';
                  page('chat');document.querySelectorAll('.topbar,#mobile-bottom-tabs').forEach(n=>n.style.removeProperty('display'));applyTheme('${if(dark)"dark" else "light"}');
                  const root=document.getElementById('chat-content');root.replaceChildren();
                  const events=$events;
                  for(const e of events.filter(e=>['user.message','assistant.message'].includes(e.type))){
                    const row=messageNode(e.type==='user.message'?'user':'assistant',e.data.text);
                    row.dataset.seq=String(e.seq);root.append(row);
                    if(e.type==='assistant.message'){row.querySelector('.message-tools')?.remove();mobileMessageActions?.bind(row,e,'${activity.model.sessionId}');}
                  }
                  WeftTimeline.render(events,root,{tag:'div'});return root.textContent.includes('现在是下午');
                }catch(e){return {error:e.message}}})()
            """.trimIndent()){value->webReady=value=="true";println("FIX36_WEB_RENDER=$value")}
        }
        waitFor("web projection rendered"){webReady};Thread.sleep(350);shot("web-same-data")

        File(activity.getExternalFilesDir(null),"fix36-${args.getString("theme")}-report.json").writeText(JSONObject().put("passed",true).put("dark",dark).put("density",activity.resources.displayMetrics.density).put("navigationBottom",androidx.core.view.ViewCompat.getRootWindowInsets(activity.presentationContainer)?.getInsets(androidx.core.view.WindowInsetsCompat.Type.navigationBars())?.bottom ?: -1).toString())
        onMain{activity.finish()}
    }
}
