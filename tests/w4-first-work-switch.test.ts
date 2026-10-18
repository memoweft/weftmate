import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { phoneRuntime } from '../services/cloud/test/relay-phone-runtime.mjs';
import { createPersonalAccessService } from './helpers/personal-access-test-service.mjs';

process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
const text = (m: any) => typeof m.content === 'string' ? m.content : (m.content ?? []).map((p: any) => p.text ?? '').join('');
function firstWorkReply(body: any) {
  const index = body.messages.findLastIndex((m: any) => m.role === 'user' && text(m).startsWith('W4_FIRST'));
  if (index < 0 || !body.tools?.length) return { content: '合成标题' };
  const calls = body.messages.slice(index + 1).flatMap((m: any) => m.tool_calls ?? []);
  if (calls.length && !body.tools.some((t: any) => t.function.name === 'write') && !body.messages.some((m: any) => text(m).includes('重新调用 load_tools'))) {
    return { content: '请先切换到工作。' };
  }
  const call = (name: string, args: any) => ({ content: '', tool_calls: [{ id: `w4-${calls.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  if (!calls.length) return call('load_tools', {}); // Observed first preparation failure.
  const hasTool = (name: string) => body.tools.some((tool: any) => tool.function.name === name);
  // Interpret the actual native model input, not the imported prompt function.
  // Without the folder-selection contract, reproduce the observed path question.
  const hasFolderGuidance = body.messages.some((message: any) => {
    const notice = text(message);
    return notice.includes('不要用 ask_user_question 索要路径') && notice.includes('相对路径') && notice.includes('切换到工作');
  });
  if (!hasFolderGuidance) {
    if (!hasTool('ask_user_question')) return call('load_tools', { names: ['ask_user_question'] });
    return call('ask_user_question', { questions: [{ id: 'folder_path', header: '文件夹', question: '请提供要整理的文件夹完整路径。',
      options: [{ label: '选择文件夹', description: '浏览选择' }, { label: '输入路径', description: '填写完整路径' }] }] });
  }
  if (!hasTool('write')) return call('load_tools', { names: ['write'] });
  const written = new Set(calls.filter((item: any) => item.function.name === 'write').map((item: any) => JSON.parse(item.function.arguments).file_path));
  for (const [file_path, content] of [['txt/a.txt', 'text'], ['csv/b.csv', 'csv']]) {
    if (!written.has(file_path)) return call('write', { file_path, content });
  }
  return { content: '已写入分类文件。' };
}

test('#507 synthetic responder requests a folder path without selection guidance', () => {
  const reply = firstWorkReply({
    messages: [
      { role: 'user', content: 'W4_FIRST 请把选定文件夹中的文件按类型整理。' },
      { role: 'user', content: '当前是对话模式，电脑工具会询问是否切换到工作。' },
      { role: 'assistant', tool_calls: [
        { function: { name: 'load_tools', arguments: '{}' } },
        { function: { name: 'load_tools', arguments: '{"names":["write"]}' } },
      ] },
    ],
    tools: ['load_tools', 'write', 'ask_user_question'].map(name => ({ function: { name } })),
  });
  const call = reply.tool_calls?.[0]?.function;
  assert.equal(call?.name, 'ask_user_question', 'without the fix the model must reproduce the wrong path-question branch');
  assert.match(JSON.parse(call!.arguments).questions[0].question, /路径/);
});

test('#363 first request with failed tool preparation switches and resumes file writes without a follow-up', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'w4-first-switch-'));
  let runtime: any, host: any;
  const until = async (read: () => Promise<any>) => {
    const end = Date.now() + 20000;
    while (Date.now() < end) { const value = await read(); if (value) return value; await new Promise(r => setTimeout(r, 60)); }
    throw Error('first request did not progress');
  };
  async function removeLinks(directory: string) {
    for (const row of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, row.name);
      if ((await lstat(file)).isSymbolicLink()) await unlink(file); else if (row.isDirectory()) await removeLinks(file);
    }
  }
  try {
    runtime = await phoneRuntime(root, [], { respond: firstWorkReply });
    host = await createPersonalAccessService({ root: join(root, 'account'), port: 0, backend: runtime.backend });
    runtime.setHost(host); await runtime.start();
    const { origin, hostId } = await host.start(), grant = await host.issueSetupGrant();
    const setup = await fetch(origin + '/personal/v1/auth/setup', { method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ grant: grant.grant, username: 'SyntheticW4', password: 'Synthetic W4 password', deviceName: 'synthetic' }) });
    assert.equal(setup.status, 201); const auth: any = await setup.json(), cookie = setup.headers.get('set-cookie')!.split(';')[0];
    const api = async (path: string, body?: any) => {
      const res = await fetch(origin + '/personal/v1' + path, { method: body ? 'POST' : 'GET', headers: { origin, cookie, 'content-type': 'application/json', 'x-weftmate-csrf': auth.csrfToken }, body: body ? JSON.stringify(body) : undefined });
      const data: any = await res.json(); assert.ok(res.ok, JSON.stringify({ path, error: data.error })); return data;
    };
    const folder = join(root, 'Chosen'); await mkdir(folder);
    await writeFile(join(folder, 'a.txt'), 'text'); await writeFile(join(folder, 'b.csv'), 'csv');
    const project = (await api('/projects', { requestId: randomUUID(), name: '合成文件夹', rootPath: folder, permission: 'write' })).project;
    const creation = (await api('/commands', { requestId: randomUUID(), kind: 'session.create', targetDeviceId: hostId, modelProfileId: 'synthetic' })).command;
    const id = await until(async () => { const row = (await api('/commands/' + creation.commandId)).command; return row.state === 'accepted_by_dsh' && row.sessionId; });
    await api('/commands', { requestId: randomUUID(), kind: 'session.message', targetDeviceId: hostId, sessionId: id, text: 'W4_FIRST 请把选定文件夹中的文件按类型整理。', intent: 'queue' });
    const first = await until(async () => {
      const approvals = (await api(`/sessions/${id}/approvals`)).approvals;
      const events = (await api(`/sessions/${id}/events?limit=100`)).events;
      return approvals.some((a: any) => a.status === 'pending') || events.some((e: any) => e.type === 'turn.ended'
        || e.type === 'question.asked') ? { approvals, events } : null;
    });
    const card = first.approvals.find((a: any) => a.status === 'pending');
    assert.equal(card?.intent, 'work-switch', 'the first user request must recover preparation and open a card');
    assert.equal(first.events.some((e: any) => e.type === 'question.asked'), false);
    assert.deepEqual((await readdir(folder)).sort(), ['a.txt', 'b.csv']);
    await api(`/sessions/${id}/approvals/${card.approvalId}`, { requestId: randomUUID(), outcome: 'allowed-once', workProjectId: project.projectId });
    await until(async () => {
      for (const approval of (await api(`/sessions/${id}/approvals`)).approvals.filter((a: any) => a.status === 'pending')) {
        await api(`/sessions/${id}/approvals/${approval.approvalId}`, { requestId: randomUUID(), outcome: 'allowed-once' });
      }
      return await readFile(join(folder, 'txt', 'a.txt'), 'utf8').catch(() => null) === 'text'
        && await readFile(join(folder, 'csv', 'b.csv'), 'utf8').catch(() => null) === 'csv';
    }).catch(async error => {
      const rows = (await api(`/sessions/${id}/events?limit=100`)).events;
      const failed = rows.findLast((e: any) => e.type === 'step.completed' && e.data.state === 'failed');
      throw new Error(error.message + ': ' + JSON.stringify(failed && await api(`/sessions/${id}/events/${failed.seq}/detail`)));
    });
    assert.equal(await readFile(join(folder, 'csv', 'b.csv'), 'utf8'), 'csv');
    const events = await until(async () => { const rows = (await api(`/sessions/${id}/events?limit=100`)).events; return rows.some((e: any) => e.type === 'turn.ended') && rows; });
    assert.equal(events.filter((e: any) => e.type === 'user.message').length, 1);
    assert.equal(events.filter((e: any) => e.type === 'step.completed' && e.data.toolName === 'load_tools' && e.data.state === 'failed').length, 1);
    assert.equal((await api('/sessions')).sessions.find((s: any) => s.sessionId === id).mode, 'work');
  } finally {
    await runtime?.close(); await host?.close();
    const rel = relative(resolve(tmpdir()), resolve(root)); assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel));
    await removeLinks(root); await rm(root, { recursive: true, force: true });
  }
});
