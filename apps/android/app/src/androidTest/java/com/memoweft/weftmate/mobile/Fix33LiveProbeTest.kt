package com.memoweft.weftmate.mobile

import android.content.Intent
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Authorized existing debug login: metadata only, never reads credentials or account content. */
class Fix33LiveProbeTest {
    @Test fun inspectCurrentConnectionWithoutChangingLogin() {
        val i=InstrumentationRegistry.getInstrumentation()
        check(i.targetContext.packageName=="com.memoweft.weftmate.mobile.debug")
        i.runOnMainSync{android.webkit.WebView.setWebContentsDebuggingEnabled(true)}
        val a=i.startActivitySync(Intent(i.targetContext,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as NativeActivity
        Thread.sleep(5000)
        val done=CountDownLatch(1)
        i.runOnMainSync{
            val report=JSONObject().put("loggedIn",a.model.loggedIn).put("standalone",a.model.standalone).put("phone",a.model.phone).put("phoneArchive",a.model.phoneArchive)
                .put("loading",a.model.loading).put("connected",a.model.connected).put("chatCount",a.model.chats.size).put("modelCount",a.model.models.size).put("error",a.model.error)
            a.embeddedWeb.evaluateJavascript("""JSON.stringify({page:state.page,connection:state.connection,chatSource:state.chatSource,loggedIn:state.loggedIn,authBusy:state.authBusy,phoneActive:WeftPhone.active,phoneHasData:WeftPhone.hasData,logicalChats:state.logicalChats,sharedCount:state.sharedSessions?.length,auth:WeftMobileCloud.core.cloudAuthView(),origin:location.origin})"""){value->
                // Select fields before saving: cloudAuthView can contain account identifiers.
                val raw=runCatching{JSONObject(org.json.JSONArray("[$value]").getString(0))}.getOrDefault(JSONObject())
                val safe=JSONObject();for(key in listOf("page","connection","chatSource","loggedIn","authBusy","phoneActive","phoneHasData","logicalChats","sharedCount","origin"))if(raw.has(key))safe.put(key,raw.get(key))
                val auth=raw.optJSONObject("auth");val authSafe=JSONObject();for(key in listOf("mode","step","busy","error","cloudOnly","cachedSession","localSession"))if(auth?.has(key)==true)authSafe.put(key,auth.get(key))
                safe.put("auth",authSafe);report.put("web",safe)
                File(a.filesDir,"fix33-live-state.json").writeText(report.toString(2));done.countDown()
            }
        }
        check(done.await(10,TimeUnit.SECONDS))
        val hold=InstrumentationRegistry.getArguments().getString("holdMs")?.toLongOrNull() ?: 0L
        if(hold>0) Thread.sleep(hold)
        // Leave the app and logged-in account available for the authorized follow-up.
    }
}
