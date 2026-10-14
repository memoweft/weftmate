import { evidencePath } from '../helpers/evidence-path.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { migrationHost, until } from '../helpers/migration-host.mjs';
import { createProcessEvidence } from '../helpers/process-evidence.mjs';
const repo=resolve(import.meta.dirname,'../..'), output=evidencePath('rob-1');mkdirSync(output,{recursive:true});
const root=mkdtempSync('C:/weftmate-rob1-ui-'), startedAt=Date.now(), electron=createRequire(import.meta.url)('electron');
let h;const evs=[];
try {
  h=await migrationHost({tempRoot:root,processEvidence:spec=>{const e=createProcessEvidence({outputDir:join(repo,'.local/rob-1-ui-processes'),profileDirectory:spec.profile,commandRoots:[root],executables:[electron,process.execPath],startedAt});evs.push(e);return e;}});
  const original=(await h.api('/account/models')).body.models;
  await h.app.close();h.app=null;
  writeFileSync(join(h.profile,'weftmate-model.enc'),Buffer.from('synthetic unreadable encrypted vault'));
  await h.launch();
  const affected=(await h.api('/account/models')).body.models;
  assert.equal(affected.length,original.length);assert.equal(affected[0].configured,false);
  await h.page.locator('#account-menu-trigger').click();await h.page.locator('#rail-account').click();
  await h.page.getByRole('button',{name:'模型',exact:true}).click();
  await h.page.getByText('密钥暂时读不出',{exact:true}).waitFor();
  const originalCiphertext=readFileSync(join(h.profile,'weftmate-model.enc'));
  await h.page.getByRole('button',{name:'重试',exact:true}).click();
  await h.page.getByRole('button',{name:'重试',exact:true}).waitFor();
  assert.deepEqual(readFileSync(join(h.profile,'weftmate-model.enc')),originalCiphertext);
  const captures=[];
  for(const theme of ['light','dark']) for(const width of [1200,480,360,390]) {
    await h.app.evaluate(({BrowserWindow},{width})=>{const w=BrowserWindow.getAllWindows()[0];w.setMinimumSize(300,600);w.setContentSize(width,width===360?780:844);},{width});
    await h.page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await h.page.screenshot({path:join(output,`models-refill-${width}-${theme}.png`)});
    await h.page.getByRole('button',{name:'更多模型操作',exact:true}).click();
    await h.page.getByRole('menuitem',{name:'停止使用',exact:true}).waitFor();
    await h.page.screenshot({path:join(output,`models-refill-menu-${width}-${theme}.png`)});
    await h.page.keyboard.press('Escape');
    await h.page.getByRole('button',{name:'重新填写',exact:true}).click();
    assert.equal(await h.page.locator('#account-model-key').inputValue(),'');
    await h.page.getByText('密钥暂时读不出，可以关闭后重试。重新填写并保存后会保留一份旧密文；模型地址和名称已保留。',{exact:true}).waitFor();
    await h.page.locator('#account-model-submit').scrollIntoViewIfNeeded();
    await h.page.locator('.model-editor-body').evaluate(node=>node.scrollTop=node.scrollHeight);
    await h.page.screenshot({path:join(output,`models-refill-editor-${width}-${theme}.png`)});
    const layout=await h.page.evaluate(()=>{const head=document.querySelector('.model-editor-dialog .dialog-head').getBoundingClientRect(),close=document.querySelector('[aria-label="关闭模型表单"]').getBoundingClientRect(),save=document.querySelector('#account-model-submit').getBoundingClientRect(),dialog=document.querySelector('.model-editor-dialog').getBoundingClientRect();return {headVisible:head.top>=0&&head.bottom<=innerHeight,closeVisible:close.top>=0&&close.bottom<=innerHeight,bottomSpace:dialog.bottom-save.bottom};});
    assert.equal(layout.headVisible,true); assert.equal(layout.closeVisible,true); assert.ok(layout.bottomSpace>=16);
    captures.push({theme,width,...layout,...await h.page.evaluate(()=>({viewportWidth:innerWidth,viewportHeight:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth})),systemBars:false,surface:'real Electron responsive window'});
    await h.page.locator('#account-model-cancel').click();
  }
  const logs=readdirSync(join(h.profile,'logs')).filter(name=>name.endsWith('.jsonl')).flatMap(name=>readFileSync(join(h.profile,'logs',name),'utf8').split('\n').flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}}));
  assert.ok(logs.some(row=>row.event==='host.failure' && row.code==='CREDENTIAL_VAULT_UNREADABLE'));
  assert.equal(logs.filter(row=>row.event==='host.failure' && row.code==='CREDENTIAL_VAULT_UNREADABLE').length,1);
  assert.equal(readdirSync(h.profile).some(name=>name.includes('.unreadable-')||name.endsWith('.recovery.json')),false);
  assert.deepEqual(readFileSync(join(h.profile,'weftmate-model.enc')),originalCiphertext);
  await h.page.getByRole('button',{name:'重新填写',exact:true}).click();
  await h.page.locator('#account-model-key').fill('synthetic-rob1-refilled-key');
  await h.page.locator('#account-model-submit').click();
  await until(async()=>(await h.api('/account/models')).body.models[0].configured===true);
  const replaced=readdirSync(h.profile).filter(name=>name.startsWith('weftmate-model.enc.replaced-')); assert.equal(replaced.length,1); assert.deepEqual(readFileSync(join(h.profile,replaced[0])),originalCiphertext);
  assert.equal(h.requests.length,0,'no inference requests');
  writeFileSync(join(output,'recovery-ui.json'),JSON.stringify({synthetic:true,realElectron:true,startupNeverMovesUnreadableCiphertext:true,retryAvailable:true,headerVisibleAfterScroll:true,startupContinues:true,profileMetadataPreserved:true,refillEntryOpens:true,emptySecretInput:true,refillCompletes:true,unreadableBytesRetained:true,fixedFailureCode:'CREDENTIAL_VAULT_UNREADABLE',modelRequests:0,captures},null,2));
} finally {
  await h?.close({failed:!h});let cleaned=0,safe=true;
  for(const e of evs){const c=await e.finalize();cleaned+=c.cleaned;safe&&=!c.stillRunning&&!c.preservationError;}
  if(safe)rmSync(root,{recursive:true,force:true});console.log(`已清理进程：${cleaned}`);
}
