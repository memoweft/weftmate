/* Native model vault and workspace recovery over ordinary state, without DOM. */
globalThis.WeftUiCore.factories.mobileSettings = (core, effects, environment) => {
 if (!environment.mobileState) return {};
 const state=environment.mobileState;
 const projectIdPattern=/^project-[A-Za-z0-9-]{1,128}$/;
 const profileIdPattern=core.browserModelId, sessionIdPattern=core.sessionIdPattern;
 function projectIntentKey(hostId){return `weftmate-project-create:${state.owner}:${hostId}`}

function savedProjectIntent(hostId){try{const value=JSON.parse(environment.storage.getItem(projectIntentKey(hostId))||'null');
  return value?.owner===state.owner&&value.hostId===hostId&&projectIdPattern.test(value.projectId||'')&&
    profileIdPattern.test(value.modelProfileId||'')&&/^[0-9a-f-]{36}$/.test(value.requestId||'')?value:null}catch{return null}}

function projectIntentCurrent(owner,epoch,generation){return state.loggedIn&&state.owner===owner&&
  state.authEpoch===epoch&&state.page==='workspaces'&&state.generation===generation&&!state.transitionPending}

function browserIntentKey(hostId){return `weftmate-browser-create:${state.owner}:${hostId}`}

function savedBrowserIntent(hostId){try{const value=JSON.parse(environment.storage.getItem(browserIntentKey(hostId))||'null');
  return value?.owner===state.owner&&value.hostId===hostId&&profileIdPattern.test(value.modelProfileId||'')&&
    /^[0-9a-f-]{36}$/.test(value.sessionRequestId||'')&&/^[0-9a-f-]{36}$/.test(value.messageRequestId||'')&&
    typeof value.goal==='string'&&value.goal.length>0&&value.goal.length<=6000&&
    Array.isArray(value.urls)&&value.urls.length>=1&&value.urls.length<=5&&
    value.urls.every(url=>typeof url==='string'&&url.length<=2048)?value:null}catch{return null}}

async function resolveBrowserIntent(intent,message){const owner=state.owner,epoch=state.authEpoch,generation=state.generation;
  const current=()=>projectIntentCurrent(owner,epoch,generation),sameOwner=()=>state.owner===owner&&
    state.authEpoch===epoch&&!state.transitionPending;
  if(!current())return;effects.paintWorkspaceNotice(message,'正在核对原网页会话请求…');
  let command=null;
  try{command=(await core.android.call('shared.commands.byRequest',{requestId:intent.sessionRequestId}))?.command||null}
  catch(error){if(!current())return;if(error?.message!=='NOT_FOUND'){
    effects.paintWorkspaceNotice(message,'暂时无法核对原网页会话，原选择和编号已保留。');return}}
  if(!command){try{const result=await core.android.call('host.business',{path:'/personal/v1/workspaces/browser/sessions',
      method:'POST',body:{requestId:intent.sessionRequestId,modelProfileId:intent.modelProfileId}});
      if(!current())return;command=result?.command||null}
    catch{if(current())effects.paintWorkspaceNotice(message,'网页会话送达状态不明；重连后先查原编号，不会重复创建。');return}}
  if(command?.kind!=='session.create'||command.requestId!==intent.sessionRequestId||
    command.workspaceKind!=='browser'||!sessionIdPattern.test(command.sessionId||'')){
    if(current())effects.paintWorkspaceNotice(message,'网页会话回执与原选择不一致，编号已保留供核对。');return}
  for(let attempt=0;attempt<5&&current()&&['pending','dispatching'].includes(command.state);attempt++){
    await new Promise(resolve=>setTimeout(resolve,800));if(!current())return;
    try{command=(await core.android.call('shared.commands.byRequest',{requestId:intent.sessionRequestId}))?.command||command}
    catch{break}}
  if(command.state!=='accepted_by_dsh'){
    if(current())effects.paintWorkspaceNotice(message,'电脑尚未确认网页会话；原选择与请求编号已保留。');return}
  let session=null;
  try{const listed=await core.android.call('shared.sessions.list');if(!current())return;
    if(listed?.source!=='host'||!Array.isArray(listed.sessions))throw new Error('SESSION_UNAVAILABLE');
    session=listed.sessions.find(item=>item.sessionId===command.sessionId&&item.workspaceKind==='browser'&&
      item.modelProfileId===intent.modelProfileId)||null;
    if(!session){effects.paintWorkspaceNotice(message,'网页会话已受理，正在等待准确会话绑定进入列表。');return}
    state.sharedSessions=listed.sessions.filter(item=>item?.source==='host'&&typeof item.sessionId==='string');
    effects.selectSharedSession(command.sessionId)
  }catch{if(current())effects.paintWorkspaceNotice(message,'网页会话列表暂不可核对；原编号仍保留。');return}
  if(!sameOwner())return;
  const text=`${intent.goal}\n\n网页链接：\n${intent.urls.join('\n')}`;
  let sent=null;
  try{sent=(await core.android.call('shared.commands.byRequest',{requestId:intent.messageRequestId}))?.command||null}
  catch(error){if(!sameOwner())return;if(error?.message!=='NOT_FOUND'){
    effects.status('网页目标状态待核对，原消息编号仍保留');return}}
  if(!sent){try{const result=await core.android.call('shared.send',{sessionId:command.sessionId,
      text,requestId:intent.messageRequestId});if(!sameOwner())return;
      if(result?.source!=='host'||result.sessionId!==command.sessionId||
        result.requestId!==intent.messageRequestId){effects.status('网页目标回执不完整，原编号已保留');return}
      if(result.state==='accepted'){
        environment.storage.removeItem(browserIntentKey(intent.hostId));
        effects.status('网页目标已送达电脑会话，正在等待实际阅读结果');void effects.loadSharedHistory();return}
      effects.status('网页目标送达结果待核对；原编号已保留，不会自动重复发送');return}
    catch{if(sameOwner())effects.status('网页目标送达状态不明；原编号已保留，重连后先查询');return}}
  if(sent.requestId===intent.messageRequestId&&sent.sessionId===command.sessionId&&
      sent.kind==='session.message'&&sent.state==='accepted_by_dsh'){
    environment.storage.removeItem(browserIntentKey(intent.hostId));
    effects.status('网页目标已在原电脑会话受理');void effects.loadSharedHistory();return}
  effects.status('网页目标尚未确认受理；原消息编号仍保留')
}

async function resolveProjectSessionIntent(intent,message){
  const owner=state.owner,epoch=state.authEpoch,generation=state.generation;
  const current=()=>projectIntentCurrent(owner,epoch,generation);
  if(!current())return;
  effects.paintWorkspaceNotice(message,'正在核对上次项目会话请求…');
  let command=null;
  try{const result=await core.android.call('shared.commands.byRequest',{requestId:intent.requestId});
    if(!current())return;command=result?.command||null}
  catch(error){if(!current())return;if(!['NOT_FOUND','SESSION_UNAVAILABLE'].includes(error?.message)){
    effects.paintWorkspaceNotice(message,'当前无法核对原请求。项目与模型选择已保留，重连后再试。');return}}
  if(!command){try{const result=await core.android.call('shared.projects.createSession',{projectId:intent.projectId,
      modelProfileId:intent.modelProfileId,requestId:intent.requestId});
      if(!current())return;command=result?.command||null;
      if(result?.source!=='host'||command?.requestId!==intent.requestId)throw new Error('COMMAND_RECEIPT_INVALID')}
    catch(error){if(current())effects.paintWorkspaceNotice(message,'送达状态尚不明确。保留原请求编号；重连后会先查询再重试。');return}}
  if(command.kind!=='session.create'||command.requestId!==intent.requestId||
    command.projectId!==intent.projectId||!sessionIdPattern.test(command.sessionId||'')){
    if(current())effects.paintWorkspaceNotice(message,'会话回执与原选择不一致，已保留请求供核对。');return}
  if(['pending','dispatching'].includes(command.state)){
    for(let attempt=0;attempt<5&&current()&&['pending','dispatching'].includes(command.state);attempt++){
      await new Promise(resolve=>setTimeout(resolve,800));
      if(!current())return;
      try{command=(await core.android.call('shared.commands.byRequest',{requestId:intent.requestId}))?.command||command}
      catch{break}}
    if(['pending','dispatching'].includes(command.state)){
      if(current())effects.paintWorkspaceNotice(message,'电脑已记录请求，正在创建会话；稍后可用同一选择继续核对。');return}}
  if(command.state!=='accepted_by_dsh'){
    if(current())effects.paintWorkspaceNotice(message,'电脑尚未确认会话创建；原选择和编号仍保留。');return}
  try{const result=await core.android.call('shared.sessions.list');if(!current())return;
    if(result?.source!=='host'||!Array.isArray(result.sessions))throw new Error('SESSION_UNAVAILABLE');
    const exact=result.sessions.find(item=>item.sessionId===command.sessionId&&item.projectId===intent.projectId&&
      item.modelProfileId===intent.modelProfileId);
    if(!exact){effects.paintWorkspaceNotice(message,'会话已受理，正在等待项目绑定出现在列表；原编号已保留。');return}
    state.sharedSessions=result.sessions.filter(item=>item?.source==='host'&&typeof item.sessionId==='string');
    environment.storage.removeItem(projectIntentKey(intent.hostId));
    effects.selectSharedSession(command.sessionId);
    effects.toast('项目会话已打开，可在原对话发送摘要目标。')
  }catch(error){if(current())effects.paintWorkspaceNotice(message,'会话列表暂时不可核对；原选择和编号已保留。')}
}

function accountModelIntentKey(kind,id){return `weftmate-account-model:${kind}:${state.owner}:${id}`}

function savedAccountModelIntent(kind,id){try{const value=JSON.parse(environment.storage.getItem(accountModelIntentKey(kind,id))||'null');
  return value?.owner===state.owner&&/^[0-9a-f-]{36}$/.test(value.requestId||'')?value:null}catch{return null}}

function clearAccountModelIntent(kind,id,requestId){if(savedAccountModelIntent(kind,id)?.requestId===requestId)
  try{environment.storage.removeItem(accountModelIntentKey(kind,id))}catch{}}

function modelPageCurrent(owner,epoch,generation){return state.page==='models'&&state.owner===owner&&
  state.authEpoch===epoch&&state.generation===generation&&!state.transitionPending}

async function publishSavedPhoneModel(item){const owner=state.owner,epoch=state.authEpoch,generation=state.generation,
  id=`${item.endpoint}|${item.modelId}`,current=()=>modelPageCurrent(owner,epoch,generation);
  let marker=savedAccountModelIntent('publish',id);
  if(marker&&(marker.endpoint!==item.endpoint||marker.modelId!==item.modelId)){
    effects.toast('原上传请求仍待核对；请保持原手机模型',true);return}
  marker ||= {owner,requestId:environment.crypto.randomUUID(),endpoint:item.endpoint,modelId:item.modelId};
  try{environment.storage.setItem(accountModelIntentKey('publish',id),JSON.stringify(marker))}
  catch{effects.toast('无法保存上传编号，本次没有提交',true);return}
  try{const result=await core.android.call('models.account.publishSaved',{endpoint:item.endpoint,
    modelId:item.modelId,requestId:marker.requestId});if(!current())return;
    const operation=result?.operation;
    if(operation?.requestId!==marker.requestId){effects.toast('上传回执无法核对；原编号已保留',true);return}
    if(operation.status==='succeeded'){
      clearAccountModelIntent('publish',id,marker.requestId);
      effects.toast('原手机模型已保存到当前电脑账户；已有会话目的地保持不变');effects.page('models')
    }else if(operation.status==='failed'){
      clearAccountModelIntent('publish',id,marker.requestId);
      effects.toast(effects.safeError({message:operation.errorCode||operation.reasonCode||'OPERATION_FAILED'}),true)
    }else effects.toast('电脑仍在处理原模型配置，请稍后用同编号核对',true)
  }catch(error){if(current())effects.toast(error?.message==='TIMEOUT'
    ? '上传结果待核对；原请求编号已保留，不会换模型':effects.safeError(error),true)}}

async function transferAccountModel(item,replaceExistingKey=false){const owner=state.owner,epoch=state.authEpoch,
  generation=state.generation,current=()=>modelPageCurrent(owner,epoch,generation),
  id=`${item.accountModelId}:${item.revision}`;
  let marker=replaceExistingKey?null:savedAccountModelIntent('transfer',id);
  if(marker&&(marker.accountModelId!==item.accountModelId||marker.expectedRevision!==item.revision)){
    effects.toast('原下载请求仍待核对，请保持原配置修订',true);return}
  marker ||= {owner,requestId:environment.crypto.randomUUID(),accountModelId:item.accountModelId,
    expectedRevision:item.revision};
  try{environment.storage.setItem(accountModelIntentKey('transfer',id),JSON.stringify(marker))}
  catch{effects.toast('无法保存取回编号，本次没有提交',true);return}
  try{const result=await core.android.call('models.account.transfer',{accountModelId:item.accountModelId,
    expectedRevision:item.revision,requestId:marker.requestId,replaceExistingKey});if(!current())return;
    if(result?.requestId!==marker.requestId){effects.toast('取回回执无法核对；原编号已保留',true);return}
    if(result.status==='credential_conflict'){
      clearAccountModelIntent('transfer',id,marker.requestId);
      state.accountModelCredentialConflict={owner,id,item};
      effects.toast('手机同一地址已有不同密钥，原配置与当前模型未改变',true);effects.page('models');return}
    if(result.status==='saved'){
      clearAccountModelIntent('transfer',id,marker.requestId);
      state.accountModelCredentialConflict=null;
      effects.toast('已加密存到手机。要改为手机直连，请在本机模型列表明确选择');effects.page('models')
    }else effects.toast('取回结果待核对，原手机配置保持不变',true)
  }catch(error){if(current())effects.toast(effects.safeError(error),true)}}

async function testAccountModel(item){const owner=state.owner,epoch=state.authEpoch,
  generation=state.generation,current=()=>modelPageCurrent(owner,epoch,generation),
  id=`${item.accountModelId}:${item.revision}`;
  let marker=savedAccountModelIntent('test',id);
  marker ||= {owner,requestId:environment.crypto.randomUUID(),accountModelId:item.accountModelId,
    expectedRevision:item.revision};
  try{environment.storage.setItem(accountModelIntentKey('test',id),JSON.stringify(marker))}
  catch{effects.toast('无法保存测试编号，本次没有提交',true);return}
  try{let result;try{result=await core.android.call('models.account.byRequest',{requestId:marker.requestId})}
    catch(error){if(error?.message!=='NOT_FOUND')throw error}
    if(!current())return;
    result ||= await core.android.call('models.account.test',{accountModelId:item.accountModelId,
      expectedRevision:item.revision,requestId:marker.requestId});
    if(!current())return;
    if(result?.operation?.requestId!==marker.requestId||result.operation.kind!=='test')
      throw new Error('MODEL_RECEIPT_INVALID');
    if(result.operation.status==='succeeded'){
      clearAccountModelIntent('test',id,marker.requestId);
      const checked=result.operation.testResult;
      const passed=checked?.configured===true&&checked.reachable===true&&checked.modelListed===true;
      effects.toast(passed?'目录与鉴权已核对；尚未发送推理消息':
        '连接检查已完成，但目录、鉴权或模型列表未通过；尚未发送推理消息',!passed)
    }else if(result.operation.status==='failed'){
      clearAccountModelIntent('test',id,marker.requestId);
      effects.toast(effects.safeError({message:result.operation.errorCode||result.operation.reasonCode||'OPERATION_FAILED'}),true)
    }else effects.toast('连接检查仍在处理，原测试编号已保留',true)
  }catch(error){if(current())effects.toast(effects.safeError(error),true)}}
 return {mobileSettings:{projectIntentKey, savedProjectIntent, projectIntentCurrent, browserIntentKey, savedBrowserIntent, resolveBrowserIntent, resolveProjectSessionIntent, accountModelIntentKey, savedAccountModelIntent, clearAccountModelIntent, modelPageCurrent, publishSavedPhoneModel, transferAccountModel, testAccountModel},
   readMobileSystem:()=>{core.syncMobileIdentity();return core.accessApi('/system')},
   readMobileModelSettings:()=>{core.syncMobileIdentity();return core.accessApi('/settings/models')},
   createMobileBrowserSession:body=>{core.syncMobileIdentity();return core.accessApi('/workspaces/browser/sessions',{method:'POST',protectedWrite:true,body})},
   async mobileAppearance(value) {
     const saved=await core.android.call('settings.appearance', value===undefined?{}:{value});
     core.appearance.set({theme:saved.value},false);
     return saved;
   },
 };
};
