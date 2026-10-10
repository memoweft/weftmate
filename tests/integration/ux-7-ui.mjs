/** UX-7 production Electron/mobile presentation with deterministic ephemeral model responses. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { exposeUx7Desktop, mockUx7Requests, prepareUx7Suggestions, ux7Replies } from './ux-7-scenes.mjs';
const root = resolve(import.meta.dirname, '../..'), out = join(root, 'tests/evidence/ux-7');
await mkdir(out, { recursive: true });
const env = { ...process.env }; for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
const rows = [], errors = [], checks = []; let app, browser, profile, fixture, replies = ux7Replies;
const coreCode = 'globalThis.__ux7core || uiCore';
const delay = ms => new Promise(done => setTimeout(done, ms));
async function selectSession(page) { await page.waitForFunction(()=>globalThis.__ux7core?.state.account);await core(page,'return core.selectSession(arg);',fixture.sessionId); }
async function core(page, code, arg) { return page.evaluate(({code, arg, coreCode}) => new Function('core', 'arg', code)(eval(coreCode), arg), {code, arg, coreCode}); }
async function shot(page, surface, theme, scene) {
  const screenshot = `${surface}-${theme}-${scene}.png`; await delay(180); await page.screenshot({ path: join(out, screenshot) });
  const metrics = await page.evaluate(() => { const field = document.querySelector('#message-text,#draft'), slot = document.querySelector('#composer-above-slot'), bar = document.querySelector('#next-suggestions'), scroll = document.querySelector('.next-suggestions-scroll');
    return { viewport: {width:innerWidth,height:innerHeight}, documentOverflow:document.documentElement.scrollWidth>innerWidth+1, priority:slot?.dataset.priority,
      field:field?.getBoundingClientRect().toJSON(), slot:slot?.getBoundingClientRect().toJSON(), chipHeights:[...document.querySelectorAll('.next-suggestion-chip')].map(n=>n.getBoundingClientRect().height),
      barVisible:!!bar&&!bar.hidden, scrollOverflow:!!scroll&&scroll.scrollWidth>scroll.clientWidth, fade:scroll&&getComputedStyle(scroll).maskImage }; });
  assert.equal(metrics.documentOverflow, false, `${surface}/${theme}/${scene} page overflow`); rows.push({surface, theme, scene, screenshot, metrics}); console.log(screenshot);
}
async function exercise(page, surface, theme) {
  const field = page.locator('#message-text,#draft'), chip = page.locator('.next-suggestion-chip'), bar = page.locator('#next-suggestions');
  await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
  await field.fill(''); await core(page, 'core.cancelNextSuggestions();');
  const before = await field.boundingBox();
  for (const n of [1,2,3]) { replies = ux7Replies.slice(0,n); await prepareUx7Suggestions(page); assert.equal(await chip.count(),n); await shot(page,surface,theme,`replies-${n}`); }
  const after = await field.boundingBox(); assert.equal(after.y,before.y); assert.equal(after.height,before.height); checks.push({surface,theme,composerDisplacementPx:after.y-before.y,composerHeightDeltaPx:after.height-before.height});
  await chip.first().hover(); await shot(page,surface,theme,'hover');
  await field.focus(); await field.press('Tab'); assert.equal(await chip.first().evaluate(n=>n===document.activeElement),true); await shot(page,surface,theme,'focus');
  await chip.first().press('Enter'); assert.equal(await field.inputValue(),ux7Replies[0]); await shot(page,surface,theme,'filled');
  await field.fill(''); await prepareUx7Suggestions(page);
  const box = await chip.first().boundingBox(); await page.mouse.move(box.x+10,box.y+10); await page.mouse.down(); await shot(page,surface,theme,'pressed'); await page.mouse.move(0,0); await page.mouse.up();
  await chip.first().evaluate(n=>n.disabled=true); await shot(page,surface,theme,'disabled'); await chip.first().evaluate(n=>n.disabled=false);
  replies = ['把这份项目进度报告保存为可共享的文件并整理一份详细版本', '继续说第二点并给出具体例子', '帮我设个明天上午九点的提醒'];
  await prepareUx7Suggestions(page); await shot(page,surface,theme,'long-overflow');
  assert.equal(await chip.first().getAttribute('title'),replies[0]); assert.equal(await chip.first().evaluate(n=>getComputedStyle(n).textOverflow),'ellipsis');
  replies=ux7Replies;
  await page.evaluate(()=>{const slot=document.querySelector('#composer-above-slot');for(const [id,text] of [['approval-bar','允许保存这份报告？'],['question-bar','希望使用哪种格式？'],['connection-status','正在重新连接'],['composer-subtasks','1 个子任务']]){let n=document.getElementById(id);if(!n){n=document.createElement('div');n.id=id;slot.append(n);n.dataset.ux7Synthetic='true';}n.dataset.ux7OldText=n.textContent;n.textContent=text;n.hidden=false;}});
  for(const priority of ['approval','question','connection','subtasks']){await page.waitForFunction(priority=>document.querySelector('#composer-above-slot').dataset.priority===priority,priority);await shot(page,surface,theme,`priority-${priority}`);
    const shown=await page.locator('[data-composer-above]').evaluateAll(ns=>ns.filter(n=>!n.hidden&&getComputedStyle(n).display!=='none').map(n=>n.dataset.composerAbove));assert.deepEqual(shown,[priority]);assert.equal(await bar.isVisible(),false);
    await page.evaluate(priority=>{for(const n of document.querySelectorAll(`[data-composer-above="${priority}"]`))n.hidden=true;},priority);}
  await page.evaluate(()=>{for(const n of document.querySelectorAll('[data-ux7-old-text]')){if(n.dataset.ux7Synthetic)n.remove();else {n.textContent=n.dataset.ux7OldText;n.hidden=true;delete n.dataset.ux7OldText;}}});
  await page.waitForFunction(()=>document.querySelector('#composer-above-slot').dataset.priority==='suggestions');
  await page.evaluate(()=>{const hint=document.createElement('div');hint.className='model-gate-hint';hint.id='ux7-model-gate';hint.textContent='请先添加对话模型';document.querySelector('#composer-above-slot').parentElement.append(hint);});await page.waitForFunction(()=>document.querySelector('#composer-above-slot').dataset.priority==='none');await shot(page,surface,theme,'no-model');assert.equal(await bar.isVisible(),false);await page.evaluate(()=>document.getElementById('ux7-model-gate').remove());
  await page.getByRole('button',{name:'收起本次建议',exact:true}).click(); await bar.waitFor({state:'hidden'});assert.equal(await bar.isVisible(),false); await shot(page,surface,theme,'dismissed');
  await core(page,'core.requestNextSuggestions("replies");'); await delay(50); assert.equal(await bar.isVisible(),false);
  await field.fill('请把它'); await field.evaluate(n=>n.setSelectionRange(n.value.length,n.value.length));
  await page.locator('.composer-completion:not([hidden])').waitFor(); await shot(page,surface,theme,'completion');
  const originalHeight=(await field.boundingBox()).height; await field.press('Tab'); assert.equal(await field.inputValue(),'请把它保存成文件'); assert.equal((await field.boundingBox()).height,originalHeight); await shot(page,surface,theme,'completion-accepted');
  await field.fill('请把它'); await page.locator('.composer-completion:not([hidden])').waitFor(); await field.press('Escape'); assert.equal(await page.locator('.composer-completion').isVisible(),false);
  await core(page,'core.state.personalization.nextSuggestionsEnabled=false;core.syncNextSuggestions();'); await shot(page,surface,theme,'setting-off'); assert.equal(await bar.isVisible(),false);
  checks.push({surface,theme,fillDoesNotSend:true,dismissedReplyDoesNotReturn:true,completionTab:true,completionEscape:true,off:true});
}
try {
  console.log('UX-7 fixture starting'); fixture = await startTimelineCandidate({historyCount:0,interactive:true,composer:true}); await fixture.complete(); console.log('UX-7 fixture complete');
  profile=await mkdtemp(join(tmpdir(),'weftmate-ux7-ui-'));
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['scripts/review-gallery/electron.mjs'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_THEME:'light'}});
  console.log('UX-7 Electron launched'); const p=await app.firstWindow(); p.setDefaultTimeout(12000); p.on('pageerror',e=>errors.push(e.message)); await exposeUx7Desktop(p); await localUiSession(p,fixture.credentials); await mockUx7Requests(p,()=>replies,{legacy:true}); console.log('UX-7 authenticated');
  for(const width of [1200,480])for(const theme of ['light','dark']) { console.log('UX-7 reload',width,theme); await p.reload(); console.log('UX-7 select',width,theme); await selectSession(p); console.log('UX-7 selected'); await p.locator('#message-text').waitFor();
    await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,800),width); await exercise(p,`electron-${width}`,theme); }
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const size of [{width:390,height:844},{width:360,height:780}])for(const theme of ['light','dark']) {
    const web=await browser.newPage({viewport:size,isMobile:true,hasTouch:true});web.setDefaultTimeout(12000);web.on('pageerror',e=>errors.push(e.message));await exposeUx7Desktop(web);await web.goto(fixture.origin+'/personal/v1/ui');await localUiSession(web,fixture.credentials);await mockUx7Requests(web,()=>replies,{legacy:true});await selectSession(web);await exercise(web,`mobile-web-${size.width}`,theme);await web.close();
    const bundle=await browser.newPage({viewport:size,isMobile:true,hasTouch:true});bundle.setDefaultTimeout(12000);bundle.on('pageerror',e=>errors.push(e.message));await mockUx7Requests(bundle,()=>replies);await bundle.goto(fixture.mobileUrl);await bundle.waitForFunction(()=>state.booted);await bundle.evaluate(async id=>{await selectSharedSession(id);closeDrawer()},fixture.sessionId);await exercise(bundle,`android-bundle-${size.width}`,theme);await bundle.close();
  }
  assert.deepEqual(errors,[]);await writeFile(join(out,'ui-checks.json'),JSON.stringify({synthetic:true,modelRequests:0,rows,checks,errors},null,2));
} finally { await writeFile(join(out,'ui-checks.partial.json'),JSON.stringify({rows,checks,errors},null,2));await browser?.close();await app?.close();await fixture?.close();if(profile)await rm(profile,{recursive:true,force:true});if(fixture)await rm(fixture.root,{recursive:true,force:true}); }
