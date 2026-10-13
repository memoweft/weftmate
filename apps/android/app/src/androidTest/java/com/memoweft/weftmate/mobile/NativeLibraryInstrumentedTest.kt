package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
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
import java.net.URL

/** Real native UI + authenticated host. Only the host contents and system-panel recipients are synthetic. */
class NativeLibraryInstrumentedTest {
    @get:Rule val compose=createEmptyComposeRule()
    private val i=InstrumentationRegistry.getInstrumentation()
    private val args=InstrumentationRegistry.getArguments()
    private lateinit var activity:NativeActivity
    private val origin get()=args.getString("and7Origin")!!
    private val variant get()="${args.getString("and7Width","360")}-${args.getString("and7Theme","light") }"
    private fun main(action:()->Unit)=i.runOnMainSync(action)
    private fun waitFor(label:String,condition:()->Boolean){val end=System.currentTimeMillis()+30000;while(System.currentTimeMillis()<end){var done=false;main{done=condition()};if(done)return;Thread.sleep(100)};error("Timed out: $label")}
    private fun shot(name:String){compose.waitForIdle();Thread.sleep(300);val b=i.uiAutomation.takeScreenshot();File(activity.filesDir,"and7-$variant-$name.png").outputStream().use{b.compress(Bitmap.CompressFormat.PNG,100,it)}}
    private fun control(mode:String){URL("$origin/and7-control?mode=$mode").openConnection().getInputStream().use{it.readBytes()}}
    private fun reveal(name:String){compose.onNodeWithContentDescription("成果文件").performScrollToNode(hasText(name))}
    private fun webComparisons() {
        compose.onNodeWithContentDescription("成果库").performClick()
        compose.waitUntil(30000){compose.onAllNodesWithText("虚构文档.docx").fetchSemanticsNodes().isNotEmpty()}
        reveal("虚构周计划.md");compose.onNodeWithText("虚构周计划.md").performClick()
        compose.waitUntil(30000){compose.onAllNodesWithContentDescription("正在读取文件").fetchSemanticsNodes().isEmpty()}
        compose.onNodeWithContentDescription("更多文件操作").performClick()
        compose.onNodeWithText("在原网页中查看").performClick()
        var legacy:HybridActivity?=null
        waitFor("original library window") {
            val field=WeftMateApplication::class.java.getDeclaredField("visible").apply{isAccessible=true}
            legacy=(field.get(i.targetContext.applicationContext) as Set<*>).filterIsInstance<HybridActivity>().firstOrNull{it !is NativeActivity}
            legacy!=null
        }
        fun js(code:String){main{legacy!!.embeddedWeb.evaluateJavascript(code,null)}}
        fun ready(code:String){var done=false;waitFor("web library state"){legacy!!.embeddedWeb.evaluateJavascript(code){done=it=="true"};done}}
        fun capture(name:String){Thread.sleep(350);val image=i.uiAutomation.takeScreenshot();File(activity.filesDir,"and7-$variant-web-$name.png").outputStream().use{image.compress(Bitmap.CompressFormat.PNG,100,it)}}
        ready("Boolean(typeof state!=='undefined' && state.booted)")
        ready("Boolean(document.getElementById('resource-content')?.textContent.includes('虚构周计划'))")
        capture("direct-preview")
        js("closeResourcePage()")
        main{legacy!!.embeddedWeb.settings.useWideViewPort=true}
        js("(()=>{const w=${args.getString("and7Width","360")},s=innerWidth/w*visualViewport.scale;document.querySelector('meta[name=viewport]').content='width='+w+',initial-scale='+s;})()")
        js("applyTheme('${args.getString("and7Theme","light")}');page('library')")
        ready("Boolean(document.querySelector('.library-row'))")
        main{legacy!!.embeddedWeb.evaluateJavascript("JSON.stringify({width:innerWidth,dpr:devicePixelRatio,scale:visualViewport.scale,styles:Object.fromEntries(['.library-page','.library-heading h1','.library-toolbar','.library-type','.library-row','.library-file-name','.library-file-icon'].map(s=>{const e=document.querySelector(s),c=getComputedStyle(e);return [s,{font:c.fontSize,color:c.color,weight:c.fontWeight,padding:c.padding,radius:c.borderRadius,background:c.backgroundColor,borderColor:c.borderColor,border:c.borderBottomWidth,display:c.display,columns:c.gridTemplateColumns,gap:c.gap}]}))})"){value->File(activity.filesDir,"and7-$variant-web-styles.json").writeText(org.json.JSONTokener(value).nextValue().toString())}}
        capture("library-list")
        js("(()=>{const row=document.querySelector('.library-row[data-library-id=\"${args.getString("and7MarkdownId")}\"]');row.scrollIntoView({block:'center'});row.querySelector('.library-row-actions button').click()})()")
        Thread.sleep(300);capture("row-menu")
        js("WeftPopover.closeMenu()")
        js("document.querySelector('.library-row[data-library-id=\"${args.getString("and7MarkdownId")}\"] .library-file').click()")
        ready("Boolean(document.getElementById('resource-content')?.textContent.includes('虚构周计划'))")
        capture("viewer-markdown")
        js("closeResourcePage()")
        control("empty");js("uiCore.readLibrary()")
        ready("Boolean(document.querySelector('.library-empty') && !document.querySelector('.library-row'))")
        capture("library-empty")
        control("normal")
        main{legacy!!.finish()}
        compose.waitForIdle();compose.onNodeWithContentDescription("关闭预览").performClick()
    }
    @Test fun libraryAndUnifiedFiles() {
        check(i.targetContext.packageName=="com.memoweft.weftmate.mobile.and7qa")
        i.targetContext.getSharedPreferences("native-qa",0).edit().putInt("width",args.getString("and7Width","360").toInt()).commit()
        SecureSettings(i.targetContext).clearHost()
        // Existing notification prompt is outside this package: synthesize the already-asked state.
        ActivityNotifications(i.targetContext).markPermissionAsked()
        activity=i.startActivitySync(Intent(i.targetContext,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("lg1bHostOrigin",origin)) as NativeActivity
        var booted=false
        waitFor("web login booted"){activity.embeddedWeb.evaluateJavascript("Boolean(typeof state!=='undefined' && state.booted)"){booted=it=="true"};booted}
        val credentials=JSONObject().put("origin",origin).put("username",args.getString("and7User")).put("password",args.getString("and7Password")).put("deviceName","Synthetic Android")
        main{activity.embeddedWeb.evaluateJavascript("call('auth.login',$credentials).then(()=>location.reload())",null)}
        waitFor("logged in"){activity.model.loggedIn && !activity.model.loading}
        val host=SecureSettings(i.targetContext).host()!!
        runBlocking{activity.model.call("settings.appearance",JSONObject().put("value",args.getString("and7Theme","light")))}
        main{activity.model.dark=args.getString("and7Theme")=="dark"}
        compose.onNodeWithContentDescription("成果库").performClick()
        main{androidx.compose.runtime.snapshots.Snapshot.sendApplyNotifications()}
        compose.mainClock.advanceTimeBy(100)
        compose.waitForIdle()
        Thread.sleep(500)
        main{
            val field=WeftMateApplication::class.java.getDeclaredField("visible").apply{isAccessible=true}
            val visible=(field.get(i.targetContext.applicationContext) as Set<*>).filterIsInstance<NativeActivity>()
            File(activity.filesDir,"and7-$variant-entry.json").writeText(JSONObject().put("loggedIn",activity.model.loggedIn).put("tab",activity.model.tab).put("error",activity.model.error).put("destroyed",activity.isDestroyed).put("finishing",activity.isFinishing).put("children",activity.presentationContainer.childCount).put("focus",activity.window.decorView.hasWindowFocus()).put("compositions",org.json.JSONArray((0 until activity.presentationContainer.childCount).map{(activity.presentationContainer.getChildAt(it) as? androidx.compose.ui.platform.ComposeView)?.hasComposition})).put("visible",org.json.JSONArray(visible.map{JSONObject().put("same",it===activity).put("tab",it.model.tab)})).toString())
        }
        val entry=i.uiAutomation.takeScreenshot();File(activity.filesDir,"and7-$variant-entry.png").outputStream().use{entry.compress(Bitmap.CompressFormat.PNG,100,it)}
        compose.waitUntil(30000){runCatching{compose.onAllNodesWithText("虚构文档.docx").fetchSemanticsNodes().isNotEmpty()}.getOrDefault(false)};shot("library-list")
        reveal("虚构周计划.md")
        val beforeMenu=i.uiAutomation.takeScreenshot()
        compose.onNodeWithContentDescription("文件操作：虚构周计划.md").performClick();shot("row-menu")
        if(android.os.Build.VERSION.SDK_INT>=31) {
            val afterMenu=i.uiAutomation.takeScreenshot()
            var difference=0L;var samples=0
            // Right-hand system icons are stable; exclude the clock, which can advance a minute.
            for(y in 0 until 26)for(x in beforeMenu.width*3/4 until beforeMenu.width) {
                val before=beforeMenu.getPixel(x,y);val after=afterMenu.getPixel(x,y)
                difference+=kotlin.math.abs(android.graphics.Color.red(before)-android.graphics.Color.red(after))
                difference+=kotlin.math.abs(android.graphics.Color.green(before)-android.graphics.Color.green(after))
                difference+=kotlin.math.abs(android.graphics.Color.blue(before)-android.graphics.Color.blue(after));samples+=3
            }
            val delta=difference.toDouble()/samples
            assertTrue("Menu leaves the system bar sharp and unchanged: $delta",delta<2.0)
            File(activity.filesDir,"and7-$variant-menu-blur.json").writeText(JSONObject().put("statusBarMeanDelta",delta).put("statusBarPreserved",true).put("backdrop","shared panel-only GPU blur").put("scrollingContentBlurred",false).toString())
        }
        i.uiAutomation.performGlobalAction(1)
        compose.onNodeWithContentDescription("成果文件").performScrollToNode(hasContentDescription("按项目筛选"))
        compose.onNodeWithContentDescription("按文件类型筛选").performClick();shot("type-menu");compose.onNodeWithText("全部",useUnmergedTree=true).performClick()
        compose.onNodeWithContentDescription("按项目筛选").performClick();shot("filter-menu");compose.onAllNodesWithText("全部项目").onLast().performClick()
        control("error");compose.onNodeWithContentDescription("刷新成果库").performClick()
        compose.waitUntil(30000){compose.onAllNodesWithText("那台电脑不在线，连接后再试。").fetchSemanticsNodes().isNotEmpty()}
        shot("library-offline-cached");reveal("虚构文档.docx");compose.onNodeWithText("虚构文档.docx").assertExists()
        control("normal");compose.onNodeWithContentDescription("成果文件").performScrollToNode(hasContentDescription("刷新成果库"));compose.onNodeWithContentDescription("刷新成果库").performClick()
        compose.waitUntil(30000){compose.onAllNodesWithText("那台电脑不在线，连接后再试。").fetchSemanticsNodes().isEmpty()}
        for((name,label) in listOf("虚构风景.png" to "image","虚构便签.txt" to "text","虚构周计划.md" to "markdown","synthetic-example.py" to "code","虚构阅读.pdf" to "pdf","虚构文档.docx" to "other")) {
            reveal(name)
            compose.onNodeWithText(name).performClick()
            compose.waitUntil(30000){compose.onAllNodesWithContentDescription("正在读取文件").fetchSemanticsNodes().isEmpty()};Thread.sleep(500)
            compose.onNodeWithContentDescription("文件查看").assertExists();compose.onNodeWithContentDescription("消息输入").assertDoesNotExist();shot("viewer-$label")
            if(label=="image") {compose.onNodeWithContentDescription(name).performTouchInput{doubleClick()};shot("viewer-image-zoom")}
            if(label=="pdf") {compose.onNodeWithContentDescription("下一页").performClick();Thread.sleep(500);compose.onNodeWithText("2 / 2").assertExists();shot("viewer-pdf-page2")}
            if(label=="markdown") {
                compose.onNodeWithContentDescription("更多文件操作").performClick();shot("viewer-menu")
                compose.onNodeWithText("查看历史版本").assertDoesNotExist()
                val captured=mutableListOf<Intent>();main{activity.fileActions.systemIntent={captured.add(it)}}
                compose.onNodeWithText("保存到手机").performClick();assertEquals(Intent.ACTION_CREATE_DOCUMENT,captured.last().action);assertEquals("虚构周计划.md",captured.last().getStringExtra(Intent.EXTRA_TITLE));assertTrue(captured.last().categories.contains(Intent.CATEGORY_OPENABLE))
                compose.onNodeWithContentDescription("更多文件操作").performClick();compose.onNodeWithText("分享").performClick()
                val chooser=captured.last();assertEquals(Intent.ACTION_CHOOSER,chooser.action)
                assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION,chooser.flags)
                val send=chooser.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)!!;assertEquals(Intent.ACTION_SEND,send.action);assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION,send.flags)
                val uri=send.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)!!;assertEquals(uri,send.clipData!!.getItemAt(0).uri)
                assertEquals(1,chooser.clipData!!.itemCount);assertEquals(uri,chooser.clipData!!.getItemAt(0).uri)
                assertEquals("${activity.packageName}.native-files",uri.authority)
                val content=activity.contentResolver.openInputStream(uri)!!.use{it.readBytes()};assertTrue(String(content).contains("虚构周计划"))
                val loaded=runBlocking{activity.fileActions.load(JSONObject().put("libraryId",args.getString("and7MarkdownId"))) }
                val destination=File(activity.cacheDir,"composer-camera/synthetic-saved.md").apply{parentFile!!.mkdirs()}
                val destinationUri=androidx.core.content.FileProvider.getUriForFile(activity,"${activity.packageName}.composer-camera",destination)
                main{activity.fileActions.write(loaded,destinationUri)}
                waitFor("synthetic save bytes"){destination.exists() && destination.length()==content.size.toLong()}
                assertArrayEquals(content,destination.readBytes())
                // Provider refuses files outside the dedicated cache, including draft and private account data.
                try {androidx.core.content.FileProvider.getUriForFile(activity,"${activity.packageName}.native-files",File(activity.filesDir,"private-settings"));fail("Broad provider root")}catch(_:IllegalArgumentException){}
                main{activity.fileActions.systemIntent=null}
            }
            compose.onNodeWithContentDescription("关闭预览").performClick()
        }
        reveal("虚构周计划.md");compose.onNodeWithContentDescription("文件操作：虚构周计划.md").performClick()
        compose.onNodeWithText("在对话中定位").performClick()
        waitFor("file source chat"){activity.model.tab=="chat"}
        compose.onNodeWithText("虚构周计划.md").performScrollTo().performClick()
        Thread.sleep(700);compose.onNodeWithContentDescription("文件查看").assertExists();shot("chat-artifact-viewer")
        compose.onNodeWithContentDescription("关闭预览").performClick()
        compose.onNodeWithContentDescription("成果库").performClick();Thread.sleep(500)
        // Phone-only identity follows the same bootstrap contract, and makes no library request.
        SecureSettings(i.targetContext).saveHost(host.copy(authSource="phone"))
        compose.onNodeWithContentDescription("聊天").performClick();compose.waitForIdle();compose.onNodeWithContentDescription("成果库").performClick();Thread.sleep(700)
        val phoneBoot=runBlocking{activity.model.call("app.bootstrap")};File(activity.filesDir,"and7-$variant-phone.json").writeText(JSONObject().put("authSource",phoneBoot.optString("authSource")).put("noComputer",libraryHasNoComputer(phoneBoot)).put("tab",activity.model.tab).toString())
        compose.onNodeWithContentDescription("成果文件").performScrollToNode(hasText("让电脑上的 WeftMate 帮你做事后，产出的文件会出现在这里。"))
        compose.onNodeWithText("让电脑上的 WeftMate 帮你做事后，产出的文件会出现在这里。").assertExists();shot("phone-only-empty")
        SecureSettings(i.targetContext).saveHost(host)
        // Missing, failure and loading are distinct real network responses, not fake screen state.
        control("empty");main{activity.model.tab="chat"};compose.waitForIdle();compose.onNodeWithContentDescription("成果库").performClick();Thread.sleep(900);shot("library-empty")
        control("loading");main{activity.model.tab="chat"};compose.waitForIdle();compose.onNodeWithContentDescription("成果库").performClick();Thread.sleep(600);shot("library-loading")
        control("error");main{activity.model.tab="chat"};compose.waitForIdle();compose.onNodeWithContentDescription("成果库").performClick();Thread.sleep(900);shot("library-error")
        control("normal");main{activity.model.tab="chat"};compose.waitForIdle();compose.onNodeWithContentDescription("成果库").performClick();Thread.sleep(900)
        control("file-loading");reveal("虚构便签.txt");compose.onNodeWithText("虚构便签.txt").performClick();Thread.sleep(600);shot("viewer-loading");compose.onNodeWithContentDescription("关闭预览").performClick();control("normal")
        control("missing");reveal("虚构便签.txt");compose.onNodeWithText("虚构便签.txt").performClick();compose.waitUntil(30000){compose.onAllNodesWithText("文件已不在原位置，可以回到对话查看。").fetchSemanticsNodes().isNotEmpty()};shot("viewer-missing");compose.onNodeWithContentDescription("关闭预览").performClick()
        control("file-error");reveal("虚构便签.txt");compose.onNodeWithText("虚构便签.txt").performClick();compose.waitUntil(30000){compose.onAllNodesWithText("重试").fetchSemanticsNodes().isNotEmpty()};shot("viewer-error");control("normal");compose.onNodeWithText("重试").performClick();Thread.sleep(500);compose.onNodeWithContentDescription("关闭预览").performClick()
        // Actual chat attachment uses the same viewer and byte loader, including original binary files.
        main{activity.model.tab="chat"}
        val camera=File(activity.cacheDir,"composer-camera").apply{mkdirs()};val text=File(camera,"来自聊天的虚构便签.txt").apply{writeText("聊天附件的原始内容。")}
        val store=AttachmentStore(activity,LocalStore(activity));store.list(activity.model.owner,activity.model.chatId).forEach{store.remove(activity.model.owner,it.id)}
        store.import(androidx.core.content.FileProvider.getUriForFile(activity,"${activity.packageName}.composer-camera",text),activity.model.owner,activity.model.chatId,"file")
        main{activity.model.launch{activity.model.refreshAttachments()}};waitFor("composer file"){activity.model.attachments.isNotEmpty()}
        compose.waitForIdle();shot("chat-attachment");compose.onNodeWithText("来自聊天的虚构便签.txt").performTouchInput{click(androidx.compose.ui.geometry.Offset(width*0.25f,height*0.8f))};Thread.sleep(700);shot("chat-file-viewer");compose.onNodeWithContentDescription("文件查看").assertExists();compose.onNode(hasContentDescription("消息输入") and hasAnyAncestor(hasContentDescription("文件查看"))).assertDoesNotExist();compose.onNodeWithContentDescription("关闭预览").performClick()
        // A raw Office attachment can be opened/shared even though the library server cannot export one yet.
        val office=File(camera,"synthetic.docx").apply{writeBytes(byteArrayOf(80,75,3,4,0,1,2,3))}
        val original=store.import(androidx.core.content.FileProvider.getUriForFile(activity,"${activity.packageName}.composer-camera",office),activity.model.owner,activity.model.chatId,"file")
        val row=original.bridge().put("conversationId",activity.model.chatId)
        val loaded=runBlocking{activity.fileActions.load(row)};assertArrayEquals(office.readBytes(),loaded.file!!.readBytes())
        var open:Intent?=null;main{activity.fileActions.systemIntent={open=it};activity.fileActions.share(loaded,true)}
        assertEquals(Intent.ACTION_CHOOSER,open!!.action);assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION,open!!.flags)
        assertEquals(Intent.ACTION_VIEW,open!!.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)!!.action)
        webComparisons()
        // Logout cleanup and delayed old-account export are exercised without a real system panel.
        assertTrue(activity.nativeFileCurrent(loaded))
        runBlocking{activity.model.call("auth.logout")}
        assertFalse(loaded.file.exists());assertFalse(activity.nativeFileCurrent(loaded))
        var invalidIntent=false;main{activity.fileActions.systemIntent={invalidIntent=true};activity.fileActions.share(loaded)};assertFalse(invalidIntent)
        File(i.targetContext.filesDir,"and7-$variant-done.json").writeText(JSONObject().put("passed",true).put("widthDp",activity.resources.configuration.screenWidthDp).put("systemVersion",android.os.Build.VERSION.RELEASE).put("navigationBottom",androidx.core.view.ViewCompat.getRootWindowInsets(activity.presentationContainer)?.getInsets(androidx.core.view.WindowInsetsCompat.Type.navigationBars())?.bottom ?: -1).toString())
        main{activity.fileActions.systemIntent=null;activity.finish()}
    }
}
