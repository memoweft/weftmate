package com.memoweft.weftmate.mobile

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.view.Choreographer
import android.view.WindowInsets
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Production activity, real system IME/insets. Only identity/data/picker results are synthetic. */
class NativeComposerInstrumentedTest {
    @get:Rule val compose = createEmptyComposeRule()
    private val i=InstrumentationRegistry.getInstrumentation()
    private val args=InstrumentationRegistry.getArguments()
    private lateinit var activity:NativeActivity
    private val theme get()=args.getString("theme","light")!!
    private val checks=JSONArray()
    private val keyboardMotions=linkedMapOf<String,JSONArray>()
    private fun main(action:()->Unit)=i.runOnMainSync(action)
    private fun waitFor(label:String,condition:()->Boolean) {
        val end=System.currentTimeMillis()+30000
        while(System.currentTimeMillis()<end){var ok=false;main{ok=condition()};if(ok)return;Thread.sleep(80)}
        error("Timed out: $label")
    }
    private fun editor()=compose.onNodeWithContentDescription("消息输入")
    private fun click(label:String)=compose.onNodeWithContentDescription(label).performTouchInput{click()}
    private fun liveClick(label:String) {
        val rect=compose.onNodeWithContentDescription(label).fetchSemanticsNode().boundsInRoot
        val now=android.os.SystemClock.uptimeMillis()
        i.sendPointerSync(android.view.MotionEvent.obtain(now,now,android.view.MotionEvent.ACTION_DOWN,rect.center.x,rect.center.y,0))
        i.sendPointerSync(android.view.MotionEvent.obtain(now,now+30,android.view.MotionEvent.ACTION_UP,rect.center.x,rect.center.y,0))
    }
    private fun item(label:String)=compose.onAllNodesWithText(label,useUnmergedTree=true).onLast().performTouchInput{click()}
    private fun keep(label:String,text:String) {
        compose.waitForIdle();editor().assertIsFocused();editor().assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.EditableText,androidx.compose.ui.text.AnnotatedString(text)))
        main {
            assertTrue("$label: IME must remain visible",activity.window.decorView.rootWindowInsets.isVisible(WindowInsets.Type.ime()))
            assertTrue("$label: original window keeps focus",activity.window.decorView.hasWindowFocus())
            assertEquals(text,activity.model.draft)
        }
        checks.put(label)
    }
    private fun shot(name:String) {
        if(!name.startsWith("web"))compose.waitForIdle();Thread.sleep(180)
        val image=i.uiAutomation.takeScreenshot()
        File(activity.getExternalFilesDir(null) ?: activity.filesDir,"and12-$theme-$name.png").outputStream().use{image.compress(Bitmap.CompressFormat.PNG,100,it)}
    }
    private fun motion(name:String,action:()->Unit):JSONArray {
        val composerNode=compose.onNodeWithContentDescription("聊天输入区").fetchSemanticsNode()
        val coordinates=composerNode.layoutInfo.coordinates
        val outsidePadding=DesignTokens.space8*activity.resources.displayMetrics.density
        val frames=JSONArray();val done=CountDownLatch(1)
        val durations=java.util.Collections.synchronizedList(mutableListOf<Long>())
        val metricsThread=android.os.HandlerThread("and12-frames").apply{start()}
        val metricsListener=android.view.Window.OnFrameMetricsAvailableListener { _,metrics,_ -> durations.add(metrics.getMetric(android.view.FrameMetrics.TOTAL_DURATION)) }
        main{activity.window.addOnFrameMetricsAvailableListener(metricsListener,android.os.Handler(metricsThread.looper))}
        main {
            val start=System.nanoTime()
            val cb=object:Choreographer.FrameCallback {
                override fun doFrame(time:Long) {
                    val elapsed=(time-start)/1000000
                    if(coordinates.isAttached) {
                        val rect=composerNode.boundsInRoot
                        frames.put(JSONObject().put("ms",elapsed).put("top",rect.top+outsidePadding).put("bottom",rect.bottom-outsidePadding)
                            .put("imeVisible",activity.window.decorView.rootWindowInsets.isVisible(WindowInsets.Type.ime())).put("imeBottom",activity.window.decorView.rootWindowInsets.getInsets(WindowInsets.Type.ime()).bottom))
                    }
                    if(elapsed<900)Choreographer.getInstance().postFrameCallback(this) else done.countDown()
                }
            }
            Choreographer.getInstance().postFrameCallback(cb)
        }
        action()
        val end=System.currentTimeMillis()+4000
        while(done.count>0 && System.currentTimeMillis()<end){compose.mainClock.advanceTimeByFrame();Thread.sleep(16)}
        assertTrue(done.await(1,TimeUnit.SECONDS));compose.waitForIdle()
        shot("$name-final")
        main{activity.window.removeOnFrameMetricsAvailableListener(metricsListener)}
        metricsThread.quitSafely();metricsThread.join(1000)
        val frameBudget=1_000_000_000.0 / activity.window.decorView.display.refreshRate
        val timing=JSONObject().put("measurement","900ms around action; Compose test clock overhead, not the real-time performance sample")
            .put("frameBudgetNs",frameBudget).put("frames",durations.size).put("jankFrames",durations.count{it>frameBudget})
            .put("durationsNs",JSONArray(durations))
        File(activity.getExternalFilesDir(null) ?: activity.filesDir,"and12-$theme-$name-metrics.json").writeText(timing.toString(2))
        File(activity.getExternalFilesDir(null) ?: activity.filesDir,"and12-$theme-$name-frames.json").writeText(frames.toString(2))
        val positions=(0 until frames.length()).map{frames.getJSONObject(it).getDouble(if(name.startsWith("multiline"))"top" else "bottom")}.distinct()
        if(name.startsWith("keyboard"))keyboardMotions[name]=frames
        else assertTrue("$name must have intermediate positions: $positions",positions.size>3)
        checks.put("$name-continuous-${positions.size}-positions")
        return frames
    }
    @Test fun composerKeyboardAndNativeDefault() {
        assertEquals("com.memoweft.weftmate.mobile.and12qa",i.targetContext.packageName)
        i.targetContext.getSharedPreferences("native-ui",0).edit().putBoolean("enabled",false).commit()
        i.targetContext.getSharedPreferences("native-qa",0).edit().putInt("width",390).commit()
        main{android.webkit.WebView.setWebContentsDebuggingEnabled(true)}
        activity=i.startActivitySync(Intent(i.targetContext,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra("lg1bHostOrigin",args.getString("origin"))) as NativeActivity
        try {
            waitFor("native survives old preference"){activity.nativeForeground}
            assertFalse(i.targetContext.getSharedPreferences("native-ui",0).contains("enabled"));checks.put("old-rollback-preference-migrated")
            var booted=false
            waitFor("login boot"){activity.embeddedWeb.evaluateJavascript("Boolean(typeof state!=='undefined' && state.booted)"){booted=it=="true"};booted}
            val credentials=JSONObject().put("origin",args.getString("origin")).put("username",args.getString("username"))
                .put("password",args.getString("password")).put("deviceName","Synthetic Composer")
            main{activity.embeddedWeb.evaluateJavascript("call('auth.login',$credentials).then(()=>location.reload())",null)}
            waitFor("signed in"){activity.model.loggedIn&&!activity.model.loading&&activity.model.rows.size>=80}
            main{activity.model.launch{activity.model.call("settings.appearance",JSONObject().put("value",theme));activity.model.dark=theme=="dark";activity.embeddedWeb.evaluateJavascript("applyTheme('$theme')",null)}}
            Thread.sleep(500)
            motion("keyboard-open"){
                val rect=editor().fetchSemanticsNode().boundsInRoot
                val now=android.os.SystemClock.uptimeMillis()
                i.sendPointerSync(android.view.MotionEvent.obtain(now,now,android.view.MotionEvent.ACTION_DOWN,rect.center.x,rect.center.y,0))
                i.sendPointerSync(android.view.MotionEvent.obtain(now,now+30,android.view.MotionEvent.ACTION_UP,rect.center.x,rect.center.y,0))
            }
            val draft="保留正在输入的草稿"
            editor().performTextInput(draft);keep("typed",draft)
            for(mode in listOf("每次询问","自动","接受文件修改","先出计划")) {
                val label=run{var value="";main{value="审批方式："+mapOf("auto" to "自动","ask" to "每次询问","accept-edits" to "接受文件修改","plan" to "先出计划","allow-all" to "全部允许")[activity.model.mode]};value}
                click(label);keep("approval-menu-$mode",draft)
                if(mode=="每次询问")shot("approval-menu")
                item(mode);waitFor("mode $mode"){activity.model.mode==mapOf("每次询问" to "ask","自动" to "auto","接受文件修改" to "accept-edits","先出计划" to "plan")[mode]};keep("approval-item-$mode",draft)
            }
            click("审批方式：先出计划");item("全部允许");keep("risk-confirmation-open",draft);item("取消");keep("risk-confirmation-cancel",draft)
            click("审批方式：先出计划");item("全部允许");item("全部允许")
            waitFor("allow-all confirmed"){activity.model.mode=="allow-all"};keep("risk-confirmation-approved",draft)
            click("模型：MiMo v2.6 Flash");keep("model-menu",draft);shot("model-menu");item("MiMo v2.6 Flash");keep("model-item",draft)
            var connection:android.view.inputmethod.InputConnection?=null
            fun findConnection(view:android.view.View):android.view.inputmethod.InputConnection? {
                if(view.onCheckIsTextEditor())return view.onCreateInputConnection(android.view.inputmethod.EditorInfo())
                if(view is android.view.ViewGroup)for(index in 0 until view.childCount)findConnection(view.getChildAt(index))?.let{return it}
                return null
            }
            main{connection=findConnection(activity.window.decorView);assertNotNull(connection);assertTrue(connection!!.setComposingText("候选",1))}
            editor().assertTextEquals(draft+"候选")
            click("模型：MiMo v2.6 Flash");item("MiMo v2.6 Flash")
            main{assertTrue(connection!!.setComposingText("候选词",1))};editor().assertTextEquals(draft+"候选词")
            main{connection!!.finishComposingText();connection!!.deleteSurroundingText(3,0)};keep("composition-survives-model-menu",draft)
            i.uiAutomation.grantRuntimePermission(activity.packageName,android.Manifest.permission.CAMERA)
            // Block external activities, with the product still executing each picker bridge.
            val pickerMonitor=object:Instrumentation.ActivityMonitor() {
                override fun onStartActivity(intent:Intent):Instrumentation.ActivityResult? =
                    if(intent.action in listOf(Intent.ACTION_CHOOSER,Intent.ACTION_OPEN_DOCUMENT,"android.media.action.IMAGE_CAPTURE"))
                        Instrumentation.ActivityResult(Activity.RESULT_CANCELED,null) else null
            }
            i.addMonitor(pickerMonitor)
            try {
                for(label in listOf("照片","拍照","文件")) {
                    click("添加附件");keep("plus-menu-$label",draft);if(label=="照片")shot("plus-menu")
                    item(label);Thread.sleep(350);keep("plus-item-$label-canceled-picker",draft)
                }
            } finally { i.removeMonitor(pickerMonitor) }
            click("添加附件");liveClick("消息输入");keep("outside-dismiss-on-editor",draft);compose.onNodeWithText("照片").assertDoesNotExist()
            compose.onNodeWithContentDescription("聊天输入区").performTouchInput{click(androidx.compose.ui.geometry.Offset(center.x,height-40f))}
            keep("composer-tool-gap-keeps-input",draft)
            click("语音补充草稿");keep("voice-keeps-input",draft)
            motion("multiline-expand"){main{activity.model.edit((1..5).joinToString("\n"){"第 $it 行草稿"})}}
            motion("multiline-collapse"){main{activity.model.edit(draft)}}
            motion("keyboard-close"){main{activity.hideKeyboard()}}
            shot("tools-and-goal")
            // Reading above: a resize must keep the first visible message at the same location.
            click("消息输入");keep("before-list-drag",draft)
            compose.onNodeWithContentDescription("消息列表").performTouchInput{swipeDown(durationMillis=300)}
            waitFor("list drag hides IME"){!activity.window.decorView.rootWindowInsets.isVisible(WindowInsets.Type.ime())}
            editor().assertIsNotFocused();checks.put("list-drag-dismisses-keyboard")
            compose.waitForIdle()
            val reading=compose.onAllNodes(hasText("第 ",substring=true)).fetchSemanticsNodes().first{it.boundsInRoot.top>150}
            val readingText=reading.config[androidx.compose.ui.semantics.SemanticsProperties.Text].first().text
            val readingY=reading.boundsInRoot.top
            click("消息输入");Thread.sleep(600)
            assertEquals("Reading anchor",readingY,compose.onNodeWithText(readingText).fetchSemanticsNode().boundsInRoot.top,3f)
            checks.put("reading-anchor-retained")
            compose.onNodeWithContentDescription("消息列表").performTouchInput{click(androidx.compose.ui.geometry.Offset(4f,center.y))}
            waitFor("message blank hides IME"){!activity.window.decorView.rootWindowInsets.isVisible(WindowInsets.Type.ime())}
            editor().assertIsNotFocused();checks.put("visible-message-blank-dismisses-keyboard")
            click("消息输入");keep("blank-dismiss-reopen",draft)
            editor().performTextReplacement("合成流式");click("发送消息")
            waitFor("accepted draft"){activity.model.draft.isEmpty()&&activity.model.running};keep("send-keeps-input","")
            click("停止回复");keep("stop-keeps-input","");waitFor("stopped"){!activity.model.running};click("语音输入");keep("primary-voice-keeps-input","")
            main{activity.hideKeyboard()};Thread.sleep(600)
            click("目标")
            compose.onNodeWithContentDescription("目标列表").assertExists()
            main{assertEquals("goals",activity.model.tab)}
            checks.put("merged-native-goals-entry-retained");shot("page-goals")
            for(tab in listOf("activity","health","library")) {
                main{activity.model.tab=tab};Thread.sleep(900);shot("page-$tab")
                compose.onNodeWithText("使用原生聊天界面").assertDoesNotExist()
            }
            main{activity.model.tab="settings"};Thread.sleep(600)
            main{activity.embeddedWeb.evaluateJavascript("page('general')",null)};Thread.sleep(600);shot("settings-general")
            var absent=false;main{activity.embeddedWeb.evaluateJavascript("!document.body.textContent.includes('使用原生聊天界面')"){absent=it=="true"}}
            waitFor("setting absent"){absent};checks.put("retired-setting-absent")
            main{activity.model.tab="chat"};click("打开侧栏");shot("sidebar");click("关闭侧栏")
            // Compare the same stable scene, rather than a stream/stop racing between captures.
            main{activity.model.launch{activity.model.refresh()}}
            waitFor("comparison stream settled"){!activity.model.running && activity.model.rows.last().optJSONObject("data")?.optString("text")?.startsWith("收到。")==true}
            main{activity.model.edit("对比用的草稿");activity.model.scrollVersion++};Thread.sleep(500);shot("native-content")
            // Same installation, identity and long data through the old web entry for comparison.
            val legacy=i.startActivitySync(Intent(activity,HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra("lg1bHostOrigin",args.getString("origin"))) as HybridActivity
            Thread.sleep(1200)
            main{legacy.embeddedWeb.evaluateJavascript("applyTheme('$theme');uiCore.selectMainChat()",null)};Thread.sleep(1000)
            main{legacy.embeddedWeb.evaluateJavascript("const input=document.getElementById('draft');input.value='对比用的草稿';input.dispatchEvent(new Event('input',{bubbles:true}))",null)};Thread.sleep(500);shot("web-content")
            main{legacy.embeddedWeb.evaluateJavascript("openDrawer()",null)};Thread.sleep(450);shot("web-sidebar")
            main{legacy.finish()}
            File(activity.getExternalFilesDir(null) ?: activity.filesDir,"and12-$theme-ui-checks.json").writeText(JSONObject().put("checks",checks).put("uiAssertionsPassed",true)
                .put("statusHeight",activity.window.decorView.rootWindowInsets.getInsets(WindowInsets.Type.statusBars()).top)
                .put("navigationHeight",activity.window.decorView.rootWindowInsets.getInsets(WindowInsets.Type.navigationBars()).bottom).toString(2))
            for((name,frames) in keyboardMotions) {
                assertTrue("$name requires a nonzero system IME region",(0 until frames.length()).any{frames.getJSONObject(it).optInt("imeBottom")>0})
                assertTrue("$name requires continuous positions",(0 until frames.length()).map{frames.getJSONObject(it).getDouble("bottom")}.distinct().size>3)
            }
            File(activity.getExternalFilesDir(null) ?: activity.filesDir,"and12-$theme-checks.json").writeText(JSONObject().put("checks",checks).put("passed",true)
                .put("statusHeight",activity.window.decorView.rootWindowInsets.getInsets(WindowInsets.Type.statusBars()).top)
                .put("navigationHeight",activity.window.decorView.rootWindowInsets.getInsets(WindowInsets.Type.navigationBars()).bottom).toString(2))
        } finally { main{activity.finish();android.webkit.WebView.setWebContentsDebuggingEnabled(false)} }
    }
}
