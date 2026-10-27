import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

test('same-path reviews in different turns retain their source and ignore revoked reads',{timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'chrome'})});
 try {
  const page=await browser.newPage();await page.setContent('<main></main>');
  await page.evaluate(()=>{globalThis.WeftUiComponents={factories:{}};});
  await page.addScriptTag({content:readFileSync('src/personal-access-ui/components/resources.js','utf8')});
  const result=await page.evaluate(async()=>{
   const tabs=new Map(),reads=new Map();let generation=1;
   globalThis.WeftDesktop={openPreview(title,trigger,key){if(!tabs.has(key)){const content=document.createElement('section');document.body.append(content);tabs.set(key,{content});}return tabs.get(key);}};
   const core={conversationTaskContext:()=>({sessionId:'synthetic',generation}),conversationTaskCurrent:context=>context.generation===generation,
    readTimelineDetail:(_session,seq)=>new Promise(resolve=>reads.set(seq,resolve))};
   const ui={element:(tag,cls='',text='')=>{const el=document.createElement(tag);el.className=cls;el.textContent=text;return el;}};
   const actions=WeftUiComponents.factories.resources(core,ui),file=seq=>({path:'report.md',steps:[{sessionId:'synthetic',detailRef:{seq}}]});
   const old=actions.openFileChange(file(1)),fresh=actions.openFileChange(file(2));
   reads.get(2)({fileDiffs:[{path:'report.md',oldText:'old',newText:'latest-turn'}]});await fresh;
   reads.get(1)({fileDiffs:[{path:'report.md',oldText:'old',newText:'old-turn'}]});await old;
   const text=[...tabs.values()].map(tab=>tab.content.textContent);
   const revoked=actions.openFileChange(file(3));generation++;
   reads.get(3)({fileDiffs:[{path:'report.md',oldText:'old',newText:'revoked-result'}]});await revoked;
   return {tabs:tabs.size,text,revoked:document.body.textContent.includes('revoked-result')};
  });
  assert.equal(result.tabs,3);assert.match(result.text[0],/old-turn/);assert.match(result.text[1],/latest-turn/);assert.equal(result.revoked,false);
 }finally{await browser.close();}
});
