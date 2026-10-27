import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function streaming() {
  let next=0;
  const frames=new Map<number,Function>();
  const root={toggleAttribute(){}};
  const context:any={document:{documentElement:root,body:root,hidden:false,addEventListener(){},querySelectorAll:()=>[]},
    localStorage:{getItem(){},setItem(){}},matchMedia:()=>({matches:false,addEventListener(){}}),
    getComputedStyle:()=>({getPropertyValue:(name:string)=>({'--dur-3':'320ms','--dur-4':'420ms','--dur-5':'640ms','--ease-out':'cubic-bezier(.16,1,.3,1)'})[name]||''}),
    requestAnimationFrame:(fn:Function)=>{frames.set(++next,fn);return next;},cancelAnimationFrame:(id:number)=>frames.delete(id),
    addEventListener(){},dispatchEvent(){},CustomEvent:class {}};
  runInNewContext(readFileSync('src/ui-core/reply-motion.js','utf8'),context);
  const body:any={isConnected:true,_renderText:'',textContent:''},seen:string[]=[];
  const render=(node:any,text:string)=>{node._renderText=text;node.textContent=text;seen.push(text);};
  return {body,seen,api:context.WeftReplyMotion,render,frames,tick(){const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn());}};
}

test('FE-CHAT a transport burst paints once on the next frame',()=>{
  const f=streaming(),text='合成🙂回复'.repeat(300);
  f.api.stream(f.body,text,{streaming:true},f.render);
  assert.equal(f.body.textContent,'');
  f.tick();
  assert.ok(Array.from(f.body.textContent).length>3,'catch up with transport bursts');
  assert.equal(f.body.textContent,text,'no artificial typewriter backlog');
  f.api.stream(f.body,text,{streaming:false},f.render);
  for(let frame=0;frame<30&&f.frames.size;frame++)f.tick();
  assert.equal(f.body.textContent,text,'no seconds-long queue after the model completes');
  assert.ok(f.seen.every((text,index)=>!index||text.startsWith(f.seen[index-1])),'existing text never disappears');
});

test('FE-CHAT a long streamed burst has the same one-frame delivery as a small chunk',()=>{
  const f=streaming(),text='长回复'.repeat(2000);
  f.api.stream(f.body,text,{streaming:true},f.render);
  assert.equal(f.body.textContent,'');
  f.tick();assert.equal(f.body.textContent,text);
  for(let frame=0;frame<30&&f.frames.size;frame++)f.tick();
  assert.equal(f.body.textContent,text);
});

test('FE-CHAT polling the same stream and terminal snapshot never replays an already visible prefix',()=>{
  const f=streaming();f.body._renderText=f.body.textContent='已经读到的前文。';
  const text=f.body.textContent+'后续内容🙂'.repeat(20);
  f.api.stream(f.body,text,{streaming:true},f.render);f.tick();
  const prefix=f.body.textContent;
  for(let i=0;i<10;i++)f.api.stream(f.body,text,{streaming:true},f.render);
  assert.equal(f.frames.size,1);f.tick();assert.ok(f.body.textContent.startsWith(prefix));
  f.api.stream(f.body,text,{streaming:false},f.render);
  for(let frame=0;frame<30&&f.frames.size;frame++)f.tick();
  assert.equal(f.body.textContent,text);
  const count=f.seen.length;f.api.stream(f.body,text,{streaming:false},f.render);
  assert.equal(f.frames.size,0);assert.equal(f.body.textContent,text);assert.ok(f.seen.length<=count+1);
});
