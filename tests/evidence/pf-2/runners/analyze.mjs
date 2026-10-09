import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const output = 'tests/evidence/pf-2';
mkdirSync(output, { recursive: true });
export function analyze(directory) {
  const report = JSON.parse(readFileSync(join(directory, 'results.json')));
  const trace = readFileSync(join(directory, 'requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const requests = trace.filter(e => e.kind === 'model' && e.phase === 'start').map(start => {
    const events = trace.filter(e => e.id === start.id);
    const terminal = events.find(e => ['end', 'error', 'cancel'].includes(e.phase));
    const first = events.filter(e => ['first-reasoning', 'first-content', 'first-tool-call'].includes(e.phase)).sort((a,b) => a.elapsedMs-b.elapsedMs)[0];
    return { id: start.id, at: start.at, inputChars: start.requestChars, stream: start.stream,
      durationMs: terminal?.elapsedMs, firstTokenMs: first?.elapsedMs ?? null,
      firstContentMs: events.find(e=>e.phase==='first-content')?.elapsedMs ?? null,
      firstReasoningMs: events.find(e=>e.phase==='first-reasoning')?.elapsedMs ?? null,
      firstToolMs: events.find(e=>e.phase==='first-tool-call')?.elapsedMs ?? null,
      headersMs: events.find(e=>e.phase==='headers')?.elapsedMs, terminal: terminal?.phase ?? 'missing', usage:terminal?.usage };
  });
  const nativeDirectory = directory==='tests/evidence/fx-10/before/mimo' ? join(output,'before-fx10/mimo')
    : directory==='tests/evidence/fx-10/delivery-web/mimo' ? join(output,'before-fx10-delivery/mimo') : directory;
  const native = existsSync(join(nativeDirectory,'native-evidence.json')) ? JSON.parse(readFileSync(join(nativeDirectory,'native-evidence.json'))) : [];
  const progress = existsSync(join(directory,'live-progress.json')) ? JSON.parse(readFileSync(join(directory,'live-progress.json'))) : [];
  const scenarios = report.results.map(r => {
    const turn = r.turns[0], start = Date.parse(turn.startedAt), end = Date.parse(r.turns.at(-1).endedAt);
    const foreground = requests.filter(q=>q.stream && q.inputChars>1000 && Date.parse(q.at)>=start && Date.parse(q.at)<=end);
    foreground.forEach((q,i)=>q.sameSizeRetryAfterAbort = i>0 && foreground[i-1].terminal!=='end' && q.inputChars===foreground[i-1].inputChars);
    const toolEvents = (r.toolDetails ?? []).map(e=> {
      let detail; try {detail=JSON.parse(e.text);}catch{}
      let args;try{args=JSON.parse(detail?.arguments);}catch{}
      return {...e,args,content:detail?.output?.flatMap(b=>b.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n')};
    });
    const pending = new Map(), tools = [];
    for(const e of toolEvents) {
      const key=JSON.stringify([e.toolName,e.args]);
      if(e.type==='step.started') { const queue=pending.get(key)??[];queue.push(e);pending.set(key,queue); }
      if(e.type==='step.completed') {
        const begun=pending.get(key)?.shift();
        tools.push({name:e.toolName,arguments:e.args,at:begun?.at,durationMs:begun?Date.parse(e.at)-Date.parse(begun.at):null,
          outputChars:e.content?.length??null,outputBytes:e.content?Buffer.byteLength(e.content):null,
          web:/web_fetch|browser/.test(e.toolName),error:/^Error:/.test(e.content??'')});
      }
    }
    const sessionNative = native.find(n=>n.sessionId===turn.sessionId);
    const visible = progress.find(p=>p.sessionId===turn.sessionId&&Date.parse(p.at)>=start&&p.progress.some(t=>t.trim()));
    return { id:r.id,status:r.status,checks:r.checks,durationMs:r.durationMs,
      ordinaryModelRounds:sessionNative?.ordinaryModelRounds,compactionRequests:sessionNative?.compactionRequests,
      firstVisibleProgressMs:visible?Date.parse(visible.at)-start:null,
      firstNativeStepMs: turn.timeline.find(e=>e.type==='step.started')?Date.parse(turn.timeline.find(e=>e.type==='step.started').at)-start:null,
      requests:foreground,requestCount:foreground.length,inputCharsTotal:foreground.reduce((s,q)=>s+q.inputChars,0),
      maxInputChars:Math.max(0,...foreground.map(q=>q.inputChars)),modelMs:foreground.reduce((s,q)=>s+(q.durationMs??0),0),
      tools:sessionNative?.tools??tools,toolDetailsAvailable:toolEvents.length>0,
      note:toolEvents.length ? 'Tool times paired by name and exact arguments; overlapping calls must not be summed as wall time.' : 'Original evidence omitted tool details: webpage return sizes and individual times cannot be recovered from the timeline alone.' };
  });
  return {directory,scenarios,usage:{requests:requests.length,withUsage:requests.filter(r=>r.usage).length,
    missingUsage:requests.filter(r=>!r.usage).length,inputTokens:requests.reduce((s,r)=>s+(r.usage?.prompt_tokens??0),0),
    cachedTokens:requests.reduce((s,r)=>s+(r.usage?.prompt_tokens_details?.cached_tokens??0),0),outputTokens:requests.reduce((s,r)=>s+(r.usage?.completion_tokens??0),0)}};
}
const before = ['tests/evidence/qa-1/m1-mimo','tests/evidence/qa-2/m1-mimo','tests/evidence/fx-10/before/mimo','tests/evidence/fx-10/delivery-web/mimo'].filter(p=>existsSync(join(p,'results.json'))).map(analyze);
writeFileSync(join(output,'before-breakdown.json'),JSON.stringify(before,null,2));
const after = readdirSync(output).filter(p=>existsSync(join(output,p,'mimo','results.json')) || existsSync(join(output,p,'lan','results.json')))
  .flatMap(p=>['mimo','lan'].filter(m=>existsSync(join(output,p,m,'results.json'))).map(m=>analyze(join(output,p,m))));
writeFileSync(join(output,'after-breakdown.json'),JSON.stringify(after,null,2));
for(const item of [...before,...after]) for(const s of item.scenarios.filter(s=>s.id==='action-02-web-document')) {
  console.log(JSON.stringify({directory:item.directory,ms:s.durationMs,requests:s.requestCount,input:s.inputCharsTotal,max:s.maxInputChars,modelMs:s.modelMs,web:s.tools.filter(t=>t.web).map(t=>[t.durationMs,t.outputChars])}));
}
