import { evidencePath } from '../helpers/evidence-path.mjs';
// Windows counterpart of the Linux relay scenario: same production runtime,
// synthetic model and phone UI, using an isolated direct host transport.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {phoneRuntime,scenarioUserText} from '../../services/cloud/test/relay-phone-runtime.mjs';
import {createPersonalAccessService} from '../../src/personal-access/index.mjs';
import {servePersonalAccessUi} from '../../src/personal-access-ui/index.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
import {approvePhoneOperation} from '../helpers/phone-approval.mjs';
import {managedMkdtemp,managedTempRoot,disposeManagedTemp} from '../helpers/managed-temp.mjs';
const out=evidencePath('mob-3-fix'),root=await managedMkdtemp(join(managedTempRoot(),'weftmate-mob3-fix-'));
await mkdir(out,{recursive:true});const logs=[],report={synthetic:true,realModelRequests:0,transport:'isolated direct Windows host; Linux 443 relay is verified by CI',switches:[],approvals:[]};
let runtime,host,browser,page;
const wait=async(fn,label)=>{const end=Date.now()+90000;while(Date.now()<end){if(await fn())return;await new Promise(done=>setTimeout(done,200));}throw Error(label);};
try{
  runtime=await phoneRuntime(root,logs);host=await createPersonalAccessService({root:join(root,'host'),port:0,backend:runtime.backend,uiHandler:servePersonalAccessUi});runtime.setHost(host);await runtime.start();const started=await host.start(),origin=started.origin;
  const credentials={username:'SyntheticPhone',password:'synthetic-'+randomUUID(),deviceName:'合成验证手机'};
  const grant=await host.issueSetupGrant(),setup=await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({...credentials,grant:grant.grant})});assert.equal(setup.status,201);
  const auth=await setup.json(),cookie=setup.headers.get('set-cookie').split(';')[0];
  const api=async(path,body,method=body?'POST':'GET')=>{const response=await fetch(origin+'/personal/v1'+path,{method,headers:{origin,cookie,'content-type':'application/json','x-weftmate-csrf':auth.csrfToken},body:body?JSON.stringify(body):undefined});const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;};
  const command=async(body)=>{const accepted=await api('/commands',{requestId:randomUUID(),targetDeviceId:started.hostId,...body});let row;await wait(async()=>{row=(await api('/commands/'+accepted.command.commandId)).command;return row.state==='accepted_by_dsh';},'command accepted');return row;};
  browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.setDefaultTimeout(15000);
  await page.addInitScript(()=>{let module;Object.defineProperty(globalThis,'WeftUiCore',{configurable:true,get:()=>module,set:value=>{module=value;const create=value.create;value.create=(...args)=>globalThis.__mobFixCore=create(...args);}});});
  await page.goto(origin+'/personal/v1/ui/');await localUiSession(page,credentials);await page.locator('#assistant-view').waitFor();
  const select=async(id)=>{await page.evaluate(()=>__mobFixCore.refreshSessions(true));const toggle=page.getByRole('button',{name:'切换会话侧栏',exact:true});if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();const title=await page.evaluate(id=>__mobFixCore.state.sessions.find(row=>row.sessionId===id)?.title,id);await page.locator(`[data-session-id="${id}"]`).getByRole('button',{name:title,exact:true}).click();await page.waitForFunction(id=>__mobFixCore.state.selectedSessionId===id&&!__mobFixCore.state.newConversation,id);};
  const sessions=[];for(let i=0;i<2;i++)sessions.push((await command({kind:'session.create',modelProfileId:'synthetic'})).sessionId);
  await page.reload();await page.locator('#assistant-view').waitFor();
  let delayed;await page.route('**/personal/v1/**/events*',async route=>{const url=new URL(route.request().url());if(delayed&&url.pathname.includes(delayed.id)&&!url.searchParams.has('afterSeq')){delayed.count++;await new Promise(done=>setTimeout(done,2000));}await route.continue();});
  const draft=page.locator('#message-text');
  // The complete ten-switch sequence remains in the Linux 443 relay test.
  // This local counterpart checks one delayed first input and the native file path.
  for(let i=0;i<1;i++){
    const id=sessions[i%2];delayed={id,count:0};await select(id);assert.equal(await draft.isDisabled(),true);await draft.press('x');assert.equal(await draft.inputValue(),'');await wait(()=>draft.isEnabled(),'composer unlock');assert.ok(delayed.count>0);
    const text=`CI_R1_FIRST_INPUT_${i}_解锁后第一次输入，中文和 ASCII 全部保留。`;await draft.fill(text);await new Promise(done=>setTimeout(done,300));assert.equal(await draft.inputValue(),text);await page.waitForFunction(()=>document.getElementById('send-message').dataset.action==='send'&&!document.getElementById('send-message').disabled);await page.locator('#send-message').click();
    await wait(async()=>{const events=(await api(`/sessions/${id}/events?limit=100`)).events;return events.some(event=>event.type==='user.message'&&event.data?.text===text)&&events.at(-1)?.type==='turn.ended';},'first send complete');assert.equal(runtime.requests.filter(row=>scenarioUserText(row.messages)===text).length,1);report.switches.push({iteration:i,delayMs:2000,lostCharacters:0,sends:1});delayed=null;
  }
  await page.screenshot({path:join(out,'direct-first-input.png')});
  const file=(await command({kind:'session.create',modelProfileId:'synthetic'})).sessionId;await api(`/sessions/${file}/approval-mode`,{mode:'ask'},'PATCH');await page.reload();await page.locator('#assistant-view').waitFor();await select(file);await wait(()=>draft.isEnabled(),'file composer');await draft.fill('CI_R1_FILE_TASK：读取 input.txt，新建 result.txt，再读回核验。');await new Promise(done=>setTimeout(done,300));await page.waitForFunction(()=>document.getElementById('send-message').dataset.action==='send'&&!document.getElementById('send-message').disabled);await page.locator('#send-message').click();
  const approved=new Set();await wait(async()=>{
    const pending=(await api(`/sessions/${file}/approvals`)).approvals.find(row=>row.status==='pending'&&!approved.has(row.approvalId));
    if(pending){const geometry=await approvePhoneOperation(page,pending,()=>page.screenshot({path:join(out,`direct-approval-${approved.size+1}.png`)}));approved.add(pending.approvalId);report.approvals.push({toolName:pending.toolName,canAlwaysAllow:pending.canAlwaysAllow,geometry});}
    return (await api(`/sessions/${file}/events?limit=100`)).events.at(-1)?.type==='turn.ended';
  },'native file task completion');
  assert.ok(approved.size>=2);assert.equal(await runtime.readOutput(),runtime.content);const requests=runtime.requests.filter(row=>scenarioUserText(row.messages).startsWith('CI_R1_FILE_TASK'));assert.equal(requests.length,5);
  const library=await api('/library?search=result.txt'),item=library.items.find(item=>item.name==='result.txt'||item.fileName==='result.txt');assert.ok(item);assert.equal(item.source.sessionId,file);assert.equal(item.source.callId,'ci-r1-2');assert.ok(JSON.stringify(await api(`/library/${item.id}/preview`)).includes(runtime.content.trim()));
  await page.getByText('CI_R1_FILE_TASK_COMPLETED',{exact:true}).waitFor();await page.screenshot({path:join(out,'direct-file-task-completed.png')});report.fileTask={completed:true,approvals:approved.size,modelSteps:requests.length,libraryPreviewMatches:true};report.passed=true;
}catch(error){report.passed=false;report.error=error.message;await page?.screenshot({path:join(out,'direct-failure.png')}).catch(()=>{});throw error;}
finally{await browser?.close();await host?.close();await runtime?.close();await disposeManagedTemp(root);await writeFile(join(out,'direct-report.json'),JSON.stringify(report,null,2)+'\n');}
