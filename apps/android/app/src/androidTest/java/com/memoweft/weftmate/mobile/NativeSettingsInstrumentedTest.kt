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

class NativeSettingsInstrumentedTest {
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
        shot("web-$name");web=null;main{old.finish()};waitFor("native resumed"){activity.nativeForeground}
    }
    @Test fun settingsAndServiceFlow(){
        assertEquals("com.memoweft.weftmate.mobile.and9qa",i.targetContext.packageName)
        val context=i.targetContext;context.getSharedPreferences("native-qa",0).edit().putInt("width",args.getString("width","390")!!.toInt()).commit()
        main{android.webkit.WebView.setWebContentsDebuggingEnabled(true)}
        activity=i.startActivitySync(Intent(context,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("lg1bHostOrigin",args.getString("origin"))) as NativeActivity
        waitFor("page booted"){js("Boolean(typeof state!=='undefined'&&state.booted)")=="true"}
        if(!activity.model.loggedIn){val p=JSONObject().put("origin",args.getString("origin")).put("username",args.getString("username")).put("password",args.getString("password")).put("deviceName","Synthetic Android");js("call('auth.login',$p).then(()=>location.reload())")}
        waitFor("native authenticated"){activity.model.loggedIn&&!activity.model.loading&&activity.model.rows.isNotEmpty()}
        main{activity.model.launch{activity.model.call("settings.appearance",JSONObject().put("value",args.getString("theme","light")));activity.model.dark=args.getString("theme")=="dark"}}
        js("state.appearance='${args.getString("theme","light")}';mobileAppearanceStore.set({...mobileAppearanceStore.value,fontSize:'15',codeFontSize:'13'});applyTheme(state.appearance)");main{activity.model.textSize=DesignTokens.font15;activity.model.codeSize=DesignTokens.font13}
        compose.onNodeWithContentDescription("消息输入").performClick().performTextReplacement("下一条保留草稿")
        Thread.sleep(500)
        var imeBefore=0;main{imeBefore=activity.window.decorView.rootWindowInsets.getInsets(WindowInsets.Type.ime()).bottom}
        compose.onNodeWithContentDescription("模型：${activity.model.modelLabel}").performClick()
        waitFor("services loaded"){activity.settings.services.isNotEmpty()};shot("model-menu")
        compose.onNodeWithText("合成 MiMo 服务").assertDoesNotExist()
        compose.onNodeWithContentDescription("消息输入").assertIsFocused()
        compose.onNodeWithContentDescription("深度思考").performClick();waitFor("thinking saved"){!activity.settings.busy};assertTrue(command("inspect").getBoolean("thinking"));shot("thinking-on")
        node("MiMo v2.6 Pro").performClick();waitFor("model selected"){!activity.settings.menuVisible&&!activity.settings.busy}
        assertEquals("synthetic-1",activity.model.modelId);assertEquals("下一条保留草稿",activity.model.draft)
        compose.onNodeWithContentDescription("消息输入").assertIsFocused()
        main{if(imeBefore>0)assertTrue(activity.window.decorView.rootWindowInsets.getInsets(WindowInsets.Type.ime()).bottom>0)}
        assertEquals("synthetic-1",command("inspect").getString("selected"))
        // A running reply keeps its actual binding; only the next-message projection changes.
        command("running");main{activity.model.launch{activity.model.refresh()}};waitFor("running reply"){activity.model.running}
        compose.onNodeWithContentDescription("模型：${activity.model.modelLabel}").performClick();node("MiMo v2.6 Flash").performClick();waitFor("switch while running"){!activity.settings.busy&&!activity.settings.menuVisible};assertTrue(activity.model.running);assertEquals("synthetic-1",command("inspect").getString("inFlightModel"));assertEquals("synthetic",activity.model.modelId)
        compose.onNodeWithContentDescription("模型：${activity.model.modelLabel}").performClick();node("全部模型").performClick();compose.onNodeWithContentDescription("搜索模型").performClick().performTextInput("chat-15");shot("all-models-search");node("合成型号 15").performClick();waitFor("searched selection"){!activity.settings.busy&&!activity.settings.menuVisible};assertEquals("synthetic-15",activity.model.modelId);compose.onNodeWithContentDescription("消息输入").assertIsFocused()
        command("idle");main{activity.model.launch{activity.model.refresh()}};waitFor("reply idle"){!activity.model.running}
        compose.onNodeWithContentDescription("模型：${activity.model.modelLabel}").performClick();waitFor("selected menu read"){activity.settings.menuVisible};shot("model-menu-selected");original("chat","model-menu-selected","openHostModelServices()");main{activity.settings.menuVisible=false}
        open("");shot("settings-home");original("settings","settings-home")
        compose.onNodeWithText("使用原生聊天界面").assertDoesNotExist();assertTrue(activity.settings.home.getJSONArray("categories").objects().any{it.optString("id")=="data"})
        open("general");shot("general");original("general","general")
        open("appearance");shot("appearance");compose.onNodeWithText("大 · 17").assertDoesNotExist();compose.onNodeWithContentDescription("选择字号：标准 · 15").performScrollTo().performClick();shot("font-menu");node("大 · 17").performClick();waitFor("appearance saved"){!activity.settings.busy};assertEquals(17f,activity.model.textSize)
        open("account");shot("account");compose.onNodeWithContentDescription("昵称").performTextReplacement("合成使用者");click("保存昵称");waitFor("profile saved"){!activity.settings.busy&&!activity.settings.loading};assertEquals("",activity.settings.error)
        // Existing multi-computer engine is a deterministic synthetic directory here.
        js("""(()=>{window.and9Directory={capabilities:{multiHost:1},hosts:[{hostId:'desk',name:'合成台式机',online:true},{hostId:'laptop',name:'合成笔记本',online:false}],devices:[{id:'phone',name:'合成手机',isCurrent:true}]};uiCore.state.cloudAuth.mode='authenticated';uiCore.state.cloudAuth.multiHostSupported=true;uiCore.cloudDirectory=async()=>window.and9Directory;uiCore.cloudRenameComputer=async(id,name)=>{window.and9Directory.hosts.find(x=>x.hostId===id).name=name;return window.and9Directory};uiCore.cloudRemoveComputer=async id=>{window.and9Directory.hosts=window.and9Directory.hosts.filter(x=>x.hostId!==id);return window.and9Directory};return true})()""")
        open("devices");shot("devices");click("合成笔记本");compose.onNodeWithContentDescription("设备名称").performTextReplacement("合成轻薄本");click("保存名称");waitFor("computer renamed"){!activity.settings.busy&&!activity.settings.loading&&activity.settings.device==null};compose.onNodeWithText("合成轻薄本").assertExists();click("合成轻薄本");click("移除设备");shot("remove-computer-confirm");node("取消").performClick();assertEquals(2,activity.settings.directory.getJSONArray("hosts").length());click("移除设备");node("移除设备").performClick();waitFor("computer removed"){!activity.settings.busy&&!activity.settings.loading};assertEquals(1,activity.settings.directory.getJSONArray("hosts").length())
        js("uiCore.state.cloudAuth.mode='offline'")
        open("about");shot("about")
        open("models");shot("services");original("models","services");compose.onNodeWithContentDescription("更多").performClick();shot("models-more-menu");node("账户云模型").performClick();waitFor("cloud model web"){activity.settings.webPage=="models"};Thread.sleep(700);shot("cloud-models");main{activity.settings.back()}
        click("合成 MiMo 服务");shot("service-editor");click("重新查询模型");waitFor("catalog refreshed"){!activity.settings.busy};compose.onNodeWithText("显示的模型").assertExists()
        main{activity.settings.back()};click("添加模型服务…");shot("add-service");original("models","add-service","document.querySelector('.wm-model-service-editor')?.scrollIntoView({block:'start'})");compose.onNodeWithContentDescription("选择服务：MiMo").performClick();shot("preset-menu");node("自定义").performClick();compose.onNodeWithContentDescription("选择接口类型：OpenAI 兼容").performScrollTo().performClick();shot("interface-menu");node("OpenAI 兼容").performClick();compose.onNodeWithContentDescription("服务名称").performTextReplacement("合成新服务");compose.onNodeWithContentDescription("服务地址").performTextReplacement("https://second.example/v1");compose.onNodeWithContentDescription("密钥").performTextInput("synthetic-key");click("查询模型并继续");waitFor("new service queried"){!activity.settings.busy&&activity.settings.services.size==2};assertEquals("mimo-v2.6-flash",activity.settings.selected.optString("modelId"));shot("new-service-models");click("完成");assertFalse(activity.settings.adding)
        click("合成新服务");click("删除模型服务");shot("delete-service-confirm");node("删除模型服务").performClick();waitFor("deleted"){!activity.settings.busy&&activity.settings.services.size==1}
        command("empty");open("models");shot("services-empty");original("models","services-empty")
        command("failure");open("models",expectError=true);shot("services-error");assertTrue(activity.settings.error.isNotEmpty());command("recover");node("重试").performClick();waitFor("retried"){!activity.settings.loading};assertEquals("",activity.settings.error)
        command("legacy");open("models");assertTrue(activity.settings.legacy);shot("legacy-settings")
        command("reset")
        // Phone-only model pages use the actual encrypted native bridge and engine.
        val secrets=SecureSettings(activity);val host=secrets.host()!!;val previousCredentials=secrets.appValue("credentials");val previousPhone=secrets.appValue("phone-account")
        secrets.saveAppValue("credentials",JSONObject().put("app-tokens:and9",JSONObject().put("sub",host.ownerId)).toString())
        val phone=JSONObject().put("origin",args.getString("origin")).put("accountId",host.ownerId).put("email","synthetic@example.test").put("deviceId",host.deviceId)
        js("WeftPhone.start($phone,{authorized:async()=>({devices:[{id:'phone',isCurrent:true}],hosts:[]})}).then(()=>window.and9PhoneReady=true).catch(e=>window.and9PhoneFailure=String(e))")
        waitFor("phone engine ready"){js("Boolean(window.and9PhoneReady)")=="true"}
        main{activity.model.launch{activity.model.bootstrap();activity.model.newChat()}}
        waitFor("phone native chat"){activity.model.standalone&&!activity.model.loading&&activity.model.chatId=="phone-new"}
        open("models");assertTrue(activity.settings.services.isEmpty());shot("phone-services-empty")
        click("添加模型服务…");compose.onNodeWithContentDescription("服务名称").performTextReplacement("手机合成服务");compose.onNodeWithContentDescription("服务地址").performTextReplacement(args.getString("origin")+"/v1");compose.onNodeWithContentDescription("密钥").performTextInput("synthetic-phone-key");click("查询模型并继续")
        waitFor("phone service queried"){!activity.settings.busy&&activity.settings.services.size==1};assertEquals("",activity.settings.error);assertEquals(2,activity.settings.services.single().getJSONArray("models").length());shot("phone-service-editor");click("完成")
        main{activity.settings.back();activity.model.returnToChat()};waitFor("phone chat returned"){activity.model.tab=="chat"}
        compose.onNodeWithContentDescription("消息输入").performClick().performTextReplacement("手机草稿")
        compose.onNodeWithContentDescription("模型：${activity.model.modelLabel}").performClick();waitFor("phone menu"){activity.settings.menuVisible};shot("phone-model-menu");node("手机专业模型").performClick();waitFor("phone selected"){!activity.settings.busy&&!activity.settings.menuVisible}
        assertEquals("phone-pro",SecureSettings(activity).model(Endpoints.ownerKey(host.origin,host.ownerId))?.modelId)
        assertEquals("手机草稿",activity.model.draft)
        File(activity.filesDir,"and9-$variant-done.json").writeText(JSONObject().put("passed",true).put("widthDp",args.getString("width")).put("pageTheme",args.getString("theme")).put("systemSdk",android.os.Build.VERSION.SDK_INT).put("imeHeightBefore",imeBefore).put("keyboardKept",imeBefore>0).put("phoneServices",true).put("multiComputer","synthetic existing engine functions").toString())
        PhoneAccount(activity,secrets).models("serviceRemove",JSONObject().put("serviceId",activity.settings.services.single().getString("serviceId")))
        secrets.saveHost(host);secrets.saveAppValue("credentials",previousCredentials);secrets.saveAppValue("phone-account",previousPhone)
        main{activity.finish()}
    }
}
