package com.memoweft.weftmate.mobile

import android.content.Intent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Whole-window confirmation scrim includes system bars; no emulator settings are changed. */
class NativeSettingsBarsInstrumentedTest {
    @get:Rule val compose=createEmptyComposeRule()
    private val i=InstrumentationRegistry.getInstrumentation()
    private val args=InstrumentationRegistry.getArguments()
    private lateinit var activity:NativeActivity
    private fun main(action:()->Unit)=i.runOnMainSync(action)
    private fun waitFor(label:String,test:()->Boolean){val end=System.currentTimeMillis()+30000;while(System.currentTimeMillis()<end){if(test()){compose.waitForIdle();return};Thread.sleep(80)};error("Timed out: $label")}
    private fun click(label:String)=compose.onNode(hasText(label) and hasClickAction()).performScrollTo().performClick()
    private val variant get()="${args.getString("width","390")}-${args.getString("theme","light") }"
    private fun shot(name:String){compose.waitForIdle();Thread.sleep(180);val image=i.uiAutomation.takeScreenshot();java.io.File(activity.filesDir,"and9-$variant-$name.png").outputStream().use{image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}}
    @Test fun confirmationsCoverSystemBars(){
        assertEquals("com.memoweft.weftmate.mobile.and9qa",i.targetContext.packageName)
        i.targetContext.getSharedPreferences("native-qa",0).edit().putInt("width",args.getString("width","390")!!.toInt()).commit()
        activity=i.startActivitySync(Intent(i.targetContext,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("lg1bHostOrigin",args.getString("origin"))) as NativeActivity
        main{activity.model.launch{activity.model.call("auth.login",JSONObject().put("origin",args.getString("origin")).put("username",args.getString("username")).put("password",args.getString("password")).put("deviceName","Synthetic bars test"));activity.embeddedWeb.reload();while(activity.model.loading)kotlinx.coroutines.delay(50);activity.model.bootstrap()}}
        waitFor("authenticated"){activity.model.loggedIn&&!activity.model.loading}
        main{activity.model.launch{activity.model.call("settings.appearance",JSONObject().put("value",args.getString("theme","light")));activity.model.dark=args.getString("theme")=="dark";activity.settings.open("devices")}}
        waitFor("settings ready"){!activity.settings.loading&&activity.settings.home.length()>0}
        main{activity.settings.device=JSONObject().put("name","合成轻薄本").put("id","synthetic-computer").put("hostId","synthetic-laptop")}
        click("移除设备");shot("remove-computer-confirm");compose.onNode(hasText("取消") and hasClickAction()).performClick()
        main{activity.settings.open("models")};waitFor("services"){!activity.settings.loading&&activity.settings.services.isNotEmpty()}
        main{activity.settings.editingService=activity.settings.services.first()}
        click("删除模型服务");shot("delete-service-confirm");compose.onNode(hasText("删除模型服务") and hasClickAction()).performClick();waitFor("deleted after confirmation"){!activity.settings.busy&&activity.settings.services.isEmpty()};assertEquals("",activity.settings.error)
        main{activity.finish()}
    }
}
