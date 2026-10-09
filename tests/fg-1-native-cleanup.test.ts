import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { eraseSessionMemoryArtifact } from '../src/runtime/dsh-adapter/memory-erasure.mjs';
function decodeFrames(bytes) {
  const parts=[];let offset=0;
  while(offset<bytes.length){const decoded=zstdDecompressSync(bytes.subarray(offset),{info:true});parts.push(decoded.buffer);offset+=decoded.engine.bytesWritten}
  return Buffer.concat(parts).toString();
}
test('native forgetting clears injected memory and projections, retaining original text by default',async()=>{
  const root=await mkdtemp(join(tmpdir(),'fg-native-')),file=join(root,'session.jsonl.zstd');
  const events=[{kind:'header',id:'session'}, {type:'message',source:{kind:'user'},content:[{text:'原话FGSecret'}]},
    {type:'assistant/message',data:{memoryUsed:[{id:'memory-1',kind:'cognition',summary:'FGAdoptedSummary'}]}},
    {type:'message',source:{kind:'plugin',plugin:'weftmate-personal-memory',sections:[{text:'FGSecret记忆'}]},content:[{text:'FGSecret记忆'}]},
    {type:'user/message',data:{source:{kind:'plugin',plugin:'weftmate-chat-handoff',sourceRefs:[{sessionId:'previous-private-source',seq:5}]},content:[{type:'text',text:'FGSecret交接'}]}}];
  const persistence={config:{root},inspect:async()=>({meta:{id:'session',agentPreset:'personal-remote'}}),
    locate:()=>({kind:'jsonl',path:file}),readRaw:async()=>({meta:{id:'session'},content:decodeFrames(await readFile(file))})};
  try{
    await writeFile(file,zstdCompressSync(Buffer.from(events.map(row=>JSON.stringify(row)).join('\n')+'\n')));
    await eraseSessionMemoryArtifact(persistence, 'session');
    assert.equal(JSON.parse(zstdDecompressSync(await readFile(file)).toString()).kind,'header');
    let text=decodeFrames(await readFile(file));assert.match(text,/原话FGSecret/);assert.doesNotMatch(text,/FGSecret记忆|FGAdoptedSummary|previous-private-source|FGSecret交接/);
    await eraseSessionMemoryArtifact(persistence, 'session',{deleteConversationSnippets:true,sourceTexts:['原话FGSecret']});
    text=decodeFrames(await readFile(file));assert.doesNotMatch(text,/FGSecret/);
  }finally{await rm(root,{recursive:true,force:true})}
});
