/** CI-R1: synthetic phone over the actual 443 content relay. No daily data or model keys. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { relayFixture, waitFor } from './relay-fixture.mjs';
import { registration, appDevice, control, refresh, proof } from './app-helpers.mjs';
import { createPersonalAccessService } from '../../../src/personal-access/index.mjs';
import { servePersonalAccessUi } from '../../../src/personal-access-ui/index.mjs';
import { phoneRuntime } from './relay-phone-runtime.mjs';

const pause = ms => new Promise(r => setTimeout(r, ms));
test('Relay phone first input and file task', {
  skip: process.env.WEFTMATE_RELAY_E2E !== 'true' && 'Linux full-chain opt-in required', timeout: 330_000,
}, async t => {
  const startedAt = Date.now(), report = { synthetic: true, switches: [], approvals: [], requests: [] }, runtimeLogs = [];
  const evidence = resolve(process.env.WEFTMATE_RELAY_PHONE_REPORT ?? '.local/relay-phone'); await mkdir(evidence, { recursive: true });
  let infra, runtime, host, browser, phone;
  try {
    infra = await relayFixture(t); const { f, root, frpDir, frontPort } = infra;
    assert.equal(frontPort, 443, 'this scenario must exercise the public 443 frontend');
    runtime = await phoneRuntime(root, runtimeLogs);
    host = await createPersonalAccessService({ root: join(root, 'host'), port: 0, backend: runtime.backend, uiHandler: servePersonalAccessUi,
      cloudIdentity: { issuer: f.config.issuer, allowInsecureLoopback: true },
      relay: { binary: join(frpDir, 'frpc'), transportCaFile: join(infra.infra, 'cert.pem'), developmentTls: true,
        connectAddress: '127.0.0.1', connectPort: frontPort, diagnostic: e => runtimeLogs.push(e.message) } });
    runtime.setHost(host); await runtime.start(); const started = await host.start();
    const direct = async (route, body, auth, method = body === undefined ? 'GET' : 'POST', headers = {}) => {
      const response = await fetch(started.origin + '/personal/v1' + route, { method,
        headers: { origin: started.origin, 'content-type': 'application/json', ...(auth ? { cookie: auth.cookie, 'x-weftmate-csrf': auth.csrfToken } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    await registration(f); const desktop = await appDevice(f, 'desktop');
    const nonce = await direct('/auth/cloud-nonce', {});
    const logged = await direct('/auth/cloud-desktop', { accessToken: desktop.tokens.access_token, deviceName: '合成电脑' }, undefined, 'POST',
      { dpop: await proof(desktop, started.origin + '/personal/v1/auth/cloud-desktop', desktop.tokens.access_token, { nonce: nonce.data.nonce }) });
    assert.equal(logged.status, 200, JSON.stringify(logged.data)); const local = { cookie: logged.cookie, csrfToken: logged.data.csrfToken };
    await waitFor(() => host.relayStatus().state === 'online', 'relay not online');
    const base = host.relayStatus().baseUrl, domain = new URL(base).hostname;
    const pairing = await direct('/cloud/pairings', {}, local); assert.equal(pairing.status, 201);
    browser = await chromium.launch({ headless: true, args: ['--no-proxy-server', `--host-resolver-rules=MAP ${domain} 127.0.0.1`,
      `--ignore-certificate-errors-spki-list=${pairing.data.tlsSpki}`] });
    phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    phone.setDefaultTimeout(15_000);
    const routeViolations = [], pageErrors = [];
    phone.on('pageerror', error => pageErrors.push(error.message));
    // Reject any browser escape before dispatch, including a direct host port.
    await phone.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.protocol === 'https:' && url.hostname === domain && (url.port || '443') === '443') return route.continue();
      routeViolations.push({ origin: url.origin, path: url.pathname }); await route.abort();
    });
    phone.on('request', request => {
      const url = new URL(request.url()); report.requests.push({ method: request.method(), origin: url.origin, port: url.port || '443', path: url.pathname });
    });
    phone.on('response', response => {
      const url = new URL(response.url()); if (url.pathname.startsWith('/personal/v1')) (report.responses ??= []).push({ path: url.pathname, status: response.status() });
    });
    phone.on('requestfailed', request => (report.failedRequests ??= []).push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
    await phone.goto(base + '/personal/v1/ui/');
    // Registration, PKCE and DPoP use the real cloud helpers. The host exchange
    // and all subsequent phone content requests go through the browser relay.
    const device = await appDevice(f, 'ci-r1-phone');
    const selected = (await control(device, '/hosts/connect', { hostId: started.hostId })).data;
    assert.equal(selected.approval, 'pending'); await refresh(device, selected.resource);
    const phoneApi = async (route, body, method = body === undefined ? 'GET' : 'POST', headers = {}) => phone.evaluate(async ({ route, body, method, headers }) => {
      const me = await (await fetch('/personal/v1/auth/me')).json();
      const response = await fetch('/personal/v1' + route, { method, headers: { 'content-type': 'application/json', 'x-weftmate-csrf': me.csrfToken ?? '', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    }, { route, body, method, headers });
    const exchange = async () => {
      const nonce = await phoneApi('/auth/cloud-nonce', {});
      return phoneApi('/auth/cloud-session', { accessToken: device.tokens.access_token, deviceName: '合成中继手机' }, 'POST',
        { dpop: await proof(device, base + '/personal/v1/auth/cloud-session', device.tokens.access_token, { nonce: nonce.data.nonce }) });
    };
    const pending = await exchange(); assert.equal(pending.status, 202, JSON.stringify(pending.data));
    assert.equal((await phoneApi('/sessions')).status, 401, 'unapproved device must not see content');
    assert.equal((await direct(`/cloud/devices/${pending.data.requestId}/decision`, { decision: 'allow' }, local)).status, 200);
    assert.equal((await exchange()).status, 200); report.deviceApproval = true;
    // Disable onboarding only via its existing API; no UI or business responses are mocked.
    await phoneApi('/onboarding', { step: 'first', completed: true }, 'PATCH');
    const settle = async command => {
      let result;
      await waitFor(async () => { result = (await phoneApi('/commands/' + command.commandId)).data.command;
        if (['rejected', 'uncertain'].includes(result?.state)) throw new Error(JSON.stringify(result));
        return result?.state === 'accepted_by_dsh'; }, 'command receipt timeout');
      return result;
    };
    const sessions = [];
    for (let i = 0; i < 2; i++) {
      const accepted = await phoneApi('/commands', { requestId: randomUUID(), kind: 'session.create', targetDeviceId: started.hostId, modelProfileId: 'synthetic' });
      assert.equal(accepted.status, 202, JSON.stringify(accepted.data)); const created = await settle(accepted.data.command);
      const title = `合成中继会话 ${i + 1}`;
      assert.equal((await phoneApi(`/sessions/${created.sessionId}/metadata`, { title }, 'PATCH')).status, 200);
      sessions.push({ sessionId: created.sessionId, title });
    }
    await phone.reload(); await phone.locator('#assistant-view').waitFor();
    const draft = phone.locator('#message-text'), send = phone.locator('#send-message');
    let delayed = null;
    await phone.route('**/personal/v1/**/events*', async route => {
      const url = new URL(route.request().url());
      if (delayed && url.pathname.includes(delayed.sessionId) && !url.searchParams.has('afterSeq')) {
        delayed.count++; const response = await route.fetch(); await pause(2000); await route.fulfill({ response });
      } else await route.continue();
    });
    const select = async session => {
      const rail = phone.getByRole('complementary', { name: '会话导航', exact: true });
      if (!await rail.isVisible()) await phone.getByRole('button', { name: '切换会话侧栏', exact: true }).click();
      await phone.locator(`[data-session-id="${session.sessionId}"]`).getByRole('button', { name: session.title, exact: true }).click();
    };
    for (let i = 0; i < 10; i++) {
      const session = sessions[i % 2]; delayed = { sessionId: session.sessionId, count: 0 };
      await select(session);
      assert.equal(await draft.isDisabled(), true, 'history loading must disable first input');
      // Real key events immediately after selection cannot alter a disabled textarea.
      await draft.press('x'); assert.equal(await draft.inputValue(), '', 'loading input must not enter a draft');
      await waitFor(() => draft.isEnabled(), 'composer did not unlock');
      assert.ok(delayed.count > 0, 'the 2s history delay must actually run');
      const text = `CI_R1_FIRST_INPUT_${i}_解锁后第一次输入，中文和 ASCII 全部保留。`;
      await draft.fill(text); await pause(300); assert.equal(await draft.inputValue(), text, 'first input lost characters');
      await waitFor(() => send.isEnabled(), 'first input cannot be sent'); await send.click();
      await waitFor(async () => {
        const events = (await phoneApi(`/sessions/${session.sessionId}/events?limit=100`)).data.events;
        return events.some(e => e.type === 'user.message' && e.data?.text === text) && events.at(-1)?.type === 'turn.ended';
      }, 'first send did not complete');
      const events = (await phoneApi(`/sessions/${session.sessionId}/events?limit=100`)).data.events;
      assert.equal(events.filter(e => e.type === 'user.message' && e.data?.text === text).length, 1, 'first input sent more than once');
      assert.equal(runtime.requests.filter(r => JSON.stringify(r.messages.findLast(m => m.role === 'user')?.content).includes(text)).length, 1, 'model turn duplicated');
      report.switches.push({ iteration: i, sessionId: session.sessionId, historyDelayMs: 2000, delayedRequests: delayed.count, lostCharacters: 0, sends: 1 });
      delayed = null;
    }
    await phone.screenshot({ path: join(evidence, 'first-input.png') });
    const registered = await direct('/projects', { requestId: randomUUID(), name: '合成中继文件项目', rootPath: runtime.project, permission: 'read-write' }, local);
    assert.equal(registered.status, 201, JSON.stringify(registered.data));
    const accepted = await phoneApi(`/projects/${registered.data.project.projectId}/sessions`, { requestId: randomUUID(), modelProfileId: 'synthetic' });
    assert.equal(accepted.status, 202, JSON.stringify(accepted.data)); const created = await settle(accepted.data.command);
    const fileSession = { sessionId: created.sessionId, title: '合成中继文件任务' };
    await phoneApi(`/sessions/${created.sessionId}/metadata`, { title: fileSession.title }, 'PATCH');
    assert.equal((await phoneApi(`/sessions/${created.sessionId}/approval-mode`, { mode: 'ask' }, 'PATCH')).status, 200);
    await phone.reload(); await phone.locator('#assistant-view').waitFor(); await select(fileSession);
    await waitFor(() => draft.isEnabled(), 'file task composer locked');
    await draft.fill('CI_R1_FILE_TASK：在合成项目里读取 input.txt，新建 result.txt，再读回核验内容。'); await send.click();
    const approvedIds = new Set();
    await waitFor(async () => {
      const rows = (await phoneApi(`/sessions/${created.sessionId}/approvals`)).data.approvals ?? [];
      const pending = rows.find(row => row.status === 'pending' && !approvedIds.has(row.approvalId));
      if (pending) {
        const approve = phone.getByRole('button', { name: '批准', exact: true }); await approve.waitFor();
        await phone.screenshot({ path: join(evidence, `approval-${approvedIds.size + 1}.png`) });
        await approve.click(); approvedIds.add(pending.approvalId); report.approvals.push({ approvalId: pending.approvalId, toolName: pending.toolName });
      }
      const events = (await phoneApi(`/sessions/${created.sessionId}/events?limit=100`)).data.events;
      return events.some(e => e.type === 'turn.ended' && e.data?.reason === 'completed');
    }, 'file task did not complete', 90_000);
    assert.ok(approvedIds.size >= 2, 'phone must approve at least twice');
    assert.equal(await runtime.readOutput(), runtime.content);
    const library = (await phoneApi('/library?search=result.txt')).data;
    const item = library.items.find(item => item.name === 'result.txt' || item.fileName === 'result.txt'); assert.ok(item, JSON.stringify(library));
    const preview = (await phoneApi(`/library/${item.id}/preview`)).data;
    assert.ok(JSON.stringify(preview).includes(runtime.content.trim()), 'relay library preview does not match disk readback');
    const taskRequests = runtime.requests.filter(r => JSON.stringify(r.messages.findLast(m => m.role === 'user')?.content).includes('CI_R1_FILE_TASK'));
    assert.equal(taskRequests.length, 4, 'read/write/readback/finish must run once each');
    assert.ok(taskRequests.at(-1).messages.filter(m => m.role === 'tool').some(m => JSON.stringify(m.content).includes(runtime.content.trim())), 'model did not read the native file result');
    assert.deepEqual(routeViolations, []); assert.deepEqual(pageErrors, []);
    assert.ok(report.requests.length > 0); assert.ok(report.requests.every(r => r.origin === base && r.port === '443'));
    report.fileTask = { completed: true, approvals: approvedIds.size, fileContent: runtime.content, libraryId: item.id, modelSteps: taskRequests.length };
    report.relay = { base, port: 443, realHAProxy: true, realFrp: true, tlsAtHost: true, directBrowserRequests: 0 };
    await phone.screenshot({ path: join(evidence, 'file-task-completed.png') }); report.passed = true;
  } catch (error) {
    report.passed = false; report.error = error.stack;
    await phone?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
    if (phone) await writeFile(join(evidence, 'failure-ui.txt'), await phone.locator('body').innerText().catch(() => 'page closed'));
    throw error;
  } finally {
    report.durationMs = Date.now() - startedAt;
    await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2));
    await writeFile(join(evidence, 'proxy.log'), infra?.logs() ?? 'infrastructure startup failed');
    await writeFile(join(evidence, 'runtime.log'), runtimeLogs.join('\n'));
    await browser?.close(); await host?.close(); await runtime?.close();
  }
});
