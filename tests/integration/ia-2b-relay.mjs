import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { verify } from '../../src/personal-backup/archive.mjs';
import { harness, evidence, until } from './ia-2b-harness.mjs';
const h = await harness('relay', { memory: false });
const report = { realElectron: true, fixedDsh: true, model: 'mimo-v2.6-flash', turns: [], switches: [] };
try {
  const main = (await h.api('/chats/main')).body.chat;
  assert.equal(main.activeSessionId, null);
  async function send(text, extra = {}) {
    const body = { requestId: randomUUID(), kind: 'chat.message', chatId: main.chatId, targetDeviceId: h.hostId, text, ...extra };
    const command = await h.command(body); await h.complete(command);
    assert.equal(command.kind, 'chat.message'); assert.equal(command.chatId, main.chatId);
    assert.equal((await h.api('/commands', body)).body.command.receiptId, command.receiptId);
    const current = (await h.api('/chats/main')).body.chat;
    report.turns.push({ commandId: command.commandId, sessionId: command.sessionId, activeSessionId: current.activeSessionId });
    if (report.turns.length > 1 && report.turns.at(-2).sessionId !== command.sessionId) report.switches.push(command.sessionId);
    return command;
  }
  const first = await send('合成第一段锚点：蓝色纸船。未完成事项：稍后核对纸船编号。只回复“已记录”，不要使用工具。', { modelProfileId: h.modelProfileId });
  assert.equal((await h.api('/commands', { requestId: randomUUID(), kind: 'session.message', targetDeviceId: h.hostId, sessionId: first.sessionId, text: '旧接口不能发送' })).status, 409);
  assert.ok(!(await h.api('/sessions')).body.sessions?.some(row => row.sessionId === first.sessionId));
  const count = process.env.IA2B_QUICK === '1' ? 0 : 22;
  for (let i = 0; i < count && report.switches.length < 2; i++) {
    // Long synthetic messages cross the existing native research-pressure
    // policy; no test override of the production threshold or model capacity.
    const data = Array.from({ length: 70 }, (_, j) => `Synthetic record ${i}-${j}: paper boat ${i * 70 + j}; preserve the pending check in order. Test data only.`).join('\n');
    await send(`以下是合成长历史测试资料，不执行操作，不调用工具。只回复“已记录”。\n${data}`);
    console.log(`relay progress: ${report.turns.length} turns, ${report.switches.length} switches`);
  }
  if (count) assert.equal(report.switches.length, 2);
  const search = await until(async () => { const page = await h.api(`/chats/${main.chatId}/search?q=${encodeURIComponent('蓝色纸船')}`); return page.body.indexState === 'ready' && page.body; });
  assert.ok(search.hits.some(row => row.sourceRef.sessionId === first.sessionId));
  const store = JSON.parse(await readFile(join(h.profile, 'personal-access/store.json'), 'utf8'));
  const account = store.accounts[h.ownerId];
  report.segments = Object.values(account.chatIdentity.segments).filter(row => row.chatId === main.chatId);
  assert.equal(report.segments.length, report.switches.length + 1);
  assert.ok(report.segments.every(row => account.sessions[row.sessionId].workspaceChatId === main.chatId));
  await h.close(); await h.launch();
  assert.equal((await h.api('/chats/main')).body.chat.chatId, main.chatId);
  assert.equal((await h.api(`/commands/by-request/${first.requestId}`)).body.command.sessionId, first.sessionId);
  const last = await send('这是重启后的接力验证，只回复“连续主对话已恢复”。不要使用工具。');
  assert.equal(last.sessionId, report.segments.at(-1).sessionId);
  if (count) {
    const cleaned = await h.app.evaluate(async (_, ownerId) => globalThis.ia2b.service.cleanupMemoryCopies(ownerId,
      { sourceTexts: ['蓝色纸船'], deleteConversationSnippets: true }), h.ownerId);
    assert.equal(cleaned.cleaned, true);
    const searched = await until(async () => { const result = await h.api(`/chats/${main.chatId}/search?q=${encodeURIComponent('蓝色纸船')}`); return result.body.indexState === 'ready' && result.body; });
    assert.equal(searched.hits.length, 0);
    assert.equal((await h.api('/chats/main')).body.chat.chatId, main.chatId);
    const backup = await h.api('/backups', {}); assert.equal(backup.body.state, 'succeeded', JSON.stringify(backup));
    const extracted = join(h.base, 'after-forget-backup');
    const manifest = await verify(join(h.base, 'Backups', backup.body.backup.id), extracted);
    let frames = 0;
    const hits = [], contains = bytes => bytes.includes(Buffer.from('蓝色纸船')) || bytes.includes(Buffer.from('蓝色纸船', 'utf16le')) || /\\+u84dd\\+u8272\\+u7eb8\\+u8239/i.test(bytes.toString('utf8'));
    for (const file of manifest.files) {
      const bytes = await readFile(join(extracted, file.path));
      if (contains(bytes)) hits.push(file.path);
      if (file.path.endsWith('.zstd')) for (let offset = 0; offset < bytes.length;) {
        const result = zstdDecompressSync(bytes.subarray(offset), { info: true }); frames++;
        if (contains(result.buffer)) hits.push(file.path);
        assert.ok(result.engine.bytesWritten); offset += result.engine.bytesWritten;
      }
    }
    assert.deepEqual(hits, []); report.zeroResidueAfterTwoRelays = { files: manifest.files.length, decodedFrames: frames, hits: hits.length };
    await send('继续验证清理后可以发送，只回复“已恢复”。不要使用工具。');
  }
  await h.close(); report.usage = await h.usage();
  await writeFile(join(evidence, count ? '2.4-relay.json' : '2.4-first-send.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ segments: report.segments.length, requests: report.usage.length }));
} catch (error) {
  await writeFile(join(evidence, '2.4-failure.json'), JSON.stringify({ error: error.message, report, usage: await h.usage().catch(() => []) }, null, 2));
  throw error;
} finally { await h.close(); console.log(`Owned isolated root: ${h.base}`); }
