package com.memoweft.weftmate.mobile

import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import org.json.JSONObject

/** Only existing complex memory editing, settings and artifact preview remain embedded. */
@Composable internal fun NativeFeedWeb(feed:NativeFeedModel,activity:NativeActivity,modifier:Modifier) {
    val payload=feed.webDetail ?: return
    val webInstance=activity.embeddedWebIdentity ?: activity.embeddedWeb
    val value=JSONObject.quote(payload.toString())
    key(webInstance,value) {
    val scrollbars=remember{webInstance.isVerticalScrollBarEnabled to webInstance.isHorizontalScrollBarEnabled}
    val loadedHook=remember{arrayOfNulls<(() -> Unit)>(1)}
    // Compose can reuse the same WebView while disposing its previous slot. Never
    // clear the newly mounted instance's route or readiness from that old slot.
    DisposableEffect(webInstance){onDispose{if(activity.embeddedFeedLoaded===loadedHook[0])activity.embeddedFeedLoaded=null;webInstance.isVerticalScrollBarEnabled=scrollbars.first;webInstance.isHorizontalScrollBarEnabled=scrollbars.second}}
    AndroidView(factory={activity.webPage("activity").also{activity.displayedFeedWeb=it;it.isVerticalScrollBarEnabled=false;it.isHorizontalScrollBarEnabled=false;it.evaluateJavascript("window.weftNativeActivityAction=null;window.weftNativeMemoryReady=false",null)}},modifier=modifier,update={web->
        activity.displayedFeedWeb=web
        val script="""(() => {
          const key=$value;if(window.weftNativeActivityAction===key)return;window.weftNativeActivityAction=key;const p=JSON.parse(key);window.weftNativeFeedStage='waiting';
          function open(){
            if(window.weftNativeActivityAction!==key)return;
            if(typeof uiCore==='undefined'||!state.booted){setTimeout(open,100);return;}
            uiCore.syncMobileIdentity();window.weftNativeFeedStage='opening';
            if(p.action.kind==='native_memory_review'||p.action.kind==='native_activity_item'){
              page('activity');function ready(){
                if(window.weftNativeActivityAction!==key)return;
                if(uiCore.state.personalCapabilities?.activity!==1){setTimeout(ready,100);return;}
                window.weftNativeFeedStage='reading';uiCore.setActivityFilter(p.action.kind==='native_memory_review'?'memory':'all').then(async()=>{
                while(!uiCore.activity.items.some(r=>r.id===p.row.id)&&uiCore.activity.nextCursor)await uiCore.readActivity(true);
                if(window.weftNativeActivityAction!==key)return;
                function focus(){
                  if(window.weftNativeActivityAction!==key)return;
                  document.querySelectorAll('.activity-heading,.activity-filters,.activity-notice,.activity-page>p.muted').forEach(el=>el.style.display='none');
                  let selected;document.querySelectorAll('[data-activity-id]').forEach(el=>{const match=el.dataset.activityId===p.row.id;el.style.display=match?'':'none';if(match)selected=el;});
                  window.weftNativeMemoryReady=!!selected;window.weftNativeFeedStage=selected?'ready':'missing-row';
                }
                focus();window.weftNativeMemoryObserver?.disconnect();window.weftNativeMemoryObserver=new MutationObserver(focus);
                const days=document.querySelector('.activity-days');if(days)window.weftNativeMemoryObserver.observe(days,{childList:true,subtree:true});
                setTimeout(()=>{focus();[...document.querySelectorAll('[data-activity-id]')].find(el=>el.dataset.activityId===p.row.id)?.scrollIntoView({block:'start'});},100);
              }).catch(e=>{window.weftNativeFeedStage='error:'+String(e?.message||e?.code||e)});}ready();
            }else uiCore.activityAction(p.row,p.action,p.outcome).catch(()=>toast('暂时没能打开，请重试。',true));
          }open();
        })()""".trimIndent()
        loadedHook[0]={if(activity.embeddedWeb===web)web.evaluateJavascript(script,null)}
        activity.embeddedFeedLoaded=loadedHook[0]
        web.evaluateJavascript(script,null)
    })
    }
}
