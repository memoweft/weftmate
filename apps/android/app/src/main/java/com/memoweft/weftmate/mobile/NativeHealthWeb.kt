package com.memoweft.weftmate.mobile

import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import org.json.JSONObject

/** Exact old day/metric screen remains reachable, including future web-only detail additions. */
@Composable internal fun NativeHealthWeb(model:NativeHealthModel,activity:NativeActivity,modifier:Modifier) {
    val identity=activity.embeddedWebIdentity ?: activity.embeddedWeb
    key(identity,model.day,model.webMetric,model.webView){AndroidView(factory={activity.webPage("health")},onRelease={activity.parkWeb()},modifier=modifier,update={web->
        val day=JSONObject.quote(model.day);val metric=JSONObject.quote(model.webMetric);val view=JSONObject.quote(model.webView)
        web.evaluateJavascript("""(()=>{const key=$day+'/'+$metric+'/'+$view;if(window.weftNativeHealthScreen===key)return;window.weftNativeHealthScreen=key;async function open(){if(window.weftNativeHealthScreen!==key)return;if(typeof uiCore==='undefined'||!state.booted){setTimeout(open,100);return;}try{await uiCore.readHealth($day);await uiCore.openHealthMetric($metric,$view);page('health')}catch{toast('暂时没能打开，请连接电脑后重试。',true)}}void open()})()""",null)
    })}
}
