package com.memoweft.weftmate.mobile

import kotlinx.coroutines.*
import org.json.JSONObject
import java.util.UUID
import kotlin.coroutines.resume

/** Presentation adapter to the existing account/phone engine; no credentials or second settings store. */
internal class NativeSettingsBridge(private val activity: NativeActivity) {
    suspend fun call(action: String, params: JSONObject = JSONObject()): JSONObject {
        val key = JSONObject.quote(UUID.randomUUID().toString())
        activity.embeddedWeb.evaluateJavascript("""
          (()=>{window.weftSettingsResults??={};const results=window.weftSettingsResults;results[$key]=null;
          const action=${JSONObject.quote(action)},p=$params,identity=state.authEpoch,generation=uiCore.state.identityGeneration;
          const current=()=>identity===state.authEpoch&&generation===uiCore.state.identityGeneration;
          async function execute(){
            uiCore.syncMobileIdentity();
            const cloud=uiCore.state.cloudAuth?.mode==='authenticated';
            switch(action){
              case 'home':{if(!cloud){const profile=await call('auth.me');if(current())state.profile=profile;}return {categories:mobileSettingsRegistry.list().map(({id,name,group,icon})=>({id,name,group,icon})),profile:state.profile||{},email:uiCore.state.cloudAuth?.email||state.username,appearance:{...mobileAppearanceStore.value,theme:state.appearance||'system'},reducedMotion:!!WeftReplyMotion.reduced,presets:WeftOnboardingCopy.presets.filter(x=>x.id!=='local'),cloud};}
              case 'appearance':{if(p.theme){const saved=await uiCore.mobileAppearance(p.theme);if(!current())return {};applyAppearancePreference(saved);}if(!current())return {};mobileAppearanceStore.set({...mobileAppearanceStore.value,...p});applyTheme(state.appearance||'system');return {appearance:{...mobileAppearanceStore.value,theme:state.appearance||'system'}};}
              case 'motion':if(p.preference)WeftReplyMotion.setPreference(p.preference);return {reduced:WeftReplyMotion.reduced,preference:WeftReplyMotion.preference};
              case 'directory':{const value=cloud?await uiCore.cloudDirectory():await call('auth.devices');return {...value,multiHost:uiCore.state.cloudAuth?.multiHostSupported===true};}
              case 'rename':return cloud?(p.hostId&&uiCore.state.cloudAuth.multiHostSupported?await uiCore.cloudRenameComputer(p.hostId,p.name):await uiCore.cloudRename(p.id,p.name)):await call('auth.renameDevice',{deviceId:p.id,name:p.name});
              case 'remove':if(cloud){if(p.hostId&&uiCore.state.cloudAuth.multiHostSupported)return await uiCore.cloudRemoveComputer(p.hostId);const result=await uiCore.cloudRemove(p.id);if(p.current)await uiCore.cloudLogout();return result;}return await call('auth.revokeDevice',{deviceId:p.id});
              case 'connect':{const result=await uiCore.cloudConnect(p.hostId);if(result.status!=='online')throw Error('这台电脑暂时不在线，请稍后重试。');if(result.pairingRequired)throw Error('请先更新这台电脑上的 WeftMate，再重新连接。');await uiCore.cloudConnectTrusted(result);await uiCore.enterAssistant();return {};}
              case 'profile':{const value=await call('auth.profile',{displayName:p.name,expectedRevision:state.profile?.profileRevision||0});if(current())state.profile=value;return value;}
              case 'password':return cloud?await uiCore.cloudChangePassword(p.current,p.password,p.confirmation):await call('auth.changePassword',{currentPassword:p.current,newPassword:p.password});
              case 'emailRequest':return await uiCore.cloudEmailRequest(p.email);
              case 'emailConfirm':return await uiCore.cloudEmailConfirm(p.code);
              case 'logout':return cloud?await uiCore.cloudLogout():await call('auth.logout');
              case 'logoutOthers':return await uiCore.cloudLogoutOthers();
              case 'phoneService':return await WeftPhone.serviceCall(p.action,p.body||{});
              case 'hostServices':await uiCore.refreshModelServices(p.force===true);return {...uiCore.modelServicesView()};
              case 'hostSelect':await uiCore.selectServiceModel(p);return {...uiCore.modelServicesView()};
              case 'thinking':return await uiCore.thinkingView();
              case 'setThinking':await uiCore.setDeepThinking(p.enabled);return await uiCore.thinkingView();
              case 'cloudModels':page('models');await uiCore.refreshModelServices().catch(()=>{});accountCloudModelsPage(document.getElementById('page-content'));return {};
              case 'legal':await mobileSettingsLegal(p.kind);return {};
              default:throw Error('UNKNOWN_SETTINGS_ACTION');
            }
          }
          Promise.resolve().then(execute).then(value=>{if(Object.hasOwn(results,$key))results[$key]=current()?{value:value||{}}:{error:'账户已切换，请重新打开。'}})
          .catch(e=>{if(Object.hasOwn(results,$key))results[$key]={error:typeof safeError==='function'?safeError(e):'暂时没能完成，请重试。'}});})()
        """.trimIndent(), null)
        try { return withTimeout(60000) {
            while (true) {
                val result = suspendCancellableCoroutine<JSONObject?> { c ->
                    activity.embeddedWeb.evaluateJavascript("window.weftSettingsResults?.[$key]||null") { raw ->
                        if(c.isActive)c.resume(runCatching { JSONObject(raw) }.getOrNull())
                    }
                }
                if(result != null) { check(!result.has("error")) { result.optString("error") }; return@withTimeout result.optJSONObject("value") ?: JSONObject() }
                delay(50)
            }
            @Suppress("UNREACHABLE_CODE") JSONObject()
        } } finally { activity.embeddedWeb.evaluateJavascript("delete window.weftSettingsResults?.[$key]",null) }
    }
}
