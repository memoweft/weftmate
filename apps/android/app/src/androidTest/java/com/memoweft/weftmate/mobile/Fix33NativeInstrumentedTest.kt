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

class Fix33NativeInstrumentedTest {
    @get:Rule val compose=createEmptyComposeRule()
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val args=InstrumentationRegistry.getArguments()
    private lateinit var activity:NativeActivity
    private fun onMain(action:()->Unit)=instrumentation.runOnMainSync(action)
    private fun waitFor(label:String,condition:()->Boolean){val end=System.currentTimeMillis()+20000;while(System.currentTimeMillis()<end){var ready=false;onMain{ready=condition()};if(ready)return;Thread.sleep(50)};error("Timed out: $label")}
    private fun shot(name:String){compose.waitForIdle();val image=instrumentation.uiAutomation.takeScreenshot();File(activity.filesDir,"fix33-${args.getString("version") }-$name.png").outputStream().use{image.compress(Bitmap.CompressFormat.PNG,100,it)}}
    @Test fun connectedNewChatAndFourMessagesUseTheComputer() {
        check(instrumentation.targetContext.packageName=="com.memoweft.weftmate.mobile.and4qa")
        activity=instrumentation.startActivitySync(Intent(instrumentation.targetContext,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("lg1bHostOrigin",args.getString("origin"))) as NativeActivity
        var booted=false
        waitFor("embedded login ready"){activity.embeddedWeb.evaluateJavascript("Boolean(typeof state!=='undefined' && state.booted)"){booted=it=="true"};booted};shot("login")
        val credentials=JSONObject().put("origin",args.getString("origin")).put("username",args.getString("username")).put("password",args.getString("password")).put("deviceName","synthetic-phone")
        onMain{activity.embeddedWeb.evaluateJavascript("call('auth.login',$credentials).then(()=>location.reload())",null)}
        waitFor("native connected"){activity.model.loggedIn && !activity.model.loading && activity.model.chatId.isNotBlank()};shot("connected")
        val old=activity.model.chatId
        onMain{activity.model.newChat()}
        waitFor("new conversation belongs to computer"){activity.model.chatId!=old && !activity.model.phone && activity.model.sessionId.isNotBlank()}
        assertFalse(activity.model.standalone);shot("new-on-computer")
        val report=JSONObject().put("version",args.getString("version")).put("phone",activity.model.phone)
        val rows=org.json.JSONArray()
        for(i in 1..4){val text="FIX33_NATIVE_$i";val begin=System.currentTimeMillis();onMain{activity.model.edit(text)};compose.onNodeWithContentDescription("发送消息").performClick()
            waitFor("computer reply $i"){activity.model.rows.any{it.optString("type")=="assistant.message" && it.optJSONObject("data")?.optString("text")?.contains(text)==true}}
            rows.put(JSONObject().put("index",i).put("visibleMs",System.currentTimeMillis()-begin));assertTrue(activity.model.uncertain.isEmpty());shot("reply-$i")
        }
        report.put("messages",rows);File(activity.filesDir,"fix33-${args.getString("version")}-native.json").writeText(report.toString(2));onMain{activity.finish()}
    }
}
