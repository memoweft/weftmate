import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeTimelineLog } from '../src/runtime/dsh-adapter/timeline.mjs';
import { createDshSessionAdapter } from '../src/runtime/dsh-adapter/sessions.mjs';
import { eraseSessionMemoryArtifact } from '../src/runtime/dsh-adapter/memory-erasure.mjs';
import { createPersonalAccessService } from '../src/personal-access/index.mjs';

// Real host, native adapter, persistent history cache and native erasure writer.
// Only DSH's storage/transport boundary is synthetic; no personal runtime data.
for (const action of ['forget', 'forget-title', 'delete']) test(`D33 cached ${action}: lists, search, pages, native index and restart cannot revive erased content`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'fx16-erasure-')), nativeRoot = join(root, 'native');
  const secret = 'FX16_PRIVATE_SOURCE', clean = 'Unrelated retained conversation';
  await mkdir(nativeRoot);
  const artifacts = new Map<string, string>();
  const persistence: any = {
    config: { root: nativeRoot }, listSnapshots: async () => [],
    locate: (meta: any) => ({ kind: 'jsonl', path: artifacts.get(meta.id) }),
    async readRaw(id: string) {
      const content = await readFile(artifacts.get(id)!, 'utf8');
      return { content, meta: JSON.parse(content.split('\n')[0]) };
    },
    async inspect(id: string) {
      const rows = (await persistence.readRaw(id)).content.trim().split('\n').map(JSON.parse);
      return { meta: rows[0], events: rows.slice(1) };
    },
  };
  const listNative = async () => ({ result: { ok: true, value: { items: await Promise.all([...artifacts.keys()].map(async sessionId => {
    const { meta } = await persistence.inspect(sessionId);
    return { sessionId, title: meta.title, agentPreset: 'personal-remote', running: false };
  })) } } });
  let log: any, adapter: any, service: any, origin: string, ownerId: string;
  const openAdapter = () => {
    log = nativeTimelineLog({ get: (name: string) => name === 'sessionPersistence' ? persistence : undefined });
    adapter = createDshSessionAdapter({ sessions: { list: listNative }, events: {} }, { readLog: log, lifecycle: {
      cleanupMemory: async (id: string, options: any) => {
        const affected = (await persistence.readRaw(id)).content.includes(secret);
        await eraseSessionMemoryArtifact(persistence, id, options);
        return { cleaned: true, forgottenSeqs: affected ? [0] : [] };
      },
      remove: async (id: string) => { await rm(artifacts.get(id)!); artifacts.delete(id); return { deleted: true }; },
    } });
  };
  openAdapter();
  const backend: any = {
    getStatus: async () => ({ runtime: 'ready' }), listModels: async () => [{ id: 'local', model: 'synthetic', configured: true }],
    preflight: async () => ({ ok: true }), sendMessage: async () => ({ accepted: true }), cancelSession: async () => ({ accepted: true }),
    async createSession({ sessionId }: any) {
      const title = artifacts.size ? clean : secret, file = join(nativeRoot, sessionId + '.jsonl');
      artifacts.set(sessionId, file);
      await writeFile(file, [JSON.stringify({ id: sessionId, title, agentPreset: 'personal-remote' }), JSON.stringify({ seq: 0, time: Date.parse('2026-10-05T00:00:00Z'), type: 'assistant/message', data: { content: [{ type: 'text', text: title }] } }), ''].join('\n'));
      return { sessionId };
    },
    describeSessions: async (ids: string[]) => (await adapter.list()).filter((row: any) => ids.includes(row.sessionId)),
    describeSession: async (id: string) => (await adapter.list()).find((row: any) => row.sessionId === id),
    renameSession: async ({ title }: any) => ({ title }),
    readEvents: ({ sessionId, ...options }: any) => adapter.historyPage(sessionId, options),
    cleanupMemoryCopies: ({ sessionId, ...options }: any) => adapter.cleanupMemory(sessionId, options),
    deleteSession: ({ sessionId }: any) => adapter.remove(sessionId),
  };
  let device: any;
  const request = async (route: string, method = 'GET', body?: any) => {
    const response = await fetch(origin + '/personal/v1' + route, { method, headers: { authorization: `Bearer ${device.token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json(); assert.ok(response.ok, JSON.stringify({ route, value })); return value;
  };
  try {
    service = await createPersonalAccessService({ root: join(root, 'access'), port: 0, backend });
    let started = await service.start(); origin = started.origin; ownerId = started.ownerId;
    device = await service.enrollDevice({ name: 'synthetic' });
    const ids: string[] = [];
    // Seed through the real command/store path before building the native index.
    for (let i = 0; i < 2; i++) {
      const created = await request('/commands', 'POST', { requestId: `create-${i}`, kind: 'session.create', targetDeviceId: started.hostId, modelProfileId: 'local' });
      let command: any;
      for (let n = 0; n < 100; n++) { command = (await request('/commands/' + created.command.commandId)).command; if (command.state === 'accepted_by_dsh') break; await new Promise(r => setTimeout(r, 10)); }
      assert.equal(command.state, 'accepted_by_dsh'); ids.push(command.sessionId);
    }
    // Native creation events normally update this index. Reopen the synthetic transport once after seeding.
    await log.close(); openAdapter();
    if (action === 'forget-title') await request(`/sessions/${ids[0]}/metadata`, 'PATCH', { title: secret });
    assert.match(JSON.stringify(await request('/sessions?q=' + secret)), new RegExp(secret));
    assert.match(JSON.stringify(await request(`/sessions/${ids[0]}/events`)), new RegExp(secret));
    await request(`/sessions/${ids[1]}/events`);
    assert.equal((await request('/sessions')).sessions.find((row: any) => row.sessionId === ids[1]).unread, true);
    await request('/chats?limit=1');
    if (action.startsWith('forget')) await service.cleanupMemoryCopies(ownerId, { sourceTexts: [secret], deleteConversationSnippets: true });
    else await request(`/sessions/${ids[0]}`, 'DELETE', {});
    const verify = async () => {
      for (const base of ['/sessions', '/chats']) {
        assert.doesNotMatch(JSON.stringify(await request(base + '?archived=all')), new RegExp(secret));
        const search = await request(base + '?archived=all&q=' + secret);
        assert.equal((search.sessions ?? search.items).length, 0);
        let cursor: string | null = null, pages = 0;
        do {
          const page = await request(base + '?archived=all&limit=1' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
          assert.doesNotMatch(JSON.stringify(page), new RegExp(secret));
          if (action === 'delete') assert.ok(!(page.sessions ?? page.items).some((row: any) => row.sessionId === ids[0] || row.activeSessionId === ids[0]));
          cursor = page.hasMore ? page.nextCursor : null; assert.ok(++pages < 10);
        } while (cursor);
      }
      const native = await adapter.list(); assert.doesNotMatch(JSON.stringify(native), new RegExp(secret));
      if (action === 'delete') assert.ok(!native.some((row: any) => row.sessionId === ids[0]));
      else assert.doesNotMatch(JSON.stringify(await request(`/sessions/${ids[0]}/events`)), new RegExp(secret));
      assert.match(JSON.stringify(native), new RegExp(clean));
      assert.equal((await request('/sessions')).sessions.find((row: any) => row.sessionId === ids[1]).unread, true, 'erasure preserves the cached unread state of unrelated history');
      assert.ok(!(await readFile(join(root, 'weftmate-history.sqlite'))).includes(Buffer.from(secret)), 'persistent summary/history cache is physically clean');
    };
    await verify();
    await service.close(); await log.close(); openAdapter();
    service = await createPersonalAccessService({ root: join(root, 'access'), port: 0, backend });
    origin = (await service.start()).origin; await verify();
  } finally { await service?.close(); await log?.close(); await rm(root, { recursive: true, force: true }); }
});
