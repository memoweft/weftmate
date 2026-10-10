import assert from 'node:assert/strict';
import {_electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {startRenderingCandidate} from './ux-5-fixture.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
const out=resolve('tests/evidence/ux-5');await mkdir(out,{recursive:true});
const report={checks:[],errors:[],performance:[]};
for(const surface of ['desktop','mobile-web','android-ui']){
  const fixture=await startRenderingCandidate(),profile=await mkdtemp(join(tmpdir(),'weftmate-ux5-ui-'));
  const env={...process.env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_THEME:'light',REVIEW_LIBRARY_TOKEN:fixture.libraryDesktopToken};
  for(const key of Object.keys(env))if(key.startsWith('WEFTMATE_')||key.startsWith('MEMOWEFT_')||key==='ELECTRON_RUN_AS_NODE')delete env[key];
  let app,browser,page;
  try{
    if(surface==='desktop'){app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs'],env,timeout:90000});page=await app.firstWindow();await localUiSession(page,fixture.credentials,'UX-5 synthetic',{interceptLegacyStatus:false});}
    else {browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await page.goto(surface==='mobile-web'?fixture.origin+'/personal/v1/ui':fixture.mobileUrl);if(surface==='mobile-web'){await localUiSession(page,fixture.credentials,'UX-5 synthetic',{interceptLegacyStatus:false});}else await page.waitForFunction(()=>state.booted&&state.loggedIn);}
    page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push({surface,error:e.message}));
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{globalThis.ux5Copy=text}},configurable:true}));
    if(surface==='android-ui'){await page.evaluate(()=>listSharedSessions());await page.getByRole('button',{name:'打开导航',exact:true}).click();}
    const select=page.getByRole('button',{name:'渲染样张',exact:true,includeHidden:true});await select.waitFor({state:'attached'});if(surface==='mobile-web'&&!await select.isVisible())await page.locator('#rail-open').click();await select.click();
    const body=page.locator('.message.assistant').filter({has:page.getByRole('heading',{name:'一份可以读、可以用的回复',exact:true})}).last();
    await body.getByRole('heading',{name:'图片与文件',exact:true}).waitFor();
    if(app){await app.evaluate(({shell})=>{globalThis.ux5External=[];shell.openExternal=async url=>{globalThis.ux5External.push(url);};});await body.getByRole('link',{name:'示例站点',exact:true}).click();const urls=await app.evaluate(()=>globalThis.ux5External);assert.equal(urls.length,1);assert.ok(urls[0].startsWith('https://example.com/'));report.checks.push({surface,nativeSystemBrowserDispatch:true,actualBrowserLaunchIntercepted:true});}
    assert.equal(await page.locator('.message.user strong').filter({hasText:'这条用户消息'}).count(),1);
    const shot=async name=>page.screenshot({path:join(out,`${surface}-${name}.png`),animations:'disabled'});
    for(const theme of ['light','dark']){
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      await body.getByRole('heading',{name:'一份可以读、可以用的回复',exact:true}).scrollIntoViewIfNeeded();await shot(`${theme}-markdown`);
      const code=body.locator('.render-code[data-language="python"]');await code.scrollIntoViewIfNeeded();await code.hover();await shot(`${theme}-code-hover`);
      const copy=code.getByRole('button',{name:'复制代码',exact:true});await copy.click();await copy.getByText('已复制',{exact:true}).waitFor();await shot(`${theme}-code-copied`);
      const long=body.locator('.render-code[data-language="typescript"]');await long.scrollIntoViewIfNeeded();assert.equal(await long.evaluate(el=>el.classList.contains('is-collapsed')),true);await shot(`${theme}-code-collapsed`);
      await long.getByRole('button',{name:'展开全部（42 行）',exact:true}).click();await shot(`${theme}-code-expanded`);await long.getByRole('button',{name:'自动换行',exact:true}).click();await shot(`${theme}-code-wrap`);await long.getByRole('button',{name:'自动换行',exact:true}).click();await long.getByRole('button',{name:'收起代码',exact:true}).click();
      const table=body.locator('.table-scroll');await table.scrollIntoViewIfNeeded();await table.evaluate(el=>el.scrollLeft=el.scrollWidth);await shot(`${theme}-table-scroll`);
      await body.getByRole('button',{name:'复制为 CSV',exact:true}).click();
      const formula=body.locator('.math-block');await formula.scrollIntoViewIfNeeded();assert.equal(await formula.locator('.katex').count(),1);await shot(`${theme}-formula`);
      const diagram=body.locator('.render-mermaid').first();await diagram.scrollIntoViewIfNeeded();await diagram.locator('.render-diagram img').waitFor();await shot(`${theme}-mermaid-diagram`);await diagram.getByRole('button',{name:'看源码',exact:true}).click();await shot(`${theme}-mermaid-source`);await diagram.getByRole('button',{name:'看图',exact:true}).click();
      const fallback=body.locator('.math-fallback');await fallback.scrollIntoViewIfNeeded();await shot(`${theme}-formula-fallback`);const failed=body.locator('.render-mermaid').last();await failed.scrollIntoViewIfNeeded();await failed.locator('.render-status').getByText('图表暂时无法绘制，已保留源码。',{exact:true}).waitFor();await shot(`${theme}-mermaid-fallback`);await body.getByText('图片加载失败 · 打不开的合成图',{exact:true}).scrollIntoViewIfNeeded();await shot(`${theme}-image-failure`);
      await body.getByRole('button',{name:'查看图片 合成色板 A',exact:true}).click();const gallery=page.getByRole('dialog',{name:'图片画廊',exact:true});await gallery.waitFor();await shot(`${theme}-gallery-open`);await gallery.getByRole('button',{name:'下一张',exact:true}).click();await gallery.getByRole('button',{name:'放大',exact:true}).click();await shot(`${theme}-gallery-zoom`);await gallery.getByRole('button',{name:'关闭图片画廊',exact:true}).click();
      await body.getByRole('button',{name:'预览文件 合成报告.docx',exact:true}).scrollIntoViewIfNeeded();await shot(`${theme}-file-cards`);
      await body.getByRole('button',{name:'预览文件 合成报告.docx',exact:true}).click();await page.getByText('Office 文件请在电脑上用默认程序打开。',{exact:true}).waitFor();await shot(`${theme}-office-fallback-open`);
      if(surface==='android-ui')await page.getByRole('button',{name:'返回对话',exact:true}).click();else await page.getByRole('button',{name:'收起右侧面板',exact:true}).click();
      report.checks.push({surface,theme,markdown:true,userMarkdown:true,code:true,table:true,math:true,mermaid:true,gallery:true,files:true,officeFallback:true});
    }
    for(const size of surface==='desktop'?[{width:480,height:800}]:[{width:360,height:780},{width:390,height:844}]){
      if(app)await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(size.width,size.height),size);else await page.setViewportSize(size);
      for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await body.getByRole('heading',{name:'表格 · 保留列的宽度',exact:true}).scrollIntoViewIfNeeded();await shot(`${theme}-${size.width}x${size.height}`);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
    }
    const perf=await page.evaluate(async()=>{
      const text='# 万字性能样张\n\n'+('中文 English 内容用于测试换行与高度。'.repeat(400))+'\n\n'+Array.from({length:20},(_,i)=>'```javascript\n'+`const code${i} = "value";\n`.repeat(12)+'```').join('\n\n')+'\n\n'+Array.from({length:5},()=> '| 项目 | 数量 |\n| --- | ---: |\n| A | 12 |\n| B | 32 |').join('\n\n');
      const start=performance.now(),host=WeftContent.create(text);document.body.append(host);const initial=performance.now()-start;let peak=0,updates=[];const code=host.querySelector('.render-code'),before=performance.memory?.usedJSHeapSize;
      for(let n=1;n<=20;n++){await new Promise(requestAnimationFrame);const at=performance.now();WeftContent.update(host,text+'\n\n正在输出 '+n+'。');host.getBoundingClientRect();const duration=performance.now()-at;updates.push(duration);peak=Math.max(peak,duration);}
      const after=performance.memory?.usedJSHeapSize,stable=code===host.querySelector('.render-code');host.remove();return {characters:text.length,codeBlocks:20,tables:5,initialMs:initial,updateMeanMs:updates.reduce((a,b)=>a+b)/updates.length,updateMaxMs:peak,heapBefore:before??null,heapAfter:after??null,stableCodeNode:stable};
    });report.performance.push({surface,...perf});assert.equal(perf.stableCodeNode,true);
    report.checks.push({surface,errors:0});await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');
  }catch(error){if(page)await page.screenshot({path:join(out,`${surface}-failure.png`)});throw error;}
  finally{await app?.close();await browser?.close();await fixture.close();await rm(profile,{recursive:true,force:true});}
}
assert.deepEqual(report.errors,[]);await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
