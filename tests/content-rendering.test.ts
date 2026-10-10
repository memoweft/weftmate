import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {_electron} from 'playwright';

test('shared offline content: parsing, injection set, streaming, controls and failure fallback',async t=>{
  const profile=await mkdtemp(join(tmpdir(),'weftmate-ux5-unit-'));
  const env={...process.env,UX5_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[resolve('tests/helpers/rendering-electron.mjs')],env});
  t.after(async()=>{await app.close();await rm(profile,{recursive:true,force:true});});
  const page=await app.firstWindow();await page.waitForFunction(()=>!!globalThis.WeftContent);
  await t.test('headings, nested lists/tasks, quotes, rule, emphasis, links, footnotes and 30 languages',async()=>{
    const result=await page.evaluate(()=>{const body=WeftContent.create('# 标题\n\n1. 第一项\n   - 子项\n   - [x] 完成\n   - [ ] 继续\n\n> 引用\n\n---\n\n**粗体** *斜体* ~~删除~~ `inline` [网址](https://example.com) 脚注[^1]\n\n[^1]: 说明');document.body.append(body);return {html:body.innerHTML,languages:WeftFormat.languages};});
    for(const tag of ['h1','ol','ul','blockquote','hr','strong','em','s','code'])assert.match(result.html,new RegExp('<'+tag));
    assert.match(result.html,/aria-checked="true"/);assert.match(result.html,/footnote/);assert.match(result.html,/external-link/);assert.ok(result.languages.length>=30);
  });
  await t.test('script, HTML events, dangerous protocols, SVG scripts, CSS expression, KaTeX extensions never execute',async()=>{
    const inputs=['<script>window.injected=1</script>','<img src=x onerror="window.injected=1">','[bad](javascript:alert(1))','[bad](java&#x73;cript:alert(1))','[bad](vbscript:alert(1))','<svg><script>window.injected=1</script></svg>','<div style="width:expression(alert(1))">x</div>','![bad](data:image/svg+xml;base64,PHN2Zz4=)','$\\href{javascript:alert(1)}{x}$','$\\htmlStyle{background:url(https://example.com)}{x}$','$\\includegraphics{https://example.com/a.png}$'];
    const results=await page.evaluate(inputs=>inputs.map(text=>{const body=WeftContent.create(text);document.body.append(body);return {script:body.querySelectorAll('script,svg,iframe,object,[onerror],[onclick]').length,links:[...body.querySelectorAll('a')].map(a=>a.getAttribute('href')),image:body.querySelectorAll('img').length};}),inputs);
    for(const result of results){assert.equal(result.script,0);assert.equal(result.image,0);assert.ok(result.links.every(href=>/^https?:|^#/.test(href)));}
    assert.equal(await page.evaluate(()=>globalThis.injected),undefined);
  });
  await t.test('unclosed streaming code preserves controls and node identity, exact 30-line threshold',async()=>{
    const result=await page.evaluate(()=>{document.body.replaceChildren();const body=WeftContent.create('```python\nprint(1)');document.body.append(body);const block=body.querySelector('.render-code'),button=block.querySelector('[aria-label="复制代码"]');WeftContent.update(body,'```python\nprint(1)\nprint(2)');const stable=block===body.querySelector('.render-code')&&button===body.querySelector('[aria-label="复制代码"]');return {stable,code:body.querySelector('code').textContent,at30:WeftContent.collapsed('a\n'.repeat(30)),at31:WeftContent.collapsed('a\n'.repeat(31))};});
    assert.equal(result.stable,true);assert.match(result.code,/print\(2\)/);assert.equal(result.at30,false);assert.equal(result.at31,true);
  });
  await t.test('table copies escape pipes, CSV quotes, commas and multiline cells',async()=>{
    const result=await page.evaluate(()=>{const rows=[['a','b'],['x|y','say "hi",\nnext']];return {md:WeftContent.tableCopy(rows),csv:WeftContent.tableCopy(rows,'csv')};});
    assert.equal(result.md,'| a | b |\n| --- | --- |\n| x\\|y | say "hi",<br>next |');assert.equal(result.csv,'"a","b"\r\n"x|y","say ""hi"",\nnext"');
  });
  await t.test('math renders offline and failure returns exact delimited source',async()=>{
    const result=await page.evaluate(()=>({good:WeftFormat.render('$x^2$\n\n$$\\frac{1}{2}$$'),root:WeftFormat.render('$\\sqrt{x}$'),bad:WeftFormat.render('$\\unknown{a}$')}));
    assert.match(result.good,/katex/);assert.match(result.good,/math-block/);assert.match(result.bad,/math-fallback/);assert.match(result.bad,/\$\\unknown\{a\}\$/);
    assert.match(result.root,/<svg/);
  });
  await t.test('Mermaid graph and failed/injected syntax fallback without links or scripts',async()=>{
    await page.evaluate(()=>{document.body.replaceChildren(WeftContent.create('```mermaid\ngraph LR\n A[开始] --> B[完成]\n```'));});
    await page.locator('.render-diagram img').waitFor();assert.equal(await page.locator('.diagram-failed').count(),0);
    assert.match(await page.evaluate(async()=>await(await fetch(document.querySelector('.render-diagram img').src)).text()),/开始/);
    for(const source of ['not-a-diagram','graph LR\nA-->B\nclick A "javascript:alert(1)"','%%{init: {"securityLevel":"loose"}}%%\ngraph LR\nA-->B','graph LR\nA[<script>alert(1)</script>]']){
      await page.evaluate(source=>document.body.replaceChildren(WeftContent.create('```mermaid\n'+source+'\n```')),source);
      await page.locator('.diagram-failed').waitFor();assert.match(await page.locator('.render-code pre').textContent(),new RegExp(source.split('\n')[0].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.equal(await page.locator('script:not([src]),a[href^="javascript:"]').count(),0);
    }
  });
  await t.test('known host titles become link cards; ordinary links use external marking without a fetch',async()=>{
    const result=await page.evaluate(()=>{const body=WeftContent.create('[已读](https://example.com/)\n\n[普通](https://example.org/)','markdown-body',{pages:[{url:'https://example.com/',title:'宿主已读的合成标题'}]});return {cards:body.querySelectorAll('.render-link-card').length,title:body.querySelector('.render-link-card strong').textContent,external:body.querySelectorAll('.external-link[target="_blank"]').length};});
    assert.equal(result.cards,1);assert.equal(result.external,2);assert.equal(result.title,'宿主已读的合成标题');
  });
  await t.test('an incomplete streamed diagram recovers to graph view when the syntax becomes valid',async()=>{
    await page.evaluate(()=>{globalThis.streamDiagram=WeftContent.create('```mermaid\ngraph LR\n A -->');document.body.replaceChildren(streamDiagram);});
    await page.locator('.diagram-failed').waitFor();
    await page.evaluate(()=>WeftContent.update(streamDiagram,'```mermaid\ngraph LR\n A --> B\n```'));
    await page.locator('.render-diagram img').waitFor();assert.equal(await page.locator('.diagram-failed').count(),0);assert.equal(await page.locator('.render-code pre').isVisible(),false);
  });
});
