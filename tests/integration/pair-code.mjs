import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, open, unlink, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { generateKeyPair, exportJWK, calculateJwkThumbprint, SignJWT } from 'jose';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { syntheticCloudBinding } from '../helpers/synthetic-cloud-binding.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
process.env.WEFTMATE_TEST_HOST_NAME = 'pair-code-synthetic';
const root = resolve(import.meta.dirname, '../..'), profile = await mkdtemp(join(tmpdir(), 'wm-pair-code-'));
if (!process.env.WEFTMATE_TEST_TEMP_SCOPE) process.env.WEFTMATE_MANAGED_TEMP_ROOT ??= join(profile,'fixtures');
const hash = data => createHash('sha256').update(JSON.stringify(data)).digest();
let application, fixture, cloud, lock, watchdog, page, offset = 0;
const errors = [];
const stopTree = () => { const pid = application?.process()?.pid; if (pid) spawnSync('taskkill', ['/PID',String(pid),'/T','/F'], { windowsHide:true,timeout:10000,stdio:'ignore' }); };
const capture = async name => { if (!process.env.WEFTMATE_EVIDENCE_DIR) return; await mkdir(process.env.WEFTMATE_EVIDENCE_DIR,{recursive:true}); await page.screenshot({path:join(process.env.WEFTMATE_EVIDENCE_DIR,name+'.png'),animations:'disabled'}); };
try {
  if (process.env.WEFTMATE_HEAVY_LOCK_DIR) {
    for (const n of [1,2,3]) { const file=join(process.env.WEFTMATE_HEAVY_LOCK_DIR,`heavy-${n}.lock`);
      try { const handle=await open(file,'wx');await handle.writeFile('PAIR-CODE '+new Date().toISOString());await handle.close();lock=file;break; }
      catch(error){if(error.code!=='EEXIST')throw error;} }
    assert.ok(lock,'No heavy slot available');
  }
  watchdog=setTimeout(()=>{stopTree();process.exitCode=1;},145000);
  cloud=await syntheticCloudBinding();fixture=await startTimelineCandidate({cloudIdentity:cloud.configuration,clock:()=>Date.now()+offset,historyCount:0});
  await cloud.bind(fixture.request);
  const env={...process.env,PAIR_CODE_PROFILE:profile,PAIR_CODE_ORIGIN:fixture.origin,PAIR_CODE_TOKEN:fixture.libraryDesktopToken};delete env.ELECTRON_RUN_AS_NODE;
  application=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['tests/helpers/pair-code-electron.mjs'],env,timeout:20000});
  application.process().stdout?.resume();application.process().stderr?.resume();page=await application.firstWindow();page.setDefaultTimeout(12000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/personal/v1/ui/app.js',async route=>route.fulfill({contentType:'text/javascript',body:(await readFile(join(root,'src/personal-access-ui/app.js'),'utf8')).replace('ui.loadAttachmentHasher =','globalThis.testCore=core;globalThis.testUi=ui;ui.loadAttachmentHasher =')}));
  await page.waitForURL('**/personal/v1/ui');await localUiSession(page,fixture.credentials,'PAIR-CODE synthetic',{mainChat:true});
  await page.waitForFunction(()=>globalThis.__WeftUiStarted);
  await page.getByRole('textbox',{name:'输入消息',exact:true}).waitFor();
  await page.waitForFunction(()=>testCore.state.cloudAuth.restoreState==='none');
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,900));
  await page.evaluate(()=>testUi.openSettings('devices'));
  await page.waitForFunction(()=>document.getElementById('settings-dialog').open);
  const dialog=page.getByRole('dialog',{name:'添加设备',exact:true});
  const start=async()=>{await page.locator('#cloud-pairing-open').click();await dialog.waitFor();await page.waitForFunction(()=>document.getElementById('pairing-code').value.startsWith('wm1.'));return JSON.parse(Buffer.from((await page.locator('#pairing-code').inputValue()).slice(4),'base64url').toString());};
  const post=async(path,body)=>{const response=await fetch(fixture.origin+'/personal/v1'+path,{method:'POST',headers:{origin:fixture.origin,'content-type':'application/json'},body:JSON.stringify(body)});return {response,body:await response.json()};};
  const key=await generateKeyPair('ES256'),deviceId='pair-code-phone',jkt=await calculateJwkThumbprint(await exportJWK(key.publicKey));
  const token=await cloud.access((await fixture.request('/cloud/binding')).hostId,key,deviceId);
  const exchange=async(action,extra)=>{const nonce=await post('/auth/cloud-nonce',{}),path='/cloud/pairings/'+action;
    const proof=await new SignJWT({htm:'POST',htu:fixture.origin+'/personal/v1'+path,ath:createHash('sha256').update(token).digest('base64url'),nonce:nonce.body.nonce})
      .setProtectedHeader({alg:'ES256',typ:'dpop+jwt',jwk:await exportJWK(key.publicKey)}).setIssuedAt(Math.floor((Date.now()+offset)/1000)).setJti(randomUUID()).sign(key.privateKey);
    const response=await fetch(fixture.origin+'/personal/v1'+path,{method:'POST',headers:{origin:fixture.origin,'content-type':'application/json',dpop:proof},body:JSON.stringify({accessToken:token,deviceName:'合成手机',...extra})});
    return {response,body:await response.json()};};
  const p=await start();assert.equal(await page.locator('#pairing-confirm').isDisabled(),true);
  assert.equal(await page.locator('#pairing-number').textContent(),'扫码后显示');await capture('waiting-light');
  const pn=randomBytes(32).toString('base64url'),commit=hash(['wm-pair-phone-v2',p.challenge,deviceId,jkt,pn]).toString('base64url');
  const joined=await exchange('join',{challenge:p.challenge,phoneCommitment:commit});assert.equal(joined.response.status,200);
  const transcript=[2,p.issuer,p.sub,p.hostId,p.tlsSpki,await calculateJwkThumbprint(p.publicJwk),p.challenge,p.expiresAt,p.origin,p.relay?.baseUrl||''];
  assert.equal(hash(['wm-pair-host-v2',...transcript,joined.body.hostNonce]).toString('base64url'),p.hostCommitment);
  assert.equal((await exchange('reveal',{challenge:p.challenge,phoneNonce:pn})).response.status,200);
  const code=(hash(['wm-pair-sas-v2',...transcript,joined.body.hostNonce,deviceId,jkt,pn]).readUInt32BE(0)%1000000).toString().padStart(6,'0');
  await page.waitForFunction(code=>document.getElementById('pairing-number').textContent.replace(/ /g,'')===code,code);
  assert.equal((await exchange('redeem',{challenge:p.challenge})).response.status,403);
  await capture('compare-light');
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.documentElement.style.colorScheme='dark';});await capture('compare-dark');
  assert.equal(await page.locator('#pairing-confirm').isEnabled(),true);
  await page.locator('#pairing-confirm').click();await page.getByText('已确认，正在等待手机完成连接…',{exact:true}).waitFor();
  const redeemed=await exchange('redeem',{challenge:p.challenge});assert.equal(redeemed.response.status,200);assert.ok(redeemed.response.headers.get('set-cookie'));
  await page.getByRole('heading',{name:'配对成功',exact:true}).waitFor();await capture('completed-dark');
  await page.locator('#pairing-dismiss').click();
  const cancelled=await start();await page.locator('#pairing-cancel').click();await page.getByRole('heading',{name:'已取消配对',exact:true}).waitFor();
  assert.equal((await exchange('redeem',{challenge:cancelled.challenge})).response.status,401);await capture('cancelled-dark');
  await page.locator('#pairing-restart').click();await page.waitForFunction(()=>document.getElementById('pairing-code').value.startsWith('wm1.'));
  offset+=120001;await page.getByRole('heading',{name:'配对已过期',exact:true}).waitFor();await capture('expired-dark');
  offset=0;await page.locator('#pairing-restart').click();await page.waitForFunction(()=>document.getElementById('pairing-code').value.startsWith('wm1.'));
  const closed=JSON.parse(Buffer.from((await page.locator('#pairing-code').inputValue()).slice(4),'base64url').toString());await page.keyboard.press('Escape');
  await page.locator('#pairing-dialog').waitFor({state:'hidden'});assert.equal((await fixture.request('/cloud/pairings/status',{challenge:closed.challenge})).state,'cancelled');
  const old=await start();let releaseCancellation, cancellationReceived;
  const cancelledAtServer=new Promise(resolve=>{cancellationReceived=resolve;}),release=new Promise(resolve=>{releaseCancellation=resolve;});
  const decisionRoute=async route=>{const response=await route.fetch();cancellationReceived();await release;await route.fulfill({response});};
  await page.route('**/personal/v1/cloud/pairings/decision',decisionRoute);
  await page.evaluate(()=>{globalThis.pairCodeOldCancellation=testUi.cloudUi.cancel();});await cancelledAtServer;
  const newer=await start();assert.notEqual(old.challenge,newer.challenge);
  releaseCancellation();await page.evaluate(()=>pairCodeOldCancellation);await page.unroute('**/personal/v1/cloud/pairings/decision',decisionRoute);
  assert.equal(await page.locator('#pairing-dialog').evaluate(el=>el.open),true,'old cancellation must not close a newer dialog');
  assert.ok((await page.locator('#pairing-code').inputValue()).startsWith('wm1.'));
  await page.evaluate(()=>testCore.clearSession());
  await page.locator('#pairing-dialog').waitFor({state:'hidden'});assert.equal(await page.locator('#pairing-code').inputValue(),'');
  assert.equal(await page.locator('#pairing-number').textContent(),'—');
  assert.deepEqual(errors,[]);
  const result={protocol:'v2 commit-reveal',independentPhoneCode:code,realRequests:true,states:['waiting','comparing','confirmed','completed','cancelled','expired'],themes:['light','dark'],pageErrors:errors};
  if(process.env.WEFTMATE_EVIDENCE_DIR)await writeFile(join(process.env.WEFTMATE_EVIDENCE_DIR,'ui-result.json'),JSON.stringify(result,null,2));
  console.log('PAIR-CODE Electron: real pairing, independent SAS, confirmation, cancellation, expiry, light/dark passed');
} catch(error) {
  if(page) { console.log('PAIR-CODE diagnostic',await page.evaluate(()=>{let el=document.getElementById('cloud-pairing-open');const chain=[];while(el){const s=getComputedStyle(el);chain.push({tag:el.tagName,id:el.id,class:el.className,hidden:el.hidden,display:s.display,visibility:s.visibility,rect:el.getBoundingClientRect().toJSON()});el=el.parentElement;}return {chain,view:testCore.state.currentView,settingsOpen:document.getElementById('settings-dialog').open};}));await capture('failure').catch(()=>{}); }
  throw error;
} finally {
  clearTimeout(watchdog);if(application)await application.close().catch(stopTree);await fixture?.close();await cloud?.close();
  if(lock)await unlink(lock);await rm(profile,{recursive:true,force:true});
}
