globalThis.WeftUiComponents.factories.computers = (core,ui) => {
  let button;
  async function openComputerChannel(connection) {
    const base=new URL(connection.baseUrl);
    if(base.username||base.password||base.search||base.hash||!(base.protocol==='https:'||base.protocol==='http:'&&['127.0.0.1','localhost'].includes(base.hostname)))throw {code:'HOST_TRUST_INVALID'};
    const frame=document.createElement('iframe');frame.hidden=true;frame.title='电脑连接';
    frame.src=base.origin+'/personal/v1/ui/computer-channel.html';
    const ports=new MessageChannel(),pending=new Map();let disposed=false;
    const close=()=>{disposed=true;ports.port1.close();frame.remove();for(const job of pending.values()){clearTimeout(job.timer);job.reject({code:'NETWORK'});}pending.clear();};
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{close();reject({code:'NETWORK'});},15000);
      ports.port1.onmessage=event=>{if(event.data?.ready){clearTimeout(timer);resolve();}};
      frame.onload=()=>frame.contentWindow.postMessage({type:'weft-computer-channel'},base.origin,[ports.port2]);
      frame.onerror=()=>{clearTimeout(timer);close();reject({code:'NETWORK'});};document.body.append(frame);
    });
    ports.port1.onmessage=({data})=>{const job=pending.get(data.id);if(!job)return;pending.delete(data.id);clearTimeout(job.timer);
      data.status>=200&&data.status<300?job.resolve(data.body):job.reject({code:data.body?.error?.code||'NETWORK',status:data.status});};
    const request=(path,options)=>new Promise((resolve,reject)=>{
      if(disposed){reject({code:'NETWORK'});return;}const id=crypto.randomUUID();
      const timer=setTimeout(()=>{pending.delete(id);reject({code:'NETWORK'});},15000);
      pending.set(id,{resolve,reject,timer});ports.port1.postMessage({id,path,options});
    });
    return {request,close};
  }
  function paintComputers() {
    if(!button)return;button.hidden=!core.hasMultipleComputers?.();
    button.setAttribute('aria-label',`在哪台电脑上做：${core.computerName?.(core.currentExecutionComputer?.()) || '这台电脑'}`);
    button.title=button.getAttribute('aria-label');button.setAttribute('aria-pressed',String(!button.hidden));
    button.disabled=!!core.state.submitting;
  }
  function mountComputers() {
    const target=ui.byId('model-picker')?.parentElement || ui.byId('model-trigger')?.parentElement;
    if(!target)return;
    button=ui.element('button','composer-icon computer-choice');button.type='button';button.hidden=true;button.id='computer-choice';
    button.append(WeftIcons.create('desktop',18));button.setAttribute('aria-haspopup','menu');target.insertBefore(button,ui.byId('model-picker').nextSibling);
    button.onclick=()=>WeftPopover.menu(button,(core.state.computers||[]).map(row=>({name:row.displayName||row.name,icon:'desktop',
      checked:row.hostId===core.currentExecutionComputer(),description:row.online?'在线':'不在线',disabled:!row.online,
      action:async()=>{const draft=ui.readMessageDraft();await core.selectExecutionComputer(row.hostId);await core.startNewConversation();ui.byId('message-text').value=draft;ui.updateAvailability();}})),error=>ui.toast(error.code==='COMPUTER_OFFLINE'?'这台电脑不在线，请稍后再试。':core.failureMessage(error)));
    document.addEventListener('click',async event=>{
      const link=event.target.closest?.('a[href]');if(!link||!core.remoteComputerSelected())return;
      const url=new URL(link.href,location.href);if(url.origin!==location.origin||!/^\/personal\/v1\/(?:artifacts|library|files|attachments)\//.test(url.pathname))return;
      event.preventDefault();try{const file=await core.downloadComputerFile(url.pathname+url.search),blobUrl=URL.createObjectURL(new Blob([file.bytes],{type:file.contentType || 'application/octet-stream'}));
        const download=document.createElement('a');download.href=blobUrl;download.download=link.download || '文件';download.click();setTimeout(()=>URL.revokeObjectURL(blobUrl),60000);
      }catch{ui.toast('文件暂时无法读取，请连接这台电脑后重试。');}
    },true);
    const available=ui.updateAvailability;ui.updateAvailability=(...args)=>{available(...args);paintComputers();};paintComputers();
  }
  return {openComputerChannel,paintComputers,mountComputers};
};
