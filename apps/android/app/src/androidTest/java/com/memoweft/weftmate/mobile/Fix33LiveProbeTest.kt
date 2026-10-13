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
        org.junit.Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("fix33LiveAccount")=="authorized")
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
        val peer=JSONObject()
        // Public configuration only: standard CA/domain checks, no Cookie, token or content.
        // Comparing certificate metadata diagnoses a stored pin; it never changes that pin.
        val host=CloudAppLogin(SecureSettings(a),PersonalApi()).hostOrigin()
        if(host!=null && host!="https://api.weftmate.com") {
            val connection=java.net.URL(host+"/personal/v1/cloud/config").openConnection() as javax.net.ssl.HttpsURLConnection
            try {
                connection.connectTimeout=5000;connection.readTimeout=5000
                peer.put("status",connection.responseCode)
                val certificate=connection.serverCertificates[0] as java.security.cert.X509Certificate
                peer.put("caAndDomainValid",true).put("pinKnown",CloudPins.has(host)).put("pinMatches",CloudPins.matches(host,certificate))
                    .put("certificateExpired",certificate.notAfter.time<System.currentTimeMillis())
            } catch(e:Exception) { peer.put("caAndDomainValid",false).put("code",cloudAppFailure(e).safeCode) }
            finally {connection.disconnect()}
        }
        File(a.filesDir,"fix33-live-peer.json").writeText(peer.toString(2))
        if(host!=null && host!="https://api.weftmate.com") {
            val pinned=java.net.URL(host+"/personal/v1/cloud/config").openPinnedConnection()
            try {pinned.connectTimeout=5000;pinned.readTimeout=5000;peer.put("pinnedStatus",pinned.responseCode)}
            catch(e:Exception){peer.put("pinnedCode",cloudAppFailure(e).safeCode)}finally{pinned.disconnect()}
            File(a.filesDir,"fix33-live-peer.json").writeText(peer.toString(2))
        }
        val hold=InstrumentationRegistry.getArguments().getString("holdMs")?.toLongOrNull() ?: 0L
        if(hold>0) Thread.sleep(hold)
        // Leave the app and logged-in account available for the authorized follow-up.
    }
}
