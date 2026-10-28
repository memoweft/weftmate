/** Two consecutive native approvals through a fresh work draft and real main. */
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {migrationHost, until} from '../helpers/migration-host.mjs';
import {createInstalledSmokeResponder, installedSmokePrompt, installedSmokeRequestKind} from '../../scripts/nightly/installed-smoke-provider.mjs';

const out = resolve(process.env.WEFTMATE_EVIDENCE_DIR || '.local/second-approval');
mkdirSync(out, {recursive: true});
const report = {realElectron: true, realDsh: true, decisions: [], restorations: [], commandReceipts: []};
let h, sessionId;
try {
  const respond = createInstalledSmokeResponder();
  const released = new Set();
  h = await migrationHost({nativeSession: true, startInTray: true, entry: resolve('tests/integration/second-approval-entry.mjs'), respond: async input => {
    const message = await respond(input);
    // Hold each model response until the real window is hidden, so both native
    // approval requests originate in the tray rather than racing a hide call.
    for (const call of message.tool_calls || []) if (['read', 'write'].includes(call.function.name))
      await until(() => released.has(call.function.name));
    return message;
  }});
  h.page.on('response', async response => {
    if (!response.url().endsWith('/personal/v1/commands') || response.request().method() !== 'POST') return;
    const receipt = await response.json().catch(() => ({}));
    report.commandReceipts.push({kind:response.request().postDataJSON()?.kind, status:response.status(), state:receipt.command?.state});
  });
  await h.page.addInitScript(() => {
    let module;
    Object.defineProperty(globalThis, 'WeftUiCore', {configurable: true, get: () => module, set: value => {
      module = value; const create = value.create;
      value.create = (...args) => {
        const effects = args[0].effects;
        globalThis.approvalTestEffects = effects;
        globalThis.approvalTestCore = create(...args); return globalThis.approvalTestCore;
      };
    }});
  });
  await h.mainFirst();
  const project = join(h.root, 'synthetic-project');
  mkdirSync(project); writeFileSync(join(project, 'brief.md'), 'FX21 synthetic project file\n');
  await h.app.evaluate(({dialog}, project) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [project]}); }, project);
  await h.page.reload();
  await h.page.locator('#attachment-add').click();
  await h.page.getByRole('menuitem', {name: '选择文件夹', exact: true}).click();
  await h.page.getByRole('button', {name: '在这个文件夹里工作', exact: true}).click();
  const registered = await until(async () => (await h.api('/projects')).body.projects?.find(row => row.name === 'synthetic-project'));
  await until(async () => await h.page.locator('.folder-confirm').count() === 0);
  assert.equal((await h.api('/projects/' + registered.projectId, {expectedRevision: registered.revision, permission: 'write'}, 'PATCH')).status, 200);
  await h.page.getByRole('button', {name: '新建对话', exact: true}).click();
  await h.page.getByRole('tablist', {name: '新对话模式', exact: true}).getByRole('tab', {name: '新对话：工作', exact: true}).click();
  await h.page.getByRole('button', {name: '电脑：synthetic-host', exact: true}).click();
  await h.page.getByRole('menu', {name: '选择电脑', exact: true}).getByRole('menuitemradio', {name: 'synthetic-host', exact: true}).click();
  await h.page.getByRole('button', {name: '选择项目或文件夹', exact: true}).click();
  await h.page.getByRole('menu', {name: '选择项目或文件夹', exact: true}).getByRole('menuitemradio', {name: /^synthetic-project/}).click();
  await h.page.getByRole('button', {name: '自动', exact: true}).click();
  await h.page.getByRole('menu', {name: '审批模式', exact: true}).getByRole('menuitemradio', {name: /^每次询问/}).click();
  await h.page.locator('#message-text').fill(installedSmokePrompt);
  const [response] = await Promise.all([
    h.page.waitForResponse(r => r.url().endsWith('/personal/v1/commands') && r.request().postDataJSON()?.kind === 'session.message'),
    h.page.getByRole('button', {name: '发送', exact: true}).click(),
  ]);
  assert.equal(response.status(), 202);
  const command = (await response.json()).command;
  sessionId = (await h.receipt(command)).sessionId;
  await h.page.reload();
  await h.page.locator(`.session-row[data-session-id="${sessionId}"] > button`).first().click();
  await h.page.waitForFunction(id => document.querySelector(`.session-row[data-session-id="${id}"] > button`)?.classList.contains('is-current') && !document.querySelector('#message-text')?.disabled, sessionId);
  for (let step = 0; step < 2; step++) {
    await h.app.evaluate(({BrowserWindow}, url) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url).hide(), h.page.url());
    await h.page.waitForFunction(() => approvalTestCore.state.background === true);
    released.add(step === 0 ? 'read' : 'write');
    const pending = await until(async () => (await h.api(`/sessions/${sessionId}/approvals`)).body.approvals?.find(row => row.status === 'pending' && !report.decisions.includes(row.approvalId)));
    assert.equal(existsSync(join(project, 'approved.md')), false, 'writing waits for its own decision');
    await until(() => h.app.evaluate(({BrowserWindow}, {url, sessionId, step}) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url);
      if (win.isVisible()) throw Error('Approval must arrive while the native window is hidden');
      return globalThis.trayApprovalTest.events.filter(event => event.type === 'approval.requested' && event.sessionId === sessionId).length > step;
    }, {url: h.page.url(), sessionId, step}));
    // Observe the production foreground callback. Suppress only the periodic
    // UI timers while reopening, proving the card does not need the next poll.
    await h.page.evaluate(() => {
      clearInterval(approvalTestCore.state.refreshTimer);
      clearInterval(approvalTestCore.state.liveRefreshTimer);
      const effects = globalThis.approvalTestEffects, restore = effects.foregroundRestored;
      globalThis.approvalTestRestored = false;
      effects.foregroundRestored = async () => { await restore(); globalThis.approvalTestRestored = true; };
    });
    const openedAt = Date.now();
    await h.app.evaluate(({BrowserWindow}, {step, url, sessionId}) => {
      if (step === 0) globalThis.trayApprovalTest.tray.emit('click');
      else globalThis.trayApprovalTest.events.filter(event => event.type === 'approval.requested' && event.sessionId === sessionId).at(-1).notification.emit('click');
      if (!BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url).isVisible()) throw Error('Native activation did not show the window');
    }, {step, url: h.page.url(), sessionId});
    await h.page.waitForFunction(() => approvalTestCore.state.background === false && globalThis.approvalTestRestored);
    const button = h.page.locator(`[data-conversation-approval="${pending.approvalId}"]`).getByRole('button', {name: '批准', exact: true});
    await button.waitFor({state: 'visible', timeout: 15000});
    report.restorations.push({entry: step === 0 ? 'tray' : 'notification', milliseconds: Date.now() - openedAt, background: false, withoutPeriodicReads: true});
    assert.equal(await button.isEnabled(), true);
    await h.page.mouse.move(900, 400);
    const visible = await h.app.evaluate(({BrowserWindow}, url) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url)?.isVisible(), h.page.url());
    for (const theme of visible ? ['light', 'dark'] : []) {
      await h.page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      await h.page.screenshot({path: join(out, `approval-${step + 1}-${theme}.png`)});
    }
    await button.click();
    await until(async () => !(await h.api(`/sessions/${sessionId}/approvals`)).body.approvals?.some(row => row.approvalId === pending.approvalId && row.status === 'pending'));
    report.decisions.push(pending.approvalId);
    // Restart the ordinary production read loop for the next native tool.
    await h.page.evaluate(() => globalThis.approvalTestEffects.startAssistantRefresh());
  }
  await until(() => existsSync(join(project, 'approved.md')));
  assert.equal(readFileSync(join(project, 'approved.md'), 'utf8'), 'FX21 synthetic project file\n');
  await until(async () => (await h.api('/tasks/' + command.commandId)).body.replyEvidence?.status === 'completed');
  const approvals = (await h.api(`/sessions/${sessionId}/approvals`)).body.approvals;
  assert.equal(approvals.length, 2);
  assert.ok(approvals.every(row => row.status === 'resolved' && row.outcome === 'allowed-once'));
  assert.ok(h.requests.some(r => installedSmokeRequestKind(r) === 'project' && r.messages?.some(m => m.role === 'tool' && String(m.content).includes('FX21 synthetic project file'))));
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.stack; process.exitCode = 1;
  report.state = await h?.page.evaluate(() => {
    const core = globalThis.approvalTestCore, bar = document.querySelector('#approval-bar');
    return {visibility: document.visibilityState, background: core?.state.background, transcript: document.querySelector('#transcript')?.innerText,
      bar: bar?.outerHTML, interaction: bar?.decisionInteraction && {pressed: bar.decisionInteraction.pressed, target: bar.decisionInteraction.target?.outerHTML},
      context: core?.approvalContext(), approvals: core && [...core.conversationApprovals.entries.values()], tasks: core && [...core.conversationTasks.entries.values()]};
  }).catch(() => null);
  if (sessionId) report.approvals = (await h.api(`/sessions/${sessionId}/approvals`)).body.approvals;
  await h?.page.screenshot({path: join(out, 'failure.png')}).catch(() => {});
  console.error(error.message);
} finally {
  await h?.close({failed: !report.passed});
  writeFileSync(join(out, 'results.json'), JSON.stringify(report, (_key, value) => typeof value === 'string' ? value.replaceAll(h?.root || '\0', '%FIXTURE%') : value, 2));
}
