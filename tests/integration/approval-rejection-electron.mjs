/** W2/#536: one UI refusal, original native receipt, real file and continued conversation. */
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sourceModelDesktop } from '../helpers/source-model-desktop.mjs';

const fixture = await sourceModelDesktop('R1021-CONTROL-W2');
const { root, page, api, until, capture, events, send, report } = fixture;
const exists = file => access(file).then(() => true, () => false);
let failure, sessionId;
const decisions = report.decisions = [];
try {
  const folder = join(root, 'W2'), txt = join(folder, 'txt');
  await mkdir(txt, { recursive: true });
  const approve = join(txt, 'approve-delete.txt'), reject = join(txt, 'reject-delete.txt'), keep = join(txt, 'keep.txt');
  for (const file of [approve, reject, keep]) await writeFile(file, 'SYNTHETIC_KEEP_CONTENT\n');
  const project = (await api('/projects', { requestId: randomUUID(), name: 'W2合成审批', rootPath: folder, permission: 'write' })).project;
  const created = (await api(`/projects/${project.projectId}/sessions`, { requestId: randomUUID(), modelProfileId: 'synthetic' })).command;
  sessionId = await until(async () => {
    const value = (await api('/commands/' + created.commandId)).command;
    return value.state === 'accepted_by_dsh' && value.sessionId;
  }, 'work session');
  await api(`/sessions/${sessionId}/approval-mode`, { mode: 'ask' }, 'PATCH');
  await page.evaluate(async id => { await scenarioCore.refreshSessions(); await scenarioCore.selectSession(id); }, sessionId);
  await page.locator(`#session-list .session-row[data-session-id="${sessionId}"] > button`).first().click();

  for (const [name, file, allowed] of [['approve-delete.txt', approve, true], ['reject-delete.txt', reject, false]]) {
    const before = (await events(sessionId)).filter(row => row.type === 'turn.ended').length;
    await send(`请删除当前项目中的合成文件 txt\\${name}，只删这一文件，不做其他整理。`);
    let chosen;
    await until(async () => {
      const pending = (await api(`/sessions/${sessionId}/approvals`)).approvals.filter(row => row.status === 'pending');
      for (const row of pending) {
        const deletion = /^\[weftmate:[^\]]*\bdelete\b/.test(row.reason || '');
        if (chosen) {
          if (row.approvalId === chosen.approvalId) continue;
          report.repeatedApproval = row;
          report.refusedFileStillExists = await exists(reject);
          throw Error('A new approval appeared after the one refusal; no second decision was sent');
        }
        assert.equal(await exists(file), true, 'the target must exist before its decision');
        await capture(`${allowed ? 'before-approve' : 'before-reject'}-${row.approvalId}`);
        const allow = deletion ? allowed : true;
        await page.locator('#approval-bar').getByRole('button', { name: allow ? /^(批准|仅这一次)$/ : /^拒绝$/, exact: true }).first().click();
        decisions.push({ approvalId: row.approvalId, callId: row.callId, rootCallId: row.rootCallId, allowed: allow, deletion });
        if (deletion) chosen = row;
      }
      return (await events(sessionId)).filter(row => row.type === 'turn.ended').length > before;
    }, 'one decision finishes the deletion turn', 120000);
    assert.ok(chosen, 'the requested deletion must reach native approval');
    const approvals = (await api(`/sessions/${sessionId}/approvals`)).approvals;
    const settled = approvals.find(row => row.approvalId === chosen.approvalId);
    assert.equal(settled.status, 'resolved');
    assert.equal(settled.outcome, allowed ? 'allowed-once' : 'rejected');
    assert.equal(approvals.filter(row => row.status === 'pending').length, 0);
    assert.equal(await exists(file), !allowed);
    assert.equal(await readFile(keep, 'utf8'), 'SYNTHETIC_KEEP_CONTENT\n');
    if (!allowed) assert.equal(await readFile(file, 'utf8'), 'SYNTHETIC_KEEP_CONTENT\n');
    await until(() => page.locator('#approval-bar').isHidden(), 'approval controls close');
    report[allowed ? 'approvedDeletion' : 'refusedDeletion'] = { approval: settled, targetPresent: await exists(file) };
    await capture(allowed ? 'approved-file-gone' : 'refused-file-preserved');
  }
  const before = (await events(sessionId)).filter(row => row.type === 'turn.ended').length;
  await send('只回复“继续正常”。');
  await until(async () => (await events(sessionId)).filter(row => row.type === 'turn.ended').length > before, 'next turn continues');
  const final = await events(sessionId);
  assert.match(final.filter(row => row.type === 'assistant.message').map(row => row.data.text).join('\n'), /继续正常/);
  assert.equal((await api(`/sessions/${sessionId}/approvals`)).approvals.filter(row => row.status === 'pending').length, 0);
  report.continued = true;
  report.passed = true;
  await capture('continued');
  console.log('W2 PASS: one approval deletes; one refusal preserves and settles; next turn continues');
} catch (error) {
  failure = error; process.exitCode = 1;
  await capture('first-failure').catch(() => {});
  console.error(error.message);
} finally {
  if (sessionId) report.events = await events(sessionId).catch(() => []);
  await fixture.close(failure);
}
