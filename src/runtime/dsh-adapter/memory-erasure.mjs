import { open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { zstdCompressSync } from 'node:zlib';
import { relative, resolve, isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
const erasedTitle='[已遗忘的对话]';

async function writeArtifact(persistence, artifact, content) {
  const location=persistence.locate(artifact.meta),inside=relative(resolve(persistence.config.root),resolve(location.path));
  if(!inside || inside.startsWith('..') || isAbsolute(inside))throw new Error('memory source outside session root');
  const tmp=`${location.path}.${randomUUID()}.tmp`;let file;
  try {
    file=await open(tmp,'wx',0o600);
    const first=content.indexOf('\n');
    const bytes=location.path.endsWith('.zstd')?Buffer.concat([zstdCompressSync(Buffer.from(content.slice(0,first+1))),
      ...(content.length>first+1?[zstdCompressSync(Buffer.from(content.slice(first+1)))]:[])]):content;
    await file.writeFile(bytes);await file.sync();await file.close();file=null;await rename(tmp,location.path);
  }finally{await file?.close();await rm(tmp,{force:true});}
}

export function repriceMemoryTokenClaims(rows, {decodeStorageRecord,foldSurface,deriveEventMessage,estimateMessage}) {
  const events=rows.filter(row=>row && row.type!=='session').flatMap(decodeStorageRecord);
  foldSurface(events);
  const records=new Map(rows.filter(row=>Number.isSafeInteger(row?.seq)).map(row=>[row.seq,row]));
  const nodes=[],prices=new Map();let claim,repaired=0;
  for(const event of events) {
    if(['compaction/summary','compaction/prune'].includes(event.type)){claim=event;continue;}
    const op=event.surfaceOp;
    if(op==='append') {const message=deriveEventMessage(event);nodes.push(event.seq);prices.set(event.seq,message?estimateMessage(message):0);}
    else if(op?.op==='replace') {
      const start=nodes.indexOf(op.start),end=nodes.indexOf(op.end);
      const prior=nodes.slice(start,end+1).reduce((sum,id)=>sum+(prices.get(id)||0),0);
      let price=prior;
      if(claim && claim.data.shadowedRange.start===op.start && claim.data.shadowedRange.end===op.end) {
        const row=records.get(claim.seq);
        if(row.data.shadowedTokenCount!==prior){row.data={...row.data,shadowedTokenCount:prior};repaired++;}
        const message=deriveEventMessage(event);price=message?estimateMessage(message):0;
      }
      nodes.splice(start,end-start+1,event.seq);prices.set(event.seq,price);
    }
    claim=undefined;
  }
  return repaired;
}

export async function repairMemoryErasureArtifact(persistence, sessionId, {reprice}={}) {
  const artifact=await persistence.readRaw(sessionId);if(!artifact)return {repaired:0};
  if(!artifact.content.includes('"weftmate-memory-erasure"'))return {repaired:0};
  let rows;try{rows=artifact.content.split('\n').map(line=>line?JSON.parse(line):null);}catch{return {repaired:0};}
  const bySeq=new Map(rows.filter(row=>Number.isSafeInteger(row?.seq)).map(row=>[row.seq,row]));
  const metadata=data=>data?.message?.content?.length===1 ? {...data,message:{...data.message,content:[{...data.message.content[0],content:null}]}} : null;
  let repaired=0;
  for(let i=0;i<rows.length;i++) {
    const row=rows[i],op=row?.surfaceOp;
    if(row?.type==='session/title' && row.data?.title==='') {rows[i]={...row,data:{...row.data,title:erasedTitle}};repaired++;continue;}
    if(row?.type!=='tool/result'||op?.op!=='replace'||op.start!==op.end||row.data?.source?.plugin!=='weftmate-memory-erasure'||
      !Array.isArray(row.data.content)||row.data.content.length)continue;
    const original=bySeq.get(op.start);if(original?.type!=='tool/result')continue;
    const data={...row.data};delete data.source;delete data.content;
    const before=metadata(original.data),after=metadata(data);
    if(!before||!after||!isDeepStrictEqual(before,after))continue;
    rows[i]={...row,data};bySeq.set(row.seq,rows[i]);repaired++;
  }
  const repriced=reprice?await reprice(rows):0;
  if(repaired||repriced)await writeArtifact(persistence,artifact,rows.map(row=>row?JSON.stringify(row):'').join('\n'));
  return {repaired,...(repriced?{repriced}:{})};
}

/** Use the native surface replacement protocol: retained originals remain in
 * human history, but cannot enter future requests or native compaction. */
export function shadowForgottenSurface(session, sourceTexts, createMessage, affectedIds = [], snippetTargets = []) {
  const events = session.events, bySeq = new Map(events.map(event => [event.seq, event]));
  const matches = value => typeof value === 'string' ? sourceTexts.some(text => text && value.includes(text))
    : Array.isArray(value) ? value.some(matches) : value && typeof value === 'object' && Object.values(value).some(matches);
  const affectedTurns = new Set(snippetTargets.map(target => target.turn).filter(Number.isSafeInteger)); const turns = new Map(); let turn = null;
  const forgotten = new Set(affectedIds);
  const usedForgottenMemory = data => (data?.memoryUsed ?? []).some(item => forgotten.has(item.id) || forgotten.has(`${item.kind}:${item.id}`));
  for (const event of events) {
    if (event.type === 'turn/start') turn = event.data.turn;
    turns.set(event.seq, turn);
    if (matches(event.data) || usedForgottenMemory(event.data) || snippetTargets.some(target => target.seq === event.seq)) affectedTurns.add(turn);
    if (event.type === 'turn/end') turn = null;
  }
  // Preserve complete tool exchanges by replacing contiguous affected surface
  // spans. The native surface order, not numeric seq ranges, is authoritative.
  const nodes = [...session.surface.nodes]; const groups = []; let group = [];
  for (const seq of nodes) {
    const event = bySeq.get(seq), plugin = event?.data?.source?.plugin;
    const affected = affectedTurns.has(turns.get(seq)) || matches(event?.data) ||
      plugin === 'weftmate-personal-memory' || plugin === 'weftmate-chat-handoff' ||
      event?.surfaceOp?.op === 'replace' && plugin !== 'weftmate-memory-erasure';
    if (affected) group.push(seq);
    else if (group.length) { groups.push(group); group = []; }
  }
  if (group.length) groups.push(group);
  for (const seqs of groups) {
    const start = seqs[0], end = seqs.at(-1);
    session.append('compaction/prune', { shadowedRange: { start, end }, shadowedSeqs: seqs, shadowedTokenCount: 0 });
    session.append('user/message', createMessage({ source: { kind: 'plugin', plugin: 'weftmate-memory-erasure' },
      content: [{ type: 'text', text: '[已遗忘的上下文]' }] }),
    { surfaceOp: { op: 'replace', start, end }, sourceEventSeqs: seqs });
  }
  return groups.flat();
}

/** Erase native injected context; original source text is an explicit opt-in. */
export async function eraseSessionMemoryArtifact(persistence, sessionId, options = {}) {
  const artifact = await persistence.readRaw(sessionId)
  if (!artifact) throw Object.assign(new Error('source unavailable'), { code: 'internal' })
  let changed = false
  const lines = artifact.content.split('\n').map(line => line ? JSON.parse(line) : null);
  // A prepared erasure is addressed only by durable event/turn locations.
  // Text matching is confined to preparation and the legacy direct-call API.
  const texts = options.snippetTargets ? [] : options.sourceTexts ?? [];
  const contentKeys = ['text','texts','content','delta','arguments','argumentsDelta','args','output','summary','rawOutput'];
  // Identifiers and structure are never user words, however short the forgotten text.
  const identifier = key => /^(id|seq|type|role|kind|name|provider|model|api|plugin|stopReason)$|Ids?$/.test(key);
  // Targets prepared before this rule may still point at identifiers; never apply those paths.
  const contentPath = path => !identifier(String([...path].reverse().find(key => !/^\d+$/.test(String(key))) ?? ''));
  const fields = (value, path = [], found = [], wholeTurn = false, field = '') => {
    if (typeof value === 'string' && value && !identifier(field) &&
        (wholeTurn && contentKeys.includes(field) || texts.some(text => text && value.includes(text)))) found.push(path);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) fields(child, [...path, key], found, wholeTurn, Array.isArray(value) ? field : key);
    return found;
  };
  const turns = new Map(), affected = new Set((options.snippetTargets ?? []).map(target => target.turn).filter(Number.isSafeInteger)); let turn = null;
  for (const row of lines) {
    if (!row) continue;
    if (row.type === 'turn/start') turn = row.data.turn;
    turns.set(row, turn);
    if (turn !== null && fields(row).length) affected.add(turn);
    if (row.type === 'turn/end') turn = null;
  }
  // Locations contain no source text. Event seq is stable across native log
  // rewrites; headers/older records without seq retain their row position.
  const snippetTargets = options.snippetTargets ?? lines.flatMap((row, rowIndex) => {
    const paths = fields(row, [], [], affected.has(turns.get(row))), seq = row?.seq ?? row?.seq0;
    return paths.length ? [{ rowIndex, ...(Number.isSafeInteger(seq) ? { seq } : {}),
      ...(Number.isSafeInteger(turns.get(row)) ? { turn: turns.get(row) } : {}), paths }] : [];
  });
  if (options.prepareOnly) return { snippetTargets };
  const selectedRow = (rows, target) => target.seq === undefined ? rows[target.rowIndex] : rows.find(row => (row?.seq ?? row?.seq0) === target.seq);
  if (options.deleteConversationSnippets && options.snippetTargets) for (const target of snippetTargets) {
    const row = selectedRow(lines, target);
    for (const path of target.paths.filter(contentPath)) {
      let parent = row;
      for (const key of path.slice(0, -1)) parent = parent?.[key];
      if (parent && Object.hasOwn(parent, path.at(-1))) { parent[path.at(-1)] = row?.type==='session/title' && path.join('.')==='data.title' ? erasedTitle : ''; changed = true; }
    }
  }
  const clean = (value, redact = false, key = '') => {
    if (typeof value === 'string') {
      if (!options.deleteConversationSnippets || identifier(key)) return value
      if (redact && contentKeys.includes(key)) { changed = true; return ''; }
      for (const text of texts) if (value.includes(text)) { value = value.replaceAll(text, '[已遗忘的原话]'); changed = true }
      return value
    }
    if (Array.isArray(value)) return value.map(child => clean(child, redact, key))
    if (!value || typeof value !== 'object') return value
    if(value.type==='session/title' && value.data?.title==='') {changed=true;return {...value,data:{...value.data,title:erasedTitle}};}
    if (value.type === 'goal/change' && options.goalIds?.includes(value.data?.goal?.id)) {
      changed = true;
      return { ...value, data: { ...value.data, goal: { ...value.data.goal, objective: '[已遗忘的目标说明]', ...(value.data.goal.blockedReason ? { blockedReason: { code: value.data.goal.blockedReason.code, message: '[已遗忘的目标说明]' } } : {}) } } };
    }
    if (value.type === 'schedule/change' && options.scheduleIds?.includes(value.data?.schedule?.id)) {
      changed = true;
      return { ...value, data: { ...value.data, schedule: { ...value.data.schedule, prompt: '[已遗忘的安排说明]' } } };
    }
    if (value.type === 'todo/write' && value.data?.todos?.length) {
      changed = true;
      return { ...value, data: { ...value.data, todos: [] } };
    }
    if (Array.isArray(value.memoryUsed) && value.memoryUsed.length) {
      value = { ...value, memoryUsed: [] }; changed = true
    }
    if (value.type === 'compaction/summary') {
      // An already emptied summary is not a change; rewriting it on every forget was.
      if (value.data?.summary?.length || value.data?.rawOutput?.length) changed = true;
      return { ...value, data: { ...value.data, summary: [], ...(value.data?.rawOutput ? { rawOutput: [] } : {}) } };
    }
    if (value.type === 'user/message' && value.surfaceOp?.op === 'replace' && value.data?.source?.plugin !== 'weftmate-memory-erasure') {
      changed = true;
      return { ...value, data: { ...value.data, content: [], source: { kind: 'plugin', plugin: 'weftmate-memory-erasure' } } };
    }
    if (value.source?.kind === 'plugin' && ['weftmate-personal-memory', 'weftmate-chat-handoff'].includes(value.source.plugin)) {
      changed = true
      return { ...value, content: [], source: { kind: 'plugin', plugin: 'weftmate-memory-erasure' } }
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clean(child, redact, key)]))
  }
  const cleaned=lines.map(row=>row?clean(row,affected.has(turns.get(row))):null);
  if(options.reprice && await options.reprice(cleaned))changed=true;
  const content = cleaned.map(row=>row?JSON.stringify(row):'').join('\n')
  if (changed) await writeArtifact(persistence,artifact,content);
  // Re-read the actual artifact, not the transformed in-memory snapshot. A
  // successful write/rename alone is not proof that the source was erased.
  if (options.deleteConversationSnippets) {
    const verified = await persistence.readRaw(sessionId);
    if (!verified) throw new Error('memory cleanup verification unavailable');
    const rows = verified.content.split('\n').map(line => line ? JSON.parse(line) : null);
    let verifiedTurn = null;
    const residual = rows.some(row => {
      if (row?.type === 'turn/start') verifiedTurn = row.data.turn;
      const found = fields(row, [], [], affected.has(verifiedTurn)).length > 0;
      if (row?.type === 'turn/end') verifiedTurn = null;
      return found;
    });
    if (residual || options.snippetTargets && snippetTargets.some(target =>
      target.paths.filter(contentPath).some(path => {
        let value = selectedRow(rows, target);
        for (const key of path) value = value?.[key];
        return value !== undefined && value !== '' && !(selectedRow(rows,target)?.type==='session/title' && path.join('.')==='data.title' && value===erasedTitle);
      }))) throw new Error('memory cleanup verification failed');
  }
  return { cleaned: true, changed, snippetsVerified: options.deleteConversationSnippets === true };
}
