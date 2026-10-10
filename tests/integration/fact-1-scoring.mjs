/** Keep generated drafts out of the evidence used to judge those same drafts. */
export function factSourceEvidence(result) {
  const parse=value=>{try{return typeof value==='string'?JSON.parse(value):value;}catch{return null;}};
  const collect=value=>typeof value==='string'?[value]:Array.isArray(value)?value.flatMap(collect)
    :value?.type==='text'?[value.text||'']:value?.content?collect(value.content):[];
  const rows=[];
  for(const tool of new Map((result.toolDetails||[]).map(t=>[t.text,t])).values()) {
    const data=parse(tool.text);if(!data)continue;
    const args=parse(data.arguments)||{},serialized=JSON.stringify(args);
    const browser=['web_fetch','browser'].includes(tool.toolName);
    const capturedRead=['read','grep'].includes(tool.toolName)&&serialized.includes('.weftmate-web-sources')&&!/说明\.md/.test(serialized);
    const shellFetch=['pwsh','bash'].includes(tool.toolName)&&/Invoke-WebRequest|curl|https:\/\//i.test(serialized)&&!/Set-Content|WriteAllText|writeFile|说明\.md/i.test(serialized);
    if(!browser&&!capturedRead&&!shellFetch)continue;
    const output=collect(data.output).map(text=>{
      const value=tool.toolName==='browser'?parse(text):null;
      // A query argument is the model's own text, not a statement by the source.
      return value?.url&&typeof value.text==='string'?JSON.stringify({url:value.url,title:value.title,capturedAt:value.capturedAt,text:value.text}):text;
    }).join('\n');
    const location=browser?{url:args.url,snapshotId:args.snapshotId}
      :capturedRead?{path:args.path||args.paths||args.file_path}
        :{urls:serialized.match(/https:\/\/[^\s"'\\]+/g)||[]};
    rows.push({tool:tool.toolName,sourceLocation:location,output});
  }
  return rows;
}

export function nativeFactAudit(result) {
  const rows=new Map();
  for(const tool of result.toolDetails||[]) {
    if(tool.toolName!=='todo_write')continue;
    try {
      const data=JSON.parse(tool.text);if(data.output?.some(block=>block.isError===true))continue;
      const args=typeof data.arguments==='string'?JSON.parse(data.arguments):data.arguments;
      for(const row of args.todos||[])if(row.status==='completed'&&/断言/.test(row.content||'')&&/原文主体|草稿主体|适用范围/.test(row.content)&&/原文|出处/.test(row.content)) {
        if(!rows.has(row.content))rows.set(row.content,{seq:tool.seq,text:row.content});
      }
    }catch{/* Failed/unknown tool output is not a persisted audit. */}
  }
  const lastSaveSeq=Math.max(-1,...(result.turns||[]).flatMap(t=>t.timeline||[]).filter(e=>e.type==='artifact.created').map(e=>e.seq));
  return {rows:[...rows.values()],lastSaveSeq,beforeFinalSave:[...rows.values()].some(row=>row.seq<lastSaveSeq)};
}
