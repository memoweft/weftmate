package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class NativeHealthInstrumentedTest {
    @get:Rule val compose=createEmptyComposeRule()
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val args=InstrumentationRegistry.getArguments()
    private lateinit var activity:NativeActivity
    private var referenceWeb:android.webkit.WebView?=null
    private val variant get()="${args.getString("and8Width","360")}-${args.getString("and8Theme","light") }"+if(args.getString("and8FontScale","1.0")=="1.0")"" else "-font13"
    private fun main(action:()->Unit)=instrumentation.runOnMainSync {
        ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).filterIsInstance<NativeActivity>().lastOrNull()?.let{activity=it}
        action()
    }
    private fun waitFor(label:String,onMain:Boolean=true,condition:()->Boolean){val end=System.currentTimeMillis()+30000;while(System.currentTimeMillis()<end){compose.waitForIdle();var ok=false;if(onMain)main{ok=condition()} else ok=condition();if(ok){compose.waitForIdle();if(onMain)main{ok=condition()} else ok=condition();if(ok)return};Thread.sleep(100)};if(::activity.isInitialized){shot("diagnostic-$label".replace(' ','-'));error("Timed out: $label; tab=${activity.model.tab}, signedIn=${activity.model.loggedIn}, noComputer=${activity.health.noComputer}, loading=${activity.health.loading}, ready=${activity.health.ready}, overviewPresent=${activity.health.overview!=null}, tabMatches=${activity.model.tab=="health"}, destroyed=${activity.isDestroyed}, error=${activity.health.error}, day=${activity.health.day}")};error("Timed out: $label")}
    private fun shot(name:String){compose.waitForIdle();Thread.sleep(250);val image=instrumentation.uiAutomation.takeScreenshot();assertNotNull(image);File(activity.filesDir,"and8-$variant-$name.png").outputStream().use{image.compress(Bitmap.CompressFormat.PNG,100,it)}}
    private fun fixture(command:String):JSONObject{val c=URL(args.getString("and8Origin")+"/__and8/$command").openConnection() as HttpURLConnection;try{assertEquals(200,c.responseCode);return JSONObject(c.inputStream.bufferedReader().readText())}finally{c.disconnect()}}
    private fun settled(){waitFor("health settled"){!activity.health.loading&&!activity.health.supplementLoading&&!activity.health.trendLoading&&!activity.health.calendarLoading}}
    private fun scrollTo(matcher:SemanticsMatcher){compose.onNodeWithContentDescription("健康内容").performScrollToNode(matcher)}
    private fun reveal(node:SemanticsNodeInteraction) {
        val list=compose.onNodeWithContentDescription("健康内容")
        val end=System.currentTimeMillis()+5000
        while(System.currentTimeMillis()<end) {
            compose.waitForIdle()
            val viewport=list.fetchSemanticsNode().boundsInRoot
            val visibleBottom=minOf(viewport.bottom,compose.onNodeWithContentDescription("聊天",useUnmergedTree=true).fetchSemanticsNode().boundsInRoot.top)
            val target=node.fetchSemanticsNode()
            val top=target.positionInRoot.y
            val bottom=top+target.size.height
            if(node.isDisplayed()&&top>=viewport.top&&bottom<=visibleBottom)return
            val delta=if(bottom>visibleBottom) minOf(140f,bottom-visibleBottom+30f) else -minOf(140f,viewport.top-top+30f)
            list.performTouchInput{swipe(Offset(center.x,center.y),Offset(center.x,center.y-delta),durationMillis=180)}
        }
        node.assertIsDisplayed()
    }
    private fun showText(value:String){scrollTo(hasText(value));reveal(compose.onNodeWithText(value))}
    private fun clickText(value:String){scrollTo(hasText(value));val node=compose.onNodeWithText(value);reveal(node);node.performSemanticsAction(SemanticsActions.OnClick){it()}}
    private fun clickDescription(value:String){scrollTo(hasContentDescription(value));val node=compose.onNodeWithContentDescription(value);reveal(node);node.performSemanticsAction(SemanticsActions.OnClick){it()}}
    private fun js(script:String):String{var value:String?=null;main{(referenceWeb ?: activity.embeddedWeb).evaluateJavascript(script){value=it}};val end=System.currentTimeMillis()+10000;while(value==null&&System.currentTimeMillis()<end)Thread.sleep(50);return value ?: error("javascript timed out")}
    private fun original(scene:String,script:String="") {
        val old=instrumentation.startActivitySync(Intent(instrumentation.targetContext,HybridActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("lg1bHostOrigin",args.getString("and8Origin"))) as HybridActivity
        referenceWeb=old.embeddedWeb
        waitFor("original mounted",onMain=false){js("Boolean(typeof state!=='undefined'&&state.booted&&state.loggedIn)")=="true"}
        js("applyTheme('${args.getString("and8Theme","light")}');page('health')")
        waitFor("original loaded",onMain=false){js("Boolean(typeof uiCore!=='undefined'&&uiCore.health.overview&&!uiCore.health.loading&&!uiCore.health.supplementLoading&&!uiCore.health.trendLoading)")=="true"}
        js("void uiCore.readHealth('2026-10-14')");Thread.sleep(800)
        if(script.isNotBlank()){js(script);Thread.sleep(800)}
        shot("web-$scene");referenceWeb=null;main{old.finish()};compose.waitForIdle()
    }
    private fun tab(){compose.onNodeWithContentDescription("健康",useUnmergedTree=true).performClick();waitFor("health native route"){activity.model.tab=="health"&&activity.health.overview!=null};settled()}
    private fun captureComparisons() {
        clickDescription("选择健康日期");settled();shot("calendar-open");original("calendar-open","document.querySelector('[aria-label=\"选择健康日期\"]').click()")
        compose.onNodeWithContentDescription("健康日期 2026-10-13").assertWidthIsAtLeast(44.dp).assertHeightIsAtLeast(44.dp)
        clickDescription("收起月历");clickDescription("睡眠，查看详情");settled();shot("sleep-detail");original("sleep-detail","void uiCore.openHealthMetric('sleep','detail')")
        showText("睡眠分期");shot("sleep-stages");main{activity.health.home()};showText("昨晚的睡眠");shot("sleep-summary")
        clickDescription("睡眠，查看详情");settled();clickText("睡眠时长");settled();clickText("14天");settled()
        scrollTo(hasText("叠加深夜使用"));compose.onNodeWithText("叠加深夜使用").performSemanticsAction(SemanticsActions.OnClick){it()};waitFor("usage overlay"){activity.health.overlay&&!activity.health.trendLoading&&activity.health.usageTrend!=null}
        compose.onNodeWithContentDescription("趋势").performScrollTo();shot("trend-overlay");original("trend-overlay","void uiCore.openHealthMetric('sleepMinutes','trend').then(()=>uiCore.readHealthTrend('sleepMinutes',14)).then(()=>uiCore.healthOverlay(true))")
        scrollTo(hasContentDescription("趋势图，断线表示当天没有测量"));compose.onNodeWithContentDescription("趋势图，断线表示当天没有测量").performTouchInput{click(center)};shot("trend-selected")
        scrollTo(hasText("叠加深夜使用"));reveal(compose.onNodeWithText("叠加深夜使用"));shot("trend-controls")
        main{activity.health.home()};clickDescription("恢复，查看详情");settled();clickText("让 AI 分析这一项");clickText("打开 AI 分析");waitFor("analysis saved"){activity.health.analyses["recovery"]!=null&&activity.health.analysisBusy.isEmpty()}
        compose.onNodeWithContentDescription("和自己比较").performScrollTo();shot("analysis-open");original("analysis-open","void uiCore.openHealthMetric('recovery','detail').then(()=>uiCore.toggleHealthAnalysis('recovery'));setTimeout(()=>document.querySelector('.health-analysis')?.scrollIntoView({block:'center'}),400)")
        clickText("依据");scrollTo(hasText("依据：这一项的每日汇总、近 7 天的深夜使用时长"));reveal(compose.onNodeWithText("依据：这一项的每日汇总、近 7 天的深夜使用时长"));shot("analysis-basis")
        for((id,name) in listOf("stress" to "压力","energy" to "电能")){main{activity.health.home()};clickDescription("$name，查看详情");settled();shot("$id-detail");clickText("依据");shot("$id-method")}
        main{activity.health.home()};showText("今天的活动");shot("activity")
        fixture("empty");main{activity.health.home();activity.health.refresh()};settled();shot("empty");original("empty")
        File(activity.filesDir,"and8-$variant-comparison-done.json").writeText(JSONObject().put("passed",true).put("comparisonsOnly",true).put("variant",variant).toString())
    }
    @Test fun nativeHealthFlow() {
        check(instrumentation.targetContext.packageName=="com.memoweft.weftmate.mobile.and8qa")
        val context=instrumentation.targetContext
        context.getSharedPreferences("native-ui",0).edit().putBoolean("enabled",true).commit()
        context.getSharedPreferences("native-qa",0).edit().putInt("width",args.getString("and8Width","360").toInt()).commit()
        context.getSharedPreferences("native-qa",0).edit().putFloat("fontScale",args.getString("and8FontScale","1.0").toFloat()).commit()
        activity=instrumentation.startActivitySync(Intent(context,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("lg1bHostOrigin",args.getString("and8Origin"))) as NativeActivity
        waitFor("web booted",onMain=false){js("Boolean(typeof state!=='undefined'&&state.booted)")=="true"}
        if(!activity.model.loggedIn){val c=JSONObject().put("origin",args.getString("and8Origin")).put("username",args.getString("and8Username")).put("password",args.getString("and8Password")).put("deviceName","Synthetic Android");js("call('auth.login',$c).then(()=>location.reload())")}
        waitFor("native signed in"){activity.model.loggedIn&&!activity.model.loading&&activity.model.rows.isNotEmpty()}
        main{activity.model.launch{activity.model.call("settings.appearance",JSONObject().put("value",args.getString("and8Theme","light")));activity.model.dark=args.getString("and8Theme")=="dark"}}
        js("applyTheme('${args.getString("and8Theme","light")}')")
        tab();assertTrue(activity.health.overview!!.getBoolean("connected"));shot("content");original("content");if(args.getString("and8CaptureOnly")=="1"){captureComparisons();main{activity.finish()};return}
        clickText("展开解读");shot("insight-open");clickText("收起解读")
        clickText("提醒我");waitFor("reminder"){activity.health.reminders.isNotEmpty()};assertEquals(1,fixture("inspect").getJSONArray("reminders").length());shot("reminder")
        clickDescription("选择健康日期");settled();shot("calendar-open");original("calendar-open","document.querySelector('[aria-label=\"选择健康日期\"]').click()")
        compose.onNodeWithContentDescription("健康日期 2026-10-13").assertWidthIsAtLeast(44.dp).assertHeightIsAtLeast(44.dp).performClick();settled();assertEquals("2026-10-13",activity.health.day);shot("previous-day")
        clickText("回到今天");settled();assertEquals("2026-10-14",activity.health.day)
        compose.onNodeWithContentDescription("后一天").assertIsNotEnabled();clickDescription("前一天");settled();clickDescription("后一天");settled()
        clickDescription("睡眠，查看详情");settled();shot("sleep-detail");original("sleep-detail","void uiCore.openHealthMetric('sleep','detail')")
        showText("睡眠分期");compose.onNodeWithText("深睡 "+healthDuration(activity.health.dimension("deepMinutes"))).assertExists();shot("sleep-stages")
        clickText("睡眠时长");settled();assertEquals("trend",activity.health.view);clickText("14天");settled();compose.onNodeWithText("14天").assertIsSelected();scrollTo(hasText("叠加深夜使用"));compose.onNodeWithText("叠加深夜使用").performSemanticsAction(SemanticsActions.OnClick){it()};waitFor("usage overlay"){activity.health.overlay&&!activity.health.trendLoading&&activity.health.usageTrend!=null};compose.onNodeWithContentDescription("趋势").performScrollTo();shot("trend-overlay");original("trend-overlay","void uiCore.openHealthMetric('sleepMinutes','trend').then(()=>uiCore.readHealthTrend('sleepMinutes',14)).then(()=>uiCore.healthOverlay(true))")
        scrollTo(hasContentDescription("趋势图，断线表示当天没有测量"));compose.onNodeWithContentDescription("趋势图，断线表示当天没有测量").performTouchInput{click(center)};shot("trend-selected")
        main{activity.health.home()};clickDescription("恢复，查看详情");settled();clickText("让 AI 分析这一项");clickText("打开 AI 分析");waitFor("analysis saved"){activity.health.analyses["recovery"]!=null&&activity.health.analysisBusy.isEmpty()};compose.onNodeWithContentDescription("和自己比较").performScrollTo();shot("analysis-open");original("analysis-open","void uiCore.openHealthMetric('recovery','detail').then(()=>uiCore.toggleHealthAnalysis('recovery'));setTimeout(()=>document.querySelector('.health-analysis')?.scrollIntoView({block:'center'}),400)")
        clickText("依据");scrollTo(hasText("依据：这一项的每日汇总、近 7 天的深夜使用时长"));reveal(compose.onNodeWithText("依据：这一项的每日汇总、近 7 天的深夜使用时长"));shot("analysis-basis")
        val count=fixture("inspect").getJSONArray("requests").objects().count{it.optString("path").endsWith("/analysis")&&it.optString("method")=="POST"}
        clickDescription("展开这一项分析");clickDescription("展开这一项分析");assertEquals(count,fixture("inspect").getJSONArray("requests").objects().count{it.optString("path").endsWith("/analysis")&&it.optString("method")=="POST"})
        // Every card has native details. Only optional full old-screen entry uses WebView.
        main{activity.health.home()}
        for((id,name) in listOf("load" to "负荷","stress" to "压力","energy" to "电能","fitnessAge" to "体能年龄")+healthVitals.map{it to healthMetrics[it]!!.first}){
            clickDescription("$name，查看详情");settled();assertEquals(id,activity.health.metric);shot("$id-detail")
            if(id in listOf("stress","energy","fitnessAge")){clickText("依据");shot("$id-method")}
            compose.onNodeWithContentDescription("返回健康").performClick()
        }
        clickText("查看活动详情");settled();shot("activity-detail");clickText("原网页详情");waitFor("old exact screen"){activity.model.tab=="health-web"};waitFor("old day/metric",onMain=false){js("Boolean(uiCore.health.day==='2026-10-14'&&uiCore.health.metric==='activity'&&uiCore.health.view==='detail')")=="true"};shot("original-entry");compose.onNodeWithContentDescription("返回健康").performClick();settled();main{activity.health.home()}
        showText("昨晚的睡眠");compose.onNodeWithContentDescription("昨晚睡眠时长").assertTextEquals("7 小时 46 分");shot("sleep-summary")
        showText("今天的活动");shot("activity");clickText("查看其余运动");shot("activity-more")
        main{activity.health.home()};clickText("接着问它");waitFor("quoted draft"){activity.model.tab=="chat"&&activity.model.draft.startsWith("> 2026-10-14")};assertTrue(activity.model.draft.contains("把今天的节奏放轻松"));assertFalse(activity.model.running);assertEquals(0,fixture("inspect").getInt("sentMessages"));shot("quote-draft");main{activity.model.edit("")};tab()
        fixture("empty");main{activity.health.refresh()};settled();compose.onNodeWithText("把身体的变化放在一起看看").assertExists();shot("empty");original("empty")
        fixture("slow");main{activity.health.close();activity.model.launch{activity.health.prepare();activity.health.refresh()}};waitFor("loading"){activity.health.loading};shot("loading");settled()
        fixture("error");main{activity.health.refresh()};settled();shot("error");fixture("reset");clickText("重试");settled();assertEquals("",activity.health.error);shot("retry")
        // A later date request wins over a delayed earlier response.
        fixture("slow");main{activity.health.refresh("2026-10-13")};Thread.sleep(120);fixture("reset");main{activity.health.refresh("2026-10-14")};settled();Thread.sleep(1800);assertEquals("2026-10-14",activity.health.day)
        val settings=SecureSettings(activity);val connected=settings.host()!!;settings.saveHost(connected.copy(authSource="phone"));val before=fixture("inspect").getJSONArray("requests").length();main{activity.model.launch{activity.health.prepare()}};waitFor("phone only empty"){activity.health.noComputer&&!activity.health.loading};compose.onNodeWithText("把身体的变化放在一起看看").assertExists();assertEquals(before,fixture("inspect").getJSONArray("requests").length());shot("no-computer");settings.saveHost(connected)
        File(activity.filesDir,"and8-$variant-done.json").writeText(JSONObject().put("passed",true).put("variant",variant).put("systemSdk",android.os.Build.VERSION.SDK_INT).put("noAutoSend",true).put("staleDateDiscarded",true).toString())
        main{activity.finish()}
    }
}
