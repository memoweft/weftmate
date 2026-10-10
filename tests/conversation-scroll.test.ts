import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/personal-access-ui/conversation-scroll.js',import.meta.url),'utf8');
function fixture(){
 const frames:Function[]=[],observers:Function[]=[],viewport=new Map(),events=new Map();
 const node=()=>({scrollTop:0,scrollHeight:1500,clientHeight:500,clientWidth:300,offsetWidth:308,getBoundingClientRect:()=>({right:308}),hidden:true,textContent:'',listeners:new Map(),setAttribute(){},addEventListener(name:string,fn:Function){this.listeners.set(name,fn);}});
 const box=node(),content=node(),button=node();box.scrollTop=1000;
 const context:any={document:{hidden:false},matchMedia:()=>({matches:true}),requestAnimationFrame:(fn:Function)=>frames.push(fn),cancelAnimationFrame(){},addEventListener:(name:string,fn:Function)=>events.set(name,fn),visualViewport:{addEventListener:(name:string,fn:Function)=>viewport.set(name,fn)},ResizeObserver:class{constructor(fn:Function){observers.push(fn)}observe(){}},MutationObserver:class{constructor(fn:Function){observers.push(fn)}observe(){}}};
 vm.runInNewContext(source,context);const scroll=context.WeftConversationScroll(box,content,button);
 const flush=()=>{while(frames.length)frames.shift()!(0);};
 const fire=(name:string,event:any={})=>box.listeners.get(name)?.(event);
 return {box,content,button,scroll,flush,fire,observers,viewport,events};
}
test('conversation follows streaming growth, keyboard closure and approval layout clamping',()=>{
 const f=fixture();f.scroll.latest();
 // Keyboard closes: viewport grows, the browser clamps top before resize.
 f.box.clientHeight=800;f.box.scrollTop=700;f.fire('scroll');assert.equal(f.scroll.pinned,true);
 // Approval occupies composer space before the next resize delivery.
 f.box.clientHeight=400;f.fire('scroll');f.observers.forEach(fn=>fn());f.flush();assert.equal(f.box.scrollTop,1100);assert.equal(f.scroll.pinned,true);
 for(let i=0;i<5;i++){f.box.scrollHeight+=100;f.scroll.changed();f.flush();assert.equal(f.box.scrollTop,f.box.scrollHeight-f.box.clientHeight);}
 f.box.clientHeight=650;f.box.scrollTop=850;f.fire('scroll');f.viewport.get('resize')();f.flush();assert.equal(f.scroll.pinned,true);assert.equal(f.box.scrollTop,1350);assert.equal(f.button.hidden,true);
});
test('touch, wheel and keyboard upward input stop following until bottom or a fresh send',()=>{
 for(const input of ['touch','wheel','keyboard','scrollbar']){const f=fixture();f.scroll.latest();
  if(input==='touch'){f.fire('touchstart',{touches:[{clientY:100}]});f.fire('touchmove',{touches:[{clientY:180}]});}
  if(input==='wheel')f.fire('wheel',{deltaY:-120});
  if(input==='keyboard')f.fire('keydown',{key:'PageUp',target:{closest:()=>null}});
  if(input==='scrollbar')f.fire('pointerdown',{pointerType:'mouse',clientX:305});
  f.box.scrollTop=600;f.fire('scroll');assert.equal(f.scroll.pinned,false,input);
  f.box.scrollHeight+=200;f.scroll.changed();f.flush();assert.equal(f.box.scrollTop,600);assert.equal(f.button.hidden,false);assert.match(f.button.textContent,/有新内容/);
  f.scroll.latest();assert.equal(f.scroll.pinned,true);assert.equal(f.box.scrollTop,1200);assert.equal(f.button.hidden,true);
 }
});
