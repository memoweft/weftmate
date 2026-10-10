import assert from 'node:assert/strict';
import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startMainChatCandidate} from './main-chat-candidate.mjs';
import {localUiSession} from '../helpers/local-ui-session.mjs';
import {renderingSample} from '../helpers/rendering-sample.mjs';
const out=resolve('tests/evidence/ux-5'),fixture=await startMainChatCandidate(1000),profile=await mkdtemp(join(tmpdir(),'weftmate-ux5-height-'));
fixture.progress.text(renderingSample);fixture.progress.finish();
const env={...process.env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:fixture.origin,REVIEW_THEME:'light'};delete env.ELECTRON_RUN_AS_NODE;
let app;const errors=[];
try{
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:['scripts/review-gallery/electron.mjs'],env});
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await localUiSession(page,fixture.credentials,'UX5 virtual height',{mainChat:true});page.setDefaultTimeout(20000);
  await page.getByRole('heading',{name:'图片与文件',exact:true}).waitFor();
  await page.locator('.footnotes').waitFor();await page.waitForTimeout(400);
  await page.getByRole('heading',{name:'代码 · 可以直接复制',exact:true}).evaluate(el=>el.scrollIntoView({block:'center'}));
  const code=page.locator('.render-code[data-language="typescript"]');await code.evaluate(el=>el.scrollIntoView({block:'center'}));
  await page.waitForTimeout(400);const original=await code.evaluate(el=>el.getBoundingClientRect().top);
  await code.getByRole('button',{name:'展开全部（42 行）',exact:true}).click();await page.waitForTimeout(400);const expanded=await code.evaluate(el=>el.getBoundingClientRect().top);
  await code.getByRole('button',{name:'收起代码',exact:true}).click();await page.waitForTimeout(400);const restored=await code.evaluate(el=>el.getBoundingClientRect().top);
  const jump=Math.abs(expanded-original);assert.ok(jump<=2,`virtual row anchor moved ${jump}px`);
  await page.screenshot({path:join(out,'main-chat-height.png')});
  const imageResults=[];
  for(const theme of ['light','dark']){
    const data=await page.evaluate(async theme=>{const canvas=await WeftContent.exportCanvas('# 导出样张\n\n**保留排版**，公式 $E=mc^2$。\n\n```python\nprint("你好")\n```\n\n| 项目 | 数量 |\n| --- | ---: |\n| A | 12 |',theme);const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let colored=0;for(let n=0;n<pixels.length;n+=4)if(pixels[n]!==pixels[0]||pixels[n+1]!==pixels[1]||pixels[n+2]!==pixels[2])colored++;return {url:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height,corner:[...pixels.slice(0,4)],colored};},theme);
    assert.ok(data.colored>1000);assert.equal(data.corner[3],255);await writeFile(join(out,`rendered-export-${theme}.png`),Buffer.from(data.url.split(',')[1],'base64'));const {url,...metadata}=data;imageResults.push({theme,...metadata});
  }
  assert.deepEqual(errors,[]);await writeFile(join(out,'height-export.json'),JSON.stringify({mainHistoryMessages:1000,originalTop:original,expandedTop:expanded,restoredTop:restored,anchorJumpPx:jump,export:imageResults,errors},null,2)+'\n');
  console.log('Main virtual height and rendered PNG exports passed.');
}finally{await app?.close();await fixture.close();await rm(profile,{recursive:true,force:true});}
