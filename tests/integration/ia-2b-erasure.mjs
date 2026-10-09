import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { harness, run, python, core, evidence, until } from './ia-2b-harness.mjs';
import { verify } from '../../src/personal-backup/archive.mjs';
import { exportHasForgottenName } from './m2-exit-checks.mjs';

const h = await harness('erasure'), marker = '王小明';
const report = { realElectron: true, fixedDsh: true, realCore: true, model: 'mimo-v2.6-flash',
  seededMemoryFixture: true, modelFormationClaim: false, checks: [] };
async function seed(prefix, sessionId) {
  const script = `import sys,sqlite3
sys.path.insert(0,sys.argv[1])
from memoweft.integrations.trust.revision import advance_world_revision
from memoweft.integrations.dsh_bridge import _origin_id
c=sqlite3.connect(sys.argv[2],isolation_level=None)
owner,prefix,session,text=sys.argv[3:7]
t='2026-10-10T00:00:00Z'
message={'role':'user','content':text,'message_id':prefix+'-msg','source_ref':'source:0'}
origin=_origin_id(message=message,content=text,session_id=session,message_index=0,subject_id=owner,host_id='ia-test',boundary_id=prefix)
c.execute('BEGIN IMMEDIATE')
c.execute("INSERT INTO evidence (id,subject_id,source_kind,host_id,origin_id,occurred_at,recorded_at,raw_content,summary,allow_local_read,allow_cloud_read,allow_inference) VALUES (?,?,'spoken','ia-test',?,?,?,?,?,1,1,1)",(prefix+'-e',owner,origin,t,t,text,text))
c.execute("INSERT INTO cognition (id,subject_id,content,content_type,formed_by,confidence,cred_status,created_at,updated_at) VALUES (?,?,?,'decision','stated',800,'trusted',?,?)",(prefix+'-c',owner,text,t,t))
c.execute("INSERT INTO cognition_evidence VALUES (?,?,'support')",(prefix+'-c',prefix+'-e'))
advance_world_revision(c)
c.execute('COMMIT');c.close()`;
  await run(python, ['-c', script, core, join(h.profile, 'personal-access/accounts', h.ownerId, 'memory-home/memoweft/memoweft.sqlite3'), h.ownerId, prefix, sessionId, marker], { windowsHide: true });
}
async function forget(prefix, deleteConversationSnippets) {
  const preview = await h.api(`/memory/items/cognition/${prefix}-c/forget-preview`);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const requestId = randomUUID();
  const result = await h.api(`/memory/items/cognition/${prefix}-c`, { requestId, expectedWorldRevision: preview.body.worldRevision, deleteConversationSnippets }, 'DELETE');
  assert.ok(result.status < 300, JSON.stringify(result));
  const receipt = await until(async () => {
    const current = (await h.api(`/memory/commands/by-request/${requestId}`)).body;
    const view = current.command ?? current.receipt ?? current;
    assert.ok(['applied','no_change'].includes(view.state), JSON.stringify(current));
    if (view.storageCleanup?.state === 'pending') throw new Error(JSON.stringify(current));
    return current;
  });
  report.checks.push({ deleteConversationSnippets, result: result.body, receipt });
}
try {
  // This package tests erasure, not formation. Keep exact controlled Core rows
  // and real MiMo/native logs, without racing a background formation job.
  await h.app.evaluate(() => { globalThis.ia2b.context.memoryManager.ingest = async () => ({ state: 'accepted' }); });
  const first = await h.command({ requestId: randomUUID(), kind: 'session.create', targetDeviceId: h.hostId, modelProfileId: h.modelProfileId });
  const sent = await h.command({ requestId: randomUUID(), kind: 'session.message', targetDeviceId: h.hostId, sessionId: first.sessionId, text: marker });
  await h.complete(sent);
  const link = (await h.api(`/sessions/${first.sessionId}/chat`)).body;
  const page = (await h.api(`/chats/${link.chatId}/events`)).body;
  const anchor = page.items.find(row => row.type === 'user.message');
  const answer = page.items.findLast(row => row.type === 'assistant.message');
  const child = await h.command({ requestId: randomUUID(), kind: 'session.side.create', targetDeviceId: h.hostId, modelProfileId: h.modelProfileId,
    parent: { kind: 'main', id: (await h.api('/chats/main')).body.chat.chatId }, originChatId: link.chatId, originEventId: anchor.eventId });
  const share = await h.api(`/chats/${link.chatId}/results`, { requestId: randomUUID(), sourceEventId: answer.eventId,
    expectedRevision: (await h.api(`/chats/${link.chatId}`)).body.chat.revision });
  assert.equal(share.status, 201, JSON.stringify(share));
  // Exercise future multi-segment derived metadata before enabling the relay.
  await h.app.evaluate(async (_, { ownerId, sessionId, marker }) => {
    const c = globalThis.ia2b.context;
    await c.serial(() => c.mutate(ownerId, next => {
      const segment = next.chatIdentity.segments[next.chatIdentity.sessionSegments[sessionId]];
      segment.handoff = { summary: marker }; segment.handoffSourceRefs = [{ sessionId }];
      for (const result of Object.values(next.chatResults)) result.summary = marker;
    }));
  }, { ownerId: h.ownerId, sessionId: child.sessionId, marker });
  await seed('keep', first.sessionId); await forget('keep', false);
  const retained = (await h.api(`/sessions/${first.sessionId}/events?afterSeq=-1&limit=200`)).body;
  assert.ok(JSON.stringify(retained).includes(marker));
  assert.equal((await h.api(`/chats/${child.chatId}`)).body.chat.originRefs.length, 0);
  assert.equal((await h.api(`/chats/${link.chatId}/changes?cursor=${encodeURIComponent(page.syncCursor)}`)).status, 409);
  const follow = await h.command({ requestId: randomUUID(), kind: 'session.message', targetDeviceId: h.hostId, sessionId: first.sessionId,
    text: '只回复：清理检查完成。不要使用工具。' });
  await h.complete(follow);
  report.checks.push('default preserves visible originals and native session resumes after surface pruning');
  await seed('erase', first.sessionId); await forget('erase', true);
  const after = await h.api(`/chats/${link.chatId}/search?q=${encodeURIComponent(marker)}`);
  assert.equal(after.status, 200); assert.equal(after.body.hits.length, 0);
  const store = JSON.parse(await readFile(join(h.profile, 'personal-access/store.json'), 'utf8'));
  assert.ok(!JSON.stringify(store).includes(marker), 'no access-store copy');
  await h.page.reload();
  await h.page.getByRole('button', { name: '账户菜单', exact: true }).waitFor();
  await h.page.screenshot({ path: join(evidence, '2.5-electron.png') });
  const backup = await h.api('/backups', {});
  assert.equal(backup.status, 202, JSON.stringify(backup)); assert.equal(backup.body.state, 'succeeded', JSON.stringify(backup));
  const extracted = join(h.base, 'new-backup');
  const manifest = await verify(join(h.base, 'Backups', backup.body.backup.id), extracted);
  const hits = [];
  for (const file of manifest.files) if (exportHasForgottenName(await readFile(join(extracted, file.path)), file.path)) hits.push(file.path);
  assert.deepEqual(hits, [], 'new backup byte and concatenated-frame scan');
  const databases = manifest.files.filter(row => /\.(sqlite3?|db)$/.test(row.path));
  const dbReport = [];
  for (const file of databases) {
    const script = `import sys,sqlite3,json
c=sqlite3.connect(sys.argv[1]); tables=[r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]; hits=[]
for t in tables:
 for row in c.execute('SELECT * FROM "'+t.replace('"','""')+'"'):
  for value in row:
   if isinstance(value,bytes): value=value.decode('utf-8',errors='replace')
   if isinstance(value,str) and (sys.argv[2] in value or '\\\\u738b\\\\u5c0f\\\\u660e' in value.lower()): hits.append(t)
print(json.dumps({'tables':len(tables),'hits':hits}));c.close()`;
    const { stdout } = await run(python, ['-c', script, join(extracted, file.path), marker], { windowsHide: true });
    const result = JSON.parse(stdout); assert.deepEqual(result.hits, []); dbReport.push({ file: file.path, ...result });
  }
  report.zeroResidue = { files: manifest.files.length, byteAndDecodedFrameHits: hits.length, databases: dbReport };
  await h.close(); await h.launch();
  assert.equal((await h.api(`/chats/${link.chatId}/search?q=${encodeURIComponent(marker)}`)).body.hits.length, 0);
  assert.equal((await h.api(`/chats/${child.chatId}`)).body.chat.originRefs.length, 0);
  report.checks.push('restart does not restore result summaries, side refs or search text');
  await h.close(); report.usage = await h.usage(); report.electronLaunchesClosed = h.launches;
  await writeFile(join(evidence, '2.5-erasure.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} catch (error) {
  await writeFile(join(evidence, '2.5-erasure-failure.json'), JSON.stringify({ message: error.message, usage: await h.usage().catch(() => []) }, null, 2));
  throw error;
} finally { await h.close(); console.log(`Owned isolated root: ${h.base}`); }
