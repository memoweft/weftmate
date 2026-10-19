process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
import assert from 'node:assert/strict';
import test from 'node:test';
import { writeSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, realpath, rm, readdir, unlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { phoneRuntime } from '../services/cloud/test/relay-phone-runtime.mjs';
import { createPersonalAccessService } from './helpers/personal-access-test-service.mjs';
import { sessionWorkspace } from '../src/personal-access/session-workspace.mjs';
import { createRuntimePhaseDiagnostics } from './helpers/runtime-phase-diagnostics.mjs';

const text = (m: any) => typeof m.content === 'string' ? m.content : (m.content || []).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('');
async function links(directory: string) { for (const row of await readdir(directory, { withFileTypes: true })) { const path = join(directory, row.name);
  if ((await lstat(path)).isSymbolicLink()) await unlink(path); else if (row.isDirectory()) await links(path); } }
for (const { failedDiscovery, failRecovery } of [{ failedDiscovery: false, failRecovery: false }, { failedDiscovery: true, failRecovery: false }, { failedDiscovery: true, failRecovery: true }]) test(`W3 selection ${failRecovery ? 'bounds native recovery to once' : 'continues the original turn'} after ${failedDiscovery ? 'a failed discovery and a text-only plan' : 'a discovery tool'}`, { timeout: 90000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'work-continuation-')), logs: string[] = [], requests: any[] = [];
  let host: any, runtime: any;
  const respond = (body: any) => {
    if (!body.tools?.length) return { content: '合成回复' };
    const user = body.messages.findLastIndex((m: any) => m.role === 'user' && text(m) === 'W3_CONTINUE_ORIGINAL');
    if (user < 0) return { content: '合成回复' };
    requests.push(body);
    const calls = body.messages.slice(user + 1).flatMap((m: any) => m.tool_calls || []);
    const step = calls.length;
    const continuation = body.messages.slice(user + 1).find((m: any) => text(m).includes('文件夹选择已完成'));
    const recovery = body.messages.slice(user + 1).some((m: any) => text(m).includes('刚才的电脑操作未完成'));
    // A discovery call can trigger the card without doing the requested work.
    // Model the reported ambiguity: absent acknowledgement it stops with a plan.
    if (step >= 2 && !continuation) return { content: '切换到工作模式后，我会继续处理，请选择文件夹。' };
    if (step >= 2 && failedDiscovery && !recovery) return { content: '没有出现选择文件夹的界面，请重试切换。' };
    if (failRecovery && step >= 3) return { content: '电脑操作仍未完成。' };
    if (failRecovery && step === 2) return { content: '', tool_calls: [{ id: 'continue-2', type: 'function', function: { name: 'read', arguments: '{"file_path":"still-missing.txt"}' } }] };
    const discovery = failedDiscovery ? 'read' : 'glob';
    const name = step === 0 || step === 2 ? 'load_tools' : step === 1 ? discovery : 'write';
    if (step >= 4) return { content: '已实际完成原请求。' };
    const args = step === 0 ? { names: [discovery] } : step === 1 ? failedDiscovery ? { file_path: 'missing-discovery.txt' } : { pattern: '*' } : step === 2 ? { names: ['write'] } : { file_path: 'continued.txt', content: 'original-turn-completed' };
    return { content: '', tool_calls: [{ id: `continue-${step}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
  };
  const wait = async (read: () => Promise<any>, label: string) => {
    const end = Date.now() + 30000;
    while (Date.now() < end) { const value = await read(); if (value) return value; await new Promise(r => setTimeout(r, 80)); }
    throw Error('Timed out: ' + label);
  };
  try {
    runtime = await phoneRuntime(root, logs, { respond });
    host = await createPersonalAccessService({ root: join(root, 'account'), port: 0, backend: runtime.backend }); runtime.setHost(host); await runtime.start();
    const { origin, hostId } = await host.start(), grant = await host.issueSetupGrant();
    const setup = await fetch(origin + '/personal/v1/auth/setup', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: grant.grant, username: 'SyntheticContinuation', password: 'Synthetic continuation password', deviceName: 'synthetic-phone' }) });
    const auth: any = await setup.json(), cookie = setup.headers.get('set-cookie')!.split(';')[0]; assert.equal(setup.status, 201);
    const api = async (path: string, body?: any) => {
      const res = await fetch(origin + '/personal/v1' + path, { method: body ? 'POST' : 'GET', headers: { origin, cookie, 'x-weftmate-csrf': auth.csrfToken, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const value: any = await res.json(); assert.ok(res.ok, JSON.stringify({ path, status: res.status, error: value.error })); return value;
    };
    const folder = join(root, 'SelectedFolder'); await mkdir(folder);
    const project = (await api('/projects', { requestId: randomUUID(), name: '已选合成目录', rootPath: await realpath(folder), permission: 'write' })).project;
    const create = (await api('/commands', { requestId: randomUUID(), targetDeviceId: hostId, kind: 'session.create', modelProfileId: 'synthetic' })).command;
    const sessionId = await wait(async () => { const command = (await api('/commands/' + create.commandId)).command; return command.state === 'accepted_by_dsh' && command.sessionId; }, 'chat creation');
    await api('/commands', { requestId: randomUUID(), targetDeviceId: hostId, kind: 'session.message', sessionId, text: 'W3_CONTINUE_ORIGINAL', intent: 'queue' });
    const card = await wait(async () => (await api(`/sessions/${sessionId}/approvals`)).approvals.find((a: any) => a.status === 'pending' && a.intent === 'work-switch'), 'discovery tool switch card');
    await assert.rejects(readFile(join(folder, 'continued.txt')));
    assert.ok(requests[0].messages.some((m: any) => text(m).includes('文件整理、读写或命令任务，先直接 load_tools')), 'before switching, route file tasks to native file/command tools instead of application automation');
    await api(`/sessions/${sessionId}/approvals/${card.approvalId}`, { requestId: randomUUID(), outcome: 'allowed-once', workProjectId: project.projectId });
    await wait(async () => (await api(`/sessions/${sessionId}/events?limit=200`)).events.some((e: any) => e.type === 'turn.ended'), 'continued turn ends');
    const afterDiscovery = requests.find(body => body.messages.some((m: any) => m.tool_call_id === 'continue-1'));
    assert.ok(afterDiscovery, 'original discovery call must resume in the existing native turn');
    assert.ok(afterDiscovery.messages.some((m: any) => text(m).includes('文件夹选择已完成') && text(m).includes(project.name)), 'next model step must acknowledge the completed selection and continue the original goal');
    if (failRecovery) { await assert.rejects(readFile(join(folder, 'continued.txt'))); assert.equal(requests.length, 5, 'a second failure must end instead of looping'); }
    else assert.equal(await readFile(join(folder, 'continued.txt'), 'utf8'), 'original-turn-completed');
    assert.equal(requests.at(-1).messages.filter((m: any) => text(m).includes('刚才的电脑操作未完成')).length, failedDiscovery ? 1 : 0, 'one native recovery message, never repeated');
    const events = (await api(`/sessions/${sessionId}/events?limit=200`)).events;
    assert.equal(events.filter((e: any) => e.type === 'user.message' && e.data?.text === 'W3_CONTINUE_ORIGINAL').length, 1, 'do not resend the user request');
    assert.equal(events.filter((e: any) => e.type === 'turn.ended').length, 1, 'recovery stays inside the original turn');
    assert.equal((await api(`/sessions/${sessionId}/approvals`)).approvals.filter((a: any) => a.status === 'pending').length, 0);
  } finally { await runtime?.close(); await host?.close(); await links(root); await rm(root, { recursive: true, force: true }); }
});
test('MODE-1 pinned runtime preserves the entire logical main while switching, resumes original write with normal approval and never executes a declined call', { timeout: 90000 }, async () => {
  const diagnostic=createRuntimePhaseDiagnostics({publish:(record: unknown)=>writeSync(1,'MODE_RUNTIME '+JSON.stringify(record)+'\n')});
  let phase: string|null=null;
  const mark=(next: string)=>{if(phase)diagnostic.phase(phase,'complete');phase=next;diagnostic.phase(next,'start');};
  const failed=(error: unknown)=>{diagnostic.phase(phase,'failed',error);phase=null;};
  mark('fixture-setup');
  const root = await mkdtemp(join(tmpdir(), 'mode1-native-')), logs: string[] = [];
  let host: any, runtime: any;
  let mainDefaultFile='';
  const respond = (body: any) => {
    const index = body.messages.findLastIndex((m: any) => m.role === 'user' && text(m).startsWith('MODE1_'));
    const user = index < 0 ? '' : text(body.messages[index]);
    if (!body.tools?.length) return { content: '合成聊天回复' };
    const calls = body.messages.slice(index + 1).flatMap((m: any) => m.tool_calls || []), step = calls.length;
    if (user.includes('FETCH')) {
      if (step > 1) return {content: body.messages.some((m:any)=>m.role==='tool'&&text(m).includes('PUBLIC_QUERY_FACT'))?'MODE1_QUERY_OK':'MODE1_QUERY_ERROR'};
      return {content:'',tool_calls:[{id:`query-${step}`,type:'function',function:{name:step?'web_fetch':'load_tools',arguments:JSON.stringify(step?{url:'https://public.example/reference'}:{names:['web_fetch']})}}]};
    }
    if (!user.includes('WRITE')) return {content:'合成聊天回复'};
    if (step > 1) return { content: '合成回合结束' };
    const name = step ? 'write' : 'load_tools', args = step ? { file_path: user.includes('OVERWRITE') ? join(root,'SyntheticProject','main.txt') : user.includes('DECLINE') ? 'declined.txt' : user.includes('DIRECT')?'direct.txt':mainDefaultFile||'main.txt', content: 'native-work-proof' } : { names: ['write'] };
    return { content: '', tool_calls: [{ id: `mode1-${createHash('sha256').update(user).digest('hex').slice(0, 12)}-${step}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
  };
  const wait = async (read: () => Promise<any>, label: string) => { const end = Date.now() + 30000; while (Date.now() < end) { const value = await read(); if (value) return value; await new Promise(r => setTimeout(r, 80)); } throw Error('Timed out: ' + label); };
  try {
    mark('runtime-create');
    runtime = await phoneRuntime(root, logs, { respond, onProcessEvent:diagnostic.processEvent });
    let publicReads = 0;
    const browserReader = {status:()=>({available:true}),canonicalUrl:(url:string)=>new URL(url).href,cancelTask(){},close:async()=>{},
      read:async({url}:any)=>{publicReads++;return {url,requestedUrl:url,title:'合成公开资料',capturedText:'PUBLIC_QUERY_FACT',text:'PUBLIC_QUERY_FACT',outline:'',links:[],segmentCount:1,captureTruncated:false,truncated:false,httpStatus:200};}};
    mark('runtime-start');
    host = await createPersonalAccessService({ root: join(root, 'account'), port: 0, backend: runtime.backend, browserReader }); runtime.setHost(host); await runtime.start();
    mark('host-start');
    const { origin, hostId } = await host.start(), grant = await host.issueSetupGrant();
    mark('account-setup');
    const setup = await fetch(origin + '/personal/v1/auth/setup', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ grant: grant.grant, username: 'SyntheticNativeMode', password: 'Synthetic native mode password', deviceName: 'synthetic-phone' }) });
    const auth: any = await setup.json(), cookie = setup.headers.get('set-cookie')!.split(';')[0]; assert.equal(setup.status, 201);
    const api = async (path: string, body?: any, method = body ? 'POST' : 'GET') => { const res = await fetch(origin + '/personal/v1' + path, { method,
      headers: { origin, cookie, 'x-weftmate-csrf': auth.csrfToken, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const value: any = await res.json(); assert.ok(res.ok, JSON.stringify({ path, status: res.status, error: value.error })); return value; };
    mark('project-create');
    const folder = join(root, 'SyntheticProject'); await mkdir(folder);
    const project = (await api('/projects', { requestId: randomUUID(), name: '合成工作', rootPath: await realpath(folder), permission: 'write' })).project;
    const workCreate=(await api(`/projects/${project.projectId}/sessions`,{requestId:randomUUID(),modelProfileId:'synthetic'})).command;
    const workSession=await wait(async()=>{const command=(await api('/commands/'+workCreate.commandId)).command;if(command.state==='rejected')throw Error(command.errorCode);return command.state==='accepted_by_dsh'&&command;},'direct project creation');
    mark('direct-write');
    await api('/commands',{requestId:randomUUID(),kind:'session.message',targetDeviceId:hostId,sessionId:workSession.sessionId,text:'MODE1_WRITE_DIRECT',intent:'queue'});
    await wait(()=>readFile(join(folder,'direct.txt'),'utf8').catch(()=>null),'direct project write');
    assert.equal(await readFile(join(folder,'direct.txt'),'utf8'),'native-work-proof');
    mark('main-reply');
    const originalChat = (await api('/chats/main')).chat.chatId;
    await api('/commands', { requestId: randomUUID(), targetDeviceId: hostId, kind: 'chat.message', chatId: originalChat, modelProfileId: 'synthetic', text: 'MODE1_HELLO', intent: 'queue' });
    const main = await wait(async () => { const chat = (await api('/chats/main')).chat; return chat.activeSessionId && !chat.running && chat; }, 'first main reply');
    const sessionId = main.activeSessionId;
    mainDefaultFile=join(sessionWorkspace(join(root,'workspaces'),auth.account.ownerId,originalChat),'main.txt');
    mark('work-switch');
    await api(`/sessions/${sessionId}/approval-mode`, { mode: 'ask' }, 'PATCH');
    await api('/commands', { requestId: randomUUID(), targetDeviceId: hostId, kind: 'chat.message', chatId: originalChat, text: 'MODE1_WRITE_MAIN', intent: 'queue' });
    const card = await wait(async () => (await api(`/sessions/${sessionId}/approvals`)).approvals.find((r: any) => r.status === 'pending' && r.intent === 'work-switch'), 'main work card');
    await assert.rejects(readFile(join(folder, 'main.txt')));
    await api(`/sessions/${sessionId}/approvals/${card.approvalId}`, { requestId: randomUUID(), outcome: 'allowed-once', workProjectId: project.projectId });
    mark('normal-approval');
    const risk = await wait(async () => (await api(`/sessions/${sessionId}/approvals`)).approvals.find((r: any) => r.status === 'pending' && r.intent !== 'work-switch'), 'normal write approval');
    await assert.rejects(readFile(join(folder, 'main.txt')));
    await api(`/sessions/${sessionId}/approvals/${risk.approvalId}`, { requestId: randomUUID(), outcome: 'allowed-once' });
    await wait(() => readFile(join(folder, 'main.txt'), 'utf8').catch(() => null), 'file written');
    assert.equal(await readFile(join(folder, 'main.txt'), 'utf8'), 'native-work-proof');
    await assert.rejects(readFile(mainDefaultFile));
    mark('history-check');
    const moved = (await api('/chats/' + originalChat)).chat;
    assert.equal(moved.kind, 'main'); assert.equal(moved.mode, 'work'); assert.equal(moved.logicalHistory, true); assert.equal(moved.activeSessionId, sessionId);
    assert.equal((await api('/chats/main')).chat.chatId, originalChat);
    const history = await api(`/chats/${originalChat}/events?limit=200`);
    assert.ok(history.items.some((e: any) => e.type === 'user.message' && e.data.text === 'MODE1_HELLO'));
    assert.ok(history.items.some((e: any) => e.type === 'user.message' && e.data.text === 'MODE1_WRITE_MAIN'));
    await wait(async () => !(await api('/chats/main')).chat.running, 'work turn ends');
    mark('background-route');
    const reminder = (await api('/commands', { requestId: randomUUID(), targetDeviceId: hostId, kind: 'chat.message', chatId: originalChat, text: 'MODE1_BACKGROUND_REMINDER', intent: 'queue' })).command;
    await wait(async () => { const command=(await api('/commands/'+reminder.commandId)).command; if(command.state==='rejected') throw Error(command.errorCode);
      return (await api(`/chats/${originalChat}/events?limit=200`)).items.some((e: any) => e.type === 'user.message' && e.data.text === 'MODE1_BACKGROUND_REMINDER'); }, 'legacy background route remains the same history');
    mark('decline');
    const create = (await api('/commands', { requestId: randomUUID(), targetDeviceId: hostId, kind: 'session.create', modelProfileId: 'synthetic' })).command;
    const accepted = await wait(async () => { const command = (await api('/commands/' + create.commandId)).command; return command.state === 'accepted_by_dsh' && command; }, 'ordinary new chat');
    const next = { activeSessionId: accepted.sessionId };
    await api('/commands', { requestId: randomUUID(), targetDeviceId: hostId, kind: 'session.message', sessionId: next.activeSessionId, text: 'MODE1_WRITE_DECLINE', intent: 'queue' });
    const reject = await wait(async () => (await api(`/sessions/${next.activeSessionId}/approvals`)).approvals.find((r: any) => r.status === 'pending'), 'decline card');
    await api(`/sessions/${next.activeSessionId}/approvals/${reject.approvalId}`, { requestId: randomUUID(), outcome: 'rejected' });
    assert.equal(reject.intent, 'work-switch');
    await wait(async () => (await api(`/sessions/${next.activeSessionId}/events?limit=100`)).events.at(-1)?.type === 'turn.ended', 'declined turn ends');
    assert.equal((await api('/chats/main')).chat.mode, 'work');
    assert.equal((await api('/sessions')).sessions.find((row: any) => row.sessionId === next.activeSessionId).mode, 'chat');
    await assert.rejects(readFile(join(folder, 'declined.txt')));
    mark('public-query');
    await api('/commands',{requestId:randomUUID(),targetDeviceId:hostId,kind:'session.message',sessionId:next.activeSessionId,text:'MODE1_FETCH_PUBLIC',intent:'queue'});
    const queried = await wait(async()=>{const events=(await api(`/sessions/${next.activeSessionId}/events?limit=100`)).events;return events.find((event:any)=>event.type==='assistant.message'&&event.data?.text?.includes('MODE1_QUERY_'));},'public query answer');
    assert.match(queried.data.text,/MODE1_QUERY_OK/); assert.equal(publicReads,1);
    const queryApprovals=(await api(`/sessions/${next.activeSessionId}/approvals`)).approvals;
    assert.equal(queryApprovals.filter((row:any)=>row.status==='pending').length,0);
    assert.equal((await api('/sessions')).sessions.find((row:any)=>row.sessionId===next.activeSessionId).mode,'chat');
    mark('overwrite');
    const overwriteCreate = (await api('/commands', { requestId: randomUUID(), targetDeviceId: hostId, kind: 'session.create', modelProfileId:'synthetic' })).command;
    const overwriteSession = await wait(async()=>{const command=(await api('/commands/'+overwriteCreate.commandId)).command;return command.state==='accepted_by_dsh'&&command.sessionId;},'overwrite chat created');
    await api('/commands',{requestId:randomUUID(),targetDeviceId:hostId,kind:'session.message',sessionId:overwriteSession,text:'MODE1_WRITE_OVERWRITE',intent:'queue'});
    const modeFirst = await wait(async()=> (await api(`/sessions/${overwriteSession}/approvals`)).approvals.find((row:any)=>row.status==='pending'),'mode precedes existing-file risk approval');
    assert.equal(modeFirst.intent,'work-switch');
    await api(`/sessions/${overwriteSession}/approvals/${modeFirst.approvalId}`,{requestId:randomUUID(),outcome:'allowed-once',workProjectId:project.projectId});
    const overwriteRisk = await wait(async()=> (await api(`/sessions/${overwriteSession}/approvals`)).approvals.find((row:any)=>row.status==='pending'&&row.intent!=='work-switch'),'existing file still requires original approval');
    await api(`/sessions/${overwriteSession}/approvals/${overwriteRisk.approvalId}`,{requestId:randomUUID(),outcome:'rejected'});
    assert.equal(await readFile(join(folder,'main.txt'),'utf8'),'native-work-proof');
  } catch(error) { failed(error);throw error; }
  finally {
    try {
      mark('finally-runtime-close');await runtime?.close();
      mark('finally-host-close');await host?.close();
      mark('finally-links');await links(root);
      mark('finally-remove');await rm(root, { recursive: true, force: true });
      diagnostic.phase(phase,'complete');phase=null;
    } catch(error) {failed(error);throw error;}
  }
});
