export async function showBody(core,ui,chatId) {
  const identity=core.state.identityGeneration;
  const dialog=ui.element('dialog','dialog pulled-chat'),head=ui.element('div','dialog-head'),body=ui.element('div','dialog-body'),foot=ui.element('form','dialog-footer');
  dialog.setAttribute('aria-label','对话副本');
  const title=ui.element('h2','','对话'),status=ui.element('p','muted'),messages=ui.element('div','pulled-messages'),files=ui.element('div','actions');
  status.setAttribute('role','status');
  const close=ui.element('button','button secondary','关闭');close.type='button';close.onclick=()=>dialog.close();
  const input=ui.element('textarea');input.setAttribute('aria-label','在此设备继续');input.placeholder='在此设备继续';input.rows=3;input.disabled=true;
  const send=ui.element('button','button primary','发送');send.type='submit';send.disabled=true;
  const picker=ui.element('select');picker.setAttribute('aria-label','此设备的模型');
  const renew=ui.element('button','button secondary','重新读取');renew.type='button';
  head.append(title,close);body.append(status,messages,files);foot.append(picker,input,send,renew);dialog.append(head,body,foot);
  document.body.append(dialog);dialog.showModal();
  let replica,modelReplica,state,controller,ready=false,device='来源电脑';
  const current=()=>dialog.open&&identity===core.state.identityGeneration;
  const available=()=>{input.disabled=!state?.doc||!ready;send.disabled=input.disabled||!input.value.trim()||!!controller;};
  function paint(){
    if(!current())return;
    messages.replaceChildren();
    for(const message of [...(state?.doc?.messages??[]),...(state?.local??[])]){
      const row=ui.element('div','message '+message.role);
      row.append(ui.element('span','muted',message.role==='user'?'我':'WeftMate'),globalThis.WeftContent.create(message.text));
      messages.append(row);
    }
    files.replaceChildren();
    for(const file of state?.doc?.attachments??[]){
      const button=ui.element('button','button secondary',file.name+' · '+core.dataSize(file.size)+(file.size>20*1024*1024?' · 建议使用 Wi-Fi（无线网络）':''));
      button.type='button';button.onclick=async()=>{
        button.disabled=true;
        try{
          const downloaded=await replica.attachment(chatId,file.id);
          if(!current())return;
          const url=URL.createObjectURL(downloaded.blob);
          const link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
        }catch{if(current())status.textContent='附件暂时无法取得，请确认来源设备在线后重试。';}
        finally{button.disabled=false;}
      };
      files.append(button);
    }
    available();
  }
  async function load(){
    try{
      replica=await core.getBodyReplica();if(!replica)throw Error('BODY_KEY_REQUIRED');
      const list=await replica.list(),row=list.find(row=>row.id===chatId);
      if(row){title.textContent=row.title||'未命名对话';device=row.device||device;}
      state=await replica.read(chatId);paint();
      if(!state.doc){status.textContent='正在同步正文…';state=await replica.open(chatId);if(!current())return;paint();}
      modelReplica=await core.getModelReplica();
      let models=await modelReplica?.read();
      if(!models?.current&&modelReplica)models=await modelReplica.sync();
      if(!current())return;
      picker.replaceChildren();
      for(const service of models?.services??[])for(const model of service.models.filter(row=>row.enabled&&row.profileId)){
        const option=ui.element('option','',service.name+' · '+model.name);option.value=model.profileId;
        option.selected=model.profileId===(state.doc.modelProfileId||models.current?.profileId);picker.append(option);
      }
      if(!picker.value&&models?.current)picker.value=models.current.profileId;
      void core.resumeBodySync?.();
      ready=!!picker.value;status.textContent=ready?'正文已保存在本机，在此设备继续对话。':'正文已保存，请先配置可在此设备使用的云端模型。';available();
    }catch(error){
      if(current()){status.textContent=error.code==='BODY_UNAVAILABLE'?'这段对话已删除或停止共享。':
          ['REVISION_CHANGED','BODY_BUSY'].includes(error.code)?'对话正在更新，请稍后重新读取。':
          ['NETWORK','HOST_OFFLINE','HOST_UNAVAILABLE','CLOUD_TIMEOUT'].includes(error.code)?'这段在 '+device+' 上，它在线后才能打开。':'暂时无法读取这段对话，请稍后重试。';available();}
    }
  }
  renew.onclick=async()=>{
    input.disabled=send.disabled=true;
    try{await replica.refresh();state=await replica.read(chatId);paint();await load();}
    catch{if(current())status.textContent='暂时无法核对来源，请稍后重试。';}
  };
  input.oninput=available;
  foot.onsubmit=async event=>{
    event.preventDefault();if(!state?.doc||controller||!input.value.trim())return;
    const text=input.value;controller=new AbortController();available();
    try{
      const modelState=await modelReplica.read();
      const selected=modelState.services.flatMap(service=>service.models.map(model=>({service,model}))).find(row=>row.model.profileId===picker.value);
      if(!selected)throw Error('MODEL_NOT_CONFIGURED');
      const model={...selected.model,baseUrl:selected.service.baseUrl,interfaceType:selected.service.interfaceType,apiKey:selected.service.apiKey};
      const history=[...state.doc.messages,...state.local];
      state.local=await replica.append(chatId,{id:crypto.randomUUID(),role:'user',text,at:new Date().toISOString(),remember:false});
      input.value='';paint();status.textContent='正在回复…';
      const {body}=globalThis.WeftOffline.requestBody({items:[],personalization:core.state.personalization},history,text,model);
      const reply=await globalThis.WeftOffline.completeWithModel(body,model,controller.signal);
      const answer=reply.choices?.[0]?.message?.content;if(typeof answer!=='string'||!answer.trim())throw Error('MODEL_UNAVAILABLE');
      if(!current())return;
      state.local=await replica.append(chatId,{id:crypto.randomUUID(),role:'assistant',text:answer,at:new Date().toISOString(),remember:false});
      paint();status.textContent='回复已保存在此设备。';
    }catch{if(current())status.textContent='回复未完成，已保存的消息仍在本机。';}
    finally{controller=null;if(current())available();}
  };
  async function changed(){
    if(!current())return;
    try{
      const latest=await replica.read(chatId);
      if(latest.doc?.contentRevision===state?.doc?.contentRevision && latest.version===state?.version)return;
      controller?.abort();ready=false;state=latest;paint();await load();
    }catch{if(current()){controller?.abort();state=null;ready=false;paint();status.textContent='这段对话已删除或停止共享。';}}
  }
  document.addEventListener('weft:body-copies',changed);
  dialog.addEventListener('close',()=>{controller?.abort();document.removeEventListener('weft:body-copies',changed);dialog.remove();});
  void load();
  return ()=>dialog.close();
}
