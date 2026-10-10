import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createPersonalAccessService } from '../../../../src/personal-access/index.mjs';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../../../src/host-mode.mjs';
import { localUiSession } from '../../../../tests/helpers/local-ui-session.mjs';
const root=await mkdtemp('C:/Temp/weftmate-qa4-dialog-'),out=resolve('tests/evidence/qa-4/project-dialog');await mkdir(out,{recursive:true});
await writeFile(join(root,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const credentials={username:'FX14Synthetic',password:'synthetic-'+randomUUID(),deviceName:'FX14 dialog'};
const service=await createPersonalAccessService({root:join(root,'personal-access'),port:0,backend:Object.fromEntries(['getStatus','listModels','preflight','createSession','sendMessage','cancelSession','readEvents','describeSession'].map(name=>[name,async()=>({})]))});
try{const {origin}=await service.start(),grant=await service.issueSetupGrant();assert.equal((await fetch(origin+'/personal/v1/auth/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({...credentials,grant:grant.grant})})).status,201);}finally{await service.close();}
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|ELECTRON_RUN_AS_NODE|MIMO_API_KEY|MODEL_SWITCH_UNIFIED_KEY)/.test(key))delete env[key];
let app;const checks=[];
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['.','--personal-host',`--user-data-dir=${root}`,'--access-port=0','--force-device-scale-factor=1'],env,timeout:90000});
 const page=await app.firstWindow();await page.waitForURL('**/personal/v1/ui*');await localUiSession(page,credentials);await page.locator('button[aria-label="新建项目"]').waitFor({state:'attached'});
 for(const [width,height] of [[1200,800],[480,600]])for(const theme of ['light','dark']){
  await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(...size),[width,height]);await page.waitForTimeout(200);
  await page.evaluate(theme=>{localStorage.setItem('weftmate-theme',theme);document.documentElement.dataset.theme=theme;},theme);
  if(!await page.getByRole('button',{name:'新建项目',exact:true}).isVisible())await page.getByRole('button',{name:'切换会话侧栏',exact:true}).click();
  await page.getByRole('button',{name:'新建项目',exact:true}).click();const dialog=page.getByRole('dialog',{name:'新建项目',exact:true});
  await dialog.getByRole('textbox',{name:'电脑上的文件夹'}).fill(root);await dialog.getByRole('textbox',{name:'电脑上的文件夹'}).press('Tab');await dialog.getByRole('textbox',{name:'项目名称'}).fill('FX14 合成项目');
  await dialog.getByRole('textbox',{name:'项目说明'}).fill('保留长说明，确认窄窗口只有内容区滚动，创建和取消按钮始终可见。');
  const geometry=await dialog.evaluate(node=>{const body=node.querySelector('.dialog-body'),footer=node.querySelector('.dialog-footer');
   const rect=footer.getBoundingClientRect();return {dialogOverflow:getComputedStyle(node).overflowY,bodyOverflow:getComputedStyle(body).overflowY,
    bodyScrolls:body.scrollHeight>body.clientHeight,footerVisible:rect.top>=0&&rect.bottom<=innerHeight,horizontalOverflow:node.scrollWidth>node.clientWidth};});
  assert.equal(geometry.dialogOverflow,'hidden');assert.equal(geometry.bodyOverflow,'auto');assert.equal(geometry.footerVisible,true);assert.equal(geometry.horizontalOverflow,false);
  await page.screenshot({path:join(out,`${width}-${theme}.png`)});checks.push({width,height,theme,...geometry});
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
 }
}finally{await app?.close().catch(()=>{});await rm(root,{recursive:true,force:true});await writeFile(join(out,'verification.json'),JSON.stringify({realMain:true,syntheticOnly:true,checks},null,2));}
