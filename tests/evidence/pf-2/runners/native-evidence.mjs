import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
const evidence = 'tests/evidence/pf-2';
for(const phase of ['pilot','acceptance','final','regression','before-fx10','before-fx10-delivery']) for(const model of ['mimo','lan']) {
  const directory=join(evidence,phase,model);
  if(!existsSync(join(directory,'run.json'))) continue;
  const {root}=JSON.parse(readFileSync(join(directory,'run.json')));
  const storage=join(root,'profile/dsh-home/sessions');
  if(!existsSync(storage)) continue;
  const sessions=[];
  for(const file of readdirSync(storage,{recursive:true}).filter(p=>p.endsWith('session.jsonl.zstd'))) {
    const bytes=readFileSync(join(storage,file));let offset=0,text='';
    // DSH appends independently compressed frames; Node decodes one at a time.
    while(offset<bytes.length){const decoded=zstdDecompressSync(bytes.subarray(offset),{info:true});offset+=decoded.engine.bytesWritten;text+=decoded.buffer.toString();}
    const events=text.trim().split('\n').map(JSON.parse), header=events[0];
    const resultByCall=new Map();
    for(const e of events.filter(e=>e.type==='tool/result')) for(const b of e.data?.message?.content??[]) {
      if(b.type==='tool-result'&&!resultByCall.has(b.toolCallId)) resultByCall.set(b.toolCallId,{event:e,block:b});
    }
    const tools=events.filter(e=>e.type==='tool/call').map(e=>{
      const returned=resultByCall.get(e.data.callId), content=returned?.block.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');
      let args;try{args=JSON.parse(e.data.arguments);}catch{}
      return {callId:e.data.callId,name:e.data.name,arguments:args,at:new Date(e.time).toISOString(),
        durationMs:returned?returned.event.time-e.time:null,outputChars:content?.length??null,
        outputBytes:content?Buffer.byteLength(content):null,error:returned?.block.isError,web:/web_fetch|browser/.test(e.data.name)};
    });
    sessions.push({sessionId:header.id,ordinaryModelRounds:events.filter(e=>e.type==='step/start').length,
      compactionRequests:events.filter(e=>e.type==='compaction/start').length,
      successfulCompactions:events.filter(e=>e.type==='compaction/end'&&!e.data.error).length,
      compactions:events.filter(e=>e.type==='compaction/start').map(e=>({seq:e.seq,at:new Date(e.time).toISOString(),
        durationMs:events.find(x=>x.type==='compaction/end'&&x.data.compactionId===e.data.compactionId)?.time-e.time})),tools,
      note:'First durable tool result per call. Compaction replacements are not additional webpage calls.'});
  }
  writeFileSync(join(directory,'native-evidence.json'),JSON.stringify(sessions,null,2));
}
