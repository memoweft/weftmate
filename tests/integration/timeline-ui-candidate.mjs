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
  const root = mkdtempSync(join(tmpdir(), 'weftmate-m0-3-')), events = []
  let sessionId, taskId, running = true, artifact, service, questionFrame, processing = {phase: 'loading', modelName: '合成模型'}
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
  const backend = {
    ...(options.schedules ? { schedules: async ({action,id}) => {
      if (['list','notifications'].includes(action)) return {items:scheduleRows.map(row=>({...row}))};
      const row=scheduleRows.find(row=>row.id===id);assert.ok(row);
      if(action==='delete')scheduleRows.splice(scheduleRows.indexOf(row),1);else row.state=action==='pause'?'paused':action==='resume'?'scheduled':'completed';
      return {ok:true};
    }} : {}),
    getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready', capabilities: { chat: { available: true, inferenceVerified: false } } }), listModels: async () => [{ id: 'local', name: '合成会话', model: options.usageSamples ? 'mimo-v2.6-flash' : 'synthetic', sourceKind: options.usageSamples ? 'cloud' : 'local', configured: true }], preflight: async () => ({ ok: true }),
    createSession: async input => { operations.push({ kind: 'create' }); sessionId = input.sessionId; return { sessionId } },
    sendMessage: async input => {
      operations.push({ kind: 'message', mode: input.mode, text: input.text })
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
    stopTask: async ({ receiptIds }) => { operations.push({ kind: 'cancel' }); if (options.interactive) { append('turn/end', { turn: 1, reason: { kind: 'aborted' } }); running = false; } return { status: 'stopped', receiptIds, jobs: [], executionCancelled: true }; },
    cancelSession: async () => { operations.push({ kind: 'cancel' }); if (options.interactive) { append('turn/end', { turn: 1, reason: { kind: 'aborted' } }); running = false } return { accepted: true } },
    describeSession: async id => id === sessionId ? { sessionId, running, processing, agentPreset: 'personal-remote', modelProfileId: 'local', title: '项目进度报告', ...(contextUsage ? {contextUsage} : {}) } : null,
    readEvents: async ({ sessionId: id, ...options }) => adapter.historyPage(id, options),
    readEventDetail: async ({ sessionId: id, seq }) => adapter.historyDetail(id, seq),
    getTaskReplyEvidence: async () => ({ status: running ? 'waiting' : 'completed', turn: 1,
      assistantChunks: 0, textChunks: 0, reasoningChunks: 0, assistantMessages: running ? 1 : 2, toolSaveObserved: !!artifact }),
    listUserQuestions: async () => ({ runtimeId, questions: questionFrame ? [questionFrame] : [] }),
    respondUserQuestion: async () => { questionFrame.nativeState = 'answered'; result('question-1', '{"answers":[{"id":"format","selected":["简要报告"]}]}'); return { accepted: true } },
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
  service = await createPersonalAccessService({ root, port: 0, backend, backupManager, uiHandler: servePersonalAccessUi })
  const { origin, hostId } = await service.start(), grant = await service.issueSetupGrant()
  const credentials = { username: 'TimelineFixture', password: `isolated-${randomUUID()}`, deviceName: '隔离测试浏览器' }
  const setup = await fetch(origin + '/personal/v1/auth/setup', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: grant.grant, ...credentials }) })
  assert.equal(setup.status, 201); const auth = await setup.json(), cookie = setup.headers.get('set-cookie').split(';')[0]
  const request = async (path, body, method = body ? 'POST' : 'GET') => { const response = await fetch(origin + '/personal/v1' + path, { method, headers: { origin, cookie, 'content-type': 'application/json', 'x-weftmate-csrf': auth.csrfToken }, ...(body ? { body: JSON.stringify(body) } : {}) }); const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data }
  const command = async body => { const value = await request('/commands', body); for (let i = 0; i < 100; i++) { const row = (await request(`/commands/${value.command.commandId}`)).command; if (row.state === 'accepted_by_dsh') return row; await new Promise(done => setTimeout(done, 20)) } throw Error('command not accepted') }
  const created = await command({ requestId: 'timeline-create', kind: 'session.create', modelProfileId: 'local', targetDeviceId: hostId })
  sessionId = created.sessionId
  const source = await command({ requestId: 'timeline-message', kind: 'session.message', sessionId, targetDeviceId: hostId, text: goal }); taskId = source.commandId
  if (!options.inlineProgress) await service.trackToolApproval({ action: 'register_approval', runtimeId, approvalId, sessionId, turn: 1, callId: 'write-1', rootCallId: 'write-1', receiptId, messageHash: hash(goal), toolName: 'pwsh', argumentsHash: hash('write report'), reason: approvalReason })
  if (!options.inlineProgress) artifact = await service.submitToolArtifact({ sessionId, turn: 1, callId: 'artifact-1', messageHash: hash(goal), fileName: '项目进度报告.md', content: '# 项目进度报告\n\n已读取 3 个文件。42 项测试通过。\n' })
  if (artifact) {call('write', 'artifact-1', {fileName:artifact.fileName});result('artifact-1',JSON.stringify(artifact))}
  const bridge = async (method, params) => {
    if (method === 'cloud.callback') return {};
    if (method === 'shared.send') {
      const row = await command({requestId:params.requestId,kind:'session.message',sessionId:params.sessionId,text:params.text,intent:params.intent,targetDeviceId:hostId});
      return {source:'host',sessionId:params.sessionId,requestId:params.requestId,state:'accepted',receiptId:row.receiptId};
    }
    if (method === 'shared.commands.byRequest') return request(`/commands/by-request/${encodeURIComponent(params.requestId)}`);
    if (['app.ready', 'app.activity', 'events.subscribe'].includes(method)) return {}
    if (method === 'app.bootstrap') return { loggedIn: true, username: credentials.username, owner: hash(`${origin}|${auth.account.ownerId}`), busy: false, model: { source: 'host', displayName: '合成会话' } }
    if (method === 'auth.me') return { device: auth.device, deviceId: auth.device.id, displayName: '隔离测试账号', connectionVerified: true }
    if (method === 'settings.appearance') return { value: options.appearanceTheme || 'light' }
    if (method === 'attachments.list') return {attachments:[]}
    if (method === 'clipboard.copy') return {}
    if (method === 'conversations.list') return { conversations: [] }
    if (method === 'models.list') return { models: [] }
    if (method === 'models.host') return { models: [{ profileId: 'local', displayName: '合成会话', configured: true }] }
    if (method === 'shared.sessions.list') return { source: 'host', hostAvailable: true, sessions: (await request('/sessions')).sessions.map(row=>({...row,source:'host'})) }
    if (method === 'shared.sessions.events') return { source: 'host', sessionId, hostAvailable: true, ...await request(`/sessions/${sessionId}/events?limit=100${params.afterSeq === undefined ? '' : `&afterSeq=${params.afterSeq}`}${params.beforeSeq === undefined ? '' : `&beforeSeq=${params.beforeSeq}`}`) }
    if (method === 'shared.sessions.eventDetail') return request(`/sessions/${sessionId}/events/${params.seq}/detail`)
    if (method === 'activity.list') return { hostAvailable: true, activities: [{ ...source, source: 'host', taskId }] }
    if (method === 'shared.tasks.detail') return request(`/tasks/${params.taskId}`)
    if (method === 'shared.artifacts.preview') return request(`/artifacts/${params.artifactId}/preview`)
    if (method === 'shared.artifacts.save') return { requestId: 'synthetic-save' }
    if (method === 'host.business') return request(params.path.replace('/personal/v1',''), params.body, params.method);
    if (method === 'shared.approvals.decide') return request(`/sessions/${sessionId}/approvals/${params.approvalId}`, {requestId:params.requestId,outcome:params.outcome,...(params.scope?{scope:params.scope}:{})});
    if (method === 'shared.outbox.list') return {commands:[],source:'host'};
    if (method === 'shared.approvals.list') return request(`/sessions/${sessionId}/approvals?limit=100`)
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
    progress: {
      context: value=>{contextUsage=value},
      call, result,
      text: text => append('assistant/message', {content:[{type:'text',text}]}),
      phase: value => {processing=value},
      finish: reason => {append('turn/end',{turn:1,reason:{kind:reason||'completed'}});running=false},
      approve: async (id, command) => {const approvalId=randomUUID(), tuple={runtimeId,approvalId,sessionId,turn:1,callId:id,rootCallId:id,receiptId,messageHash:hash(goal),toolName:'pwsh',argumentsHash:hash(command)};
        call('pwsh',id,{command});append('approval/asked',{id:approvalId,toolName:'pwsh',callId:id,reason:`运行命令：${command}`});
        await service.trackToolApproval({...tuple,action:'register_approval',reason:`运行命令：${command}`});return {approvalId,tuple}},
      resolve: async ({tuple},outcome) => {await service.trackToolApproval({...tuple,action:'resolve_approval',outcome});append('approval/decided',{id:tuple.approvalId,outcome})},
      artifact: async () => {const artifact=await service.submitToolArtifact({sessionId,turn:1,callId:'artifact-progress',messageHash:hash(goal),fileName:'合成验收报告.md',content:'# 合成验收报告\n\n这份文件仅用于界面验收。\n'});call('write','artifact-progress',{fileName:artifact.fileName});result('artifact-progress',JSON.stringify(artifact));return artifact},
    }, credentials, sessionId, operations, request, backupOperations, mobileUrl: `http://127.0.0.1:${server.address().port}/`,
    complete: async (handled = false) => { if (!handled) await request(`/sessions/${sessionId}/approvals/${approvalId}`, { requestId:'fixture-allow-once',outcome:'allowed-once' });await service.trackToolApproval({ action: 'resolve_approval', runtimeId, approvalId, sessionId, turn: 1, callId: 'write-1', rootCallId: 'write-1', receiptId, messageHash: hash(goal), toolName: 'pwsh', argumentsHash: hash('write report'), outcome:'allowed-once' });append('approval/decided',{id:approvalId,outcome:'allowed-once'});questionFrame.nativeState='answered';if (!handled) result('question-1','{"answers":[{"id":"format","selected":["简要报告"]}]}');result('write-1','Report saved.'); append('step/end',{turn:1,step:1});append('assistant/message',{content:[{type:'text',text:'报告已保存，测试全部通过。'}]});append('turn/end',{turn:1,reason:{kind:'completed'}});running=false },
    close: async () => { await service.close();await new Promise(done=>server.close(done)) } }
}
