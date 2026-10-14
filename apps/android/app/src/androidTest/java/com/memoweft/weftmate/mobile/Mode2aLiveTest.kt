package com.memoweft.weftmate.mobile

import android.content.Intent
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Test
import java.io.File

/** Read-only preflight on the installed test account. No authentication changes. */
class Mode2aLiveTest {
    @Test fun readExistingComputerCapability() {
        val i=InstrumentationRegistry.getInstrumentation()
        check(i.targetContext.packageName=="com.memoweft.weftmate.mobile.debug")
        val a=i.startActivitySync(Intent(i.targetContext,NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as NativeActivity
        try {
            val end=System.currentTimeMillis()+45000
            var ready=false
            while(!ready && System.currentTimeMillis()<end){i.runOnMainSync{ready=a.model.loggedIn && !a.model.loading && a.model.chatId.isNotEmpty()};Thread.sleep(100)}
            var result=JSONObject();var read=false
            i.runOnMainSync{a.model.launch {
                val status=runCatching{a.model.business("/status")}.getOrDefault(JSONObject())
                result=JSONObject().put("loggedIn",a.model.loggedIn).put("connected",a.model.connected)
                    .put("workAndChat",hostWorkAndChatDeclared(status)).put("computerVersion",status.optString("appVersion"))
                    .put("projectCount",a.model.projects.size).put("computerCount",a.model.computers.size)
                read=true
            }}
            while(!read && System.currentTimeMillis()<end)Thread.sleep(100)
            check(read)
            File(i.targetContext.getExternalFilesDir(null),"mode2a-existing-status.json").writeText(result.toString())
        } finally { i.runOnMainSync{a.finish()} }
    }
}
