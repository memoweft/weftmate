import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

class Node extends EventTarget {
  value='';type='button';dataset:any={};style:any={};hidden=false;disabled=false;parentElement:any;children:any[]=[];attrs=new Map();
  classList={add(){},toggle(){},contains(){return false;}};
  append(...nodes:any[]){this.children.push(...nodes);}prepend(...nodes:any[]){this.children.unshift(...nodes);}
  replaceChildren(...nodes:any[]){this.children=nodes;}setAttribute(k:string,v:string){this.attrs.set(k,v);}removeAttribute(k:string){this.attrs.delete(k);}
  querySelector(){return null;}querySelectorAll(){return [];}contains(node:any){return this===node||this.children.includes(node);}
  getBoundingClientRect(){return {top:0,bottom:500};}remove(){}after(){}
}
test('typing after computer selection turns the phone action into submit before the first click or animation frame',async()=>{
  const nodes=new Map<string,Node>();for(const id of ['message-form','message-text','send-message','voice-input','chat-scroll','transcript','jump-latest'])nodes.set(id,new Node());
  const form=nodes.get('message-form')!,field=nodes.get('message-text')!,send=nodes.get('send-message')!,area=new Node();form.parentElement=area;form.append(field,send);
  let submits=0,voices=0;form.addEventListener('submit',()=>submits++);
  const document:any={body:new Node(),activeElement:field,addEventListener(){},removeEventListener(){}};
  const ui:any={byId:(id:string)=>nodes.get(id),element:()=>new Node(),updateAvailability:()=>{send.disabled=!field.value;},clearMessageDraft:()=>{field.value='';},startVoiceInput:()=>voices++};
  // The incumbent composer stores this listener before phone presentation mounts.
  field.addEventListener('input',ui.updateAvailability);
  const frames:Function[]=[];
  const context:any=vm.createContext({Event,document,innerHeight:844,requestAnimationFrame:(fn:Function)=>frames.push(fn),MutationObserver:class{observe(){}},
    matchMedia:()=>({matches:true}),SpeechRecognition:class{},WeftIcons:{create:()=>new Node()},WeftPopover:{autosize(){}},globalThis:null});context.globalThis=context;
  vm.runInContext(await readFile('src/ui-core/composer-press.js','utf8'),context);
  vm.runInContext(await readFile('src/personal-access-ui/phone-unify.js','utf8'),context);
  context.WeftPhoneUnify.mount({state:{},activity:{},currentAttachmentDrafts:()=>[],composerState:(text:string)=>({running:false,sendDisabled:!text.trim(),voiceDisabled:false})},ui);
  assert.equal(send.type,'button');assert.equal(send.dataset.action,'voice');
  field.value='synthetic first message';field.dispatchEvent(new Event('input'));
  assert.equal(send.type,'submit');assert.equal(send.dataset.action,'send');
  const click=new Event('click',{cancelable:true});send.dispatchEvent(click);if(!click.defaultPrevented&&send.type==='submit')form.dispatchEvent(new Event('submit'));
  assert.equal(voices,0);assert.equal(submits,1);assert.equal(field.value,'synthetic first message');
  assert.equal(frames.length,0,'the first click does not wait for a blur animation frame');
});
