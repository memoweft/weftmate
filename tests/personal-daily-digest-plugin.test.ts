import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
test('real pre-step hook replaces daily context each turn, clears it and preserves local chat on optional IPC failure',async()=>{
  const child=fork(new URL('./fixtures/daily-digest-plugin-child.mjs',import.meta.url),[],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});let calls=0;
  try{
    const result:any=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Daily context hook timed out')),10000);child.on('error',reject);child.on('message',(message:any)=>{
      if(message.type==='ready')child.send({type:'run'});
      else if(message.type==='result'){clearTimeout(timer);resolve(message);}
      else if(message.type==='failed'){clearTimeout(timer);reject(Error(message.message));}
      else if(message.protocol==='weftmate.personal-conversation-context.v1'){calls++;assert.equal(message.sessionId,'session-owned');assert.equal(message.receiptId,`receipt-${calls}`);child.send({protocol:message.protocol,id:message.id,ok:calls!==4,...(calls!==4?{result:{state:'none',recentContextText:calls===1?'OLD_DIGEST':calls===2?'NEW_DIGEST':''}}:{})});}
    });});
    const texts=result.results.map((rows:any[])=>JSON.stringify(rows));assert.ok(texts[0].includes('OLD_DIGEST'));assert.ok(texts[1].includes('NEW_DIGEST'));assert.ok(!texts[1].includes('OLD_DIGEST'));assert.ok(!texts[2].includes('DIGEST'));assert.ok(!texts[3].includes('DIGEST'));assert.equal(calls,4);
    for(const [n,rows]of result.results.entries()){assert.ok(rows.some((row:any)=>row.id===`message-${n+1}`));if(n<2)assert.equal(rows[0].source.plugin,'weftmate-daily-digest');}
  }finally{child.kill();}
});
