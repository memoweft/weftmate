package com.memoweft.weftmate.mobile

import android.content.Intent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Editing after hide/manual writes must use the last acknowledged service revision. */
class NativeSettingsRevisionInstrumentedTest {
    @get:Rule val compose=createEmptyComposeRule()
    private val i=InstrumentationRegistry.getInstrumentation()
    private val args=InstrumentationRegistry.getArguments()
    private lateinit var activity:NativeActivity
    private fun main(action:()->Unit)=i.runOnMainSync(action)
    private fun waitFor(label:String,test:()->Boolean){val end=System.currentTimeMillis()+30000;while(System.currentTimeMillis()<end){if(test()){compose.waitForIdle();return};Thread.sleep(80)};error("Timed out: $label")}
    private fun js(script:String):String{var result:String?=null;main{activity.embeddedWeb.evaluateJavascript(script){result=it}};val end=System.currentTimeMillis()+15000;while(result==null&&System.currentTimeMillis()<end)Thread.sleep(50);return result ?: error("JavaScript timed out")}
    private fun click(label:String)=compose.onNode(hasText(label) and hasClickAction()).performScrollTo().performClick()
    @Test fun editingAfterModelVisibilityAndManualAddition(){
        assertEquals("com.memoweft.weftmate.mobile.and9qa",i.targetContext.packageName)
        activity=i.startActivitySync(Intent(i.targetContext,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("lg1bHostOrigin",args.getString("origin"))) as NativeActivity
        waitFor("page ready"){js("Boolean(typeof state!=='undefined'&&state.booted)")=="true"}
        if(!activity.model.loggedIn){val credentials=JSONObject().put("origin",args.getString("origin")).put("username",args.getString("username")).put("password",args.getString("password")).put("deviceName","Synthetic revision test");js("call('auth.login',$credentials).then(()=>location.reload())")}
        waitFor("authenticated"){activity.model.loggedIn&&!activity.model.loading}
        main{activity.settings.open("models")};waitFor("services"){!activity.settings.loading&&activity.settings.services.isNotEmpty()}
        click("合成 MiMo 服务")
        compose.onNodeWithContentDescription("MiMo v2.6 Flash").performScrollTo().performClick();waitFor("visibility saved"){!activity.settings.busy&&activity.settings.services.first().optLong("revision")==2L}
        compose.onNodeWithContentDescription("服务名称").performScrollTo().performTextReplacement("合成修改服务")
        click("保存并重新查询");waitFor("edited after hide"){!activity.settings.busy};assertEquals("",activity.settings.error);assertEquals("合成修改服务",activity.settings.services.first().getString("name"))
        compose.onNodeWithContentDescription("模型型号").performScrollTo().performTextInput("manual-native")
        click("添加这个型号");waitFor("manual saved"){!activity.settings.busy};assertEquals("",activity.settings.error);assertTrue(activity.settings.services.first().getJSONArray("models").objects().any{it.optString("modelId")=="manual-native"})
        click("保存并重新查询");waitFor("edited after manual"){!activity.settings.busy};assertEquals("",activity.settings.error);assertEquals(5L,activity.settings.services.first().getLong("revision"))
        main{activity.settings.open("models")};waitFor("list again"){!activity.settings.loading}
        click("添加模型服务…");compose.onNodeWithContentDescription("服务名称").performTextReplacement("合成手填服务");compose.onNodeWithContentDescription("服务地址").performTextReplacement("https://manual.example/v1");compose.onNodeWithContentDescription("密钥").performTextInput("synthetic-key")
        click("查询模型并继续");waitFor("manual service"){!activity.settings.busy&&activity.settings.services.size==2};assertEquals("",activity.settings.error)
        compose.onNodeWithContentDescription("模型型号").performScrollTo().performTextInput("manual-first");click("添加这个型号");waitFor("manual default selected"){!activity.settings.busy};assertEquals("",activity.settings.error);assertEquals("manual-first",activity.settings.selected.getString("modelId"))
        click("完成");assertFalse(activity.settings.adding)
        click("添加模型服务…");compose.onNodeWithContentDescription("服务名称").performTextReplacement("合成同址服务");compose.onNodeWithContentDescription("服务地址").performTextReplacement("https://model.example/v1");compose.onNodeWithContentDescription("密钥").performTextInput("another-synthetic-key")
        click("查询模型并继续");waitFor("second credential on same address"){!activity.settings.busy&&activity.settings.services.size==3};assertEquals("",activity.settings.error);assertEquals(activity.settings.services.last().getString("serviceId"),activity.settings.selected.getString("serviceId"))
        main{activity.finish()}
    }
}
