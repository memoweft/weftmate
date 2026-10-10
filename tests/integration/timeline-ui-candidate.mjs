/** Isolated personal host + synthetic DSH log. No model or daily data is used. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPersonalAccessService } from '../../src/personal-access/index.mjs'
import { servePersonalAccessUi } from '../../src/personal-access-ui/index.mjs'
import { createDshSessionAdapter } from '../../src/runtime/dsh-adapter/sessions.mjs'
const hash = value => createHash('sha256').update(value).digest('hex')
const ok = value => ({ result: { ok: true, value } })
export async function startTimelineCandidate(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-m0-3-')); let events = [];
  const dailySessions = new Map(), questionFrames = []; let relayPending = false;
  let sessionId, taskId, running = true, artifact, service, questionFrame, setupComplete = false, processing = {phase: 'loading', modelName: '合成模型'}
  let contextUsage=options.composer?{usedTokens:713000,contextWindow:828000}:null;
  const receiptId = 'timeline-synthetic-receipt', runtimeId = randomUUID(), approvalId = randomUUID()
  const goal = '读取项目资料，运行测试，并保存一份进度报告。'
  const approvalReason = `${options.riskApproval ? '[weftmate:overwrite] ' : ''}覆盖项目中的 progress.md。原文件将被替换，可从 Git 恢复。`
  const operations = [], baseTime = options.baseTime || Date.parse('2026-10-07T08:00:00Z')
  const append = (type, data) => { const event = { seq: events.length, time: baseTime + events.length * 500, type, data }; events.push(event); return event }
  const call = (name, id, args) => append('tool/call', { turn: 1, callId: id, name, arguments: JSON.stringify(args) })
  const result = (id, text, isError = false) => append('tool/result', { turn: 1, message: { source: { kind: 'tool', callId: id }, content: [{ type: 'tool-result', toolCallId: id, isError, content: [{ type: 'text', text }] }] } })
  const adapter = createDshSessionAdapter({ sessions: { list: async () => ok({ items: [{ sessionId, origin: 'user' }] }) }, events: {} }, { readLog: async () => events })
  const scheduleRows = [{id:'ui4-schedule',text:'提交合成报告',state:'scheduled',timeZone:'Asia/Shanghai',nextRunAt:'2026-10-09T01:00:00Z'}];
  const goalRows = new Map();
  if(options.goals){scheduleRows[0]={...scheduleRows[0],createdAt:new Date().toISOString(),revision:1,kind:'reminder',repeat:{kind:'daily',time:'09:00:00'}};}
  const backend = {
    deleteSession: async ({sessionId:id}) => { dailySessions.delete(id); if(id===sessionId){events=[];running=false;} return {deleted:true}; },
    chatRelayState: async () => ({ pending: relayPending, safe: !running }),
    prepareChatHandoff: async ({sessionId}) => ({text:'Synthetic bounded handoff',sourceSessionId:sessionId,throughSeq:1,sourceRefs:[]}),
    installChatHandoff: async () => {relayPending=false;return {installed:true};},
    readAttachment: async () => ({bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk9sAAAAASUVORK5CYII=','base64'),contentType:'image/png'}),
    ...(options.sidebar ? { renameSession: async ({sessionId, title}) => { dailySessions.get(sessionId).title = title; return {title}; } } : {}),
    ...(options.schedules || options.goals ? { schedules: async ({action,id,...input}) => {
      if (['list','notifications'].includes(action)) return {items:scheduleRows.map(row=>({...row}))};
      if(action==='erase'){scheduleRows.length=0;return {ok:true};}
      if(action==='forget'){return {ok:true};}
      if(action==='create'){const content=JSON.parse(input.prompt);const row={id:randomUUID(),...content,state:'scheduled',timeZone:'Asia/Shanghai',repeat:content.repeat??null,revision:1,createdAt:new Date().toISOString(),nextRunAt:'2027-01-02T01:00:00Z'};scheduleRows.push(row);return {item:row};}
      const row=scheduleRows.find(row=>row.id===id);assert.ok(row);
      if(action==='edit'){Object.assign(row,JSON.parse(input.prompt),{revision:row.revision+1});return {item:row};}
      if(action==='delete')scheduleRows.splice(scheduleRows.indexOf(row),1);else row.state=action==='pause'?'paused':action==='resume'?'scheduled':'completed';
      return {ok:true};
    }} : {}),
    ...(options.goals?{goals:async({sessionId:id,action,objective,ref})=>{
      if(action==='list')return {goal:goalRows.get(id)??null};
      if(action==='erase'||action==='forget'||action==='archive'){goalRows.delete(id);return {archived:true};}
      if(action==='create'){const row={id:randomUUID(),revision:1,objective,phase:'active',roundsStarted:0,createdAt:Date.now(),updatedAt:Date.now()};goalRows.set(id,row);return {ref:{id:row.id,revision:row.revision}};}
      const row=goalRows.get(id);assert.equal(ref.id,row.id);row.phase='complete';row.revision++;return {ref:{id:row.id,revision:row.revision}};
    }}:{}),
    ...(options.goals?{getTaskReplyEvidence:async()=>({status:running?'streaming':'completed',turn:1,step:1,assistantChunks:1,textChunks:1,reasoningChunks:0,assistantMessages:1,toolSaveObserved:false,
      startedAt:new Date(baseTime).toISOString(),...(running?{}:{terminalAt:new Date().toISOString()})})}:{}),
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready', capabilities: { chat: { available: true, inferenceVerified: false } } }), listModels: async () => [{ id: 'local', name: '合成会话', model: options.usageSamples ? 'mimo-v2.6-flash' : 'synthetic', sourceKind: options.usageSamples ? 'cloud' : 'local', configured: true, ...(options.composerMenu?{deepThinking:{supported:true,effort:'high'}}:{}) }], preflight: async () => ({ ok: true }),
    createSession: async input => { operations.push({ kind: 'create' });
      if(options.daily){if(sessionId)dailySessions.get(sessionId).running=running;events=[];running=false;dailySessions.set(input.sessionId,{events,running:false,title:'新对话'});}
      sessionId = input.sessionId; return { sessionId } },
    sendMessage: async input => {
      operations.push({ kind: 'message', mode: input.mode, text: input.text })
      if(options.daily){
        const row=dailySessions.get(input.sessionId);assert.ok(row);sessionId=input.sessionId;events=row.events;
        const rpc='synthetic-'+randomUUID();row.title=input.text===goal?'项目进度报告':input.text;
        if(row.running&&input.mode==='queue')append('agent/inbox/spliced',{target:'next-turn',start:0,inserted:[{id:rpc,source:{kind:'user',rpcId:rpc},content:[{type:'text',text:input.text}]}]});
        else{if(input.text===goal)for(let n=0;n<(options.historyCount??0);n++)append('assistant/message',{content:[{type:'text',text:`历史记录 ${n+1}：已核对项目资料。`}]});append('turn/start',{turn:1});append('user/message',{source:{kind:'user',rpcId:rpc},content:[{type:'text',text:input.text}]});append('step/start',{turn:1,step:1});}
        row.running=running=true;return {accepted:true,receiptId:rpc};
      }
      if (events.length && options.interactive) {
        const rpc = `synthetic-${randomUUID()}`
        if(options.windowChrome && input.mode==='queue') append('agent/inbox/spliced', {target:'next-turn',start:events.filter(event=>event.type==='agent/inbox/spliced').length,
          inserted:[{id:rpc,source:{kind:'user',rpcId:rpc},content:[{type:'text',text:input.text}]}]})
        else append('user/message', { source: { kind: 'user', rpcId: rpc }, content: [{ type: 'text', text: input.text }] })
        return { accepted: true, receiptId: rpc }
      }
      for (let i = 0; i < (options.historyCount ?? 2100); i++) append('assistant/message', { content: [{ type: 'text', text: `历史记录 ${i + 1}：已核对项目资料。` }] })
      append('turn/start', { turn: 1 }); const user = append('user/message', { source: { kind: 'user', rpcId: receiptId }, content: [{ type: 'text', text: goal }] })
      if (options.inlineProgress) return { accepted: true, receiptId };
      append('step/start', { turn: 1, step: 1 })
      append('assistant/message', { content: [{ type: 'text', text: options.interactive ? '我会先读取资料并运行测试，再整理 **项目进度报告**。\n\n覆盖现有报告前，需要你批准。' : '我会先读取资料并运行测试。覆盖现有报告前，需要你批准。' }] })
      call('read', 'read-1', { paths: ['README.md', 'docs/PLAN.md', 'docs/STATE.md'] }); result('read-1', 'Read 3 files successfully.')
      call('pwsh', 'test-1', { command: 'npm test' }); result('test-1', 'Tests: 42 passed, 0 failed.')
      append('approval/asked', { id: approvalId, toolName: 'pwsh', callId: 'write-1', reason: approvalReason })
      const question = call('ask_user_question', 'question-1', { questions: [{ id: 'format', question: '报告要采用哪种格式？', options: [{ label: '简要报告' }, { label: '完整记录' }] }] })
      questionFrame = { sessionId, questionRpcId: randomUUID(), sourceReady: true, sourceReceiptId: receiptId, messageHash: hash(goal), turn: 1, sourceSeq: user.seq, observedSeq: question.seq,
        questions: [{ id: 'format', question: '报告要采用哪种格式？', options: [{ label: '简要报告' }, { label: '完整记录' }] }], nativeState: 'pending' }
      call('pwsh', 'write-1', { command: 'node scripts/report.mjs' })
      return { accepted: true, receiptId }
    },
    stopTask: async ({ sessionId:id, receiptIds, queuedOnly }) => { operations.push({ kind: 'cancel' });
      if(options.daily){const row=dailySessions.get(id);assert.ok(row);if(!queuedOnly&&row.running){for(const [type,data]of [['step/end',{turn:1,step:1}],['turn/end',{turn:1,reason:{kind:'aborted'}}]])row.events.push({seq:row.events.length,time:baseTime+row.events.length*500,type,data});row.running=false;if(id===sessionId)running=false;}
        return {outcomes:receiptIds.map(receiptId=>({receiptId,status:queuedOnly?'queue_removed':'cancel_requested',backgroundJobs:[]}))};}
      if (options.interactive) { append('turn/end', { turn: 1, reason: { kind: 'aborted' } }); running = false; } return { status: 'stopped', receiptIds, jobs: [], executionCancelled: true }; },
    cancelSession: async () => { operations.push({ kind: 'cancel' }); if (options.interactive) { append('turn/end', { turn: 1, reason: { kind: 'aborted' } }); running = false } return { accepted: true } },
    describeSession: async id => options.daily && dailySessions.has(id) ? {sessionId:id,running:id===sessionId?running:dailySessions.get(id).running,processing,agentPreset:'personal-remote',modelProfileId:'local',title:dailySessions.get(id).title} : id === sessionId ? { sessionId, running, processing, agentPreset: 'personal-remote', modelProfileId: 'local', title: '项目进度报告', ...(contextUsage ? {contextUsage} : {}) } : null,
    readEvents: async ({ sessionId: id, ...options }) => {if(dailySessions.has(id))return createDshSessionAdapter({sessions:{list:async()=>ok({items:[...dailySessions.keys()].map(sessionId=>({sessionId,origin:'user'}))})},events:{}},{readLog:async()=>dailySessions.get(id).events}).historyPage(id,options);return adapter.historyPage(id, options)},
    readEventDetail: async ({ sessionId: id, seq }) => dailySessions.has(id) ? createDshSessionAdapter({sessions:{list:async()=>ok({items:[{sessionId:id,origin:'user'}]})},events:{}},{readLog:async()=>dailySessions.get(id).events}).historyDetail(id,seq) : adapter.historyDetail(id, seq),
    getTaskReplyEvidence: async ({sessionId:id}) => ({ status: options.daily && dailySessions.get(id)?.events.at(-1)?.type==='turn/end'
      ? ({completed:'completed',error:'failed',aborted:'aborted'}[dailySessions.get(id).events.at(-1).data.reason.kind]||'completed') : running ? 'waiting' : 'completed', turn: 1,
      assistantChunks: 0, textChunks: 0, reasoningChunks: 0, assistantMessages: running ? 1 : 2, toolSaveObserved: !!artifact }),
    listUserQuestions: async () => ({ runtimeId, questions: setupComplete ? [...(questionFrame ? [questionFrame] : []), ...questionFrames.map(({callId, ...frame}) => frame)] : [] }),
    respondUserQuestion: async input => { const frame = questionFrames.find(frame => frame.questionRpcId === input.questionRpcId) || questionFrame; frame.nativeState = 'answered'; result(frame.callId || 'question-1', '{"answers":[{"id":"format","selected":["简要报告"]}]}'); return { accepted: true } },
  }
  const backupSettings = { enabled: true, directory: 'D:/Synthetic/UI-4-Backups', dailyDays: 7, weeklyCopies: 4 }, backupRows = [], backupOperations = [];
  const backupManager = options.backups ? {
    isPending: () => false,
    view: async () => ({settings:{...backupSettings},backups:backupRows.map(row=>({...row})),status:{state:'idle'}}),
    configure: async value => {Object.assign(backupSettings,value);backupOperations.push('settings');return {...backupSettings}},
    request: async () => {const row={id:'ui4-backup',createdAt:'2026-10-08T08:00:00Z',size:1048576,verification:'valid'};backupRows.push(row);backupOperations.push('create');return {backup:row}},
    importBackup: async () => {backupOperations.push('import');return {backup:{id:'ui4-import'}}},
    restore: async id => {backupOperations.push('restore:'+id);return {accepted:true}},
  } : null;
  service = await createPersonalAccessService({ root, port: 0, ...(options.clock?{clock:options.clock}:{}), backend, backupManager, memoryManager:options.memoryManager??null, uiHandler: servePersonalAccessUi })
  const started = await service.start(); let origin = started.origin;
  const { hostId } = started, grant = await service.issueSetupGrant()
  const credentials = { username: 'TimelineFixture', password: `isolated-${randomUUID()}`, deviceName: '隔离测试浏览器' }
  const setup = await fetch(origin + '/personal/v1/auth/setup', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: grant.grant, ...credentials }) })
  assert.equal(setup.status, 201); const auth = await setup.json(), cookie = setup.headers.get('set-cookie').split(';')[0]
  const request = async (path, body, method = body ? 'POST' : 'GET') => { const response = await fetch(origin + '/personal/v1' + path, { method, headers: { origin, cookie, 'content-type': 'application/json', 'x-weftmate-csrf': auth.csrfToken }, ...(body ? { body: JSON.stringify(body) } : {}) }); const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data }
  const command = async body => { const value = await request('/commands', body); for (let i = 0; i < 100; i++) { const row = (await request(`/commands/${value.command.commandId}`)).command; if (row.state === 'accepted_by_dsh') return row; await new Promise(done => setTimeout(done, 20)) } throw Error('command not accepted') }
  const created = await command({ requestId: 'timeline-create', kind: 'session.create', modelProfileId: 'local', targetDeviceId: hostId })
  sessionId = created.sessionId
  const source = await command({ requestId: 'timeline-message', kind: 'session.message', sessionId, targetDeviceId: hostId, text: goal }); taskId = source.commandId
  if (!options.inlineProgress) artifact = await service.submitToolArtifact({ sessionId, turn: 1, callId: 'artifact-1', messageHash: hash(goal), fileName: '项目进度报告.md', content: '# 项目进度报告\n\n已读取 3 个文件。42 项测试通过。\n' })
  // Artifact submission queues a real host write. Do not expose a pending
  // approval to the UI while that same task still has unconfirmed effects.
  if (artifact) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = (await request('/commands')).commands;
      if (rows.filter(row => row.kind === 'desktop.write_artifact').every(row => row.state === 'observed')) break;
      if (attempt === 99) throw Error('Synthetic artifact write was not observed');
      await new Promise(done => setTimeout(done, 20));
    }
  }
  if (artifact) {call('write', 'artifact-1', {fileName:artifact.fileName});result('artifact-1',JSON.stringify(artifact))}
  // Register the pending overwrite only after the demo artifact write finishes.
  // The production source guard correctly rejects approvals during unknown effects.
  if (!options.inlineProgress) await service.trackToolApproval({ action: 'register_approval', runtimeId, approvalId, sessionId, turn: 1, callId: 'write-1', rootCallId: 'write-1', receiptId, messageHash: hash(goal), toolName: 'pwsh', argumentsHash: hash('write report'), reason: approvalReason })
  setupComplete = true;
  const bridge = async (method, params) => {
    if (method === 'host.status') { const status=await request('/status'); return options.logicalMobile?status:{...status,personalCapabilities:{...status.personalCapabilities,chats:0}}; }
    if (options.logicalMobile && method === 'shared.send' && params.chatId) {
      const result = await request('/commands', {kind:'chat.message',targetDeviceId:hostId,...params}, 'POST');
      return {command:result.command};
    }
    if (method === 'cloud.callback') return {};
    if (method === 'shared.send') {
      const row = await command({requestId:params.requestId,kind:'session.message',sessionId:params.sessionId,text:params.text,intent:params.intent,targetDeviceId:hostId});
      return {source:'host',sessionId:params.sessionId,requestId:params.requestId,state:'accepted',receiptId:row.receiptId};
    }
    if (method === 'shared.commands.byRequest') return request(`/commands/by-request/${encodeURIComponent(params.requestId)}`);
    if (['app.ready', 'app.activity', 'events.subscribe'].includes(method)) return {}
    if (method === 'app.bootstrap') return { loggedIn: true, username: credentials.username, owner: hash(`${origin}|${auth.account.ownerId}`), busy: false, model: { source: 'host', displayName: '合成会话' } }
    if (method === 'auth.me') return { device: auth.device, deviceId: auth.device.id, displayName: '隔离测试账号', connectionVerified: true, owner: hash(`${origin}|${auth.account.ownerId}`) }
    if (method === 'settings.appearance') return { value: options.appearanceTheme || 'light' }
    if (method === 'notifications.state') return {systemAllowed:true};
    if (method === 'notifications.requestPermission') return {};
    if (method === 'attachments.list') return {attachments:[]}
    if (method === 'clipboard.copy') return {}
    if (method === 'conversations.list') return { conversations: [] }
    if (method === 'models.list') return { models: [] }
    if (method === 'models.host') return { models: [{ profileId: 'local', displayName: '合成会话', configured: true, ...(options.composerMenu?{deepThinking:{supported:true,effort:'high'}}:{}) }] }
    if (method === 'shared.sessions.list') return { source: 'host', hostAvailable: true, sessions: (await request('/sessions')).sessions.map(row=>({...row,source:'host'})) }
    if (options.sidebar && method === 'shared.projects.list') return request('/projects');
    if (options.sidebar && method === 'shared.sessions.lifecycle') return request(`/sessions/${params.sessionId}/${params.action}`, {});
    if (method === 'shared.sessions.events') return { source: 'host', sessionId, hostAvailable: true, ...await request(`/sessions/${sessionId}/events?limit=100${params.afterSeq === undefined ? '' : `&afterSeq=${params.afterSeq}`}${params.beforeSeq === undefined ? '' : `&beforeSeq=${params.beforeSeq}`}`) }
    if (method === 'shared.sessions.eventDetail') return request(`/sessions/${sessionId}/events/${params.seq}/detail`)
    if (method === 'activity.list') return { hostAvailable: true, activities: [{ ...source, source: 'host', taskId }] }
    if (method === 'shared.tasks.detail') return request(`/tasks/${params.taskId}`)
    if (method === 'shared.artifacts.preview') return request(`/artifacts/${params.artifactId}/preview`)
    if (method === 'shared.artifacts.save') return { requestId: 'synthetic-save' }
    if (options.consistency && method === 'host.business' && params.path === '/personal/v1/memory/status') return {ownerId:auth.account.ownerId,state:'ready',worldRevision:1,capabilities:{list:true,source:true}};
    if (options.consistency && method === 'host.business' && params.path.startsWith('/personal/v1/memory/items')) return {ownerId:auth.account.ownerId,worldRevision:1,searchScope:'account_snapshot',items:[],nextCursor:null,hasMore:false};
    if (method === 'host.business') return request(params.path.replace('/personal/v1',''), params.body, params.method);
    if (method === 'shared.approvals.decide') return request(`/sessions/${sessionId}/approvals/${params.approvalId}`, {requestId:params.requestId,outcome:params.outcome,...(params.scope?{scope:params.scope}:{})});
    if (method === 'shared.outbox.list') return {commands:[],source:'host'};
    if (method === 'shared.approvals.list') return request(`/sessions/${sessionId}/approvals?limit=100`)
    if (method === 'shared.questions.answer') return request(`/sessions/${sessionId}/questions/${params.questionRpcId}`, {requestId:params.requestId,answer:params.answer});
    if (method === 'shared.questions.list') return request(`/sessions/${sessionId}/questions?limit=100`)
    throw Error(`unsupported fixture method: ${method}`)
  }
  if (options.usageSamples) {
    for (let index = 0; index < 3; index++) { const scope = await service.beginUsage({ sessionId, profileId: 'local' }); await service.finishUsage({ ...scope, usage: { prompt_tokens: 10000 + index * 4000, completion_tokens: 1200, prompt_tokens_details: { cached_tokens: 4000 } } }); }
  }
  const mobileAssets = new Set(readdirSync(new URL('../../apps/mobile-ui/www/', import.meta.url), {recursive:true}).map(name=>String(name).replaceAll('\\','/')))
  const server = createServer(async (req, res) => { try {
    const path = new URL(req.url, 'http://127.0.0.1').pathname
    if (path === '/bridge') { let raw = ''; for await (const part of req) raw += part; const input = JSON.parse(raw); const result = await bridge(input.method, input.params || {}); res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify({result})) }
    const name = path === '/' ? 'index.html' : path.slice(1)
    if (!mobileAssets.has(name) || name.includes('..')) { res.writeHead(404); return res.end() }
    let content = readFileSync(new URL(`../../apps/mobile-ui/www/${name}`, import.meta.url))
    if (name === 'index.html') content = Buffer.from(content.toString().replace("connect-src 'none'", "connect-src 'self'").replace('<script defer src="app.js">', '<script defer src="bridge.js"></script><script defer src="app.js">'))
    res.writeHead(200, {'content-type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html'});res.end(content)
  } catch (error) { let code=error.message;try{code=JSON.parse(code).error?.code||code}catch{}res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{code}})) } })
  const bridgeCode = `window.weftNative={postMessage(raw){const m=JSON.parse(raw);fetch('/bridge',{method:'POST',body:JSON.stringify(m)}).then(r=>r.json()).then(v=>window.weftNative.onmessage({data:JSON.stringify({id:m.id,ok:!v.error,result:v.result,error:v.error})})).catch(()=>window.weftNative.onmessage({data:JSON.stringify({id:m.id,ok:false,error:{code:'NETWORK'}})}))},onmessage:null}`
  const handler = server.listeners('request')[0];server.removeAllListeners('request');server.on('request',(req,res)=>{if(req.url==='/bridge.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(bridgeCode)}else handler(req,res)})
  await new Promise(done => server.listen(0,'127.0.0.1',done))
  return { root, origin,
    recordActivity: input => service.recordActivity(auth.account.ownerId,input),
    relayNextMain: () => {relayPending=true;running=false;if(dailySessions.has(sessionId))dailySessions.get(sessionId).running=false;},
    seedMainHistory: (id, count = 10000, {offset=0,total=count,mixed=false} = {}) => {
      const row = dailySessions.get(id) || (id===sessionId?{events,running}:null); assert.ok(row);
      const start = Date.now() - 10 * 86400000;
      const raw=[]; const put=(n,type,data)=>raw.push({seq:raw.length,time:start+(offset+n)*10*86400000/total,type,data});
      for(let n=0;n<count;n++) {
        put(n,n%2?'assistant/message':'user/message',{...(n%2?{}:{source:{kind:'user',rpcId:`history-${offset+n}`}}),content:[{type:'text',text:n%73===0?`合成纸船 ${offset+n}：日期搜索锚点。\n\n\`\`\`js\n${'const synthetic = 123; '.repeat(30)}\n\`\`\``:`合成历史 ${offset+n}：准备周末安排。`},
          ...(n%2===0&&mixed&&n%100===0?[{type:'image',attachment:{attachmentId:`sha256:${'a'.repeat(64)}`,mediaType:'image/png',bytes:68,width:1,height:1,name:'合成像素.png'}}]:[])]});
        if(mixed&&n%100===1){const callId=`mixed-${n}`;put(n,'tool/call',{turn:1,callId,name:'read',arguments:JSON.stringify({paths:['synthetic.md']})});put(n,'tool/result',{turn:1,message:{source:{kind:'tool',callId},content:[{type:'tool-result',toolCallId:callId,content:[{type:'text',text:'Synthetic file read.'}]}]}});}
      }
      row.events=raw;
      row.running=false; if(id===sessionId){events=row.events;running=false;}
    },
    restartWithCloud: async cloudIdentity => {
      await service.close();
      service = await createPersonalAccessService({root,port:0,...(options.clock?{clock:options.clock}:{}),backend,backupManager,memoryManager:options.memoryManager??null,uiHandler:servePersonalAccessUi,cloudIdentity});
      const started = await service.start(); origin = started.origin; assert.equal(started.hostId,hostId);
      return origin;
    },
    progress: {
      ask: questions => { const id = 'question-' + randomUUID(), event = call('ask_user_question', id, {questions}); const user = events.findLast(event => event.type === 'user/message');
        const frame = {sessionId,questionRpcId:randomUUID(),callId:id,sourceReady:true,sourceReceiptId:user.data.source.rpcId,messageHash:hash(user.data.content.filter(part=>part.type==='text').map(part=>part.text).join('')),turn:1,sourceSeq:user.seq,observedSeq:event.seq,questions,nativeState:'pending'};
        questionFrames.push(frame);return frame; },
      notice: (source,text)=>append('user/message',{source,content:[{type:'text',text}]}),
      context: value=>{contextUsage=value},
      call, result,
      text: text => append('assistant/message', {content:[{type:'text',text}]}),
      phase: value => {processing=value},
      finish: reason => {append('turn/end',{turn:1,reason:{kind:reason||'completed'}});running=false;if(dailySessions.has(sessionId))dailySessions.get(sessionId).running=false;},
      approve: async (id, command) => {const user=events.findLast(event=>event.type==='user/message');const approvalId=randomUUID(), tuple={runtimeId,approvalId,sessionId,turn:1,callId:id,rootCallId:id,receiptId:user.data.source.rpcId,messageHash:hash(user.data.content.filter(part=>part.type==='text').map(part=>part.text).join('')),toolName:'pwsh',argumentsHash:hash(command)};
        call('pwsh',id,{command});append('approval/asked',{id:approvalId,toolName:'pwsh',callId:id,reason:`运行命令：${command}`});
        const registration=await service.trackToolApproval({...tuple,action:'register_approval',reason:`运行命令：${command}`});return {approvalId,tuple,registration}},
      resolve: async ({tuple},outcome) => {await service.trackToolApproval({...tuple,action:'resolve_approval',outcome});append('approval/decided',{id:tuple.approvalId,outcome})},
      artifact: async () => {const artifact=await service.submitToolArtifact({sessionId,turn:1,callId:'artifact-progress',messageHash:hash(goal),fileName:'合成验收报告.md',content:'# 合成验收报告\n\n这份文件仅用于界面验收。\n'});call('write','artifact-progress',{fileName:artifact.fileName});result('artifact-progress',JSON.stringify(artifact));return artifact},
    }, credentials, sessionId, operations, request, backupOperations, mobileUrl: `http://127.0.0.1:${server.address().port}/`,
    complete: async (handled = false) => { if (!handled) await request(`/sessions/${sessionId}/approvals/${approvalId}`, { requestId:'fixture-allow-once',outcome:'allowed-once' });await service.trackToolApproval({ action: 'resolve_approval', runtimeId, approvalId, sessionId, turn: 1, callId: 'write-1', rootCallId: 'write-1', receiptId, messageHash: hash(goal), toolName: 'pwsh', argumentsHash: hash('write report'), outcome:'allowed-once' });append('approval/decided',{id:approvalId,outcome:'allowed-once'});questionFrame.nativeState='answered';if (!handled) result('question-1','{"answers":[{"id":"format","selected":["简要报告"]}]}');result('write-1','Report saved.'); append('step/end',{turn:1,step:1});append('assistant/message',{content:[{type:'text',text:'报告已保存，测试全部通过。'}]});append('turn/end',{turn:1,reason:{kind:'completed'}});running=false },
    close: async () => { await service.close();await new Promise(done=>server.close(done)) } }
}
