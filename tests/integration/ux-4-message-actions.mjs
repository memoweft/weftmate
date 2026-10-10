// Synthetic acceptance must never publish the local computer identity.
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startFixture } from './ux-4-fixture.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const evidence=resolve('tests/evidence/ux-p2/interaction');mkdirSync(evidence,{recursive:true});
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const checks=[],errors=[];
for(const surface of process.argv.includes('--local-only') ? [] : (process.argv.includes('--android-only')?['android-ui']:['desktop','mobile-web','android-ui'])) {
  const fixture=await startFixture(),profile=mkdtempSync(join(tmpdir(),'weftmate-ux4-electron-'));let app,browser,page;
  try {
    if(surface==='desktop') {
      app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_THEME:'light'}});
      page=await app.firstWindow();await localUiSession(page,fixture.credentials);
      await app.evaluate(({dialog},root)=>{globalThis.ux4Downloads=[];dialog.showSaveDialog=async(_win,options)=>{const file=root+'/export.'+options.filters[0].extensions[0];globalThis.ux4Downloads.push({file});return {canceled:false,filePath:file};};},profile.replaceAll('\\','/'));
    } else {
      browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
      await page.goto(surface==='mobile-web'?fixture.origin+'/personal/v1/ui':fixture.mobileUrl);
      if(surface==='mobile-web')await localUiSession(page,fixture.credentials);
      else {await page.waitForFunction(()=>state.booted);await page.evaluate(()=>listSharedSessions());await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('button',{name:/^合成消息操作 /}).last().click();}
    }
    page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push({surface,error:error.message}));
    await page.evaluate(()=>{window.__copies=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.__copies.push(text)},configurable:true});});
    const shot=async name=>page.screenshot({path:join(evidence,`${surface}-${name}.png`)});
    await page.getByRole('button',{name:'更多回复操作',exact:true}).last().waitFor();
    for(const theme of ['light','dark']) {await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await shot(`${theme}-actions`);}
    await page.getByRole('button',{name:'复制回复',exact:true}).last().click();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
    if(surface!=='android-ui')assert.match((await page.evaluate(()=>window.__copies))[0],/^合成回复/);
    await page.getByRole('button',{name:'有用',exact:true}).last().click();await page.getByRole('button',{name:'有用',exact:true,pressed:true}).last().waitFor();
    await page.getByRole('button',{name:'没用',exact:true}).last().click();const feedback=page.getByRole('dialog',{name:'这条回复哪里需要改进？'});
    await feedback.getByLabel('不准确',{exact:true}).check();await feedback.getByRole('textbox',{name:'备注（可选）'}).fill('请核对合成数据');await shot('feedback');
    await feedback.getByRole('button',{name:'保存本机反馈'}).click();assert.equal(await page.getByRole('button',{name:'没用',exact:true}).last().getAttribute('aria-pressed'),'true');
    const record=await page.evaluate(()=>{const key=Object.keys(localStorage).find(key=>key.startsWith('weftmate-message-feedback:'));return JSON.parse(localStorage.getItem(key));});assert.equal(record[0].note,'请核对合成数据');
    await page.getByRole('button',{name:'更多回复操作',exact:true}).last().evaluate(node=>{const row=node.closest('.message'),body=row.querySelector('.message-text,.markdown');const range=document.createRange();range.selectNodeContents(body);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new MouseEvent('mouseup'));});
    await page.getByRole('button',{name:'引用选中文字',exact:true}).click();assert.match(await page.getByRole('textbox',{name:'输入消息',exact:true}).inputValue(),/^> /);await shot('quote');
    await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('');
    assert.equal(await page.getByRole('button',{name:/编辑并重发|从这里开旁聊并重发/,includeHidden:true}).count(),0);
    await page.getByRole('button',{name:'更多回复操作',exact:true}).last().click();await page.getByRole('menuitem',{name:'换模型重新生成',exact:true}).click();await page.getByRole('menuitemradio',{name:'另一个合成模型',exact:true}).click();
    await page.getByRole('group',{name:'回复版本',exact:true}).getByText('第 2 / 2 版',{exact:true}).waitFor();assert.equal(fixture.calls.length,1);assert.equal(fixture.calls[0].modelProfileId,'alternate');
    for(const theme of ['light','dark']) {await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await shot(`${theme}-versions`);}
    await page.getByRole('button',{name:'分享 / 导出对话',exact:true}).last().click();const exportDialog=page.getByRole('dialog',{name:'分享 / 导出对话'}),preview=exportDialog.getByRole('region',{name:'导出预览'});
    await preview.waitFor();assert.doesNotMatch(await preview.innerText(),/synthetic-secret-export|C:\\Synthetic/);
    await exportDialog.getByLabel('包含工具步骤').check();assert.match(await preview.innerText(),/读取/);await shot('export-markdown');
    if(surface==='desktop') {
      await exportDialog.getByRole('button',{name:'导出文件',exact:true}).click();
      await exportDialog.getByText('导出文件已保存',{exact:true}).waitFor();const downloads=await app.evaluate(()=>globalThis.ux4Downloads);
      assert.doesNotMatch(readFileSync(downloads[0].file,'utf8'),/synthetic-secret-export|C:\\Synthetic/);
    } else if(surface!=='android-ui') {
      const promise=page.waitForEvent('download');await exportDialog.getByRole('button',{name:'导出文件',exact:true}).click();const download=await promise;const content=readFileSync(await download.path(),'utf8');assert.doesNotMatch(content,/synthetic-secret-export|C:\\Synthetic/);
    }
    for(const theme of ['light','dark']) {
      await exportDialog.getByRole('combobox',{name:'导出格式'}).click();await page.getByRole('option',{name:`PNG 长图 · ${theme==='light'?'浅色':'深色'}`,exact:true}).click();
      await page.getByLabel(`${theme==='light'?'浅色':'深色'}长图预览`,{exact:true}).waitFor();await shot(`export-png-${theme}`);
    }
    if(surface==='desktop') {
      await exportDialog.getByRole('button',{name:'导出文件',exact:true}).click();
      await exportDialog.getByText('导出文件已保存',{exact:true}).waitFor();const downloads=await app.evaluate(()=>globalThis.ux4Downloads);
      assert.equal(readFileSync(downloads[1].file).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    } else if(surface==='mobile-web') {
      const promise=page.waitForEvent('download');await exportDialog.getByRole('button',{name:'导出文件',exact:true}).click();const download=await promise;assert.equal(readFileSync(await download.path()).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    } else await exportDialog.getByRole('button',{name:'导出文件',exact:true}).click();
    await exportDialog.getByRole('button',{name:'关闭',exact:true}).click();
    if(surface==='desktop') {await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(480,700));await shot('dark-narrow');}
    const bounds=await page.getByRole('button',{name:'更多回复操作',exact:true}).last().boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=await page.evaluate(()=>innerWidth));
    checks.push({surface,actions:true,keyboardCopy:true,feedbackLocal:true,quote:true,processedUserCannotEdit:true,versionSwitch:true,regenerateOtherModel:true,sanitizedPreview:true,pngBothThemes:true,exportFiles:surface==='android-ui'?'native save bridge requested':'Markdown and PNG bytes verified'});
  } catch(error) {if(page) {await shotFailure(page,surface);console.error(await page.locator('body').innerText());console.error('BRANCH CALLS',fixture.calls);}throw error;}
  finally {await app?.close();await browser?.close();await fixture.close();rmSync(profile,{recursive:true,force:true});}
}
async function shotFailure(page,surface){await page.screenshot({path:join(evidence,`${surface}-failure.png`)});}
const phoneFixture=await startFixture({phone:true});let phoneBrowser;
try {
  phoneBrowser=await chromium.launch({channel:'chrome',headless:true});const page=await phoneBrowser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  page.on('pageerror',error=>errors.push({surface:'phone-local',error:error.message}));await page.goto(phoneFixture.mobileUrl);
  await page.waitForFunction(()=>state.booted);await page.evaluate(()=>listSharedSessions());await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('button',{name:/^手机合成对话 /}).last().click();
  assert.equal(await page.getByRole('button',{name:/编辑并重发/,includeHidden:true}).count(),0);
  await page.getByRole('button',{name:'有用',exact:true}).click();const feedback=await page.evaluate(()=>{const key=Object.keys(localStorage).find(key=>key.startsWith('weftmate-message-feedback:'));return JSON.parse(localStorage.getItem(key))[0];});
  assert.equal(feedback.source,'phone');assert.equal(feedback.messageId,'local-reply');
  await page.getByRole('button',{name:'更多回复操作',exact:true}).click();assert.equal(await page.getByRole('menuitem',{name:'重新生成（需由电脑接续）'}).isDisabled(),true);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'分享 / 导出对话',exact:true}).click();const dialog=page.getByRole('dialog',{name:'分享 / 导出对话'});
  await dialog.getByRole('region',{name:'导出预览'}).waitFor();assert.doesNotMatch(await dialog.innerText(),/synthetic-phone-secret/);
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:join(evidence,`phone-local-${theme}-export.png`)});}
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();assert.equal(phoneFixture.calls.length,0);
  checks.push({surface:'phone-local',feedbackLocal:true,sanitizedPreview:true,noInventedOfflineBranch:true});
} catch(error) {const page=phoneBrowser?.contexts()[0]?.pages()[0];if(page){console.error(await page.locator('body').innerText());await page.screenshot({path:join(evidence,'phone-local-failure.png')});}throw error;}
finally {await phoneBrowser?.close();await phoneFixture.close();}
const longFixture=await startFixture({longReply:true});let longBrowser;
try {
  longBrowser=await chromium.launch({channel:'chrome',headless:true});const page=await longBrowser.newPage({acceptDownloads:true});
  await page.goto(longFixture.origin+'/personal/v1/ui');await localUiSession(page,longFixture.credentials);
  await page.evaluate(()=>{window.__copies=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.__copies.push(text)},configurable:true});});
  await page.getByRole('button',{name:'复制回复',exact:true}).last().click();await page.getByRole('menuitem',{name:'复制 Markdown',exact:true}).click();
  await page.waitForFunction(()=>window.__copies.length>0);assert.match((await page.evaluate(()=>window.__copies))[0],/末尾完整标记/);
  await page.getByRole('button',{name:'分享 / 导出对话',exact:true}).last().click();const dialog=page.getByRole('dialog',{name:'分享 / 导出对话'});
  await dialog.getByRole('region',{name:'导出预览'}).waitFor();assert.match(await dialog.innerText(),/末尾完整标记/);
  const promise=page.waitForEvent('download');await dialog.getByRole('button',{name:'导出文件',exact:true}).click();const download=await promise;
  const body=readFileSync(await download.path(),'utf8');assert.match(body,/末尾完整标记/);assert.doesNotMatch(body,/synthetic-secret-export/);
  checks.push({surface:'long-reply',completeCopy:true,completeExport:true,notLimitedToHistoryPreview:true});
} finally {await longBrowser?.close();await longFixture.close();}
assert.deepEqual(errors,[]);writeFileSync(join(evidence,'interaction-checks.json'),JSON.stringify({checks,errors},null,2)+'\n');console.log(JSON.stringify(checks));
