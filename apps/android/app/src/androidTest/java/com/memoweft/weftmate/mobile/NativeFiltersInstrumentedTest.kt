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

/** The additional page-filter acceptance shares the disposable AND-6 package and account. */
class NativeFiltersInstrumentedTest {
    @get:Rule val compose=createEmptyComposeRule()
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val args=InstrumentationRegistry.getArguments()
    private lateinit var activity:NativeActivity
    private val theme get()=args.getString("and6Theme","light")
    private fun main(action:()->Unit)=instrumentation.runOnMainSync(action)
    private fun js(web:android.webkit.WebView,script:String):String {var result:String?=null;main{web.evaluateJavascript(script){result=it}};val end=System.currentTimeMillis()+10000;while(result==null&&System.currentTimeMillis()<end)Thread.sleep(50);return result ?: error("javascript timed out")}
    private fun waitFor(label:String,condition:()->Boolean){val end=System.currentTimeMillis()+30000;while(System.currentTimeMillis()<end){if(condition()){compose.waitForIdle();if(condition())return};Thread.sleep(100)};error("Timed out: $label")}
    private fun shot(name:String){compose.waitForIdle();Thread.sleep(300);val image=instrumentation.uiAutomation.takeScreenshot();assertNotNull(image);File(activity.filesDir,"and6-390-$theme-$name.png").outputStream().use{image.compress(Bitmap.CompressFormat.PNG,100,it)}}
    @Test fun pageFiltersStayInOneRow(){
        val context=instrumentation.targetContext;check(context.packageName=="com.memoweft.weftmate.mobile.and6qa")
        context.getSharedPreferences("native-ui",0).edit().putBoolean("enabled",true).commit();context.getSharedPreferences("native-qa",0).edit().putInt("width",390).commit()
        activity=instrumentation.startActivitySync(Intent(context,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("lg1bHostOrigin",args.getString("and6Origin"))) as NativeActivity
        waitFor("booted"){js(activity.embeddedWeb,"Boolean(typeof state!=='undefined' && state.booted)")=="true"}
        if(!activity.model.loggedIn){val credentials=JSONObject().put("origin",args.getString("and6Origin")).put("username",args.getString("and6Username")).put("password",args.getString("and6Password")).put("deviceName","Synthetic Android");js(activity.embeddedWeb,"call('auth.login',$credentials).then(()=>location.reload())")}
        waitFor("signed in"){activity.model.loggedIn&&!activity.model.loading&&activity.model.rows.isNotEmpty()}
        main{activity.model.launch{activity.model.call("settings.appearance",JSONObject().put("value",theme));activity.model.dark=theme=="dark"}}
        compose.onNodeWithContentDescription("动态",useUnmergedTree=true).performClick();waitFor("feed"){!activity.feed.loading&&activity.feed.items.isNotEmpty()}
        compose.onNodeWithText("全部").assertIsSelected();for(name in listOf("待处理","任务","提醒","记忆"))compose.onNodeWithText(name).assertExists()
        compose.onNodeWithText("记忆").performScrollTo().performClick();waitFor("memory filter"){activity.feed.filter=="memory"&&!activity.feed.loading};compose.onNodeWithText("记忆").assertIsSelected();compose.onNodeWithText("全部").performScrollTo().performClick();waitFor("all filter"){activity.feed.filter=="all"&&!activity.feed.loading};shot("feed-filters")
        // Capture the actual previous shell, not a browser viewport or a control-spec mockup.
        val webActivity=instrumentation.startActivitySync(Intent(context,HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("lg1bHostOrigin",args.getString("and6Origin"))) as HybridActivity
        waitFor("old shell booted"){js(webActivity.embeddedWeb,"Boolean(typeof state!=='undefined'&&state.booted&&state.loggedIn)")=="true"}
        js(webActivity.embeddedWeb,"applyTheme('$theme');page('activity')")
        waitFor("old feed loaded"){js(webActivity.embeddedWeb,"Boolean(document.querySelector('.activity-filters')&&uiCore.activity.items.length)")=="true"};shot("web-feed-filters")
        main{webActivity.finish();activity.finish()}
    }
}
