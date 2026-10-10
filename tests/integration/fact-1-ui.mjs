import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { localUiSession } from '../helpers/local-ui-session.mjs';

export async function verifyFactUi({app,page,api,results,evidence,credentials}) {
  const result=results.find(r=>r.topicId==='node24'&&r.document),sessionId=result.turns.at(-1).sessionId;
  const errors=[],checks=[];let browser;
  const activePreview=p=>p.locator('.preview-content:visible');
  async function select(p) {
    if(p===page) await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows().find(w=>/personal\/v1\/ui/.test(w.webContents.getURL()))?.webContents.send('wm:desktop:conversation',id),sessionId);
    else {
      await p.evaluate(async id=>{const s=await(await fetch('/personal/v1/status')).json();localStorage.setItem(`weftmate:last-session:v1:${s.ownerId}`,id);},sessionId);
      await p.reload();
    }
    await p.getByRole('button',{name:'说明.md',exact:true}).first().waitFor();
  }
  async function screenshot(p,name) {
    await p.screenshot({path:join(evidence,name+'.png')});
    const layout=await p.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,
      preview:!!document.querySelector('.preview-content:not([hidden])')}));
    assert.equal(layout.overflow,false,name+' horizontal overflow');checks.push({name,...layout});
  }
  async function source(p,surface) {
    await select(p);
    await p.getByRole('button',{name:'说明.md',exact:true}).first().click();
    await activePreview(p).getByRole('link',{name:/Node.*24|24.*Node/}).first().waitFor();
    for(const theme of ['light','dark']) {
      await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
      await screenshot(p,`${surface}-${theme}-document`);
    }
    await activePreview(p).getByRole('link',{name:/Node.*24|24.*Node/}).first().click();
    await activePreview(p).locator('details[open] pre').first().waitFor();
    await p.waitForFunction(()=>[...document.querySelectorAll('.preview-content:not([hidden]) pre')].some(n=>/ClangCL|NODE_MODULE_VERSION|13\.6/.test(n.textContent)));
    assert.ok((await activePreview(p).innerText()).includes('原文片段')||(await activePreview(p).innerText()).includes('Accessed:'));
    for(const theme of ['light','dark']) {
      await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
      await screenshot(p,`${surface}-${theme}-source-open`);
    }
    await p.getByRole('button',{name:'收起右侧面板',exact:true}).click();
  }
  async function settings(p,surface) {
    if(!await p.getByRole('button',{name:'账户菜单',exact:true}).isVisible())await p.getByRole('button',{name:'切换会话侧栏',exact:true}).click();
    await p.getByRole('button',{name:'账户菜单',exact:true}).click();await p.getByRole('button',{name:'设置',exact:true}).click();
    if(await p.getByRole('navigation',{name:'设置分类'}).isVisible())await p.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:'助手',exact:true}).click();
    else {await p.getByRole('combobox',{name:'设置分类',exact:true}).click();await p.getByRole('option',{name:'设置 · 助手',exact:true}).click();}
    const toggle=p.getByRole('switch',{name:'成文前核对事实',exact:true});await toggle.waitFor();
    assert.equal(await toggle.isChecked(),true);
    await toggle.uncheck();await p.getByText('已同步 · 从下一次回复开始生效',{exact:true}).filter({visible:true}).waitFor();
    assert.equal((await api('/settings/personalization')).body.settings.researchSelfCheck,false);
    await toggle.check();await p.getByText('已同步 · 从下一次回复开始生效',{exact:true}).filter({visible:true}).waitFor();
    assert.equal((await api('/settings/personalization')).body.settings.researchSelfCheck,true);
    await toggle.focus();
    for(const theme of ['light','dark']){await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);await screenshot(p,`${surface}-${theme}-assistant-settings`);}
    await p.keyboard.press('Escape');
  }
  try {
    page.on('pageerror',e=>errors.push(e.message));
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1200,800));
    await page.reload();await source(page,'desktop');await settings(page,'desktop');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(480,780));
    await source(page,'desktop-480');await settings(page,'desktop-480');
    browser=await chromium.launch({headless:true,channel:'chrome'});
    for(const [width,height] of [[360,780],[390,844]]) {
      const mobile=await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true});mobile.setDefaultTimeout(30000);mobile.on('pageerror',e=>errors.push(e.message));
      await mobile.goto(new URL(page.url()).origin+'/personal/v1/ui');await localUiSession(mobile,credentials,'FACT-1 mobile');
      await source(mobile,`mobile-${width}`);await settings(mobile,`mobile-${width}`);await mobile.close();
    }
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();writeFileSync(join(evidence,'ui-checks.json'),JSON.stringify({checks,errors,realElectron:true},null,2));}
}
