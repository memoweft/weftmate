import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/personal-access-ui/popovers.js',import.meta.url),'utf8');
test('memory pull refresh requires a downward gesture from the top of the active page',()=>{
 const context:any={document:{documentElement:{dataset:{}},addEventListener(){}},window:{addEventListener(){}}};vm.runInNewContext(source,context);
 const listeners=new Map<string,Function>();const target={scrollTop:0,addEventListener:(name:string,fn:Function)=>listeners.set(name,fn)};let refreshed=0,enabled=true;
 context.WeftPopover.pullRefresh(target,()=>refreshed++,()=>enabled);
 const pull=(from:number,to:number)=>{listeners.get('touchstart')!({touches:[{clientY:from}]});listeners.get('touchend')!({changedTouches:[{clientY:to}]});};
 pull(100,130);assert.equal(refreshed,0);pull(100,170);assert.equal(refreshed,1);
 target.scrollTop=20;pull(100,200);assert.equal(refreshed,1);target.scrollTop=0;enabled=false;pull(100,200);assert.equal(refreshed,1);
 enabled=true;listeners.get('touchstart')!({touches:[{clientY:100}]});listeners.get('touchcancel')!({});listeners.get('touchend')!({changedTouches:[{clientY:200}]});assert.equal(refreshed,1);
});
