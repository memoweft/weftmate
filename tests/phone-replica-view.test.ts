import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

class Node {
  children:any[]=[];
  tag:string; className:string; text:string;
  constructor(tag='',className='',text=''){this.tag=tag;this.className=className;this.text=text;}
  append(...nodes:any[]){this.children.push(...nodes);}
  replaceChildren(...nodes:any[]){this.children=nodes;}
  querySelector(){return this.children[0];}
  get textContent():string{return this.text+this.children.map(row=>row.textContent).join('');}
}
function fixture(snapshot:any,active=true){
  const target=new Node(),requests:any[]=[],state:any={owner:'synthetic',loggedIn:true,page:'memory',memory:{scope:'synthetic',flow:0}};
  const context:any={state,WeftPhone:{active,memoryReplica:snapshot},
    el:(...args:any[])=>new Node(...args),heading:(text:string)=>new Node('h1','',text),notice:(text:string)=>new Node('p','notice',text),
    action:(text:string,callback:any)=>Object.assign(new Node('button','',text),{callback}),
    group:(text:string)=>{const node=new Node('section','',text);node.append(new Node('div','group-body'));return node;},
    timeLabel:(value:string)=>value,WeftPopover:{pullRefresh(){}},$:()=>target,
    uiCore:{mobile:{startMemorySnapshot:(...args:any[])=>requests.push(args),savedMemoryMarker:()=>null}}};
  runInNewContext(readFileSync(new URL('../apps/mobile-ui/www/components/memory.js',import.meta.url),'utf8'),context);
  context.memoryPage(target);return{target,context,requests};
}
test('a phone without a computer replica shows the exact empty state and connection action',()=>{
  const f=fixture(null);
  assert.ok(f.target.textContent.includes('记忆在电脑上形成。连上电脑后，这里会显示 WeftMate 记得的事。'));
  assert.equal(f.target.children.filter(row=>row.tag==='button').length,1);
  assert.equal(f.requests.length,0);
});
test('a disconnected phone lists the replica and sync time with no editing controls or requests',()=>{
  const f=fixture({items:[{text:'合成红茶偏好'},{text:'合成项目'}],syncedAt:'2026-10-26T00:00:00Z'});
  for(const text of ['合成红茶偏好','合成项目','2026-10-26T00:00:00Z','电脑连上后可以修改和忘掉'])assert.ok(f.target.textContent.includes(text));
  assert.equal(f.target.children.filter(row=>row.tag==='button').length,0);
  assert.equal(f.requests.length,0);
});
test('a connected phone keeps the existing computer memory snapshot flow',()=>{
  const f=fixture(null,false);
  assert.equal(f.requests.length,1);
  assert.equal(f.requests[0][0],'memory');
});
