package com.memoweft.weftmate.mobile

import android.content.Intent
import android.graphics.Rect
import android.view.FrameMetrics
import android.view.MotionEvent
import android.view.Window
import android.view.WindowInsets
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** Actual activity/recomposer/vsync: no Compose UI-test clock or hierarchy polling during animation. */
class NativeComposerPerformanceTest {
    private val i=InstrumentationRegistry.getInstrumentation()
    private val args=InstrumentationRegistry.getArguments()
    private lateinit var activity:NativeActivity
    private fun main(action:()->Unit)=i.runOnMainSync(action)
    private fun waitFor(label:String,test:()->Boolean) {
        val end=System.currentTimeMillis()+30000
        while(System.currentTimeMillis()<end){var ok=false;main{ok=test()};if(ok)return;Thread.sleep(50)}
        error("Timed out: $label")
    }
    private fun input(node:AccessibilityNodeInfo?):AccessibilityNodeInfo? {
        if(node==null)return null
        if(node.contentDescription?.toString()=="消息输入")return node
        for(index in 0 until node.childCount)input(node.getChild(index))?.let{return it}
        return null
    }
    @Test fun realKeyboardFrameMetrics() {
        assertEquals("com.memoweft.weftmate.mobile.and12qa",i.targetContext.packageName)
        val theme=args.getString("theme","light")!!
        activity=i.startActivitySync(Intent(i.targetContext,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra("lg1bHostOrigin",args.getString("origin"))) as NativeActivity
        val thread=android.os.HandlerThread("and12-real-frame-metrics").apply{start()}
        val durations=java.util.Collections.synchronizedList(mutableListOf<Pair<Long,Long>>())
        val listener=Window.OnFrameMetricsAvailableListener { _,frame,_ ->
            val deadline=if(android.os.Build.VERSION.SDK_INT>=31)frame.getMetric(FrameMetrics.DEADLINE) else -1L
            durations.add(frame.getMetric(FrameMetrics.TOTAL_DURATION) to deadline)
        }
        try {
            waitFor("restored synthetic account"){activity.model.loggedIn&&!activity.model.loading&&activity.model.rows.size>=80}
            main{activity.model.dark=theme=="dark";activity.model.edit("");activity.hideKeyboard()}
            Thread.sleep(700)
            val bounds=Rect();val editor=input(i.uiAutomation.rootInActiveWindow)
            assertNotNull("Editor accessibility node",editor);editor!!.getBoundsInScreen(bounds)
            assertFalse(bounds.isEmpty)
            val budget=1_000_000_000.0/activity.window.decorView.display.refreshRate
            main{activity.window.addOnFrameMetricsAvailableListener(listener,android.os.Handler(thread.looper))}
            fun save(name:String) {
                val times=synchronized(durations){durations.toList()}
                File(activity.getExternalFilesDir(null) ?: activity.filesDir,"and12-$theme-$name-real-metrics.json").writeText(JSONObject()
                    .put("measurement","650ms actual system IME animation; no Compose test clock; emulator")
                    .put("debuggable",activity.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0)
                    .put("displayFrameBudgetNs",budget).put("deadlineSource","FrameMetrics.DEADLINE, falling back only when unavailable")
                    .put("frameBudgetNs",times.map{if(it.second>0)it.second.toDouble() else budget}.average())
                    .put("frames",times.size).put("jankFrames",times.count{it.first>(if(it.second>0)it.second.toDouble() else budget)})
                    .put("durationsNs",JSONArray(times.map{it.first})).put("deadlinesNs",JSONArray(times.map{it.second})).toString(2))
                assertTrue("Rendered animation frames",times.isNotEmpty())
                durations.clear()
            }
            val now=android.os.SystemClock.uptimeMillis()
            i.sendPointerSync(MotionEvent.obtain(now,now,MotionEvent.ACTION_DOWN,bounds.exactCenterX(),bounds.exactCenterY(),0))
            i.sendPointerSync(MotionEvent.obtain(now,now+30,MotionEvent.ACTION_UP,bounds.exactCenterX(),bounds.exactCenterY(),0))
            Thread.sleep(650)
            main{assertTrue(activity.window.decorView.rootWindowInsets.getInsets(WindowInsets.Type.ime()).bottom>0)}
            save("keyboard-open")
            main{activity.hideKeyboard()};Thread.sleep(650);save("keyboard-close")
            main{assertFalse(activity.window.decorView.rootWindowInsets.isVisible(WindowInsets.Type.ime()))}
        } finally {
            main{activity.window.removeOnFrameMetricsAvailableListener(listener);activity.finish()}
            thread.quitSafely();thread.join(1000)
        }
    }
}
