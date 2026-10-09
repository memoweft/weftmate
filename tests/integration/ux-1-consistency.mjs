/** UX-1, isolated host, synthetic questions and approvals, production Electron. */
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { localUiSession } from '../helpers/local-ui-session.mjs';
const root = resolve(import.meta.dirname, '../..'), evidence = join(root, 'tests/evidence/ux-1');
mkdirSync(evidence, { recursive: true });
const checks = [], textFrames = [], errors = [], env = { ...process.env };
for (const key of Object.keys(env)) if (/^(WEFTMATE_|MEMOWEFT_)/.test(key) || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
let app, browser, fixture, profile;
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(fn) { const deadline = Date.now() + 20000; while (Date.now() < deadline) { if (await fn()) return; await pause(100); } throw Error('UX-1 condition timed out'); }
async function close() { await browser?.close(); await app?.close(); await fixture?.close(); if (fixture) { assert.ok(fixture.root.startsWith(join(tmpdir(), 'weftmate-m0-3-'))); rmSync(fixture.root, {recursive:true,force:true}); } if (profile) rmSync(profile,{recursive:true,force:true}); app = browser = fixture = profile = null; }
try {
  for (const theme of ['light','dark']) {
    fixture = await startTimelineCandidate({historyCount:0,interactive:true,inlineProgress:true,usageSamples:true,consistency:true,baseTime:Date.now()-15000});
    profile = mkdtempSync(join(tmpdir(),'weftmate-ux1-'));
    app = await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:root,args:['scripts/review-gallery/electron.mjs','--force-device-scale-factor=1'],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_THEME:theme}});
    const desktop = await app.firstWindow(); await localUiSession(desktop,fixture.credentials);
    browser = await chromium.launch({headless:true});
    const mobile = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Shanghai'});
    await mobile.goto(fixture.mobileUrl); await mobile.getByRole('button',{name:'项目进度报告 正在运行',exact:true}).click();
    await mobile.evaluate(theme=>applyTheme(theme),theme);
    const remote = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Shanghai'});
    await remote.goto(fixture.origin+'/personal/v1/ui'); await localUiSession(remote,fixture.credentials);
    for (const page of [desktop,remote]) await page.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme);
    const surfaces = [['desktop',desktop],['android-ui',mobile],['mobile-web',remote]];
    for (const [,page] of surfaces) { page.setDefaultTimeout(20000); page.on('pageerror',error=>errors.push(error.message)); }
    async function shot(name) {
      console.log(theme,name);
      for (const [surface,page] of surfaces) {
        await page.screenshot({path:join(evidence,`${surface}-${theme}-${name}.png`)});
        const text = await page.locator('body').innerText();
        assert.doesNotMatch(text,/\b(?:read|pwsh|shell|search|write|ask_user_question|load_tools|mcp__[A-Za-z0-9_]+|undefined|null)\b|Weave\s*组件/,'internal names in rendered screenshot text');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');
        textFrames.push({surface,theme,scene:name,text});
      }
    }
    const bar = page=>page.getByRole('region',{name:'待回答问题',exact:true});
    const batch = fixture.progress.ask([
      {id:'format',question:'报告要采用哪种格式？',detail:'选择报告的详细程度，稍后可以补充说明。',options:[{label:'简要报告',description:'保留结论和下一步。'},{label:'完整记录',description:'保留所有过程。'}]},
      {id:'include',question:'需要包含哪些内容？',multiSelect:true,options:[{label:'结论'},{label:'源文件'}]},
      {id:'note',question:'还有什么需要补充？'}
    ]);
    const second = fixture.progress.ask([{id:'delivery',question:'如何交付报告？',options:[{label:'保存文件'},{label:'直接回复'}]}]);
    const approval = await fixture.progress.approve('ux1-approval','npm run verify');
    for (const [,page] of surfaces) { await page.getByRole('region',{name:'待批准操作'}).waitFor(); await page.getByText('另有 4 个问题，处理审批后回答',{exact:true}).waitFor(); assert.equal(await bar(page).isVisible(),false); }
    await shot('01-approval-priority');
    await desktop.getByRole('button',{name:'批准',exact:true}).click();
    for (const [,page] of surfaces) { await bar(page).waitFor(); await page.getByText('还有 3 个问题',{exact:true}).waitFor(); }
    await fixture.progress.resolve(approval,'allowed-once'); fixture.progress.result('ux1-approval','合成检查通过。');
    await shot('02-single-choice');
    for (const [,page] of surfaces) {
      await bar(page).getByRole('radio',{name:'简要报告',exact:true}).click();
      const other = bar(page).getByRole('textbox',{name:'其他回答'}); await other.fill('自定义摘要'); await other.press('Enter');
      assert.equal(await bar(page).getByRole('radio',{name:'简要报告',checked:true}).count(),0);
      assert.equal((await fixture.request(`/sessions/${fixture.sessionId}/questions?limit=100`)).questions.find(row=>row.questionRpcId===batch.questionRpcId).status,'pending');
    }
    await shot('03-other-input-enter');
    for (const [,page] of surfaces) { await bar(page).getByRole('radio',{name:'简要报告',exact:true}).click(); assert.equal(await bar(page).getByRole('textbox',{name:'其他回答'}).inputValue(),''); await bar(page).getByText('查看完整说明',{exact:true}).click(); }
    await shot('04-expanded-description');
    for (const [,page] of surfaces) { await bar(page).getByRole('button',{name:'下一题',exact:true}).click(); await bar(page).getByRole('button',{name:'结论',exact:true}).click(); await bar(page).getByRole('button',{name:'源文件',exact:true}).click(); await bar(page).getByRole('textbox',{name:'其他回答'}).fill('附带简短目录'); }
    await shot('05-multiple-choice');
    for (const [,page] of surfaces) { await bar(page).getByRole('button',{name:'下一题',exact:true}).click(); await bar(page).getByRole('textbox',{name:'你的回答'}).fill('请使用中文。'); await bar(page).getByRole('textbox',{name:'你的回答'}).press('Enter'); }
    await shot('06-free-answer');
    await desktop.getByRole('button',{name:'提交回答',exact:true}).focus(); await desktop.getByRole('button',{name:'提交回答',exact:true}).press('Enter');
    for (const [,page] of surfaces) { await bar(page).getByText('如何交付报告？',{exact:true}).first().waitFor(); await page.getByText('已回答：简要报告；结论、源文件、附带简短目录；请使用中文。',{exact:true}).waitFor(); }
    const accepted = (await fixture.request(`/sessions/${fixture.sessionId}/questions?limit=100`)).questions.find(row=>row.questionRpcId===batch.questionRpcId);
    assert.deepEqual(accepted.answer.answers,[{id:'format',selected:['简要报告']},{id:'include',selected:['结论','源文件'],custom:'附带简短目录'},{id:'note',selected:[],custom:'请使用中文。'}]);
    await shot('07-next-batch');
    await mobile.getByRole('textbox',{name:'其他回答'}).fill('另存中文报告'); await mobile.getByRole('button',{name:'提交回答',exact:true}).click();
    for (const [,page] of surfaces) { await bar(page).waitFor({state:'hidden'}); await page.getByText('已回答：另存中文报告',{exact:true}).waitFor(); assert.equal(await page.getByRole('button',{name:'提交回答',exact:true}).count(),0); }
    await shot('08-answered-bar-removed');
    fixture.progress.call('read','ux1-read',{path:'使用说明.md'});fixture.progress.result('ux1-read','这是合成文件正文。');
    fixture.progress.call('search','ux1-search',{query:'报告'});fixture.progress.result('ux1-search','找到合成结果。');
    fixture.progress.call('load_tools','ux1-tools',{});fixture.progress.result('ux1-tools','工具已准备好。');
    fixture.progress.call('mcp__calendar__list','ux1-extension',{});fixture.progress.result('ux1-extension','合成扩展已处理。');
    await fixture.progress.artifact();
    for (const [,page] of surfaces) { await page.getByText('已读回核验').first().waitFor(); await page.getByRole('button',{name:'输出与来源',exact:true}).click(); await page.getByRole('button',{name:/读取文件.*次|读取文件/}).first().waitFor(); if(await page.getByRole('button',{name:'查看全部',exact:true}).count()) await page.getByRole('button',{name:'查看全部',exact:true}).click(); await page.getByRole('button',{name:/读取文件.*次|读取文件/}).first().waitFor(); }
    await shot('09-chinese-sources');
    for(const [surface,page] of surfaces){await page.getByRole('button',{name:/读取文件/}).first().click();await page.getByText(/^读取文件：使用说明.md/).filter({visible:true}).first().click(); await page.getByText('详情',{exact:true}).filter({visible:true}).first().click(); await page.getByText(/"路径"/).filter({visible:true}).first().waitFor();}
    await shot('09b-source-detail');

    // Desktop and remote web share the settings usage category; the Android bundle uses its usage page.
    for (const [surface,page] of surfaces) {
      if (surface==='android-ui') { await page.getByRole('button',{name:'返回对话',exact:true}).click(); await page.getByRole('button',{name:'本对话用量',exact:true}).click(); }
      else { await page.getByRole('button',{name:'收起右侧面板',exact:true}).click(); await page.getByRole('button',{name:'本对话用量',exact:true}).click(); }
      await page.getByRole('combobox',{name:'统计月份',exact:true}).waitFor();
      await page.getByRole('combobox',{name:'统计月份',exact:true}).click(); await page.getByRole('option',{name:'2026 年 10 月',exact:true}).waitFor();
    }
    await shot('10-chinese-month-picker');
    for (const [,page] of surfaces) { await page.getByRole('option',{name:'2026 年 10 月',exact:true}).click(); await page.getByText(/按.*中国标准时间|按.*北京时间/).waitFor(); }
    await shot('11-local-time-usage');
    await mobile.getByRole('button',{name:'返回',exact:true}).click();
    await mobile.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:/^记忆/}).click();
    await mobile.getByRole('combobox',{name:'记忆类别',exact:true}).waitFor();
    await mobile.getByRole('combobox',{name:'记忆类别',exact:true}).click();
    await mobile.getByRole('option',{name:'关系',exact:true}).click();
    assert.equal(await mobile.evaluate(()=>state.memory.kind),'relationship');
    assert.equal(await mobile.locator('select').filter({visible:true}).count(),0);
    await mobile.getByRole('combobox',{name:'记忆类别',exact:true}).click();
    await mobile.screenshot({path:join(evidence,`android-ui-${theme}-12-memory-category.png`)});
    const memoryText=await mobile.locator('body').innerText();textFrames.push({surface:'android-ui',theme,scene:'12-memory-category',text:memoryText});

    checks.push({memoryCategory:true,theme,surfaces:surfaces.map(([surface])=>surface),approvalPriority:true,singleChoice:true,multipleChoice:true,custom:true,batches:2,enterDoesNotSubmitInput:true,answeredDisappears:true,chineseSources:true,localizedUsage:true});
    await close();
  }
  assert.deepEqual(errors,[]);
  writeFileSync(join(evidence,'checks.json'),JSON.stringify({syntheticOnly:true,realElectron:true,checks,errors},null,2)+'\n');
  writeFileSync(join(evidence,'screenshot-text.json'),JSON.stringify({syntheticOnly:true,frames:textFrames},null,2)+'\n');
  console.log('UX-1 production Electron / phone web / Android UI bundle passed.');
} catch (error) { if(fixture) console.error(JSON.stringify(await fixture.request(`/sessions/${fixture.sessionId}/questions?limit=100`),null,2)); if(app) console.error(await (await app.firstWindow()).locator('body').innerText()); throw error; } finally { await close(); }
