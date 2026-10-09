// Actual isolated personal HTTP host; synthetic DSH log and planner only.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createPersonalAccessService} from '../../../src/personal-access/index.mjs';
import {syntheticBackend} from './a5_synthetic_backend.mjs';
const root=await realpath(await mkdtemp(join(tmpdir(),'wm-a13-'))), runtime=syntheticBackend(root);
const host=await createPersonalAccessService({root:join(root,'host'),port:0,backend:runtime.backend});runtime.attach(host);
const started=await host.start(), grant=await host.issueSetupGrant();
const setup=await fetch(started.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:started.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,username:'a5-tester',password:'synthetic-test-only',deviceName:'合成测试电脑'})});
const account=await setup.json(), auth={cookie:setup.headers.get('set-cookie').split(';')[0],'x-weftmate-csrf':account.csrfToken,origin:started.origin,'content-type':'application/json'};
async function api(path,body){const response=await fetch(started.origin+'/personal/v1'+path,{method:body===undefined?'GET':'POST',headers:auth,...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();return {...data,status:response.status};}
let session;
const append=(type,data)=>{const row={seq:session.events.length,time:Date.now(),type,data};session.events.push(row);return row;};
async function prepare(){
 const flow=await runtime.prepareA8(api,started.hostId);session=runtime.sessions.get(flow.sessionId);
 await runtime.a8('tools',session);await runtime.a8('approvals',session);
 const call=(name,args)=>{const id='a13-'+randomUUID();append('tool/call',{turn:session.turn,callId:id,name,arguments:JSON.stringify(args)});append('tool/result',{turn:session.turn,message:{source:{kind:'tool',callId:id},content:[{type:'tool-result',toolCallId:id,isError:false,content:[{type:'text',text:'合成检查完成。'}]}]}});};
 for(const [name,args]of [['load_tools',{}],['mcp__synthetic__extension',{unknown_field:'合成附加值',toolName:'ask_user_question'}],['write',{file_path:'report.md',content:'合成内容'}]])call(name,args);
 ask();return {sessionID:session.id};
}
function ask(){
 const questions=[{id:'format',question:'报告采用哪种格式？',header:'格式',detail:'完整说明：只用于合成报告的格式选择。',options:[{label:'简要报告',description:'便于阅读'},{label:'完整记录',description:'包含完整过程'}]},{id:'sections',question:'报告包含哪些部分？',multiSelect:true,options:[{label:'摘要'},{label:'步骤'}]},{id:'note',question:'还有什么要补充？'}];
 const q=append('tool/call',{turn:session.turn,callId:'a13-question-'+randomUUID(),name:'ask_user_question',arguments:JSON.stringify({questions})});
 session.questionFrame={sessionId:session.id,questionRpcId:randomUUID(),sourceReady:true,sourceReceiptId:session.current.source.rpcId,messageHash:createHash('sha256').update(session.current.content[0].text).digest('hex'),turn:session.turn,sourceSeq:session.events.find(e=>e.type==='user/message').seq,observedSeq:q.seq,questions,nativeState:'pending'};
 return {batchID:session.questionFrame.questionRpcId};
}
let loseNext=false;const traffic=[],usageTraffic=[];
// Drop one real successful response, exercising app readback of the original request.
const proxy=createServer(async(req,res)=>{try{const body=[];for await(const chunk of req)body.push(chunk);const pathname=new URL(req.url,'http://127.0.0.1').pathname;if(req.method==='GET'&&pathname.endsWith('/usage'))usageTraffic.push({month:new URL(req.url,'http://127.0.0.1').searchParams.get('month'),timeZone:new URL(req.url,'http://127.0.0.1').searchParams.get('timeZone')??new URL(req.url,'http://127.0.0.1').searchParams.get('tz')});const headers={...req.headers,host:new URL(started.origin).host,origin:started.origin};delete headers['content-length'];const response=await fetch(started.origin+req.url,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(body)})});const bytes=Buffer.from(await response.arrayBuffer());if(req.method==='POST'&&/\/questions\//.test(pathname)){traffic.push({status:response.status,request:JSON.parse(Buffer.concat(body)),reply:JSON.parse(bytes)});if(loseNext){loseNext=false;req.socket.destroy();return;}}const outgoing={};for(const[k,v]of response.headers)if(!['content-length','transfer-encoding','content-encoding'].includes(k))outgoing[k]=v;res.writeHead(response.status,outgoing);res.end(bytes);}catch{res.writeHead(500);res.end('{}');}});proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
const timer=setInterval(()=>runtime.consumeApprovals().catch(()=>{}),100);
const driver=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://127.0.0.1').pathname;let data;if(path==='/prepare')data=await prepare();else if(path==='/ready')data={host:`http://127.0.0.1:${proxy.address().port}`,sessionID:session.id};else if(path==='/retry-batch')data=ask();else if(path==='/lose-next'){loseNext=true;data={ok:true};}else if(path==='/report')data={questionHTTP:traffic,usageHTTP:usageTraffic,operations:runtime.operations,questions:await api('/sessions/'+session.id+'/questions')};else throw Error('Unknown route');res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));}catch(e){process.stderr.write(e.message+'\n');res.writeHead(500);res.end('{}');}});driver.listen(0,'127.0.0.1');await once(driver,'listening');
console.log(JSON.stringify({root,driver:`http://127.0.0.1:${driver.address().port}`}));
async function close(){clearInterval(timer);await host.close();proxy.close();driver.close();await rm(root,{recursive:true,force:true});process.exit(0);}process.on('SIGTERM',close);process.on('SIGINT',close);
