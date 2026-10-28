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
  await t.test('streaming lists retain completed items, the growing text node and the reading selection',async()=>{
    const result=await page.evaluate(()=>{
      const body=WeftContent.create('1. 第一项\n2. 第二项','markdown-body',{streaming:true});document.body.append(body);
      const list=body.querySelector('ol'),first=list.firstElementChild,second=list.lastElementChild,tail=second.firstChild;
      const selection=getSelection(),range=document.createRange();range.selectNodeContents(first);selection.removeAllRanges();selection.addRange(range);
      WeftContent.update(body,'1. 第一项\n2. 第二项继续\n3. 第三项',{streaming:true});
      return {list:body.querySelector('ol')===list,first:body.querySelector('li')===first,second:body.querySelectorAll('li')[1]===second,tail:second.firstChild===tail,selection:selection.toString(),text:second.textContent};
    });
    assert.deepEqual(result,{list:true,first:true,second:true,tail:true,selection:'第一项',text:'第二项继续'});
  });
  await t.test('a long streamed list parses only the open item while its last text grows',async()=>{
    const result=await page.evaluate(()=>{
      let text=Array.from({length:2000},(_,i)=>`${i+1}. 合成清单 ${i+1}`).join('\n');
      const body=WeftContent.create(text,'markdown-body',{streaming:true});document.body.append(body);
      const first=body.querySelector('li'),tail=body.querySelector('ol').lastElementChild.firstChild;
      const render=WeftFormat.render,blocks=WeftFormat.renderBlocks,lengths=[];
      WeftFormat.render=(value,options)=>{lengths.push(value.length);return render(value,options);};
      WeftFormat.renderBlocks=(value,options)=>{lengths.push(value.length);return blocks(value,options);};
      try {for(let i=0;i<20;i++){text+='继续';WeftContent.update(body,text,{streaming:true});}}
      finally {WeftFormat.render=render;WeftFormat.renderBlocks=blocks;}
      return {maxParsed:Math.max(...lengths),stable:body.querySelector('li')===first&&body.querySelector('ol').lastElementChild.firstChild===tail,items:body.querySelectorAll('li').length,exact:tail.textContent==='合成清单 2000'+'继续'.repeat(20)};
    });
    assert.ok(result.maxParsed<100,JSON.stringify(result));assert.equal(result.stable,true);assert.equal(result.items,2000);assert.equal(result.exact,true);
  });
  await t.test('an unfinished next list marker never replaces the completed list or its selection',async()=>{
    const result=await page.evaluate(()=>{
      const body=WeftContent.create('1. 已完成的条目\n2. 尾部','markdown-body',{streaming:true});document.body.append(body);
      const list=body.querySelector('ol'),first=list.firstElementChild,range=document.createRange();range.selectNodeContents(first);getSelection().removeAllRanges();getSelection().addRange(range);
      let text='1. 已完成的条目\n2. 尾部',stable=true;
      for(const part of '\n3. 新条目'){text+=part;WeftContent.update(body,text,{streaming:true});stable&&=body.querySelector('ol')===list&&body.querySelector('li')===first;}
      return {stable,selection:getSelection().toString(),items:body.querySelectorAll('li').length,text:body.innerText};
    });assert.deepEqual(result,{stable:true,selection:'已完成的条目',items:3,text:'已完成的条目\n尾部\n新条目'});
  });
  await t.test('plain streaming tails retain completed blocks and Markdown transitions still reparse references, lists and fences',async()=>{
    const prefix=await page.evaluate(()=>{const body=WeftContent.create('#','markdown-body',{streaming:true});const first=body.textContent;WeftContent.update(body,'# 标题',{streaming:true});return {first,heading:body.querySelector('h1')?.textContent};});
    assert.equal(prefix.first.replace(/\u200b/g,''),'#');assert.equal(prefix.heading,'标题');
    const equivalence=await page.evaluate(()=>{
      const samples=['[前文引用][later]\n\n中间段落\n\n[later]: https://example.com/page','第一段[^a]\n\n第二段\n\n[^a]: 脚注说明。','> 引用\n> - **项目**\n\n- [x] 完成\n- [ ] 未完成','| 名称 | 值 |\n| --- | --- |\n| **甲** | $x^2$ |','```js\nconst x = "<script>";\n```\n\n$\\frac{1}{2}$'];
      return samples.map(text=>{const host=WeftContent.create(text,'markdown-body',{streaming:true});globalThis.WeftReplyMotion?.indicator?.(host,false);const expected=document.createElement('div');expected.innerHTML=WeftFormat.render(text,{prefix:'test'});return {actual:WeftFormat.renderBlocks(text,{prefix:'test'}).join(''),expected:expected.innerHTML};});
    });
    for(const value of equivalence)assert.equal(value.actual,value.expected);
    const result=await page.evaluate(()=>{
      const prefix='```python\nprint(1)\n```\n\n',body=WeftContent.create(prefix+'第一段');document.body.append(body);const code=body.querySelector('.render-code');
      WeftContent.update(body,prefix+'第一段正在扩展');const plain=body.lastElementChild.textContent,stable=code===body.querySelector('.render-code');
      WeftContent.update(body,prefix+'- 列表项目');const list=body.lastElementChild.tagName;
      WeftContent.update(body,prefix+'```js\nlet a=1');const fenced=body.querySelectorAll('.render-code').length;
      const refs=WeftContent.create('[示例][ref]\n\n尾部');document.body.append(refs);WeftContent.update(refs,'[示例][ref]\n\n尾部\n\n[ref]: https://example.com');
      return {plain,stable,list,fenced,reference:refs.querySelector('a')?.href};
    });
    assert.equal(result.plain,'第一段正在扩展');assert.equal(result.stable,true);assert.equal(result.list,'UL');assert.equal(result.fenced,2);assert.equal(result.reference,'https://example.com/');
  });
  await t.test('math renders offline and failure returns exact delimited source',async()=>{
    const result=await page.evaluate(()=>({good:WeftFormat.render('$x^2$\n\n$$\\frac{1}{2}$$'),root:WeftFormat.render('$\\sqrt{x}$'),bad:WeftFormat.render('$\\unknown{a}$')}));
    assert.match(result.good,/katex/);assert.match(result.good,/math-block/);assert.match(result.bad,/math-fallback/);assert.match(result.bad,/\$\\unknown\{a\}\$/);
    assert.match(result.root,/<svg/);
  });
  await t.test('formatted streaming prose retains emphasis and text nodes across punctuation',async()=>{
    const result=await page.evaluate(()=>{
      const body=WeftContent.create('**结论**：第一段。','markdown-body',{streaming:true});document.body.append(body);
      const paragraph=body.querySelector('p'),strong=body.querySelector('strong'),tail=paragraph.lastChild;
      WeftContent.update(body,'**结论**：第一段。继续生成更多内容！',{streaming:true});
      return {stable:body.querySelector('p')===paragraph&&body.querySelector('strong')===strong&&paragraph.lastChild===tail,text:paragraph.textContent};
    });assert.equal(result.stable,true);assert.equal(result.text,'结论：第一段。继续生成更多内容！');
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
  await t.test('#657 numbered citations and footer links stay compact even when the source is captured',async()=>{
    const result=await page.evaluate(()=>{const body=WeftContent.create('结论[1](https://example.com/)。\n\n## 出处\n\n1. [合成站点](https://example.com/) · 今天 11:32 访问 · 一句话摘要。','markdown-body',{pages:[{url:'https://example.com/',title:'宿主已读的合成标题'}]});return {citation:body.querySelector('.render-citation').textContent,cards:body.querySelectorAll('.render-link-card').length,source:body.querySelector('.render-sources a').textContent};});
    assert.equal(result.citation,'1');assert.equal(result.cards,0);assert.equal(result.source,'合成站点');
  });
  await t.test('an incomplete streamed diagram recovers to graph view when the syntax becomes valid',async()=>{
    await page.evaluate(()=>{globalThis.streamDiagram=WeftContent.create('```mermaid\ngraph LR\n A -->');document.body.replaceChildren(streamDiagram);});
    await page.locator('.diagram-failed').waitFor();
    await page.evaluate(()=>WeftContent.update(streamDiagram,'```mermaid\ngraph LR\n A --> B\n```'));
    await page.locator('.render-diagram img').waitFor();assert.equal(await page.locator('.diagram-failed').count(),0);assert.equal(await page.locator('.render-code pre').isVisible(),false);
  });
  await t.test('captured source links preserve provenance priority and the host title card',async()=>{
    await page.evaluate(()=>{globalThis.capturedCalls=[];globalThis.externalCalls=[];globalThis.WeftOpenCapturedSource=async(url,trigger)=>{capturedCalls.push(url);trigger.textContent='正在读取出处…';return true;};globalThis.weftmateDesktop={openExternal:async url=>externalCalls.push(url)};document.body.replaceChildren(WeftContent.create('[出处](https://example.com/)','markdown-body',{pages:[{url:'https://example.com/',title:'宿主标题'}]}));});
    await page.locator('a').click();assert.equal(await page.evaluate(()=>capturedCalls.length),1);assert.equal(await page.evaluate(()=>externalCalls.length),0);assert.equal(await page.locator('a strong').textContent(),'宿主标题');
    await page.evaluate(()=>{delete globalThis.WeftOpenCapturedSource;delete globalThis.weftmateDesktop;});
  });
});
