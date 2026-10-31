// 保护：遗忘不得改坏工具结果替换记录；已有错误标记只能按已知结构修复，不恢复被删除的正文。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as native from '../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-session/lib/index.js';
import {TokenMeter} from '../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-token-meter/lib/index.js';
import {contextBreakdownProjectionDefinition as breakdown} from '../vendor/dsh-runtime/node_modules/@deepseek-ai/dsh-token-meter/lib/types/breakdown-projection.js';
import {eraseSessionMemoryArtifact,repairMemoryErasureArtifact,repriceMemoryTokenClaims} from '../src/runtime/dsh-adapter/memory-erasure.mjs';
const {Session,SESSION_FORMAT_VERSION}=native;
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'memory-format-')),file=join(root,'session.jsonl');
 const header={type:'session',version:SESSION_FORMAT_VERSION,id:'session-format',createdAt:Date.now(),cwd:root,agentPreset:'personal-remote'};
 const result=text=>({turn:1,message:{id:'message-result',role:'user',source:{kind:'tool',callId:'read-1'},content:[{type:'tool-result',toolCallId:'read-1',isError:false,content:[{type:'text',text}]}]}});
 const events=[{seq:0,time:Date.now(),type:'tool/result',data:result('first'),surfaceOp:'append'},
  {seq:1,time:Date.now(),type:'tool/result',data:result('updated'),surfaceOp:{op:'replace',start:0,end:0},sourceEventSeqs:[0]}];
 await writeFile(file,[header,...events].map(JSON.stringify).join('\n')+'\n');
 const persistence={config:{root},locate:()=>({path:file}),readRaw:async()=>({meta:header,content:await readFile(file,'utf8')})};
 const restore=async()=>{const rows=(await readFile(file,'utf8')).trim().split('\n').map(JSON.parse);const meta=rows.shift();delete meta.type;return Session.fromRestore(meta.id,rows,meta);};
 return {root,file,header,events,persistence,restore};
}
test('forgetting preserves the native tool-result replacement invariant',async()=>{
 const f=await fixture();try{await f.restore();await eraseSessionMemoryArtifact(f.persistence,f.header.id,{sourceTexts:['unrelated'],deleteConversationSnippets:false});
  await assert.doesNotReject(()=>f.restore());
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('erased history reprices stale compaction claims without producing negative native usage',async()=>{
 const f=await fixture();try{
  f.events.push({seq:2,time:Date.now(),type:'compaction/prune',data:{shadowedRange:{start:1,end:1},shadowedSeqs:[1],shadowedTokenCount:1000}},
    {seq:3,time:Date.now(),type:'user/message',data:{id:'erased-message',role:'user',source:{kind:'plugin',plugin:'weftmate-memory-erasure'},content:[{type:'text',text:'erased'}]},surfaceOp:{op:'replace',start:1,end:1},sourceEventSeqs:[1]});
  await writeFile(f.file,[f.header,...f.events].map(JSON.stringify).join('\n')+'\n');
  const reprice=rows=>repriceMemoryTokenClaims(rows,{...native,estimateMessage:message=>TokenMeter.prototype.estimateMessage(message)});
  assert.equal((await repairMemoryErasureArtifact(f.persistence,f.header.id,{reprice})).repriced,1);
  const events=(await readFile(f.file,'utf8')).trim().split('\n').map(JSON.parse).slice(1).flatMap(native.decodeStorageRecord);
  let state=breakdown.init();for(const event of events){state=breakdown.apply(state,event);assert.equal(breakdown.schema.safeParse(breakdown.view(state)).success,true);}
  assert.deepEqual(await repairMemoryErasureArtifact(f.persistence,f.header.id,{reprice}),{repaired:0});
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('known erasure corruption is repaired once without changing result content',async()=>{
 const f=await fixture();try{
  Object.assign(f.events[1].data,{source:{kind:'plugin',plugin:'weftmate-memory-erasure'},content:[]});
  await writeFile(f.file,[f.header,...f.events].map(JSON.stringify).join('\n')+'\n');
  assert.deepEqual(await repairMemoryErasureArtifact(f.persistence,f.header.id),{repaired:1});
  assert.equal((await f.restore()).events[1].data.message.content[0].content[0].text,'updated');
  assert.deepEqual(await repairMemoryErasureArtifact(f.persistence,f.header.id),{repaired:0});
 }finally{await rm(f.root,{recursive:true,force:true});}
});
