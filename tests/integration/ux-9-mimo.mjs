// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER,PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
async function until(read,timeout=120000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await read();if(value)return value;await new Promise(done=>setTimeout(done,200));}throw new Error('isolated runtime condition timed out');}
assert.ok(process.env.UX3_MIMO_KEY,'MiMo credential must be supplied in process memory');
mkdirSync('C:/Temp',{recursive:true});process.env.TMP=process.env.TEMP='C:/Temp';
const root=mkdtempSync(join(tmpdir(),'weftmate-ux9-mimo-')),profile=join(root,'profile');mkdirSync(profile);
writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const credentials={username:'FolderFixture',password:`synthetic-${randomUUID()}-password`,deviceName:'隔离推理验收'};
const backend=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(method=>[method,async()=>method==='listModels'?[]:{}]));
const preparation=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend});
const prepared=await preparation.start(),grant=await preparation.issueSetupGrant();
const response=await fetch(prepared.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:prepared.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,...credentials})});assert.equal(response.status,201);await preparation.close();
const wireFile=join(root,'wire.jsonl');
const hook=join(root,'wire-hook.mjs');writeFileSync(hook,`process.env.UX3_WIRE_FILE=${JSON.stringify(wireFile)};await import(${JSON.stringify(new URL('./ux-3-wire-hook.mjs',import.meta.url).href)});`);
const env={...process.env,UX3_WIRE_FILE:wireFile,UX3_HOOK_MODULE:new URL("file:///"+hook.replaceAll("\\","/")).href};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
let app;const evidence=resolve('tests/evidence/ux-9');mkdirSync(evidence,{recursive:true});

let page,api;const folder=join(root,'SyntheticWork');mkdirSync(folder);writeFileSync(join(folder,'input.txt'),'This is a synthetic UX-9 project.');
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['tests/integration/ux-3-runtime-electron.mjs',`--user-data-dir=${profile}`,'--personal-host','--access-port=0'],env,timeout:90000});
 page=await app.firstWindow();page.setDefaultTimeout(60000);await page.waitForURL('**/personal/v1/ui');await localUiSession(page,credentials,'UX-9 MiMo',{mainChat:true});
 api=async(path,body,method)=>page.evaluate(async({path,body,method})=>{const me=body?await(await fetch('/personal/v1/auth/me')).json():{};const response=await fetch('/personal/v1'+path,{method:method||(body?'POST':'GET'),headers:body?{'content-type':'application/json','x-weftmate-csrf':me.csrfToken}:{},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};},{path,body,method});
 assert.equal((await api('/account/models',{requestId:'ux9-mimo-model',name:'合成账号 MiMo',baseUrl:'https://api.xiaomimimo.com/v1',modelId:'mimo-v2.6-flash',apiKey:'synthetic-not-provider-key'})).status,202);
 await until(async()=>(await api('/account/models/by-request/ux9-mimo-model')).body.operation?.status==='succeeded');await page.reload();
 await page.getByRole('button',{name:'WeftMate 主对话',exact:true}).waitFor();
 await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);
 await page.getByRole('button',{name:'添加图片或文件',exact:true}).click();await page.getByRole('menuitem',{name:'选择文件夹',exact:true}).click();
 await page.getByRole('region',{name:'在文件夹里工作',exact:true}).waitFor();
 await page.getByRole('combobox',{name:'文件权限',exact:true}).click();await page.getByRole('option',{name:'可读写',exact:true}).click();
 await page.getByRole('button',{name:'在这个文件夹里工作',exact:true}).click();await page.getByRole('button',{name:'选择文件夹，当前 SyntheticWork',exact:true}).waitFor();
 const project=(await api('/projects')).body.projects.find(row=>row.name==='SyntheticWork');assert.equal(project.permission,'write');
 const session=(await api('/sessions')).body.sessions.find(row=>row.projectId===project.projectId);assert.ok(session);
 assert.equal((await api(`/sessions/${session.sessionId}/approval-mode`,{mode:'ask'},'PATCH')).status,200);
 await page.locator('#message-text').fill('看看这个文件夹里有什么并新建一个说明文件 README.md，简短描述现有的 input.txt。请实际读取并写入文件，完成后告诉我。');await page.getByRole('button',{name:'发送',exact:true}).click();
 let approvals=0;const end=Date.now()+240000;
 while(Date.now()<end){const pending=(await api(`/sessions/${session.sessionId}/approvals`)).body.approvals||[];
   for(const approval of pending.filter(row=>row.status==='pending')){await page.screenshot({path:join(evidence,`mimo-approval-${++approvals}.png`)});const result=await api(`/sessions/${session.sessionId}/approvals/${approval.approvalId}`,{requestId:crypto.randomUUID(),outcome:'allowed-once'});assert.equal(result.status,200);}
   const events=(await api(`/sessions/${session.sessionId}/events?afterSeq=-1&limit=200`)).body.events;
   if(events?.some(event=>event.type==='turn.ended'))break;await new Promise(resolve=>setTimeout(resolve,500));
 }
 assert.ok(approvals>0,'A real write must be approved');assert.ok(existsSync(join(folder,'README.md')),'Project output exists on disk');
 const library=(await api('/library?limit=100')).body;assert.ok(JSON.stringify(library).includes('README.md'),'Project output registered in library');
 await page.screenshot({path:join(evidence,'mimo-result.png')});
 const usage=(await api('/usage?timeZone=Asia%2FShanghai')).body,wire=existsSync(wireFile)?readFileSync(wireFile,'utf8').trim().split('\n').map(JSON.parse):[];
 writeFileSync(join(evidence,'mimo.json'),JSON.stringify({syntheticAccount:true,realElectron:true,realDsh:true,approvals,projectFile:true,libraryFile:true,wire,usage},null,2));console.log('MiMo folder read/write, approval and library passed.');
}catch(error){if(page){await page.screenshot({path:join(evidence,'mimo-failure.png')});console.log(await page.locator('body').innerText());}throw error;}
finally{if(api){try{writeFileSync(join(evidence,'mimo-usage.json'),JSON.stringify((await api('/usage?timeZone=Asia%2FShanghai')).body,null,2));}catch{}}await app?.close();rmSync(root,{recursive:true,force:true});}
