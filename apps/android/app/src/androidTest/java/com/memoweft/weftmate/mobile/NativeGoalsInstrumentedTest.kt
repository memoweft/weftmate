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

class NativeGoalsInstrumentedTest {
    @get:Rule val compose=createEmptyComposeRule()
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val args=InstrumentationRegistry.getArguments()
    private lateinit var activity:NativeActivity
    private var referenceWeb:android.webkit.WebView?=null
    private val variant get()="${args.getString("and6Width","360")}-${args.getString("and6Theme","light") }"
    private fun main(action:()->Unit)=instrumentation.runOnMainSync(action)
    private fun waitFor(label:String,condition:()->Boolean){val end=System.currentTimeMillis()+30000;while(System.currentTimeMillis()<end){var ok=condition();if(ok){compose.waitForIdle();ok=condition();if(ok)return};Thread.sleep(100)};error("Timed out: $label")}
    private fun shot(name:String){compose.waitForIdle();Thread.sleep(250);val image=instrumentation.uiAutomation.takeScreenshot();assertNotNull(image);File(activity.filesDir,"and6-$variant-$name.png").outputStream().use{image.compress(Bitmap.CompressFormat.PNG,100,it)}}
    private fun fixture(command:String):JSONObject{val c=URL(args.getString("and6Origin")+"/__and6/$command").openConnection() as HttpURLConnection;try{assertEquals(200,c.responseCode);return JSONObject(c.inputStream.bufferedReader().readText())}finally{c.disconnect()}}
    private fun refresh(command:String){fixture(command);main{activity.goals.refresh()};waitFor(command){!activity.goals.loading};Thread.sleep(100)}
    private fun tab(){compose.onNodeWithContentDescription("目标",useUnmergedTree=true).performClick();waitFor("goals page"){activity.model.tab=="goals"&&!activity.goals.loading}}
    private fun scrollTo(matcher:SemanticsMatcher){compose.onNodeWithContentDescription("目标列表").performScrollToNode(matcher)}
    private fun clickDescription(value:String){scrollTo(hasContentDescription(value));compose.onNodeWithContentDescription(value).performClick()}
    private fun js(script:String):String{var value:String?=null;main{(referenceWeb ?: activity.embeddedWeb).evaluateJavascript(script){value=it}};val end=System.currentTimeMillis()+10000;while(value==null&&System.currentTimeMillis()<end)Thread.sleep(50);return value ?: error("javascript timed out")}
    private fun original(state:String,command:String="") {
        val old=instrumentation.startActivitySync(Intent(instrumentation.targetContext,HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("lg1bHostOrigin",args.getString("and6Origin"))) as HybridActivity
        referenceWeb=old.embeddedWeb
        waitFor("original mounted"){js("Boolean(typeof state!=='undefined'&&state.booted&&state.loggedIn)")=="true"}
        js("applyTheme('${args.getString("and6Theme","light")}');page('goals')")
        waitFor("original data loaded"){js("Boolean(typeof uiCore!=='undefined' && uiCore.goalsPage&&!uiCore.goalsPage.loading && document.querySelector('.goals-heading'))")=="true"}
        js("if(typeof goalsView!=='undefined')goalsView.reset();uiCore.readGoals()");Thread.sleep(800)
        if(command.isNotEmpty()){js(command);Thread.sleep(350)}
        if(state=="new-form") {
            waitFor("original form mounted"){js("Boolean(document.querySelector('.goals-form textarea'))")=="true"}
            js("""(()=>{const form=document.querySelector('.goals-form');form.querySelector('textarea').value='晚上整理阅读记录';const repeat=form.querySelector('select[aria-label="重复"]');repeat.value='weekly';repeat.dispatchEvent(new Event('change'));const day=form.querySelector('select[aria-label="星期"]');day.value='5';day.dispatchEvent(new Event('change'));for(const [label,value]of [['时间 · 小时','09'],['时间 · 分钟','00']]){const control=form.querySelector('select[aria-label="'+label+'"]');control.value=value;control.dispatchEvent(new Event('change'));}form.querySelector('textarea').blur();form.scrollIntoView({block:'start'});return form.querySelector('textarea').value})()""")
            Thread.sleep(400)
        }
        shot("web-$state");referenceWeb=null;main{old.finish()};compose.waitForIdle();waitFor("original closed"){activity.model.tab=="goals"&&!activity.goals.loading}
    }
    @Test fun nativeGoalsFlow(){
        check(instrumentation.targetContext.packageName=="com.memoweft.weftmate.mobile.and6qa")
        val context=instrumentation.targetContext
        context.getSharedPreferences("native-ui",0).edit().putBoolean("enabled",true).commit()
        context.getSharedPreferences("native-qa",0).edit().putInt("width",args.getString("and6Width","360").toInt()).commit()
        main{android.webkit.WebView.setWebContentsDebuggingEnabled(true)}
        activity=instrumentation.startActivitySync(Intent(context,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("lg1bHostOrigin",args.getString("and6Origin"))) as NativeActivity
        waitFor("web booted"){js("Boolean(typeof state!=='undefined' && state.booted)")=="true"}
        if(!activity.model.loggedIn){val credentials=JSONObject().put("origin",args.getString("and6Origin")).put("username",args.getString("and6Username")).put("password",args.getString("and6Password")).put("deviceName","Synthetic Android");js("call('auth.login',$credentials).then(()=>location.reload())")}
        waitFor("native signed in"){activity.model.loggedIn&&!activity.model.loading&&activity.model.rows.isNotEmpty()}
        main{activity.model.launch{activity.model.call("settings.appearance",JSONObject().put("value",args.getString("and6Theme","light")));activity.model.dark=args.getString("and6Theme")=="dark"}}
        js("applyTheme('${args.getString("and6Theme","light")}')")
        tab();waitFor("list read"){activity.goals.sections["schedules"]?.size==2&&!activity.goals.loading};shot("content")
        // All filters are direct tabs; no disclosure menu remains.
        compose.onNodeWithText("全部").assertIsSelected();compose.onNodeWithText("定时").performClick();compose.onNodeWithText("定时").assertIsSelected();shot("schedule-list")
        clickDescription("更多操作 每天早上提醒喝水");compose.onNodeWithText("编辑").assertExists();compose.onNodeWithText("立即运行").assertExists();compose.onNodeWithText("查看记录").assertExists();compose.onNodeWithText("删除").assertExists();shot("row-menu");instrumentation.uiAutomation.performGlobalAction(1)
        clickDescription("启用 每天早上提醒喝水");waitFor("pause saved"){activity.goals.sections["schedules"]?.first()?.optString("state")=="paused"};clickDescription("启用 每天早上提醒喝水");waitFor("resume saved"){activity.goals.sections["schedules"]?.first()?.optString("state")=="scheduled"};shot("toggle-resumed")
        clickDescription("打开目标 每天早上提醒喝水");waitFor("detail"){activity.goals.detail!=null};shot("detail");compose.onNodeWithText("查看记录").performClick();waitFor("records"){!activity.goals.recordsLoading&&activity.goals.records.isNotEmpty()};shot("records");compose.onNodeWithText("打开所属对话").performScrollTo().performClick();waitFor("source chat"){activity.model.tab=="chat"};assertEquals(fixture("inspect").getJSONArray("schedules").getJSONObject(0).getString("sessionId"),activity.model.sessionId);shot("source-chat")
        tab();compose.onNodeWithText("定时").performClick();clickDescription("更多操作 每天早上提醒喝水");compose.onNodeWithText("立即运行").performClick();waitFor("run settled"){!activity.goals.busy&&!activity.goals.loading};assertTrue(fixture("inspect").getJSONArray("requests").objects().any{it.optString("path").endsWith("/run")})
        scrollTo(hasText("新建定时任务"));compose.onNodeWithText("新建定时任务").performClick();waitFor("create form"){activity.goals.draft!=null};compose.onNodeWithText("保存").performClick();compose.onNodeWithText("请写下要做什么。").assertExists();shot("validation")
        compose.onNodeWithContentDescription("要做什么").performTextInput("晚上整理阅读记录");compose.onNodeWithContentDescription("选择重复：每天").performScrollTo().performClick();compose.onNodeWithText("每周").assertExists();shot("repeat-menu");compose.onNodeWithText("每周").performClick();compose.onNodeWithContentDescription("选择星期：星期一").performScrollTo().performClick();shot("weekday-menu");compose.onNodeWithText("星期五").performClick()
        compose.onNodeWithContentDescription("选择小时：",substring=true).performScrollTo().performClick();shot("hour-menu");compose.onNodeWithContentDescription("选择小时 选项：09").performClick();compose.onNodeWithContentDescription("选择分钟：",substring=true).performScrollTo().performClick();shot("minute-menu");compose.onNodeWithContentDescription("选择分钟 选项：00").performClick();main{activity.hideKeyboard()};compose.onNodeWithText("要做什么").performScrollTo();shot("new-form")
        compose.onNodeWithText("保存").performClick();waitFor("create saved"){activity.goals.draft==null&&!activity.goals.loading&&activity.goals.sections["schedules"]?.size==3};assertTrue(fixture("inspect").getJSONArray("schedules").objects().any{it.optString("text")=="晚上整理阅读记录"&&it.optJSONObject("repeat")?.optString("kind")=="weekly"})
        clickDescription("更多操作 晚上整理阅读记录");compose.onNodeWithText("编辑").performClick();waitFor("edit form"){activity.goals.draft?.original!=null};compose.onNodeWithContentDescription("要做什么").performTextReplacement("晚上整理阅读记录与笔记");compose.onNodeWithText("保存").performClick();waitFor("edit saved"){activity.goals.draft==null&&!activity.goals.loading};assertEquals(2,fixture("inspect").getJSONArray("schedules").objects().first{it.optString("text")=="晚上整理阅读记录与笔记"}.getInt("revision"));shot("edited")
        clickDescription("更多操作 晚上整理阅读记录与笔记");compose.onNodeWithText("删除").performClick();compose.onNodeWithText("确认删除").assertExists();shot("delete-confirm");assertEquals(3,fixture("inspect").getJSONArray("schedules").length());compose.onNodeWithText("取消").performClick();assertEquals(3,fixture("inspect").getJSONArray("schedules").length());clickDescription("更多操作 晚上整理阅读记录与笔记");compose.onNodeWithText("删除").performClick();compose.onNodeWithText("确认删除").performClick();waitFor("deleted"){!activity.goals.loading&&activity.goals.sections["schedules"]?.size==2}
        main{activity.goals.filter="goals"};clickDescription("打开目标 完成秋季项目");compose.onNodeWithText("编辑目标与检查点").assertExists();shot("goal-detail");compose.onNodeWithContentDescription("返回目标").performClick();clickDescription("更多操作 完成秋季项目");compose.onNodeWithText("完成目标").performClick();waitFor("goal complete"){activity.goals.sections["goals"]?.first()?.optString("phase")=="complete"};clickDescription("更多操作 完成秋季项目");compose.onNodeWithText("归档目标").performClick();shot("archive-confirm");compose.onNodeWithText("确认归档").performClick();waitFor("goal archived"){!activity.goals.loading&&activity.goals.sections["goals"].isNullOrEmpty()};scrollTo(hasText("新建长期目标"));compose.onNodeWithText("新建长期目标").performClick();compose.onNodeWithContentDescription("目标标题").performTextInput("学习计划");compose.onNodeWithContentDescription("目标说明与检查点").performTextInput("检查点：完成第一章。");shot("goal-form");compose.onNodeWithText("保存").performClick();waitFor("goal saved"){activity.goals.draft==null&&!activity.goals.loading&&activity.goals.sections["goals"]?.size==1}
        refresh("reset");main{activity.goals.filter="all"};original("content");original("row-menu","document.querySelector('[aria-label=\"更多操作 每天早上提醒喝水\"]')?.closest('article').scrollIntoView({block:'center'});document.querySelector('[aria-label=\"更多操作 每天早上提醒喝水\"]')?.click()");original("new-form","[...document.querySelectorAll('button')].find(b=>b.textContent==='新建定时任务')?.click();document.querySelector('textarea[aria-label=\"要做什么\"]').value='晚上整理阅读记录';const repeat=document.querySelector('select[aria-label=\"重复\"]');repeat.value='weekly';repeat.dispatchEvent(new Event('change'));document.querySelector('.goals-form').scrollIntoView({block:'start'})")
        refresh("empty");Thread.sleep(3200);shot("empty");original("empty");main{activity.goals.close();activity.model.launch{activity.goals.prepare()}};waitFor("empty reloaded"){!activity.goals.loading&&activity.goals.sections["schedules"].isNullOrEmpty()};fixture("slow");main{activity.goals.refresh()};waitFor("loading"){activity.goals.loading};shot("loading");waitFor("slow settled"){!activity.goals.loading}
        refresh("error");shot("error");fixture("reset");scrollTo(hasText("重试"));compose.onAllNodesWithText("重试")[0].performClick();waitFor("retry"){!activity.goals.loading&&activity.goals.sections["schedules"]?.size==2};shot("retry")
        refresh("offline");assertEquals(2,activity.goals.sections["schedules"]?.size);shot("offline-cache");refresh("reset")
        // Synthetic directory + the same scoped content dispatcher exercise the M3-2 adapter.
        val primary=activity.goals.sections["schedules"]!!.first().getString("hostId")
        js("""(()=>{window.and6OldComputerApi=uiCore.computerApi;window.and6OldCurrent=uiCore.currentExecutionComputer;uiCore.state.computers=[{hostId:${JSONObject.quote(primary)},name:'合成台式机',online:true},{hostId:'synthetic-laptop',name:'合成笔记本',online:true}];uiCore.currentExecutionComputer=()=>${JSONObject.quote(primary)};uiCore.computerApi=async(id,path,options={})=>{const result=await call('host.business',{path:'/personal/v1'+path,method:options.method||'GET',body:options.body});if(result.items)result.items=result.items.map(row=>({...row,text:row.text?'笔记本：'+row.text:undefined,title:row.title?'笔记本：'+row.title:undefined}));return result;};return true})()""")
        main{activity.goals.refresh()};waitFor("multiple computers"){!activity.goals.loading&&activity.goals.sections["schedules"]?.size==4};assertEquals(2,activity.goals.computers.size);main{activity.goals.filter="schedules"};shot("multi-computer")
        scrollTo(hasText("新建定时任务"));compose.onNodeWithText("新建定时任务").performClick();compose.onNodeWithContentDescription("选择在哪台电脑上做：合成台式机").performScrollTo().performClick();shot("computer-menu");compose.onNodeWithText("合成笔记本").performClick();assertEquals("synthetic-laptop",activity.goals.draft?.hostId);compose.onNodeWithText("取消").performClick()
        js("uiCore.state.computers[1].online=false");main{activity.goals.refresh()};waitFor("one computer offline"){!activity.goals.loading&&activity.goals.offline.contains("合成笔记本")};assertEquals(4,activity.goals.sections["schedules"]?.size);shot("multi-offline")
        js("uiCore.state.computers=[];uiCore.computerApi=window.and6OldComputerApi;uiCore.currentExecutionComputer=window.and6OldCurrent");main{activity.goals.refresh()};waitFor("single computer restored"){!activity.goals.loading&&activity.goals.computers.isEmpty()}
        val settings=SecureSettings(activity);val connected=settings.host()!!;settings.saveHost(connected.copy(authSource="phone"));main{activity.model.launch{activity.goals.prepare()}};waitFor("phone only empty"){activity.goals.noComputer&&!activity.goals.loading};compose.onNodeWithText("连上电脑后，可以让它按时帮你做事。").assertExists();assertTrue(activity.goals.errors.isEmpty());shot("no-computer");settings.saveHost(connected)
        File(activity.filesDir,"and6-$variant-done.json").writeText(JSONObject().put("passed",true).put("variant",variant).put("systemSdk",android.os.Build.VERSION.SDK_INT).put("systemTheme","unchanged emulator setting").toString())
        main{activity.finish()}
    }
}
