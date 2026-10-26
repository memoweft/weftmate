// Synthetic HTTP fixture for the real Swift PersonalClient and encrypted replica.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {sealReplica} from '../../../src/personal-offline/crypto.mjs';
const identity={ownerId:'owner-test',hostId:'host-test',deviceId:'device-test'};
const state={ready:true},report={sync:[],turns:[],raw:[],chats:[]};
const server=createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);
  const raw=Buffer.concat(chunks),body=raw.length?JSON.parse(raw):{};
  const json=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
  if(req.url==='/configure'){Object.assign(state,body);json({ok:true});return;}
  if(req.url==='/report'){json(report);return;}
  if(req.url==='/v1/chat/completions'){
    if(req.headers.authorization!=='Bearer synthetic-state-key'){res.writeHead(401);json({error:'UNAUTHORIZED'});return;}
    report.chats.push(body);res.setHeader('content-type','text/event-stream');
    res.end('data: '+JSON.stringify({choices:[{delta:{content:'合成手机回复。'}}]})+'\n\ndata: [DONE]\n\n');return;
  }
  const route=req.url.replace('/personal/v1','');
  if(route==='/auth/login'||route==='/auth/me'){
    res.setHeader('set-cookie','wm_personal_session='+'a'.repeat(43)+'; HttpOnly');
    json({account:{ownerId:identity.ownerId,username:'synthetic',displayName:'Synthetic'},device:{id:identity.deviceId,name:'Synthetic'},csrfToken:'b'.repeat(43)});return;
  }
  if(route==='/status'){json({...identity});return;}
  if(route==='/offline/sync'){
    report.sync.push(body);
    const items=state.memory?[{id:'tea',kind:'cognition',text:'电脑记住我喜欢茉莉花茶',sources:[],currentState:'current'}]:[];
    json(sealReplica({generation:1,reset:body.generation!==1,items,remove:[],hashes:state.memory?{tea:'a'.repeat(64)}:{},truncated:false,recent:[],model:null,
      ...(state.missingAuthority?{}:{memoryAuthority:{ready:state.badReady?'true':state.ready,hostId:state.wrongAuthority?'other-host':identity.hostId}}),
      control:{hostId:identity.hostId,accountId:'account-test',generation:state.wrongControl?2:1}},body.publicJwk,identity));return;
  }
  if(route==='/offline/turns'){
    report.turns.push(body);report.raw.push(raw.toString('base64'));
    if(state.lose){state.lose=false;req.socket.destroy();return;}
    const turns=state.partial?body.turns.slice(0,1):body.turns;state.partial=false;
    json({generation:state.wrongGeneration?2:1,receipts:turns.map(t=>({id:state.foreignReceipt?'not-submitted':t.id,state:'synced'}))});return;
  }
  res.writeHead(404);json({error:'NOT_FOUND'});
});
server.listen(0,'127.0.0.1');await once(server,'listening');
console.log(JSON.stringify({origin:`http://127.0.0.1:${server.address().port}`}));
process.once('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit());});
