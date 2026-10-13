package com.memoweft.weftmate.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.app.NotificationManager
import org.json.JSONObject
import java.io.File

/** Only the isolated AND-5 application can use this instrumented readiness/notification probe. */
class And5QaReceiver:BroadcastReceiver(){
    override fun onReceive(context:Context,intent:Intent){
        if(context.packageName!="com.memoweft.weftmate.mobile.and5qa")return
        val visible=WeftMateApplication::class.java.getDeclaredField("visible").apply{isAccessible=true}.get(context.applicationContext) as Set<*>
        val activity=visible.filterIsInstance<NativeActivity>().firstOrNull()
        val manager=context.getSystemService(NotificationManager::class.java)
        val notice=manager.activeNotifications.firstOrNull{it.notification.extras.getString(android.app.Notification.EXTRA_TITLE)=="新的合成任务完成"}
        if(intent.getStringExtra("command")=="poll"){
            val pending=goAsync()
            Thread {
                val result=JSONObject().put("systemAllowed",ActivityNotifications(context).allowed())
                try { val host=SecureSettings(context).host()!!;ActivityNotifications(context).poll(host){SecureSettings(context).host()==host};result.put("passed",true) }
                catch(e:Exception){result.put("passed",false).put("failure",if(e is ApiFailure)e.safeCode else e.javaClass.simpleName)}
                finally{File(context.filesDir,"and5-notification-poll.json").writeText(result.toString());pending.finish()}
            }.start()
        }
        if(intent.getStringExtra("command")=="notification"){
            File(context.filesDir,"and5-notification-dispatch.json").writeText(JSONObject().put("hadActivity",activity!=null).put("noticeFound",notice!=null).put("pid",android.os.Process.myPid()).toString())
            notice?.notification?.contentIntent?.send()
        }
        val m=activity?.model;val feed=activity?.feed
        if(intent.getStringExtra("command")=="scroll-chat"&&m!=null){m.tab="chat";m.dark=intent.getStringExtra("theme")=="dark";m.launch{m.call("settings.appearance",JSONObject().put("value",if(m.dark)"dark" else "light"));m.refresh()}}
        File(context.filesDir,"and5-ready.json").writeText(JSONObject().put("pid",android.os.Process.myPid()).put("ready",m!=null&&!m.loading&&m.chatId.isNotEmpty()).put("tab",m?.tab ?: "").put("chatId",m?.chatId ?: "").put("rows",m?.rows?.size ?: 0).put("unread",feed?.unread ?: -1).put("hasDetail",feed?.detail!=null).put("noComputer",feed?.noComputer==true).put("noticeFound",notice!=null).put("systemAllowed",ActivityNotifications(context).allowed()).put("loading",feed?.loading==true).put("error",feed?.error ?: "").toString())
    }
}
