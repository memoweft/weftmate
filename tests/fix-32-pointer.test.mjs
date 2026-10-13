import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
test('FIX-32 first phone press survives a composer refresh between down and up', async()=>{
 const browser=await chromium.launch({headless:true});
 try {
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><form id="message-form"><textarea id="message-text">合成首句</textarea><button id="send-message"><svg width="20" height="20"><path d="M0 0h20v20H0z"/></svg></button><button id="voice-input" type="button"></button></form><div id="chat-scroll"><div id="transcript"></div></div><button id="jump-latest"></button><section id="approval-bar"></section><section id="question-bar"></section>`);
 await page.evaluate(()=>{
  globalThis.trace=[];globalThis.submits=0;
  const form=document.getElementById('message-form');form.addEventListener('submit',e=>{e.preventDefault();submits++});
  for(const type of ['pointerdown','pointerup','click','submit'])document.addEventListener(type,e=>trace.push({type,target:e.target.tagName,id:e.target.id}),true);
  const byId=id=>document.getElementById(id);globalThis.WeftIcons={create:()=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width','20');svg.setAttribute('height','20');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d','M0 0h20v20H0z');svg.append(p);return svg}};
  globalThis.WeftPopover={autosize(){}};
  globalThis.core={state:{mainChat:null},activity:{},currentAttachmentDrafts:()=>[],composerState:()=>({running:false,sendDisabled:false})};
  globalThis.ui={byId,element:(tag,cls)=>{const n=document.createElement(tag);n.className=cls;return n},updateAvailability(){byId('send-message').replaceChildren(WeftIcons.create())},startVoiceInput(){},clearMessageDraft(){}};
 });
 await page.addScriptTag({content:readFileSync('src/ui-core/composer-press.js','utf8')});
 await page.addScriptTag({content:readFileSync('src/personal-access-ui/phone-unify.js','utf8')});
 await page.evaluate(()=>WeftPhoneUnify.mount(core,ui));
 await page.locator('#message-text').focus();await page.waitForTimeout(50);
 const box=await page.locator('#send-message').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 await page.evaluate(()=>ui.updateAvailability());await page.waitForTimeout(75);await page.mouse.up();
 const result=await page.evaluate(()=>({submits,trace}));
 assert.equal(result.submits,1,JSON.stringify(result));
 }finally{await browser.close()}
});
