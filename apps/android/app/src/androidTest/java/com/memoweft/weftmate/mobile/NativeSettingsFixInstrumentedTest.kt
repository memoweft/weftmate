package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import android.view.WindowInsets
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class NativeSettingsFixInstrumentedTest {
    @get:Rule val compose=createEmptyComposeRule()
    private val i=InstrumentationRegistry.getInstrumentation()
    private val args=InstrumentationRegistry.getArguments()
    private lateinit var activity:NativeActivity
    private var web:android.webkit.WebView?=null
    private val variant get()="${args.getString("width","390")}-${args.getString("theme","light") }"
    private fun main(action:()->Unit)=i.runOnMainSync(action)
    private fun waitFor(label:String,test:()->Boolean){val end=System.currentTimeMillis()+30000;while(System.currentTimeMillis()<end){val ok=test();if(ok){compose.waitForIdle();return};Thread.sleep(80)};error("Timed out: $label")}
    private fun js(script:String):String{var result:String?=null;main{(web ?: activity.embeddedWeb).evaluateJavascript(script){result=it}};val end=System.currentTimeMillis()+15000;while(result==null&&System.currentTimeMillis()<end)Thread.sleep(50);return result ?: error("JavaScript timed out")}
    private fun node(label:String)=compose.onAllNodes(hasText(label) and hasClickAction()).onLast()
    private fun click(label:String){node(label).performScrollTo().performClick()}
    private fun shot(name:String){if(web==null)compose.waitForIdle();Thread.sleep(200);val image=i.uiAutomation.takeScreenshot();File(activity.filesDir,"and9-$variant-$name.png").outputStream().use{image.compress(Bitmap.CompressFormat.PNG,100,it)}}
    private fun command(action:String):JSONObject{val c=URL(args.getString("origin")+"/__and9/$action").openConnection() as HttpURLConnection;try{return JSONObject(c.inputStream.bufferedReader().readText())}finally{c.disconnect()}}
    private fun open(page:String,expectError:Boolean=false){main{activity.settings.open(page)};waitFor(page){!activity.settings.loading};if(!expectError)assertEquals("",activity.settings.error)}
    private fun original(page:String,name:String,extra:String=""){
        val old=i.startActivitySync(Intent(i.targetContext,HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("lg1bHostOrigin",args.getString("origin"))) as HybridActivity
        web=old.embeddedWeb
        waitFor("original booted"){js("Boolean(typeof state!=='undefined'&&state.booted&&state.loggedIn)")=="true"}
        js("applyTheme('${args.getString("theme","light")}');page('$page')");Thread.sleep(700)
        if(extra.isNotEmpty()){js(extra);Thread.sleep(300)}
        val metrics=js("""JSON.stringify([...document.querySelectorAll('.settings-account-card,.settings-usage-strip,.settings-search,.settings-list .group,.settings-list .row,.group-body,.page-title,.appearance-mode-row')].map(el=>{const style=getComputedStyle(el),r=el.getBoundingClientRect();return {className:el.className,text:el.textContent.slice(0,80),x:r.x,y:r.y,width:r.width,height:r.height,background:style.backgroundColor,border:style.borderWidth,radius:style.borderRadius,padding:style.padding,font:style.fontSize,lineHeight:style.lineHeight}}))""")
        File(activity.filesDir,"and9-$variant-web-$name-metrics.json").writeText(metrics)
        shot("web-$name");web=null;main{old.finish()};waitFor("native resumed"){activity.nativeForeground}
    }
    @Test fun settingsVisualRepairFlow(){
        assertEquals("com.memoweft.weftmate.mobile.and9qa",i.targetContext.packageName)
        val context=i.targetContext;context.getSharedPreferences("native-qa",0).edit().putInt("width",args.getString("width","390")!!.toInt()).commit()
        main{android.webkit.WebView.setWebContentsDebuggingEnabled(true)}
        activity=i.startActivitySync(Intent(context,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("lg1bHostOrigin",args.getString("origin"))) as NativeActivity
        waitFor("page booted"){js("Boolean(typeof state!=='undefined'&&state.booted)")=="true"}
        if(!activity.model.loggedIn){val p=JSONObject().put("origin",args.getString("origin")).put("username",args.getString("username")).put("password",args.getString("password")).put("deviceName","Synthetic Android");js("call('auth.login',$p).then(()=>location.reload())")}
        waitFor("native authenticated"){activity.model.loggedIn&&!activity.model.loading&&activity.model.rows.isNotEmpty()}
        main{activity.model.launch{activity.model.call("settings.appearance",JSONObject().put("value",args.getString("theme","light")));activity.model.dark=args.getString("theme")=="dark"}}
        js("state.appearance='${args.getString("theme","light")}';mobileAppearanceStore.set({...mobileAppearanceStore.value,fontSize:'15',codeFontSize:'13'});applyTheme(state.appearance)");main{activity.model.textSize=DesignTokens.font15;activity.model.codeSize=DesignTokens.font13}
        for((page,label) in listOf("" to "settings-home","general" to "general","models" to "services","account" to "account","devices" to "devices","appearance" to "appearance")) {
            open(page);shot(label);original(if(page.isEmpty())"settings" else page,label)
            if(page=="models"){compose.onNodeWithContentDescription("更多").performClick();compose.onNodeWithText("账户云模型").assertExists();shot("services-more");node("刷新").performClick();waitFor("services refreshed"){!activity.settings.loading}}
            if(page=="appearance"){compose.onNodeWithContentDescription("颜色模式：跟随系统").assertExists()}
        }
        open("")
        compose.onNodeWithContentDescription("搜索设置").performClick().performTextInput("个性化")
        node("个性化").assertExists();compose.onNodeWithText("回顾与健康").assertDoesNotExist()
        compose.onNodeWithContentDescription("搜索设置").performTextReplacement("")
        compose.onNodeWithContentDescription("用量详情").performClick()
        assertEquals("usage",activity.settings.webPage);main{activity.settings.back()}
        compose.onNodeWithContentDescription("使用原生聊天界面").assertDoesNotExist()
        File(activity.filesDir,"and9-$variant-fix-done.json").writeText(JSONObject().put("passed",true).put("widthDp",args.getString("width")).put("pageTheme",args.getString("theme")).put("systemSdk",android.os.Build.VERSION.SDK_INT).toString())
        main{activity.finish()}
    }
}
