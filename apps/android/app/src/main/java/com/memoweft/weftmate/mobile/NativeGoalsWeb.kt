package com.memoweft.weftmate.mobile

import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import org.json.JSONObject

/** Existing screens remain reachable for offline queue and remote-computer conversation operations. */
@Composable internal fun NativeGoalsWeb(model:NativeGoalsModel,activity:NativeActivity,modifier:Modifier) {
    val payload=model.webPayload ?: return
    val page=payload.optString("page","goals")
    val identity=activity.embeddedWebIdentity ?: activity.embeddedWeb
    key(identity,payload.toString()) {
        AndroidView(factory={activity.webPage(page)},onRelease={activity.parkWeb()},modifier=modifier,update={web->
            if(page=="chat") {
                val row=payload.optJSONObject("row")
                if(row!=null)LaunchedGoalSource(web,row)
            }
        })
    }
}
private fun LaunchedGoalSource(web:android.webkit.WebView,row:JSONObject) {
    val value=JSONObject.quote(row.toString())
    web.evaluateJavascript("""(()=>{const key=$value;if(window.weftNativeGoalSource===key)return;window.weftNativeGoalSource=key;const row=JSON.parse(key);async function open(){if(window.weftNativeGoalSource!==key)return;if(typeof uiCore==='undefined'||!state.booted){setTimeout(open,100);return;}try{uiCore.syncMobileIdentity();if(row.hostId&&uiCore.currentExecutionComputer?.()!==row.hostId)await uiCore.selectExecutionComputer(row.hostId);const source=row.source||{sessionId:row.sessionId};await openGoalSource(source);page('chat');}catch(e){toast('暂时没能打开，请连接电脑后重试。',true)}}void open()})()""",null)
}
