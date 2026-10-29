import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('memory availability painting during login does not depend on a list transition',()=>{
  const transitions:any[]=[],sandbox:any={WeftUiComponents:{factories:{}},WeftMotion:{content:(...args)=>transitions.push(args)}};
  runInNewContext(readFileSync(new URL('../src/personal-access-ui/components/memory.js',import.meta.url),'utf8'),sandbox);
  const node:any={textContent:'',classList:{remove(){},toggle(){}},append(){}};
  const core:any={memory:{status:{state:'disabled'}}},ui:any={byId:()=>node,element:()=>({})};
  const view=sandbox.WeftUiComponents.factories.memory(core,ui);
  assert.doesNotThrow(()=>view.memoryStatus('读取记忆状态'));
  assert.match(node.textContent,/尚未启用记忆/);assert.equal(transitions.length,0,'status paint is independent of list navigation');
});
