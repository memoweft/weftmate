package com.memoweft.weftmate.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.io.File

/** Synthetic-package-only readiness probe. No content or credentials enter the report. */
class And4QaReceiver : BroadcastReceiver() {
    override fun onReceive(context:Context,intent:Intent) {
        if(context.packageName !in setOf("com.memoweft.weftmate.mobile.and4qa", "com.memoweft.weftmate.mobile.startupqa"))return
        if(intent.getStringExtra("command")=="inspect")android.webkit.WebView.setWebContentsDebuggingEnabled(true)
        val visible=WeftMateApplication::class.java.getDeclaredField("visible").apply{isAccessible=true}.get(context.applicationContext) as Set<*>
        val activity=visible.filterIsInstance<NativeActivity>().firstOrNull()
        if(intent.getStringExtra("command")=="login" && activity!=null) {
            val params=JSONObject().put("origin",intent.getStringExtra("origin")).put("username",intent.getStringExtra("username")).put("password",intent.getStringExtra("password")).put("deviceName","Synthetic metrics")
            activity.embeddedWeb.evaluateJavascript("(function login(){if(typeof call==='function' && typeof state!=='undefined' && state.booted)call('auth.login',$params).then(()=>location.reload());else setTimeout(login,100)})()",null)
        }
        if(intent.getStringExtra("command")=="draft" && activity!=null)activity.model.edit("重开保留的草稿")
        if(intent.getStringExtra("command")=="theme" && activity!=null)activity.model.dark=intent.getBooleanExtra("dark",false)
        if(intent.getStringExtra("command")=="page" && activity!=null)activity.pages.open(intent.getStringExtra("page") ?: "help",JSONObject(intent.getStringExtra("params") ?: "{}"))
        if(intent.getStringExtra("command")=="settings" && activity!=null)activity.settings.open(intent.getStringExtra("page") ?: "")
        if(intent.getStringExtra("command")=="tab" && activity!=null)activity.model.tab=intent.getStringExtra("tab") ?: "chat"
        if(intent.getStringExtra("command")=="field" && activity!=null)activity.pages.values[intent.getStringExtra("key") ?: ""]=intent.getStringExtra("value") ?: ""
        if(intent.getStringExtra("command")=="pageAction" && activity!=null)activity.pages.data.optJSONArray("sections")?.objects().orEmpty().flatMap{it.optJSONArray("rows")?.objects().orEmpty()}.firstOrNull{it.optString("label")==intent.getStringExtra("label")}?.let{activity.pages.act(it)}
        val model=activity?.model
        val insets=activity?.presentationContainer?.let{androidx.core.view.ViewCompat.getRootWindowInsets(it)}
        val state=JSONObject().put("pid",android.os.Process.myPid())
            .put("ready",model!=null&&!model.loading&&model.chatId.isNotBlank())
            .put("rows",model?.rows?.size ?: 0).put("error",model?.error ?: "").put("dark",model?.dark==true)
            .put("loggedIn",model?.loggedIn==true).put("loading",model?.loading==true)
            .put("tab",model?.tab).put("page",activity?.pages?.page).put("pageLoading",activity?.pages?.loading).put("pageError",activity?.pages?.error)
            .put("pageRows",activity?.pages?.data?.optJSONArray("sections")?.objects().orEmpty().sumOf{it.optJSONArray("rows")?.length() ?: 0})
            .put("engineVisible",activity?.embeddedWeb?.visibility==android.view.View.VISIBLE)
            .put("restoredDraft",model?.draft=="重开保留的草稿")
            .put("statusHeight",insets?.getInsets(androidx.core.view.WindowInsetsCompat.Type.statusBars())?.top ?: -1)
            .put("navigationBottom",insets?.getInsets(androidx.core.view.WindowInsetsCompat.Type.navigationBars())?.bottom ?: -1)
        File(context.filesDir,"and4-ready.json").writeText(state.toString())
        resultData=state.toString()
    }
}
