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
const root=mkdtempSync(join(tmpdir(),'weftmate-ux3-mimo-')),profile=join(root,'profile');mkdirSync(profile);
writeFileSync(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const credentials={username:'ThinkingFixture',password:`synthetic-${randomUUID()}-password`,deviceName:'隔离推理验收'};
const backend=Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(method=>[method,async()=>method==='listModels'?[]:{}]));
const preparation=await createPersonalAccessService({root:join(profile,'personal-access'),port:0,backend});
const prepared=await preparation.start(),grant=await preparation.issueSetupGrant();
const response=await fetch(prepared.origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin:prepared.origin,'content-type':'application/json'},body:JSON.stringify({grant:grant.grant,...credentials})});assert.equal(response.status,201);await preparation.close();
const wireFile=join(root,'wire.jsonl');
const hook=join(root,'wire-hook.mjs');writeFileSync(hook,`process.env.UX3_WIRE_FILE=${JSON.stringify(wireFile)};await import(${JSON.stringify(new URL('./ux-3-wire-hook.mjs',import.meta.url).href)});`);
const env={...process.env,UX3_WIRE_FILE:wireFile,UX3_HOOK_MODULE:new URL("file:///"+hook.replaceAll("\\","/")).href};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
let app;const evidence=resolve('tests/evidence/ux-3');mkdirSync(evidence,{recursive:true});
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['tests/integration/ux-3-runtime-electron.mjs',`--user-data-dir=${profile}`,'--personal-host','--access-port=0'],env,timeout:90000});
 app.process().stderr?.on('data',data=>process.stderr.write(data));
 const page=await app.firstWindow();page.setDefaultTimeout(60000);await page.waitForURL('**/personal/v1/ui');await localUiSession(page,credentials);
 const api=async(path,body,method)=>page.evaluate(async({path,body,method})=>{const me=body?await(await fetch('/personal/v1/auth/me')).json():{};const response=await fetch('/personal/v1'+path,{method:method||(body?'POST':'GET'),headers:body?{'content-type':'application/json','x-weftmate-csrf':me.csrfToken}:{},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};},{path,body,method});
 // A synthetic placeholder is stored; the harness substitutes the real key only in the outbound fetch.
 assert.equal((await api('/account/models',{requestId:'ux3-mimo-model',name:'合成账号 MiMo',baseUrl:'https://api.xiaomimimo.com/v1',modelId:'mimo-v2.6-flash',apiKey:'synthetic-not-provider-key'})).status,202);
 await until(async()=>{const data=(await api('/account/models/by-request/ux3-mimo-model')).body;return data.operation?.status==='succeeded';});await page.reload();
 await page.getByRole('button',{name:'新对话 Ctrl N',exact:true}).click();
 await page.getByRole('button',{name:'添加图片或文件',exact:true}).click();
 await page.getByRole('menuitemcheckbox',{name:'深入思考',exact:true}).click();
 await page.getByLabel('已开启深入思考',{exact:true}).waitFor();
 await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('这是合成验证，只回复“核对完成”，不要调用工具。');
 await page.getByRole('button',{name:'发送',exact:true}).click();
 const captured=await until(async()=>{const rows=(await api('/sessions')).body.sessions;if(!rows?.length)return false;const events=(await api(`/sessions/${rows[0].sessionId}/events?limit=50`)).body.events;return events?.some(event=>event.type==='turn.ended')?{session:rows[0],events}:false;});
 const history=captured.events;
 assert.ok(history.some(event=>event.type==='assistant.message'&&event.data.text.includes('核对完成')),JSON.stringify(history.filter(event=>event.type==='turn.ended')));
 const wire=existsSync(wireFile)?readFileSync(wireFile,'utf8').trim().split('\n').map(JSON.parse).filter(row=>row.model):[];assert.equal(wire.filter(row=>row.thinking?.type==='enabled').length,1,'one foreground deep-thinking request');assert.equal(wire[0].thinking?.type,'enabled');
 const sessions=(await api('/sessions')).body.sessions,selected=sessions.find(row=>row.deepThinking)||captured.session;assert.ok(selected);
 const modelProfileId=selected.modelProfileId;
 await page.reload();await page.getByLabel('已开启深入思考',{exact:true}).waitFor();
 const usage=(await api('/usage?timeZone=Asia%2FShanghai')).body;
 const nativeSettings=readFileSync(join(profile,'dsh-home/settings.yaml'),'utf8');assert.doesNotMatch(nativeSettings,/reasoningEffort:\s*['"]?high/,'native model default is unchanged');
 for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(evidence,`mimo-${theme}.png`)});}
 const report={syntheticAccount:true,realElectron:true,realDsh:true,paidRequests:wire.length,wire,preferencePersisted:true,
   defaultRestorationVerifiedByUnitTests:true,nativeDefaultUnchanged:true,usage};
 // Usage contains only this isolated synthetic account; no credentials or conversation content.
 writeFileSync(join(evidence,'mimo.json'),JSON.stringify(report,null,2)+'\n');console.log('MiMo reasoning wire verified:',JSON.stringify(wire));
}catch(error){const page=(await app?.windows())?.find(page=>page.url().includes('/personal/v1/ui'));if(page){console.log('failure body',await page.locator('body').innerText());await page.screenshot({path:join(evidence,'mimo-failure.png')});}throw error;}finally{if(existsSync(wireFile)){const attempt={at:new Date().toISOString(),wire:readFileSync(wireFile,'utf8').trim().split('\n').map(JSON.parse)};const previous=join(evidence,'mimo-attempts.json');let attempts=[];if(existsSync(previous))attempts=JSON.parse(readFileSync(previous,'utf8'));attempts.push(attempt);writeFileSync(previous,JSON.stringify(attempts,null,2)+'\n');}await app?.close();rmSync(root,{recursive:true,force:true});}
