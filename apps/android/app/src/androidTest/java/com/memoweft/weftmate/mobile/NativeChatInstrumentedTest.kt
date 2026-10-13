package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.net.Uri
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
import java.io.File

/** Full production UI + original native network; only the package/account/files are synthetic. */
class NativeChatInstrumentedTest {
    @get:Rule val compose = createEmptyComposeRule()
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val args=InstrumentationRegistry.getArguments()
    private lateinit var activity:NativeActivity
    private val variant get()="${args.getString("and4Width","360")}-${args.getString("and4Theme","light") }"
    private fun onMain(action:()->Unit)=instrumentation.runOnMainSync(action)
    private fun waitFor(label:String,condition:()->Boolean){val end=System.currentTimeMillis()+30000;while(System.currentTimeMillis()<end){var ok=false;onMain{ok=condition()};if(ok)return;Thread.sleep(100)};error("Timed out: $label")}
    private fun shot(name:String){compose.waitForIdle();Thread.sleep(350);val image=instrumentation.uiAutomation.takeScreenshot();assertNotNull(image);File(activity.filesDir,"and4-$variant-$name.png").outputStream().use{image.compress(Bitmap.CompressFormat.PNG,100,it)}}
    private fun send(text:String){onMain{activity.model.edit(text)};compose.onNodeWithContentDescription("发送消息").performClick()}
    @Test fun nativeChatFlow(){
        check(instrumentation.targetContext.packageName=="com.memoweft.weftmate.mobile.and4qa")
        instrumentation.targetContext.getSharedPreferences("native-chat",0).edit().clear().commit()
        instrumentation.targetContext.getSharedPreferences("native-qa",0).edit().putInt("width",args.getString("and4Width","360").toInt()).commit()
        onMain{android.webkit.WebView.setWebContentsDebuggingEnabled(true)}
        activity=instrumentation.startActivitySync(Intent(instrumentation.targetContext,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("lg1bHostOrigin",args.getString("and4Origin")).putExtra("and4Width",args.getString("and4Width","360").toInt())) as NativeActivity
        waitFor("web login available"){activity.embeddedWeb.progress==100};shot("login")
        var booted=false
        waitFor("web booted"){activity.embeddedWeb.evaluateJavascript("Boolean(typeof state!=='undefined' && state.booted)"){booted=it=="true"};booted}
        val credentials=JSONObject().put("origin",args.getString("and4Origin")).put("username",args.getString("and4Username")).put("password",args.getString("and4Password")).put("deviceName","Synthetic Android")
        onMain{activity.embeddedWeb.evaluateJavascript("call('auth.login',${credentials}).then(()=>location.reload()).catch(e=>{window.and4LoginError=e.code||e.message})",null)}
        waitFor("native signed in"){activity.model.loggedIn && !activity.model.loading && activity.model.chatId.isNotBlank() && activity.model.rows.isNotEmpty()}
        onMain{activity.model.launch{activity.model.call("settings.appearance",JSONObject().put("value",args.getString("and4Theme","light")));activity.model.dark=args.getString("and4Theme")=="dark";activity.embeddedWeb.evaluateJavascript("applyTheme('${args.getString("and4Theme","light")}')",null)}}
        Thread.sleep(700)
        if(args.getString("and4MetricSetup")=="1")return
        compose.onNodeWithContentDescription("语音输入").assertExists();shot("capsule")
        compose.onNodeWithContentDescription("消息输入").performClick();shot("focused")
        compose.onNodeWithContentDescription("消息输入").performTextInput("草稿保持展开")
        onMain{activity.hideKeyboard()};shot("draft")
        compose.onNodeWithContentDescription("模型：MiMo v2.6 Flash").performClick();compose.onNodeWithText("MiMo v2.6 Flash").assertExists();shot("model-menu")
        compose.onNodeWithText("MiMo v2.6 Flash").performClick()
        compose.onNodeWithContentDescription("审批方式：自动").performClick();compose.onNodeWithText("每次询问").assertExists();shot("mode-menu");compose.onNodeWithText("自动").performClick()
        compose.onNodeWithContentDescription("添加附件").performClick();compose.onNodeWithText("照片").assertExists();shot("plus-menu");onMain{activity.hideKeyboard()};instrumentation.uiAutomation.performGlobalAction(1)
        onMain{activity.model.edit("");activity.model.focused=false}
        send("合成流式")
        waitFor("stream snapshot"){activity.model.rows.any{it.optString("type")=="assistant.delta"}};shot("stream")
        waitFor("stream finalized"){!activity.model.running && activity.model.rows.any{it.optString("type")=="assistant.message"&&it.optJSONObject("data")?.optString("text")?.contains("收到。") == true}}
        if(args.getString("and4Regression")=="1") {
            send("三项审批");waitFor("three approval"){activity.model.approvals.any{it.optBoolean("canAlwaysAllow")}};Thread.sleep(700);shot("approval-three")
            compose.onNodeWithText("以后这类都允许").performClick();compose.onNodeWithText("确认",useUnmergedTree=true).performClick()
            waitFor("approval consumed"){activity.model.approvals.any{it.optString("status")!="pending"}};shot("approval-receipt")
            onMain{activity.startActivity(Intent(activity,MainActivity::class.java))};Thread.sleep(900);shot("compat-native-connection")
            onMain{activity.finish()};return
        }
        // System picker test substitute: import synthetic URIs into the production AttachmentStore.
        val syntheticFiles=File(activity.cacheDir,"composer-camera").apply{mkdirs()}
        val png=File(syntheticFiles,"synthetic-image.png");val bitmap=Bitmap.createBitmap(320,200,Bitmap.Config.ARGB_8888);Canvas(bitmap).drawColor(Color.rgb(150,175,157));png.outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle()
        val txt=File(syntheticFiles,"synthetic-note.txt").apply{writeText("本周计划：整理记录，留出休息时间。")}
        val store=LocalStore(activity);val attachments=AttachmentStore(activity,store)
        attachments.import(androidx.core.content.FileProvider.getUriForFile(activity,"${activity.packageName}.composer-camera",png),activity.model.owner,activity.model.chatId,"image");attachments.import(androidx.core.content.FileProvider.getUriForFile(activity,"${activity.packageName}.composer-camera",txt),activity.model.owner,activity.model.chatId,"file")
        onMain{activity.model.launch{activity.model.refreshAttachments()}};waitFor("two attachments"){activity.model.attachments.size==2};shot("attachments")
        compose.onNodeWithContentDescription("移除附件：synthetic-note.txt").assertExists()
        compose.onNodeWithText("synthetic-image.png",substring=true).let{ /* image accessible via content description */ }
        compose.onNodeWithContentDescription("synthetic-image.png").performClick();shot("image-preview");compose.onNodeWithContentDescription("关闭预览").performClick()
        send("请读取这两个合成附件");waitFor("attachments accepted"){activity.model.attachments.isEmpty()};Thread.sleep(2500);shot("sent-attachments")
        send("两按钮审批");waitFor("pending approval"){activity.model.approvals.any{it.optString("status")=="pending"}};Thread.sleep(700);shot("approval-two");compose.onNodeWithText("批准",useUnmergedTree=true).performClick();waitFor("approval registered"){activity.model.approvals.any{it.optString("status")!="pending"}};shot("receipt")
        send("三项审批");waitFor("three approval"){activity.model.approvals.any{it.optBoolean("canAlwaysAllow")}};Thread.sleep(700);shot("approval-three");compose.onNodeWithText("以后这类都允许").performClick();compose.onNodeWithText("确认",useUnmergedTree=true).performClick()
        send("三选一");waitFor("question"){activity.model.questions.isNotEmpty()};Thread.sleep(700);shot("question");compose.onNodeWithText("本周计划").performClick();compose.onNodeWithText("确认选择").performClick();waitFor("question registered"){activity.model.questions[0].optString("status")!="pending"}
        for(tab in listOf("动态","健康","目标","成果库","聊天")){compose.onNodeWithContentDescription(tab).performClick();Thread.sleep(1100);shot("tab-$tab")}
        compose.onNodeWithContentDescription("更多").performClick();shot("overflow-menu");compose.onNodeWithText("设置").performClick();Thread.sleep(800);shot("settings")
        onMain{activity.model.tab="chat"};compose.onNodeWithContentDescription("打开侧栏").performClick();Thread.sleep(500);shot("sidebar");instrumentation.uiAutomation.performGlobalAction(1)
        if(args.getString("and4Mimo")=="1"){send("真实流式");waitFor("MiMo reply"){activity.model.running};waitFor("MiMo complete"){!activity.model.running};shot("mimo")}
        onMain{activity.model.edit("重开保留的草稿")};shot("retained-draft")
        onMain{activity.model.tab="settings"}
        onMain{activity.fallback()}
        Thread.sleep(1400)
        assertFalse(instrumentation.targetContext.getSharedPreferences("native-ui",0).getBoolean("enabled",true))
        shot("legacy-entry")
        val visible=WeftMateApplication::class.java.getDeclaredField("visible").apply{isAccessible=true}
        var legacy:HybridActivity?=null
        onMain{legacy=(visible.get(instrumentation.targetContext.applicationContext) as Set<*>).filterIsInstance<HybridActivity>().firstOrNull{it !is NativeActivity}}
        assertNotNull("Legacy activity is visible",legacy)
        onMain{legacy!!.embeddedWeb.evaluateJavascript("call('native.presentation',{enabled:true})",null)}
        Thread.sleep(1400)
        assertTrue(instrumentation.targetContext.getSharedPreferences("native-ui",0).getBoolean("enabled",false))
        File(activity.filesDir,"and4-$variant-done.json").writeText(JSONObject().put("variant",variant).put("density",activity.resources.displayMetrics.density).put("widthDp",activity.resources.configuration.screenWidthDp).put("navigationBottom",androidx.core.view.ViewCompat.getRootWindowInsets(activity.presentationContainer)?.getInsets(androidx.core.view.WindowInsetsCompat.Type.navigationBars())?.bottom ?: -1).put("passed",true).toString())
    }
}
