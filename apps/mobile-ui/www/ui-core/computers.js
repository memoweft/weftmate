/* Computer ownership is fixed for an existing conversation and every retry. */
globalThis.WeftUiCore.chooseComputer = (computers, {sourceHostId,lastHostId} = {}) => {
  if (sourceHostId) return computers.find(row => row.hostId === sourceHostId)?.hostId || null;
  const online = computers.filter(row => row.online);
  return (online.find(row => row.hostId === lastHostId) || online[0])?.hostId || null;
};
globalThis.WeftUiCore.factories.computers = (core,effects,environment) => {
  const channels = new Map(), connecting = new Map(), snapshots = new Map();
  let enabled = false, current = null, directoryAt = 0, directoryRead;
  const original = {accessApi:core.accessApi,selectSession:core.selectSession,startNewConversation:core.startNewConversation,clearSession:core.clearSession};
  const json=core.requestJson;
  core.requestJson=(url,options)=>{
    const path=String(url).startsWith(core.accessBase)?String(url).slice(core.accessBase.length):null;
    if(enabled&&current&&current!==core.cloudCurrentComputer?.()&&path&&(!path.startsWith('/auth/')||path==='/auth/me'))return request(current,path,options);
    return json(url,options);
  };
  const lastKey = () => `weftmate-computer:${core.state.cloudAuth?.sub || ''}`;
  const name = id => {const row=core.state.computers?.find(row=>row.hostId===id);return row?.displayName || row?.name || '这台电脑';};
  // bindDesktop verifies nativeIdentity/ownHost; the current cloud target alone may be remote.
  const isLocalComputer = id => environment.desktop && environment.bindDesktop === true && id === core.cloudCurrentComputer?.();
  core.computerName = name;
  core.hasMultipleComputers = () => core.state.computers?.length > 1;
  core.canChooseExecutionComputer=()=>enabled&&core.hasMultipleComputers();
  core.canUseComputerChannel=()=>enabled;
  core.updateComputerDirectory = result => {
    enabled = result.capabilities?.multiHost === 1 && (!environment.desktop || core.state.personalCapabilities?.workAndChat === 1) && typeof effects.openComputerChannel === 'function';
    core.state.computers = result.capabilities?.multiHost===1 ? result.hosts || [] : [];
    if(!enabled)current=core.cloudCurrentComputer?.() || core.state.hostId;
    else current ??= core.cloudCurrentComputer?.() || core.state.hostId;
    for (const id of channels.keys()) if (!core.state.computers.some(row=>row.hostId===id)) {channels.get(id)?.close?.();channels.delete(id);}
    for(const removed of result.removedHosts || [])if((core.state.computersSeen || []).includes(removed.hostId)&&!(core.state.removedComputers || []).some(r=>r.hostId===removed.hostId))
      effects.toast?.(`${removed.name} 已移除，交给它的事项已取消。本机内容仍保留。`);
    core.state.removedComputers = result.removedHosts || [];
    core.state.computersSeen = [...new Set([...(core.state.computersSeen || []),...core.state.computers.map(row=>row.hostId)])];
    directoryAt = Date.now(); effects.paintComputers?.();
  };
  async function directory() {
    if(!enabled || Date.now()-directoryAt < 5000 || !core.cloudDirectory) return;
    if(!directoryRead) directoryRead=core.cloudDirectory().finally(()=>{directoryRead=null;});
    await directoryRead;
  }
  async function channel(id) {
    if(channels.has(id)) return channels.get(id);
    if(connecting.has(id)) return connecting.get(id);
    const identity = core.state.cloudAuth?.sub;
    const pending=(async()=>{
      const connection=await core.cloudConnect(id);
      if(connection.status!=='online'||!connection.baseUrl)throw {code:'COMPUTER_OFFLINE'};
      const capabilities=await core.cloudComputerCapabilities?.(connection);
      if(capabilities?.cloudChannel!==1)throw {code:'COMPUTER_UPDATE_REQUIRED',connection};
      const transport=await effects.openComputerChannel(connection);
      try {
        const session=await core.cloudComputerChannel(connection,transport.request);
        if(identity!==core.state.cloudAuth?.sub)throw {code:'ACCOUNT_CHANGED'};
        const entry={...transport,session,connection};channels.set(id,entry);return entry;
      } catch(error) {transport.close();throw error;}
    })().finally(()=>connecting.delete(id));connecting.set(id,pending);return pending;
  }
  async function request(id,path,options={}) {
    if(id===core.cloudCurrentComputer?.()&&current===id)return json(core.accessBase+path,options);
    const row=core.state.computers?.find(row=>row.hostId===id);
    if(!row?.online)throw {code:'COMPUTER_OFFLINE'};
    const entry=await channel(id);
    try {
      return await entry.request('/personal/v1'+path,{method:options.method || 'GET',headers:{'content-type':'application/json',Authorization:'Bearer '+entry.session.token},
        ...(options.body===undefined?{}:{body:JSON.stringify(options.body)})});
    } catch(error) {if(error.code==='UNAUTHORIZED'){entry.close();channels.delete(id);}throw error;}
  }
  core.computerApi = request;
  core.remoteComputerSelected=()=>enabled&&current!==core.cloudCurrentComputer?.();
  core.downloadComputerFile=async path=>{
    const entry=await channel(current);
    return entry.request(path,{method:'GET',headers:{Authorization:'Bearer '+entry.session.token},binary:true});
  };
  const memory=core.memoryRequest;
  core.memoryRequest=(path,options)=>enabled&&current!==core.cloudCurrentComputer?.()?request(current,'/memory'+path,options):memory(path,options);
  const refresh=core.refreshSessions;
  core.refreshSessions=async(...args)=>{
    if(enabled)await directory().catch(()=>{});
    if(enabled&&core.hasMultipleComputers()&&!isLocalComputer(current)&&core.state.computers.find(row=>row.hostId===current)?.online===false){
      const page=await core.accessApi('/sessions?archived=all');core.state.sessions=page.sessions || [];
      effects.renderSessions?.();effects.updateAvailability?.();return;
    }
    return refresh(...args);
  };
  core.accessApi = async (path,options={}) => {
    if(!enabled || !core.hasMultipleComputers())return current && channels.has(current) ? request(current,path,options) : original.accessApi(path,options);
    if((options.method || 'GET')==='GET' && (/^\/(sessions|chats|projects)\?/.test(path) || path==='/projects')) {
      await directory();
      const field=path.startsWith('/sessions')?'sessions':path.startsWith('/chats')?'items':'projects';
      let active;
      const rows=[];
      for(const computer of core.state.computers){
        const key=computer.hostId+':'+path;
        try {
          if(!computer.online&&!isLocalComputer(computer.hostId))throw {code:'COMPUTER_OFFLINE'};
          const result=await request(computer.hostId,path,options);snapshots.set(key,result);
          if(computer.hostId===current)active=result;
          rows.push(...(result[field] || []).map(row=>({...row,hostId:computer.hostId,computerName:name(computer.hostId)})));
        } catch {rows.push(...(snapshots.get(key)?.[field] || []).map(row=>({...row,hostId:computer.hostId,computerName:name(computer.hostId),computerOffline:true})));}
      }
      if(field==='sessions'||field==='items')rows.sort((a,b)=>(Date.parse(b.updatedAt||b.lastMessageAt||b.createdAt||b.attachedAt)||0)-(Date.parse(a.updatedAt||a.lastMessageAt||a.createdAt||a.attachedAt)||0));
      return {...active,[field]:rows};
    }
    const session=/^\/sessions\/([^/?]+)/.exec(path),project=/^\/projects\/([^/?]+)/.exec(path),chat=/^\/chats\/([^/?]+)/.exec(path);
    const source=session?core.state.sessions.find(row=>row.sessionId===session[1]):project?core.state.projects?.find(row=>row.projectId===project[1]):chat?core.state.chats?.find(row=>row.chatId===chat[1]):null;
    return request(source?.hostId || current || core.cloudCurrentComputer?.(),path,options);
  };
  const probe=core.probeCloudPresence;
  core.probeCloudPresence=()=>enabled&&current?core.cloudConnect(current):probe?.();
  core.selectExecutionComputer = async id => {
    if(!enabled || id===current)return;
    if(core.state.submitting || core.state.unresolvedSubmission)throw {code:'SESSION_BUSY'};
    const row=core.state.computers.find(row=>row.hostId===id);if(!row?.online)throw {code:'COMPUTER_OFFLINE'};
    let entry;
    try { entry=id===core.cloudCurrentComputer?.()?null:await channel(id); }
    catch(error) {
      if(error.code!=='COMPUTER_UPDATE_REQUIRED'||!core.cloudConnectTrusted)throw error;
      // The original Cookie flow connects legacy computers without opening the new iframe or token channel.
      await core.cloudConnectTrusted(error.connection); entry=null;
    }
    const session=entry?.session || await json(core.authBase+'/me');
    core.stopAssistantRefresh?.();current=id;core.acceptSession(session);core.state.hostId=id;
    core.resetLogicalSession?.();
    core.state.selectedSessionId=null;core.state.selectedChatId=null;core.state.mainChat=null;
    try{environment.storage.setItem(lastKey(),id);}catch{}
    await core.refreshStatus();await core.refreshModels();await core.refreshSessions();
    effects.startAssistantRefresh?.();
    effects.paintComputers?.();
  };
  core.selectSession = async (id,...args) => {
    const row=core.state.sessions.find(row=>row.sessionId===id);
    if(core.hasMultipleComputers()&&row?.hostId && row.hostId!==current) {
      if(row.computerOffline){effects.toast?.(`${name(row.hostId)} 不在线，连接后可继续这段对话。`);return;}
      await core.selectExecutionComputer(row.hostId);
    }
    if(core.hasMultipleComputers()&&row?.hostId)try{environment.storage.setItem(lastKey(),row.hostId);}catch{}
    return original.selectSession(id,...args);
  };
  core.startNewConversation = async (...args) => {
    if(enabled) {
      let last;try{last=environment.storage.getItem(lastKey());}catch{}
      const chosen=globalThis.WeftUiCore.chooseComputer(core.state.computers,{lastHostId:last || current});
      if(chosen)await core.selectExecutionComputer(chosen);
    }
    const created=await original.startNewConversation(...args);
    if(core.hasMultipleComputers())await core.refreshSessions();
    return created;
  };
  core.currentExecutionComputer = () => current || core.state.hostId;
  const createProject=core.createProjectConversation;
  core.createProjectConversation=async(project,...args)=>{
    if(enabled&&project.hostId&&project.hostId!==current)await core.selectExecutionComputer(project.hostId);
    return createProject(project,...args);
  };
  const side=core.openSideChat;
  core.openSideChat=async(fields={})=>{
    const project=fields.parent?.kind==='project'?core.state.projects?.find(row=>row.projectId===fields.parent.id):null;
    if(enabled&&project?.hostId&&project.hostId!==current)await core.selectExecutionComputer(project.hostId);
    return side(fields);
  };
  core.activeComputerIdentity=()=>{
    if(!enabled||!current||current===core.cloudCurrentComputer?.())return null;
    const entry=channels.get(current);return entry?{origin:entry.connection.baseUrl,hostId:current,ownerId:entry.session.account.ownerId,deviceId:entry.session.device.id}:null;
  };
  core.clearSession = () => {for(const entry of channels.values())entry.close();channels.clear();snapshots.clear();enabled=false;current=null;core.state.computers=[];return original.clearSession();};
  return {};
};
