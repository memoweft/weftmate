import assert from 'node:assert/strict';
import test from 'node:test';
import {appliedFileChanges} from '../src/runtime/dsh-adapter/file-changes.mjs';
import {createDshSessionAdapter} from '../src/runtime/dsh-adapter/sessions.mjs';

test('applied hunks exclude context and preserve separate replacements and unknown counts',()=>{
  const diffs=[{path:'report.md',oldText:'heading\nold\nkept\nold2\nend',newText:'heading\nnew\nkept\nnew2\nextra\nend'},
    {path:'report.md',oldText:null,newText:'extra2'}, {path:'large.txt',oldText:'a\n'.repeat(2000),newText:'b\n'.repeat(2000)}];
  assert.deepEqual(appliedFileChanges({meta:{diffs}}),[{path:'report.md',added:4,removed:2},{path:'large.txt',added:null,removed:null}]);
  assert.deepEqual(appliedFileChanges({isError:true,meta:{diffs}}),[]);
  assert.deepEqual(appliedFileChanges({meta:{diffs:[{path:'x',oldText:1,newText:'x'}]}}),[]);
  assert.deepEqual(appliedFileChanges({meta:{diffs:[{path:'blank',oldText:null,newText:''}]}}),[{path:'blank',added:1,removed:0}]);
  assert.deepEqual(appliedFileChanges({meta:{diffs:[{path:'tail',oldText:'kept',newText:'kept\n'}]}}),[{path:'tail',added:1,removed:0}]);
  assert.deepEqual(appliedFileChanges({meta:{diffs:[{path:'ambiguous',oldText:'removed',newText:''}]}}),[{path:'ambiguous',added:null,removed:null}]);
});
test('DSH history projects real applied metadata, not the requested replacement',async()=>{
  const entries=[{seq:0,time:1,type:'turn/start',data:{turn:1}},
    {seq:1,time:2,type:'tool/call',data:{turn:1,callId:'edit-1',name:'edit',arguments:JSON.stringify({file_path:'report.md',old_string:'old',new_string:'new'})}},
    {seq:2,time:3,type:'tool/result',data:{turn:1,meta:{diffs:[{path:'report.md',oldText:'old\nkeep\nold',newText:'new\nkeep\nnew'}]},message:{source:{kind:'tool',callId:'edit-1'},content:[{type:'tool-result',toolCallId:'edit-1',content:[{type:'text',text:'Updated.'}]}]}}}];
  const api=createDshSessionAdapter({sessions:{list:async()=>({result:{ok:true,value:{items:[{sessionId:'synthetic',origin:'user'}]}}})},events:{}},{readLog:async()=>entries});
  const page=await api.historyPage('synthetic');
  assert.deepEqual(page.events.at(-1).data.fileChanges,[{path:'report.md',added:2,removed:2}]);
  entries[2].data.meta.diffs[0].oldText='old\n'.repeat(20000);
  entries[2].data.meta.diffs[0].newText='new\n'.repeat(20000);
  const detail=await api.historyDetail('synthetic',2);
  assert.equal(detail.fileDiffs[0].path,'report.md');
  assert.equal(detail.fileDiffs[0].truncated,true);
  assert.ok(detail.fileDiffs[0].oldText.startsWith('old'));
  assert.ok(detail.fileDiffs[0].newText.startsWith('new'));
  const output='output\n'.repeat(20000);
  entries[2].data.message.content[0].content[0].text=output;
  const first=await api.historyDetail('synthetic',2), second=await api.historyDetail('synthetic',2,{outputOffset:64000}),third=await api.historyDetail('synthetic',2,{outputOffset:128000});
  assert.equal(first.output+second.output+third.output,output);
  assert.equal(first.nextOutputOffset,64000);assert.equal(second.nextOutputOffset,128000);assert.equal(third.nextOutputOffset,null);
});
