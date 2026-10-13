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
    @Test fun libraryAndUnifiedFiles() {
        check(i.targetContext.packageName=="com.memoweft.weftmate.mobile.and7qa")
        i.targetContext.getSharedPreferences("native-qa",0).edit().putInt("width",args.getString("and7Width","360").toInt()).commit()
        val host=PersonalApi().login(origin,args.getString("and7User")!!,args.getString("and7Password")!!,"Synthetic Android")
        SecureSettings(i.targetContext).saveHost(host)
        activity=i.startActivitySync(Intent(i.targetContext,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as NativeActivity
        waitFor("logged in"){activity.model.loggedIn && !activity.model.loading}
        main{activity.model.dark=args.getString("and7Theme")=="dark"}
        compose.onNodeWithContentDescription("成果库").performClick()
        compose.waitUntil(30000){compose.onAllNodesWithText("虚构周计划.md").fetchSemanticsNodes().isNotEmpty()};shot("library-list")
        compose.onNodeWithContentDescription("文件操作：虚构周计划.md").performClick();shot("row-menu")
        i.uiAutomation.performGlobalAction(1)
        compose.onNodeWithContentDescription("筛选文件").performClick();shot("filter-menu");compose.onNodeWithText("全部文件").performClick()
        for((name,label) in listOf("虚构风景.png" to "image","虚构便签.txt" to "text","虚构周计划.md" to "markdown","synthetic-example.py" to "code","虚构阅读.pdf" to "pdf","虚构文档.docx" to "other")) {
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
                val send=captured.last();assertEquals(Intent.ACTION_SEND,send.action);assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION,send.flags)
                val uri=send.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)!!;assertEquals(uri,send.clipData!!.getItemAt(0).uri)
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
        compose.onNodeWithContentDescription("文件操作：虚构周计划.md").performClick()
        compose.onNodeWithText("在对话中定位").performClick()
        waitFor("file source chat"){activity.model.tab=="chat"}
        compose.onNodeWithText("虚构周计划.md").performScrollTo().performClick()
        Thread.sleep(700);compose.onNodeWithContentDescription("文件查看").assertExists();shot("chat-artifact-viewer")
        compose.onNodeWithContentDescription("关闭预览").performClick()
        compose.onNodeWithContentDescription("成果库").performClick();Thread.sleep(500)
        // Missing, failure and loading are distinct real network responses, not fake screen state.
        control("empty");main{activity.model.tab="chat"};compose.onNodeWithContentDescription("成果库").performClick();Thread.sleep(900);shot("library-empty")
        control("loading");main{activity.model.tab="chat"};compose.onNodeWithContentDescription("成果库").performClick();Thread.sleep(600);shot("library-loading")
        control("error");main{activity.model.tab="chat"};compose.onNodeWithContentDescription("成果库").performClick();Thread.sleep(900);shot("library-error")
        control("normal");main{activity.model.tab="chat"};compose.onNodeWithContentDescription("成果库").performClick();Thread.sleep(900)
        control("missing");compose.onNodeWithText("虚构便签.txt").performClick();Thread.sleep(700);shot("viewer-missing");compose.onNodeWithContentDescription("关闭预览").performClick()
        control("file-error");compose.onNodeWithText("虚构便签.txt").performClick();Thread.sleep(700);shot("viewer-error");control("normal");compose.onNodeWithText("重试").performClick();Thread.sleep(500);compose.onNodeWithContentDescription("关闭预览").performClick()
        // Actual chat attachment uses the same viewer and byte loader, including original binary files.
        main{activity.model.tab="chat"}
        val camera=File(activity.cacheDir,"composer-camera").apply{mkdirs()};val text=File(camera,"来自聊天的虚构便签.txt").apply{writeText("聊天附件的原始内容。")}
        val store=AttachmentStore(activity,LocalStore(activity));store.import(androidx.core.content.FileProvider.getUriForFile(activity,"${activity.packageName}.composer-camera",text),activity.model.owner,activity.model.chatId,"file")
        main{activity.model.launch{activity.model.refreshAttachments()}};waitFor("composer file"){activity.model.attachments.isNotEmpty()}
        compose.onNodeWithContentDescription("来自聊天的虚构便签.txt").performClick();Thread.sleep(700);compose.onNodeWithContentDescription("消息输入").assertDoesNotExist();shot("chat-file-viewer");compose.onNodeWithContentDescription("关闭预览").performClick()
        // A raw Office attachment can be opened/shared even though the library server cannot export one yet.
        val office=File(camera,"synthetic.docx").apply{writeBytes(byteArrayOf(80,75,3,4,0,1,2,3))}
        val original=store.import(androidx.core.content.FileProvider.getUriForFile(activity,"${activity.packageName}.composer-camera",office),activity.model.owner,activity.model.chatId,"file")
        val row=original.bridge().put("conversationId",activity.model.chatId)
        val loaded=runBlocking{activity.fileActions.load(row)};assertArrayEquals(office.readBytes(),loaded.file!!.readBytes())
        var open:Intent?=null;main{activity.fileActions.systemIntent={open=it};activity.fileActions.share(loaded,true)}
        assertEquals(Intent.ACTION_VIEW,open!!.action);assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION,open!!.flags)
        // Logout cleanup and delayed old-account export are exercised without a real system panel.
        assertTrue(activity.nativeFileCurrent(loaded))
        runBlocking{activity.model.call("auth.logout")}
        assertFalse(loaded.file.exists());assertFalse(activity.nativeFileCurrent(loaded))
        var invalidIntent=false;main{activity.fileActions.systemIntent={invalidIntent=true};activity.fileActions.share(loaded)};assertFalse(invalidIntent)
        File(i.targetContext.filesDir,"and7-$variant-done.json").writeText(JSONObject().put("passed",true).put("widthDp",activity.resources.configuration.screenWidthDp).put("systemVersion",android.os.Build.VERSION.RELEASE).put("navigationBottom",androidx.core.view.ViewCompat.getRootWindowInsets(activity.presentationContainer)?.getInsets(androidx.core.view.WindowInsetsCompat.Type.navigationBars())?.bottom ?: -1).toString())
        main{activity.fileActions.systemIntent=null;activity.finish()}
    }
}
