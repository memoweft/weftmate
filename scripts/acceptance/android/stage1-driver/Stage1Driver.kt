package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.semantics.SemanticsActions
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import kotlinx.coroutines.*
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.net.ServerSocket
import java.net.InetAddress

/** Disposable instrumentation only. It calls the installed app, never replaces its services. */
class Stage1Driver {
  @get:Rule val compose=createEmptyComposeRule()
  @Test fun serve() {
    val inst=InstrumentationRegistry.getInstrumentation()
    check(inst.targetContext.packageName=="com.memoweft.weftmate.mobile.b2qa")
    var activity=inst.startActivitySync(Intent(inst.targetContext,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as NativeActivity
    fun main(action:()->Unit)=inst.runOnMainSync {
      ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED)
        .filterIsInstance<NativeActivity>().lastOrNull()?.let { activity=it }
      action()
    }
    fun state():JSONObject {
      var result=JSONObject()
      main { val m=activity.model;result=JSONObject().put("loggedIn",m.loggedIn).put("localOnly",m.localOnly).put("phone",m.phone).put("standalone",m.standalone).put("loading",m.loading).put("running",m.running).put("draft",m.draft).put("error",m.error).put("canSend",m.canSend).put("chatId",m.chatId).put("sessionId",m.sessionId).put("modelId",m.modelId).put("tab",m.tab).put("rows",JSONArray(m.rows)).put("chats",JSONArray(m.chats)).put("hasOlder",m.hasOlder).put("approvals",JSONArray(m.approvals)).put("computers",JSONArray(m.computers)).put("projects",JSONArray(m.projects)).put("hostId",m.hostId).put("hostName",m.hostName).put("workAndChat",m.workAndChat).put("conversationMode",m.conversationMode).put("approvalMode",m.mode).put("workProject",m.workProject) }
      main { result.put("foreground",activity.nativeForeground).put("submitting",activity.model.submitting).put("workBusy",activity.model.workBusy).put("refreshPhase",activity.model.refreshPhase) }
      return result
    }
    val server=ServerSocket(0,4,InetAddress.getByName("127.0.0.1"))
    server.soTimeout=1000
    File(activity.filesDir,"b2-driver-port").writeText(server.localPort.toString())
    val deadline=System.currentTimeMillis()+18*60*1000
    var done=false
    try { while(!done && System.currentTimeMillis()<deadline) {
      val socket=try{server.accept()}catch(_:java.net.SocketTimeoutException){continue}
      socket.use {
        it.soTimeout=20000
        val request=JSONObject(it.getInputStream().bufferedReader().readLine())
        val result=try {
          main { }
          when(request.getString("action")) {
            "state"->state()
            "call"->runBlocking(Dispatchers.Main){activity.model.call(request.getString("method"),request.optJSONObject("params")?:JSONObject())}
            "business"->runBlocking(Dispatchers.Main){activity.model.business(request.getString("path"),request.optString("verb","GET"),request.optJSONObject("body"))}
            "bridge"->runBlocking(Dispatchers.Main){activity.settings.bridge.call(request.getString("method"),request.optJSONObject("params")?:JSONObject())}
            "web"->{
              var raw:String?=null
              main { activity.embeddedWeb.evaluateJavascript(request.getString("script")){raw=it} }
              val end=System.currentTimeMillis()+10000
              while(raw==null&&System.currentTimeMillis()<end)Thread.sleep(20)
              JSONObject().put("value",raw?:error("Web view timeout"))
            }
            "phone"->runBlocking(Dispatchers.Main){activity.phonePresentation(request.getString("method"),request.optJSONObject("params")?:JSONObject())}
            "send"->{ main{activity.model.edit(request.getString("text"));activity.model.send()};JSONObject().put("actionIssued",true) }
            "new"->{main{activity.model.newChat(request.optString("mode", "chat"))};JSONObject()}
            "approvalMode"->{main{activity.model.setApprovalMode(request.getString("value"))};JSONObject()}
            "computer"->{main{activity.model.chooseWorkComputer(request.getString("id"))};JSONObject()}
            "project"->{main{activity.model.chooseWorkProject(request.getJSONObject("project"))};JSONObject()}
            "choices"->{runBlocking(Dispatchers.Main){activity.model.refreshWorkChoices()};state()}
            "bootstrap"->{runBlocking(Dispatchers.Main){activity.model.bootstrap()};state()}
            "decide"->{main{activity.model.decide(request.getJSONObject("row"),request.getString("outcome"))};JSONObject()}
            "stop"->{main{activity.model.stop()};JSONObject()}
            "refresh"->{runBlocking(Dispatchers.Main){activity.model.refresh(request.optBoolean("older"))};state()}
            "select"->{runBlocking(Dispatchers.Main){activity.model.select(request.getJSONObject("chat"))};state()}
            "page"->{main{activity.model.tab=request.getString("name")};JSONObject()}
            "settings"->{main{activity.settings.open(request.getString("name"),request.optBoolean("adding"))};JSONObject()}
            "theme"->{runBlocking(Dispatchers.Main){activity.settings.bridge.call("appearance",JSONObject().put("theme",request.getString("value")));activity.model.dark=request.getString("value")=="dark"};JSONObject()}
            "input"->{compose.onNodeWithContentDescription(request.getString("label")).performScrollTo().performTextReplacement(request.getString("value"));JSONObject()}
            "click"->{val node=compose.onNodeWithText(request.getString("text"));runCatching{node.performScrollTo()};node.performClick();JSONObject()}
            "clickLabel"->{compose.onNodeWithContentDescription(request.getString("label")).performClick();JSONObject()}
            "activate"->{
              val node=if(request.has("label"))compose.onNodeWithContentDescription(request.getString("label")) else compose.onNodeWithText(request.getString("text"))
              node.performSemanticsAction(SemanticsActions.OnClick){check(it())}
              JSONObject().put("semanticAction",true)
            }
            "scrollText"->{compose.onNodeWithContentDescription(request.optString("list","消息列表")).performScrollToNode(hasText(request.getString("text")));JSONObject()}
            "historySwipe"->{compose.onNodeWithContentDescription("消息列表").performTouchInput{swipeDown(durationMillis=500)};state()}
            "model"->{runBlocking(Dispatchers.Main){val service=activity.settings.services.first();val model=service.getJSONArray("models").objects().first{it.getString("modelId")==request.getString("id")};activity.settings.chooseModel(service,model)};JSONObject()}
            "tree"->JSONObject().put("tree",compose.onAllNodes(isRoot(),useUnmergedTree=true).fetchSemanticsNodes().indices.joinToString("\n"){index->compose.onAllNodes(isRoot(),useUnmergedTree=true)[index].printToString()})
            "shot"->{val name=request.getString("name");check(name.matches(Regex("[a-zA-Z0-9-]+")));main{activity.hideKeyboard()};compose.mainClock.advanceTimeBy(500);compose.waitForIdle();Thread.sleep(100);File(activity.filesDir,"$name.png").outputStream().use{out->inst.uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG,100,out)};JSONObject().put("file","$name.png")}
            "done"->{done=true;JSONObject()}
            else->error("Unknown driver action")
          }.let{compose.mainClock.advanceTimeByFrame();compose.waitForIdle();JSONObject().put("ok",true).put("result",it)}
        }catch(e:Throwable){JSONObject().put("ok",false).put("error",e.javaClass.simpleName).put("message",e.message?.take(500))}
        it.getOutputStream().write((result.toString()+"\n").toByteArray())
      }
    }}finally{server.close();main{activity.finishAndRemoveTask()}}
  }
}
