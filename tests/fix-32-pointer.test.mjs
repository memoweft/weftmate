import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
for(const mode of ['mouse','touch']) test(`FIX-32 first phone ${mode} press survives a composer refresh between down and up`, async()=>{
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
 const box=await page.locator('#send-message').boundingBox(),point={x:box.x+box.width/2,y:box.y+box.height/2};
 const cdp=await page.context().newCDPSession(page);
 if(mode==='touch')await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});else {await page.mouse.move(point.x,point.y);await page.mouse.down()}
 const before=await page.locator("#send-message").boundingBox();
 await page.evaluate(()=>{document.getElementById("message-text").value="";document.getElementById("message-text").blur();ui.updateAvailability()});await page.waitForTimeout(75);
 assert.deepEqual(await page.locator("#send-message").boundingBox(),before);if(mode==='touch')await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.mouse.up();
 const result=await page.evaluate(()=>({submits,trace}));
 assert.equal(result.submits,1,JSON.stringify(result));
 }finally{await browser.close()}
});

test('FIX-32 first typing changes the microphone button into a working send action',async()=>{
 const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><form id="message-form"><textarea id="message-text"></textarea><button id="send-message"></button><button type="button" id="voice-input"></button></form><div id="chat-scroll"><div id="transcript"></div></div><button id="jump-latest"></button><section id="approval-bar"></section><section id="question-bar"></section>');
 await page.evaluate(()=>{globalThis.submits=0;document.getElementById('message-form').addEventListener('submit',e=>{e.preventDefault();submits++});
 globalThis.SpeechRecognition=function(){};globalThis.WeftIcons={create:()=>document.createElement('span')};globalThis.WeftPopover={autosize(){}};
 globalThis.core={state:{mainChat:null},activity:{},currentAttachmentDrafts:()=>[],composerState:()=>({running:false,sendDisabled:!document.getElementById('message-text').value,voiceDisabled:false})};
 globalThis.ui={byId:id=>document.getElementById(id),element:(tag,cls)=>{const n=document.createElement(tag);n.className=cls;return n},updateAvailability(){const b=document.getElementById('send-message');b.dataset.action='send';b.disabled=false;b.replaceChildren(WeftIcons.create())},startVoiceInput(){},clearMessageDraft(){}};
 // Production mountComposer binds this reference before PhoneUnify wraps it.
 document.getElementById('message-text').addEventListener('input',ui.updateAvailability);
 });
 await page.addScriptTag({content:readFileSync('src/ui-core/composer-press.js','utf8')});await page.addScriptTag({content:readFileSync('src/personal-access-ui/phone-unify.js','utf8')});await page.evaluate(()=>WeftPhoneUnify.mount(core,ui));
 await page.locator('#message-text').focus();await page.waitForTimeout(50);assert.equal(await page.locator('#send-message').getAttribute('data-action'),'voice');
 await page.locator('#message-text').fill('第一次打字后马上发送');
 assert.equal(await page.locator('#send-message').getAttribute('data-action'),'send');
 assert.equal(await page.locator('#send-message').getAttribute('type'),'submit','visible send action must submit immediately, without waiting for a metadata refresh');
 await page.locator('#send-message').click();assert.equal(await page.evaluate(()=>submits),1);
 }finally{await browser.close()}
});
