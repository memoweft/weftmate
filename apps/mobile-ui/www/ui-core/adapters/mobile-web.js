/* Browser presentation uses the same /personal/v1 routes; no Android RPC simulation. */
globalThis.WeftUiCore.createMobileWebBridge = () => {
  let csrf=null;
  async function request(path,method='GET',body) {
    if(method!=='GET'&&!csrf){const me=await (await globalThis.fetch('/personal/v1/auth/me',{credentials:'same-origin'})).json();csrf=me.csrfToken;}
    const response=await globalThis.fetch(path,{method,credentials:'same-origin',headers:{'content-type':'application/json',...(method!=='GET'?{'x-weftmate-csrf':csrf}: {})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const value=await response.json();if(value.csrfToken)csrf=value.csrfToken;
    if(!response.ok)throw Object.assign(new Error(value.error?.code||'REQUEST_FAILED'),{status:response.status});return value;
  }
  async function call(method,p={}) {
    if(method==='host.status')return request('/personal/v1/status');
    if(method==='host.business')return request(p.path,p.method,p.body);
    if(method==='auth.me') {const value=await request('/personal/v1/auth/me');return {...value,...value.account,owner:value.account.ownerId,deviceId:value.device.id};}
    if(method==='models.host'){const value=await request('/personal/v1/models');return {...value,models:value.models.map(row=>({...row,profileId:row.id,displayName:row.name}))};}
    if(method==='shared.sessions.list'){const value=await request('/personal/v1/sessions?archived=all');return {...value,source:'host',hostAvailable:true,sessions:value.sessions.map(row=>({...row,source:'host'}))};}
    if(method==='shared.projects.list')return request('/personal/v1/projects');
    if(method==='shared.sessions.events'){const q=new URLSearchParams();for(const key of ['afterSeq','beforeSeq'])if(p[key]!=null)q.set(key,p[key]);return {...await request(`/personal/v1/sessions/${p.sessionId}/events?${q}`),source:'host',sessionId:p.sessionId,hostAvailable:true};}
    if(method==='shared.sessions.eventDetail')return request(`/personal/v1/sessions/${p.sessionId}/events/${p.seq}/detail`);
    if(method==='shared.commands.byRequest')return request(`/personal/v1/commands/by-request/${p.requestId}`);
    if(method==='shared.tasks.detail')return request(`/personal/v1/tasks/${p.taskId}`);
    if(method==='shared.tasks.stop')return request(`/personal/v1/tasks/${p.taskId}/stop`,'POST',p);
    if(method==='shared.stop'){const host=await request('/personal/v1/status'),result=await request('/personal/v1/commands','POST',{requestId:p.requestId,kind:'session.cancel',sessionId:p.sessionId,targetDeviceId:host.hostId});return {source:'host',sessionId:p.sessionId,requestId:p.requestId,state:'accepted',command:result.command};}
    if(method==='shared.send'){if(p.attachmentIds?.length)throw new Error('ATTACHMENT_UNAVAILABLE');const host=await request('/personal/v1/status'),result=await request('/personal/v1/commands','POST',{requestId:p.requestId,kind:'session.message',sessionId:p.sessionId,targetDeviceId:host.hostId,text:p.text,intent:p.intent||'queue'});return {source:'host',sessionId:p.sessionId,requestId:p.requestId,state:['accepted_by_dsh','observed'].includes(result.command.state)?'accepted':'uncertain',command:result.command};}
    if(/^shared\.(approvals|questions)\./.test(method)){const kind=method.split('.')[1],key=kind==='approvals'?'approvalId':'questionRpcId';return request(`/personal/v1/sessions/${p.sessionId}/${kind}${p[key]?'/'+p[key]:''}`,p[key]?'POST':'GET',p[key]?p:undefined);}
    if(method==='clipboard.copy'){await navigator.clipboard.writeText(p.text);return {};}
    if(['shared.outbox.list','shared.outbox.reconcile'].includes(method))return {commands:[],source:'host'};
    if(method==='activity.list'){const value=await request('/personal/v1/commands?limit=50');return {hostAvailable:true,activities:value.commands.map(row=>({...row,source:'host'}))};}
    if(['app.activity','conversations.list'].includes(method))return {conversations:[]};
    throw Object.assign(new Error('METHOD_UNKNOWN'),{status:400});
  }
  return {call,fetch:async(path,options={})=>{
    try{
      const method=options.method||'GET';
      if(method!=='GET'&&!csrf){const me=await (await globalThis.fetch('/personal/v1/auth/me',{credentials:'same-origin'})).json();csrf=me.csrfToken;}
      const headers=new Headers(options.headers);if(method!=='GET')headers.set('x-weftmate-csrf',csrf);
      const response=await globalThis.fetch(path,{...options,headers,credentials:'same-origin'});
      if(new URL(path,location.origin).pathname==='/personal/v1/sessions'&&method==='GET'&&response.ok){const value=await response.json();return {ok:true,status:200,json:async()=>({...value,source:'host',hostAvailable:true,sessions:value.sessions.map(row=>({...row,source:'host'}))})};}
      return response;
    }
    catch(error){return {ok:false,status:error.status||503,json:async()=>({error:{code:error.message}})};}
  }};
};
