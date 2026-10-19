// Append synthetic history using the same pinned DSH persistence and Session contracts.
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
export async function appendHistory({repository,profile,sessionId,output}){
 const base=join(repository,'vendor/dsh-runtime/node_modules/@deepseek-ai');
 const {JsonlSessionPersistence}=await import(pathToFileURL(join(base,'dsh-session-persistence-jsonl/lib/index.js')));
 const {Session}=await import(pathToFileURL(join(base,'dsh-session/lib/index.js')));
 const directory=join(profile,'dsh-home/sessions');
 const file=(await readdir(directory,{recursive:true})).find(name=>name.includes(sessionId)&&name.endsWith('.zstd'));
 if(!file)throw Error('Dedicated seed session file unavailable');
 const native=Object.assign(Object.create(JsonlSessionPersistence.prototype),{root:directory,compression:'zstd',packChunks:false});
 const bytes=await readFile(join(directory,file));const prefix=await native.readZstdPrefix(bytes);
 if(prefix.meta.id!==sessionId)throw Error('Dedicated history session identity mismatch');
 await writeFile(join(output,'c4-seed-backup.zstd'),bytes,{flag:'wx'});
 const session=Session.create(prefix.meta.id,prefix.events,prefix.meta);
 for(let n=1;n<=500;n++){
  const turn=n+1;session.append('turn/start',{turn});
  session.append('user/message',{role:'user',id:randomUUID(),source:{kind:'user',rpcId:'b1-c4-fixture-'+n},content:[{type:'text',text:`B1-HISTORY-${String(n*2-1).padStart(4,'0')} 合成历史问题。`}]},{surfaceOp:'append'});
  session.append('assistant/message',{turn,step:1,message:{role:'assistant',id:randomUUID(),source:{kind:'model',provider:'synthetic-fixture',model:'history'},content:[{type:'text',text:`B1-HISTORY-${String(n*2).padStart(4,'0')} 合成历史回答。`}]}},{surfaceOp:'append'});
  session.append('turn/end',{turn,reason:{kind:'completed'}});
 }
 await native.appendLines(prefix.meta,session.events.slice(prefix.events.length));
 const after=await native.readZstdPrefix(await readFile(join(directory,file)));Session.create(after.meta.id,after.events,after.meta);
 return {sessionId,syntheticMessagesAdded:1000,totalEvents:after.events.length,originalPrefixPreserved:(await readFile(join(directory,file))).subarray(0,bytes.length).equals(bytes)};
}
