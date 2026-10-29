import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/personal-access-ui/conversation-scroll.js',import.meta.url),'utf8');
function fixture(smooth=false){
 const frames:Function[]=[],observers:Function[]=[],viewport=new Map(),events=new Map();
 const node=()=>({scrollTop:0,scrollHeight:1500,clientHeight:500,clientWidth:300,offsetWidth:308,getBoundingClientRect:()=>({right:308}),hidden:true,textContent:'',listeners:new Map(),setAttribute(){},addEventListener(name:string,fn:Function){this.listeners.set(name,fn);},removeEventListener(name:string,fn:Function){if(this.listeners.get(name)===fn)this.listeners.delete(name);}});
 const box=node(),content=node(),button=node();box.scrollTop=1000;
 let actualTop=box.scrollTop;Object.defineProperty(box,'scrollTop',{get:()=>actualTop,set:(value:number)=>{actualTop=Math.max(0,Math.min(value,box.scrollHeight-box.clientHeight))}});
 let time=0;
 const context:any={document:{hidden:false,documentElement:{}},performance:{now:()=>time},getComputedStyle:(target:any)=>({overflowY:target?.overflowY,getPropertyValue:()=>''}),matchMedia:()=>({matches:!smooth}),requestAnimationFrame:(fn:Function)=>{frames.push(fn);return fn},cancelAnimationFrame:(fn:Function)=>{const i=frames.indexOf(fn);if(i>=0)frames.splice(i,1)},addEventListener:(name:string,fn:Function)=>events.set(name,fn),visualViewport:{addEventListener:(name:string,fn:Function)=>viewport.set(name,fn)},ResizeObserver:class{constructor(fn:Function){observers.push(fn)}observe(){}disconnect(){}},MutationObserver:class{constructor(fn:Function){observers.push(fn)}observe(){}disconnect(){}}};
 vm.runInNewContext(source,context);const scroll=context.WeftConversationScroll(box,content,button);
 const flush=()=>{while(frames.length)frames.shift()!(0);};
 const fire=(name:string,event:any={})=>box.listeners.get(name)?.(event);
 const tick=()=>{time+=16;const batch=frames.splice(0);batch.forEach(fn=>fn(time));return box.scrollTop;};
 return {box,content,button,scroll,flush,fire,observers,viewport,events,tick,node,createScroll:context.WeftConversationScroll};
}

test('empty and short conversations never offer a jump after wheel, touch or keyboard input',()=>{
 for(const height of [100,500])for(const input of ['wheel','touch','keyboard']) {
  const f=fixture();f.box.scrollHeight=height;f.box.scrollTop=0;f.scroll.changed();f.flush();
  if(input==='wheel')f.fire('wheel',{deltaY:-120});
  if(input==='touch'){f.fire('touchstart',{touches:[{clientY:100}]});f.fire('touchmove',{touches:[{clientY:180}]});}
  if(input==='keyboard')f.fire('keydown',{key:'PageUp',target:{closest:()=>null}});
  assert.equal(f.button.hidden,true,`${height}, ${input}`);
 }
});
test('streaming follows the current bottom in one frame without smooth chasing',()=>{
 const f=fixture(true);f.scroll.latest();
 for(let i=0;i<10;i++){f.box.scrollHeight+=20;f.scroll.changed();f.tick();assert.equal(f.box.scrollTop,f.box.scrollHeight-f.box.clientHeight);}
});
test('a stream paint follows before that frame ends, and upward reading stays held',()=>{
 const f=fixture(true);f.box.scrollHeight+=35;
 f.content.listeners.get('weft-stream-frame')();
 assert.equal(f.box.scrollTop,1035);
 f.fire('wheel',{deltaY:-100});f.box.scrollTop=600;f.box.scrollHeight+=35;
 f.content.listeners.get('weft-stream-frame')();
 assert.equal(f.box.scrollTop,600);assert.equal(f.scroll.pinned,false);
});

test('main and side stream frames keep independent follow intent and disposing the side releases its frame listener',()=>{
 const main=fixture(true),box=main.node(),content=main.node(),button=main.node();
 box.scrollTop=1000;
 let sidePaints=0;
 const side=main.createScroll(box,content,button,()=>sidePaints++);
 main.fire('wheel',{deltaY:-100});main.box.scrollTop=600;
 main.box.scrollHeight+=100;box.scrollHeight+=100;
 main.content.listeners.get('weft-stream-frame')();content.listeners.get('weft-stream-frame')();
 assert.equal(main.box.scrollTop,600);assert.equal(main.scroll.pinned,false);
 assert.equal(box.scrollTop,1100);assert.equal(side.pinned,true);
 side.hold();box.scrollTop=700;main.scroll.latest();
 main.box.scrollHeight+=100;box.scrollHeight+=100;
 main.content.listeners.get('weft-stream-frame')();content.listeners.get('weft-stream-frame')();
 assert.equal(main.box.scrollTop,1200);assert.equal(main.scroll.pinned,true);
 assert.equal(box.scrollTop,700);assert.equal(side.pinned,false);
 side.latest();side.changed();side.dispose();const paints=sidePaints,top=box.scrollTop;
 box.scrollHeight+=100;content.listeners.get('weft-stream-frame')?.();main.tick();
 assert.equal(box.scrollTop,top);assert.equal(sidePaints,paints);
 main.box.scrollHeight+=100;main.content.listeners.get('weft-stream-frame')();
 assert.equal(main.box.scrollTop,1300);assert.equal(main.scroll.pinned,true);
 main.scroll.dispose();
});
test('wheel and touch over the output itself scroll it without unpinning the conversation',()=>{
 for(const kind of ['wheel','touch']) {
  const f=fixture(),target={parentElement:f.box,scrollTop:300,scrollHeight:2000,clientHeight:220,overflowY:'auto'};
  if(kind==='wheel')f.fire('wheel',{target,deltaY:-100});
  else {f.fire('touchstart',{target,touches:[{clientY:100}]});f.fire('touchmove',{target,touches:[{clientY:140}]});}
  assert.equal(f.scroll.pinned,true,kind);
  target.scrollTop=0;
  if(kind==='wheel')f.fire('wheel',{target,deltaY:-100});else f.fire('touchmove',{target,touches:[{clientY:180}]});
  assert.equal(f.scroll.pinned,false,kind+' at output top');
 }
});

test('opening and closing details preserves bottom following or an explicitly unpinned reader',()=>{
 for(const input of ['pointerdown','keydown'])for(const unpinned of [false,true]){
  const f=fixture(true);f.scroll.latest();
  if(unpinned){f.fire('wheel',{deltaY:-120});f.box.scrollTop=600;f.fire('scroll');}
  const target={closest:()=>({tagName:'SUMMARY'})};
  for(const delta of [180,-120]){
   f.content.listeners.get(input)?.({target,key:'Enter'});
   f.box.scrollHeight+=delta;f.content.listeners.get('toggle')?.();f.observers.forEach(fn=>fn());f.tick();
   assert.equal(f.scroll.pinned,!unpinned,`${input}, unpinned=${unpinned}`);
   assert.equal(f.box.scrollTop,unpinned?600:f.box.scrollHeight-f.box.clientHeight);
  }
 }
});

test('smooth follow never replays its old origin after a layout clamp reaches the new bottom',()=>{
 const f=fixture(true);f.scroll.latest();f.box.scrollHeight+=160;f.scroll.changed();for(let i=0;i<8;i++)f.tick();
 // Composer shrinks/keyboard closes during the animation; Chromium clamps.
 f.box.clientHeight+=80;f.box.scrollTop=f.box.scrollHeight-f.box.clientHeight;f.fire('scroll');f.scroll.changed();
 const positions=Array.from({length:30},()=>{f.scroll.changed();return f.tick()});
 assert.ok(positions.every(top=>Math.abs(top-1080)<=1),JSON.stringify(positions));
});
test('continuous growth advances each frame rather than restarting follow at zero progress',()=>{
 const f=fixture(true);f.scroll.latest();const positions=[];
 for(let i=0;i<20;i++){f.box.scrollHeight+=20;f.scroll.changed();positions.push(f.tick());}
 assert.ok(positions.at(-1)!>positions[0]+200,JSON.stringify(positions));
 for(let i=0;i<30;i++)f.tick();assert.equal(f.box.scrollTop,f.box.scrollHeight-f.box.clientHeight);
});
test('an upward gesture near bottom cancels animation immediately, even within the bottom tolerance',()=>{
 for(const input of ['wheel','touch','scrollbar']){
 const f=fixture(true);f.scroll.latest();f.box.scrollHeight+=20;f.scroll.changed();f.tick();
 if(input==='wheel')f.fire('wheel',{deltaY:-10});
 if(input==='touch'){f.fire('touchstart',{touches:[{clientY:100}]});f.fire('touchmove',{touches:[{clientY:110}]});}
 if(input==='scrollbar')f.fire('pointerdown',{pointerType:'mouse',clientX:305});
 f.box.scrollTop-=10;const top=f.box.scrollTop;f.fire('scroll');f.scroll.changed();
 assert.equal(f.scroll.pinned,false);assert.ok(Array.from({length:20},()=>f.tick()).every(value=>value===top));
 }
});
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
  f.box.scrollHeight+=200;f.scroll.changed();f.flush();assert.equal(f.box.scrollTop,600);assert.equal(f.button.hidden,false);assert.equal(f.button.textContent,'');
  f.scroll.latest();assert.equal(f.scroll.pinned,true);assert.equal(f.box.scrollTop,1200);assert.equal(f.button.hidden,true);
 }
});
