import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const out=resolve('tests/evidence/stream-1');mkdirSync(out,{recursive:true});
const key=process.env.STREAM1_MIMO_KEY;if(!key)throw Error('Missing in-memory MiMo key');
const messages=[{role:'user',content:'家里的照片、账单和证件如何分类，给我几个简洁建议。'},{role:'assistant',content:'照片按年月整理，账单按用途和年份保存，证件集中加密备份。'}];
const report=[];
for(const mode of ['before','compact-json','plain-stream']){
 const start=Date.now();const row={mode,started:start};report.push(row);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
 try{
  const compact=mode!=='before';
  const body={model:'mimo-v2.6-flash',thinking:{type:'disabled'},stream:mode==='plain-stream',max_tokens:compact?48:160,temperature:0.3,
   messages:[{role:'system',content:mode==='plain-stream'?'续写用户草稿，只输出一句的后半句，最多16字。不重复前缀，不解释。没把握输出空。':compact?'续写草稿，最多16字，不重复前缀。只输出JSON {"completion":"后半句"}。':
   '补全用户正在输入的话。只返回自然、确定的后半句，最多40字，只补到本句结束，不换行。不重复用户已经输入的前缀，不新增任务或凭空承诺。只输出JSON {"completion":"后半句"}，没把握输出空字符串。'},...messages,{role:'user',content:compact?'请把刚才的整理建议':'正在输入：请把刚才的整理建议。仅返回completion的JSON。'}]};
  row.inputCharacters=JSON.stringify(body.messages).length;
  const r=await fetch('https://api.xiaomimimo.com/v1/chat/completions',{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify(body),signal:controller.signal});row.status=r.status;row.headersMs=Date.now()-start;
  if(!body.stream){const v=await r.json();row.content=v.choices?.[0]?.message?.content;row.usage=v.usage;row.reasoningCharacters=v.choices?.[0]?.message?.reasoning_content?.length??0;}
  else{let pending='';row.chunks=[];row.content='';for await(const part of r.body){pending+=Buffer.from(part).toString();let at;while((at=pending.indexOf('\n'))>=0){const line=pending.slice(0,at);pending=pending.slice(at+1);if(!line.startsWith('data:'))continue;try{const v=JSON.parse(line.slice(5));const text=v.choices?.[0]?.delta?.content;if(text){row.chunks.push({ms:Date.now()-start,length:text.length});row.content+=text;}if(v.usage)row.usage=v.usage;}catch{}}}}
 }catch(e){row.error=e.name;}finally{clearTimeout(timer);row.durationMs=Date.now()-start;writeFileSync(join(out,'completion-probe.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(row));}
}
