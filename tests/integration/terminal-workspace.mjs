import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const root = await mkdtemp(join(tmpdir(), 'weftmate-ui05-workspace-'));
const evidence = resolve(process.env.WEFTMATE_EVIDENCE_DIR || '.local/terminal-workspace'); await mkdir(evidence, {recursive:true});
const env = {...process.env, WEFTMATE_TERMINAL_TEST_DATA:root, WEFTMATE_TERMINAL_FULL_SHELL:'1'}; delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ args:['tests/integration/terminal-electron-main.mjs'], env, timeout:30000 });
app.process().stdout?.resume(); app.process().stderr?.resume();
const deadline = setTimeout(() => void app.close(), 90000);
let page, releaseDelayedAuth;
try {
  page = await app.firstWindow(); page.setDefaultTimeout(15000); const errors=[], sockets=[];
  page.on('websocket', ws=>{if(ws.url().includes('/terminals/')){ws.terminalClosed=false;sockets.push(ws);ws.on('close',()=>ws.terminalClosed=true);}});
  page.on('pageerror', e=>errors.push(e.message));
  await page.route('**/personal/v1/ui/app.js', async route => route.fulfill({contentType:'text/javascript',
    body:(await readFile('src/personal-access-ui/app.js','utf8')).replace('globalThis.__WeftUiStarted = true;', 'globalThis.ui05Core=core;globalThis.ui05Ui=ui;globalThis.__WeftUiStarted = true;')}));
  await page.waitForURL(/\/personal\/v1\/ui\/?$/); await page.waitForLoadState('domcontentloaded');
  await page.reload();
  await page.waitForFunction(()=>globalThis.__WeftUiStarted && globalThis.ui05Core);
  await page.waitForFunction(()=>ui05Core.state.ownerId && ui05Core.state.sessions.length>=2);
  const selectionError = await page.evaluate(async()=>{try{await ui05Core.selectSession('terminal-chat');return null;}catch(e){return {code:e.code,message:e.message};}});
  assert.equal(selectionError,null,JSON.stringify(selectionError));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,800));
  await page.getByRole('button',{name:'打开工作面板',exact:true}).click();
  const panel=page.getByRole('complementary',{name:'工作面板',exact:true});
  await panel.locator('[data-panel-kind=terminal]').click();
  await panel.getByRole('status').filter({hasText:/^已连接$/}).waitFor();
  const screen=()=>panel.locator('.terminal-session:not([hidden]) .xterm-rows');
  const command=async text=>{const input=panel.locator('.terminal-session:not([hidden]) textarea');await input.focus();await input.pressSequentially(text,{delay:1});await input.press('Enter');};
  const output=marker=>page.waitForFunction(marker=>document.querySelector('.terminal-session:not([hidden]) .xterm-rows')?.textContent.includes(marker),marker);
  await command("$ui05 = 800; Write-Output ('真正面板'+'中文正常'); cd $env:TEMP; dir | Select-Object -First 1");await output('真正面板中文正常');
  await command('node -i');await output('Welcome to Node.js');await command("'交互结果'+(6*7)");await output('交互结果42');await command('.exit');
  await panel.getByRole('button',{name:'再打开一项',exact:true}).click();await page.getByRole('menuitem',{name:'审查',exact:true}).click();
  await panel.getByRole('tab',{name:'终端',exact:true}).click();await command('Write-Output ($ui05+1)');await output('801');
  await panel.getByRole('button',{name:'收起右侧面板',exact:true}).click();await page.getByRole('button',{name:'打开工作面板',exact:true}).click();
  await command('Write-Output ($ui05+2)');await output('802');
  const cols=await screen().evaluate(el=>el.parentElement.clientWidth);await panel.getByRole('separator',{name:'调整预览宽度'}).press('ArrowLeft');
  await page.waitForFunction(width=>document.querySelector('.terminal-session:not([hidden]) .xterm-screen').clientWidth>width,cols);
  await page.evaluate(()=>ui05Core.selectSession('terminal-work'));
  await panel.locator('.terminal-session:not([hidden])').getByRole('status').filter({hasText:/^已连接$/}).waitFor();
  await command("Write-Output ('工作位置'+(Get-Location).Path)");await output('工作位置');await output('synthetic-project');
  for(const theme of ['light','dark']) {await page.evaluate(theme=>WeftDesktop.setAppearance({theme}),theme);await page.waitForTimeout(120);await page.screenshot({path:join(evidence,`workspace-terminal-${theme}.png`),animations:'disabled'});}
  // Async native directory lookup updates context without replacing this shell.
  await page.evaluate(()=>{const ctx=WeftPanels.context;WeftPanels.update({...ctx,workDir:null});WeftPanels.update({...ctx,workDir:'synthetic-context-only'});});
  await command("Write-Output ('原目录'+(Get-Location).Path)");await output('原目录');await output('synthetic-project');
  await command('exit');await panel.getByRole('button',{name:'重新打开',exact:true}).click();
  await panel.locator('.terminal-session:not([hidden])').getByRole('status').filter({hasText:/^已连接$/}).waitFor();
  // Actual registry identity reset disposes all tabs, then the owner can reopen.
  const oldIdentity=await page.evaluate(()=>WeftPanels.context);
  const identityClosed = Promise.all(sockets.filter(ws=>!ws.terminalClosed).map(ws=>ws.waitForEvent('close',{timeout:10000})));
  await page.evaluate(()=>WeftPanels.update({...WeftPanels.context,ownerId:'synthetic-next-owner',identityGeneration:WeftPanels.context.identityGeneration+1}));
  await page.waitForFunction(()=>!document.querySelector('.terminal-panel'));
  await identityClosed;
  await page.evaluate(ctx=>WeftPanels.update(ctx),oldIdentity);
  await page.getByRole('button',{name:'打开工作面板',exact:true}).click();await panel.locator('[data-panel-kind=terminal]').click();
  await panel.getByRole('status').filter({hasText:/^已连接$/}).waitFor();
  const tabClosed = Promise.all(sockets.filter(ws=>!ws.terminalClosed).map(ws=>ws.waitForEvent('close',{timeout:10000})));
  await panel.getByRole('button',{name:'关闭标签 终端',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.terminal-panel'));
  await tabClosed;
  // Create succeeds, but identity changes before the next authentication/attach.
  // Track the actual owned worker, not just removal of the visible panel.
  const deviceId = await page.evaluate(async()=> (await (await fetch('/personal/v1/auth/me')).json()).device.id);
  let authCalls=0, authPaused;
  const held=new Promise(resolve=>authPaused=resolve), gate=new Promise(resolve=>releaseDelayedAuth=resolve);
  await page.route('**/personal/v1/auth/me', async route=>{if(++authCalls===2){authPaused();await gate;}await route.continue();});
  await panel.locator('[data-panel-kind=terminal]').click(); await held;
  await app.evaluate(()=>{globalThis.ui05RaceWorker=process._getActiveHandles().find(h=>h.spawnargs?.some(a=>a.endsWith('personal-terminal\\worker.mjs')||a.endsWith('personal-terminal/worker.mjs')));});
  assert.ok(await app.evaluate(()=>!!globalThis.ui05RaceWorker),'created PTY has a real worker');
  await app.evaluate(async(_,id)=>ui05FixtureService.revokeDevice(id),deviceId);
  await page.evaluate(()=>WeftPanels.update({...WeftPanels.context,ownerId:'synthetic-next-owner',identityGeneration:WeftPanels.context.identityGeneration+1}));
  releaseDelayedAuth();
  const closedDeadline=Date.now()+4000;
  while(!await app.evaluate(()=>ui05RaceWorker.exitCode!==null||ui05RaceWorker.signalCode!==null)) {
    assert.ok(Date.now()<closedDeadline,'identity reset must stop an already created, not-yet-attached PTY');
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  assert.deepEqual(errors,[]);
  await writeFile(join(evidence,'workspace-result.json'),JSON.stringify({passed:true,checks:['real native desktop host','right panel launcher','Chinese input/output','cd/dir','Node REPL','tab/hide persistence','resize','conversation/project cwd','late workDir update','exit/reopen','identity reset dispose','close tab'],errors},null,2));
  console.log('UI05 real workspace terminal passed');
}catch(error){if(page){await page.screenshot({path:join(evidence,'workspace-failure.png')}).catch(()=>{});console.error(await page.locator('body').innerText().catch(()=>''));}throw error;}
finally{releaseDelayedAuth?.();clearTimeout(deadline);await app.close();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
