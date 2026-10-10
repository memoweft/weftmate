// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { zstdDecompressSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { snapshot, verify } from '../../src/personal-backup/archive.mjs';

const evidence=resolve(process.env.MEM2_EVIDENCE || 'tests/evidence/mem-2'), root=mkdtempSync(join(tmpdir(),'weftmate-mem2-real-')), profile=join(root,'profile');
mkdirSync(evidence,{recursive:true}); mkdirSync(profile);
const save=(name,value)=>writeFileSync(join(evidence,name),JSON.stringify(value,null,2)+'\n');
save('run.json',{root,startedAt:new Date().toISOString()});
const key=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::Out.Write([Environment]::GetEnvironmentVariable('MIMO_API_KEY','Machine'))"],{encoding:'utf8',windowsHide:true}).trim();
assert.ok(key);
const credentials={username:'synthetic-mem2',password:`synthetic-${randomUUID()}`,deviceName:'MEM-2 fixture'};
writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const backend=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(k=>[k,async()=>({})]));
const prep=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend});
const prepared=await prep.start(),grant=await prep.issueSetupGrant();
assert.equal((await fetch(prepared.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:prepared.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,...credentials})})).status,201);
await prep.close();
const config=join(root,'memory.json');
writeFileSync(config,JSON.stringify({python:'D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe',pythonPath:'D:/AIProjects/MemoWeft/Worktrees/mem-2-validation/py/src',baseUrl:'http://127.0.0.1:1/v1',model:'@current',authRef:'mem2-pending'}));
const env={...process.env};for(const name of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(name)||['ELECTRON_RUN_AS_NODE','MIMO_API_KEY','MODEL_SWITCH_UNIFIED_KEY'].includes(name))delete env[name];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
env.WEFTMATE_BASELINE_TRACE=join(root,'requests.jsonl');env.WEFTMATE_BASELINE_MEMORY_TRACE=join(root,'memory-requests.jsonl');env.WEFTMATE_BASELINE_RECALL_TRACE=join(root,'recall.jsonl');
let app,page,browser,hostId,modelId,ownerId;const report={checks:[],turns:[],synthetic:true,coreCommit:'a9b115f'};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=180000){const end=Date.now()+timeout;while(Date.now()<end){const result=await fn();if(result)return result;await pause(250);}throw Error(label);}
const api=async(path,body,method=body?'POST':'GET')=>page.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const r=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};},{path,body,method});
async function command(body){const requestId=randomUUID();let result=await api('/commands',{requestId,targetDeviceId:hostId,...body});assert.equal(result.status,202,JSON.stringify(result));return until(async()=>{result=await api('/commands/by-request/'+requestId);assert.notEqual(result.body.command.state,'rejected',JSON.stringify(result));return result.body.command.state==='accepted_by_dsh'&&result.body.command;},'command acceptance');}
const create=async temporary=>(await command({kind:'session.create',modelProfileId:modelId,...(temporary?{temporary:true}: {})})).sessionId;
async function turn(sessionId,text){const before=(await api(`/sessions/${sessionId}/events?limit=100`)).body.events??[];const after=before.at(-1)?.seq??-1;await command({kind:'session.message',sessionId,text,mode:'queue'});const events=await until(async()=>{const rows=(await api(`/sessions/${sessionId}/events?afterSeq=${after}&limit=100`)).body.events??[];return rows.some(e=>e.type==='turn.ended')&&rows;},'turn finish');const reply=events.filter(e=>e.type==='assistant.message').map(e=>e.data.text).join('\n');report.turns.push({sessionId,text,reply,events});save('verification.json',report);return reply;}
function scan(directory,needles){let files=0,frames=0;const matches=[];const has=b=>needles.some(n=>b.includes(Buffer.from(n))||b.includes(Buffer.from(n,'utf16le')));function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){if(e.isSymbolicLink())continue;const file=join(dir,e.name);if(e.isDirectory())walk(file);else if(e.isFile()){files++;const b=readFileSync(file);if(has(b))matches.push(file.slice(directory.length+1));for(let i=0;i<b.length-4;i++)if(b.readUInt32LE(i)===0xfd2fb528){try{const plain=zstdDecompressSync(b.subarray(i));frames++;if(has(plain))matches.push(file.slice(directory.length+1)+':zstd');}catch{}}}}}walk(directory);return{files,frames,matches};}
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['tests/integration/mem-2-bootstrap.mjs',`--user-data-dir=${profile}`,'--personal-host','--access-port=0',`--personal-memory-config=${config}`],env,timeout:90000});
 let diagnostics='';app.process().stderr?.on('data',data=>{diagnostics+=data;writeFileSync(join(root,'host.log'),diagnostics.replaceAll(key,'[private]'));});
 page=await app.firstWindow();page.on('pageerror',e=>console.error('PAGE',e.message));page.setDefaultTimeout(30000);await page.waitForURL('**/personal/v1/ui');await localUiSession(page,credentials,'MEM-2',{mainChat:true});
 const status=(await api('/status')).body;hostId=status.hostId;ownerId=status.ownerId;
 const requestId=randomUUID();assert.equal((await api('/account/models',{requestId,name:'MEM-2 MiMo',baseUrl:'https://api.xiaomimimo.com/v1',modelId:'mimo-v2.6-flash',apiKey:key})).status,202);
 await until(async()=>((await api('/account/models/by-request/'+requestId)).body.operation?.status==='succeeded'),'model setup');
 modelId=(await api('/models')).body.models.find(m=>m.name==='MEM-2 MiMo').id;
 await api('/settings/models',{backgroundModelProfileId:modelId},'PATCH');
 await page.addInitScript(() => { let value; Object.defineProperty(globalThis, 'WeftUiCore', { configurable:true, get:()=>value, set:v=>{value=v;const create=v.create;v.create=(...args)=>{const core=create(...args);globalThis.mem2UiCore=core;return core;};} }); });
 await page.reload();
 await page.waitForFunction(()=>globalThis.mem2UiCore?.state.capabilities?.chat?.available === true);await page.getByRole('button',{name:'选择新对话类型',exact:true}).click();await page.getByRole('menuitem',{name:'临时对话',exact:true}).click();await page.getByText('临时对话 · 不会形成记忆，30 天后自动删除',{exact:true}).waitFor();
 await page.screenshot({path:join(evidence,'desktop-temporary-light.png')});
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:join(evidence,'desktop-temporary-dark.png')});
 const normal=await create(false);await turn(normal,'请记住：我给盆栽浇水的量是每次 137 毫升。只需简短确认，不要调用工具。');
 await until(async()=>((await api('/memory/items?kind=cognition')).body.items??[]).some(i=>i.currentState==='current'&&i.text.includes('137')),'ordinary formation',330000);
 const secret='紫金色珊瑚杯';
 await page.evaluate(async()=>{await globalThis.mem2UiCore.refreshSessions();await globalThis.mem2UiCore.selectMainChat();});
 await page.getByRole('button',{name:'选择新对话类型',exact:true}).click();await page.getByRole('menuitem',{name:'临时对话',exact:true}).click();
 const privateText=`这次只临时说：我喝茶只用${secret}。请告诉我之前说过每次给盆栽浇多少水，不要重复杯子信息，也不要调用工具。`;
 await page.locator('#message-text').fill(privateText);await page.getByRole('button',{name:'发送',exact:true}).click();
 const temporary=await until(async()=>((await api('/sessions')).body.sessions??[]).find(s=>s.memoryMode==='off')?.sessionId,'UI temporary creation');
 const privateEvents=await until(async()=>{const rows=(await api(`/sessions/${temporary}/events?limit=100`)).body.events??[];return rows.some(e=>e.type==='turn.ended')&&rows;},'UI temporary turn');
 const recalled=privateEvents.filter(e=>e.type==='assistant.message').map(e=>e.data.text).join('\n');
 report.turns.push({sessionId:temporary,text:privateText,reply:recalled,events:privateEvents});report.checks.push('main to temporary UI creates and sends a private side conversation');
 await page.evaluate(()=>globalThis.mem2UiCore.selectMainChat());
 assert.equal(await page.locator('#temporary-chat-notice').isVisible(),false,'main never inherits the temporary badge');
 assert.match(recalled,/137/);report.checks.push('temporary recall of ordinary memory');
 for(const mode of ['default','settled']){
   if(mode==='settled')await until(async()=>{
     const s=(await api('/memory/status')).body;
     const db=new DatabaseSync(join(profile,'personal-access','accounts',ownerId,'memory-home','memoweft','memoweft.sqlite3'),{readOnly:true});
     try { const rows=db.prepare('SELECT state,count(*) AS count FROM memory_world_job GROUP BY state').all();
       report.settledJobs=rows;return !s.pendingBoundaryCount&&!rows.some(row=>['pending','processing','retry'].includes(row.state));
     } finally {db.close();}
   },'Core formation jobs settle',330000);
   const id=await create(false),answer=await turn(id,'我之前说喝茶只用什么杯子？如果没有可靠依据请说不知道，不要猜测，不要调用工具。');
   assert.ok(!answer.includes(secret));report.checks.push(mode+' new conversation cannot recall private preference');
 }
 await api(`/sessions/${normal}/metadata`,{memoryMode:'off'},'PATCH');
 const second='银蓝色折叠水壶';await turn(normal,`这次不形成记忆：我旅行只带${second}。只回复收到，不要调用工具。`);
 assert.equal((await api(`/sessions/${normal}/fork`,{})).status,409);
 await page.evaluate(async id=>{await globalThis.mem2UiCore.refreshSessions();await globalThis.mem2UiCore.selectSession(id);}, temporary);
 await page.locator(`.session-row[data-session-id="${temporary}"] .session-more`).click();
 await page.getByRole('menuitemcheckbox',{name:'使用已有记忆',exact:true}).click();
 assert.equal((await api('/sessions')).body.sessions.find(s=>s.sessionId===temporary).recallEnabled,false);
 await page.locator(`.session-row[data-session-id="${temporary}"] .session-more`).click();
 await page.screenshot({path:join(evidence,'desktop-memory-settings.png')});
 await page.getByRole('menuitem',{name:'1 天后自动删除',exact:true}).click();
 const withoutRecall=await create(true);await api(`/sessions/${withoutRecall}/metadata`,{recallEnabled:false},'PATCH');
 const noRecall=await turn(withoutRecall,'我之前说每次给盆栽浇多少水？没有可靠依据就说不知道，不要猜测，不要调用工具。');
 assert.ok(!noRecall.includes('137'));report.checks.push('recall can be disabled independently');
 await api(`/sessions/${normal}/metadata`,{memoryMode:'on'},'PATCH');
 const reopened=await turn(normal,'刚才说旅行只带什么水壶？没有可靠依据就说不知道，不要猜测，不要调用工具。');
 assert.ok(!reopened.includes(second));report.checks.push('returning to ordinary mode cannot reuse private context');
 await api(`/sessions/${normal}/metadata`,{memoryMode:'off'},'PATCH');
 report.checks.push('memory switch before/after and fork blocked');
 const db=join(profile,'personal-access','accounts',ownerId,'memory-home','memoweft','memoweft.sqlite3');
 const dbScript = `import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]);tables=[r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")];hits=[]
for t in tables:
 rows=c.execute('SELECT * FROM "'+t.replace('"','""')+'"').fetchall()
 if any(n in json.dumps(rows,ensure_ascii=False,default=str) for n in sys.argv[2:]):hits.append(t)
print(json.dumps({'tables':len(tables),'matches':hits}));c.close()`;
 report.databaseScan=JSON.parse(execFileSync('D:/AIProjects/MemoWeft/Core/py/.venv/Scripts/python.exe',['-c',dbScript,db,secret,second],{encoding:'utf8',windowsHide:true}));assert.deepEqual(report.databaseScan.matches,[]);
 report.coreScan=scan(join(profile,'personal-access','accounts',ownerId,'memory-home'),[secret,second]);assert.deepEqual(report.coreScan.matches,[]);
 const backup=await api('/backups',{});assert.equal(backup.status,202,JSON.stringify(backup));
 const state=await until(async()=>{const r=(await api('/backups')).body;return r.status?.state==='succeeded'&&r;},'backup complete');
 const extracted=join(root,'backup-extracted');await verify(join(state.settings.directory,state.status.backup.id),extracted);
 report.backupScan=scan(extracted,[secret,second]);assert.deepEqual(report.backupScan.matches,[]);
 await app.evaluate(async()=>{globalThis.mem2Offset=31*86400000;await globalThis.mem2Sweep();});
 assert.ok(!(await api('/sessions')).body.sessions.some(s=>[normal,temporary].includes(s.sessionId)));
 report.usage=(await api('/usage')).body;save('verification.json',report);
 await app.close();app=null;
 report.expiredScan=scan(profile,[secret,second]);assert.deepEqual(report.expiredScan.matches,[]);
 const finalBackup=await snapshot({root:profile,directory:join(root,'final-backups')});await verify(join(root,'final-backups',finalBackup.id),join(root,'final-extracted'));
 report.expiredBackupScan=scan(join(root,'final-extracted'),[secret,second]);assert.deepEqual(report.expiredBackupScan.matches,[]);
 report.checks.push('expiry removes native logs and workspace; fresh backup zero matches');save('verification.json',report);
}catch(error){report.failure=String(error);save('verification.json',report);if(page)await page.screenshot({path:join(evidence,'failure.png')}).catch(()=>{});throw error;}
finally{await browser?.close();await app?.close();for(const name of ['requests.jsonl','memory-requests.jsonl','recall.jsonl']){try{const text=readFileSync(join(root,name),'utf8');assert.ok(!text.includes(key));writeFileSync(join(evidence,name),text);}catch(e){if(e.code!=='ENOENT')throw e;}}}
