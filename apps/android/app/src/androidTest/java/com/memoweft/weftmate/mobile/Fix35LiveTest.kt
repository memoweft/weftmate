package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Explicitly authorized, existing login only. Reports contain no account or device identifiers. */
class Fix35LiveTest {
    private val i=InstrumentationRegistry.getInstrumentation()
    private lateinit var a:NativeActivity
    private val report=JSONObject()
    private fun main(work:()->Unit){if(android.os.Looper.myLooper()==android.os.Looper.getMainLooper())work() else i.runOnMainSync(work)}
    private fun waitFor(label:String,timeout:Long=25000,test:()->Boolean) {
        val until=System.currentTimeMillis()+timeout
        while(System.currentTimeMillis()<until){var ok=false;main{ok=test()};if(ok)return;Thread.sleep(50)}
        error("Timed out: $label")
    }
    private fun start(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("fix35LiveAccount")=="authorized")
        check(i.targetContext.packageName=="com.memoweft.weftmate.mobile.debug")
        main{android.webkit.WebView.setWebContentsDebuggingEnabled(true)}
        a=i.startActivitySync(Intent(i.targetContext,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as NativeActivity
        waitFor("restored native login",60000){a.model.loggedIn&&!a.model.loading&&a.model.chats.isNotEmpty()}
        report.put("authorizedExistingLogin",true)
    }
    private fun shot(name:String){
        Thread.sleep(250)
        val image=i.uiAutomation.takeScreenshot();check(image!=null)
        File(a.filesDir,"fix35-$name.png").outputStream().use{image.compress(Bitmap.CompressFormat.PNG,100,it)}
    }
    private fun save(name:String){File(a.filesDir,"fix35-$name.json").writeText(report.toString(2))}
    private fun js(web:android.webkit.WebView,source:String):String {
        val done=CountDownLatch(1);var value=""
        main{web.evaluateJavascript(source){value=it;done.countDown()}}
        check(done.await(10,TimeUnit.SECONDS));return value
    }
    private fun legacy():HybridActivity? {
        var found:HybridActivity?=null
        main{val field=WeftMateApplication::class.java.getDeclaredField("visible").apply{isAccessible=true};found=(field.get(i.targetContext.applicationContext) as Set<*>).filterIsInstance<HybridActivity>().firstOrNull{it !is NativeActivity}}
        return found
    }
    @Test fun chatReceiptsAndImmediateNewConversation(){
        start()
        var target="";var selected=false;var previousReplies=0
        main{val chat=a.model.chats.first{!it.optBoolean("nativePhone")&&!it.optBoolean("phoneHistory")};target=chat.optString("chatId",chat.optString("id"));a.model.launch{a.model.select(chat);previousReplies=a.model.rows.count{it.optString("type")=="assistant.message"};selected=true}}
        waitFor("old conversation selected",60000){selected&&a.model.chatId==target}
        val messages=(1..4).map{"你好，第${it}条。请只回答：收到。"}
        val sentAt=mutableListOf<Long>()
        try{
            for(index in messages.indices){
                if(index==0)main{a.model.edit(messages[index])}
                waitFor("previous receipt before next send"){!a.model.submitting}
                main{assertEquals(messages[index],a.model.draft);sentAt.add(System.currentTimeMillis());a.model.send()}
                Thread.sleep(1200)
                if(index<3)main{a.model.edit(a.model.draft+messages[index+1])}
            }
            report.put("sendIntervalsMs",org.json.JSONArray(sentAt.zipWithNext{l,r->r-l}));save("chat")
            waitFor("four accepted receipts",60000){!a.model.submitting&&a.model.draft.isEmpty()}
            waitFor("four durable bubbles and replies",180000){
                val rows=a.model.rows
                messages.all{text->rows.any{it.optString("type")=="user.message"&&it.optJSONObject("data")?.optString("text")?.contains(text)==true}} &&
                    rows.count{it.optString("type")=="assistant.message"}>=previousReplies+4 && !a.model.running
            }
            report.put("fourMessagesPresent",true).put("sendIntervalsMs",org.json.JSONArray(sentAt.zipWithNext{l,r->r-l}))
            shot("01-four-replies")
            main{a.model.newChat();assertEquals("新对话",a.model.title);assertTrue(a.model.rows.isEmpty());a.model.edit("现在几点？请简短回复。")}
            shot("02-immediate-new-draft")
            waitFor("new conversation created",60000){a.model.chatId.isNotBlank()&&a.model.chatId!=target&&a.model.sendAvailable}
            main{assertEquals("现在几点？请简短回复。",a.model.draft);a.model.send()}
            waitFor("new conversation reply",90000){a.model.rows.any{it.optString("type")=="assistant.message"}&&!a.model.running}
            report.put("newDraftPreserved",true);shot("03-new-reply")
        }finally{save("chat")}
    }
    @Test fun themesPagesAccountAndOriginalFiles(){
        start();var original="system";var originalDark=a.model.dark
        main{a.model.launch{original=a.model.call("settings.appearance").optString("value","system")}}
        Thread.sleep(500)
        try{
            for(theme in if(InstrumentationRegistry.getArguments().getString("fix35FilesOnly")=="true")emptyList() else listOf("light","dark")){
                main{a.model.launch{a.model.call("settings.appearance",JSONObject().put("value",theme));a.model.dark=theme=="dark"}}
                Thread.sleep(500)
                for(pass in 1..3){
                    main{a.model.tab="chat"};Thread.sleep(100)
                    main{a.model.tab="goals";a.goals.refresh()}
                    waitFor("$theme goals $pass",22000){!a.goals.loading&&(a.goals.sections.isNotEmpty()||a.goals.errors.isNotEmpty())}
                    report.put("$theme-goals-$pass",if(a.goals.errors.isEmpty())"content-or-empty" else "retryable-error")
                    shot("04-$theme-goals-$pass")
                }
                main{a.model.tab="activity";a.feed.refresh(full=true)}
                waitFor("feed settles"){!a.feed.loading};shot("05-$theme-activity")
                main{a.model.tab="health";a.health.refresh()}
                waitFor("health settles"){!a.health.loading};shot("06-$theme-health")
                main{a.model.tab="library"}
                Thread.sleep(2500);shot("07-$theme-library")
                main{a.settings.open()}
                waitFor("settings home settles",70000){!a.settings.loading&&a.settings.home.length()>0}
                main{assertTrue("cloud account projection",a.settings.home.optBoolean("cloud"));assertFalse(a.settings.home.optString("accountLabel").contains("只在这台电脑"))}
                shot("08-$theme-settings")
                main{a.settings.open("account")}
                waitFor("account settles",70000){!a.settings.loading}
                shot("09-$theme-account")
            }
            var files=emptyList<JSONObject>();main{a.model.launch{files=a.model.business("/library?limit=50").getJSONArray("items").objects()}}
            waitFor("files listed"){files.isNotEmpty()}
            for((kind,row) in listOf("markdown" to files.first{it.optString("fileName").endsWith(".md")},"pdf" to files.first{it.optString("fileName").endsWith(".pdf")})){
                main{a.model.tab="library";a.originalLibrary(row.getString("id"))}
                waitFor("original file page"){a.model.tab=="library-web"}
                val web=a.embeddedWeb
                val until=System.currentTimeMillis()+65000;var ready=false
                while(System.currentTimeMillis()<until){val result=js(web,"Boolean(typeof state!=='undefined'&&state.resourceView?.context?.kind==='library'&&document.getElementById('resource-content')?.textContent&&!document.getElementById('resource-content')?.textContent.includes('暂时无法读取'))");if(result=="true"){ready=true;break};Thread.sleep(200)}
                if(!ready){
                    shot("10-$kind-open-failed")
                    report.put("fileFailure",js(web,"JSON.stringify({page:state.page,loggedIn:state.loggedIn,resource:state.resourceView?.context?.kind,entry:window.weftNativeLibraryEntry,pdfState:document.querySelector('.phone-pdf-view')?.dataset.pdfState,hasError:document.getElementById('resource-content')?.textContent.includes('暂时无法读取')})"))
                }
                assertTrue("specific $kind preview opens",ready)
                if(kind=="pdf"){
                    val end=System.currentTimeMillis()+30000;var pdfReady=false
                    while(System.currentTimeMillis()<end){if(js(web,"document.querySelector('.phone-pdf-view')?.dataset.pdfState||''")=="\"ready\""){pdfReady=true;break};Thread.sleep(200)}
                    assertTrue("PDF rendered",pdfReady)
                    val ink=js(web,"(()=>{const c=document.querySelector('.phone-pdf-page canvas');const b=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let ink=0;for(let n=0;n<b.length;n+=4)if(b[n]<240||b[n+1]<240||b[n+2]<240)ink++;return ink})()").toInt()
                    var loaded:NativeFile?=null;main{a.model.launch{loaded=a.fileActions.load(JSONObject(row.toString()).put("libraryId",row.getString("id")))}}
                    waitFor("native PDF reference"){loaded!=null}
                    val fd=android.os.ParcelFileDescriptor.open(loaded!!.file!!,android.os.ParcelFileDescriptor.MODE_READ_ONLY)
                    var nativeInk=0
                    android.graphics.pdf.PdfRenderer(fd).use{renderer->renderer.openPage(0).use{page->
                        val bitmap=Bitmap.createBitmap(page.width,page.height,Bitmap.Config.ARGB_8888);bitmap.eraseColor(android.graphics.Color.WHITE);page.render(bitmap,null,null,android.graphics.pdf.PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        val pixels=IntArray(bitmap.width*bitmap.height);bitmap.getPixels(pixels,0,bitmap.width,0,0,bitmap.width,bitmap.height);nativeInk=pixels.count{android.graphics.Color.red(it)<240||android.graphics.Color.green(it)<240||android.graphics.Color.blue(it)<240};bitmap.recycle()
                    }}
                    report.put("pdfNativeInk",nativeInk).put("pdfWebInk",ink)
                    assertTrue("web PDF preserves visible native content",nativeInk==0||ink>0)
                }
                shot("10-$kind-original")
                js(web,"document.getElementById('resource-back').click()")
                waitFor("back to native library"){a.model.tab=="library"}
                report.put("$kind-original-and-back",true);shot("11-$kind-return-native")
            }
        }finally{main{a.model.launch{a.model.call("settings.appearance",JSONObject().put("value",original));a.model.dark=originalDark}};save("pages")}
    }
}
