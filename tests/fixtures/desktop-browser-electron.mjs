import { app, BrowserWindow, WebContentsView, session, Notification } from 'electron';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { servePersonalAccessUi } from '../../src/personal-access-ui/index.mjs';
import { createPersonalDesktop } from '../../src/personal-desktop.mjs';
import { createPersonalBrowserReader } from '../../src/personal-browser/index.mjs';
import { DesktopBrowser } from '../../src/personal-browser/desktop.mjs';

app.setName('WeftMate Browser Test');
app.setAppUserModelId('com.memoweft.weftmate.test.browser');
app.setPath('userData', process.env.BROWSER_TEST_PROFILE);
app.disableHardwareAcceleration();
Notification.isSupported = () => false;
app.whenReady().then(async () => {
let desktop, service, quitting = false;
app.on('before-quit', () => { quitting = true; });
const network = { syntheticFixture: { hostnameSuffix: '.weftmate.invalid', allowedPort: Number(process.env.BROWSER_TEST_PORT) },
  resolver: async hostname => {
    if (!['page-a.weftmate.invalid', 'page-b.weftmate.invalid'].includes(hostname)) throw new Error('unowned test hostname');
    return [{ address: '127.0.0.1', family: 4 }];
  } };
const browser = new DesktopBrowser({ WebContentsView, session, getParent: () => desktop?.window,
  resolveScope: (ownerId, id, allowDeleting) => service.browserScope(ownerId, id, allowDeleting),
  fallbackReader: createPersonalBrowserReader({ BrowserWindow, session, ...network }), ...network });
const sessions = new Set();
const backend = {
  getStatus: async () => ({ runtime: 'ready', referenceScan: 'ready' }),
  listModels: async () => [{ id: 'synthetic', model: 'synthetic', name: '合成模型', configured: true }],
  preflight: async () => ({ ok: true }),
  createSession: async ({ sessionId }) => { sessions.add(sessionId); return { sessionId }; },
  describeSession: async sessionId => sessions.has(sessionId) ? { sessionId, agentPreset: 'personal-remote', modelProfileId: 'synthetic', running: false } : null,
  readEvents: async () => ({ events: [], nextSeq: -1, hasMore: false }),
  sendMessage: async () => ({ accepted: true, receiptId: `receipt-${randomUUID()}` }),
  cancelSession: async () => ({ accepted: true }),
  deleteSession: async ({ sessionId }) => { sessions.delete(sessionId); return { deleted: true }; },
};
service = await createPersonalAccessService({ root: join(process.env.BROWSER_TEST_PROFILE, 'personal-access'), port: 0,
  backend, browserReader: browser, uiHandler: servePersonalAccessUi });
const { origin, hostId } = await service.start();
const grant = await service.issueSetupGrant();
const setup = await fetch(origin + '/personal/v1/auth/setup', { method: 'POST', headers: { origin, 'content-type': 'application/json' },
  body: JSON.stringify({ grant: grant.grant, username: 'BrowserFixture', password: 'synthetic-browser-password-2026', deviceName: '合成浏览器验收' }) });
if (!setup.ok) throw new Error('test setup failed');
const auth = await setup.json(), cookie = setup.headers.get('set-cookie').split(';')[0];
const request = async (path, body, method = body ? 'POST' : 'GET') => {
  const response = await fetch(origin + '/personal/v1' + path, { method, headers: { origin, cookie,
    'content-type': 'application/json', 'x-weftmate-csrf': auth.csrfToken }, body: body ? JSON.stringify(body) : undefined });
  const value = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(value));
  return value;
};
const command = async body => {
  let { command } = await request('/commands', { targetDeviceId: hostId, requestId: 'test-' + randomUUID(), ...body });
  for (let tries = 0; ['pending', 'preflight', 'dispatching'].includes(command.state); tries++) {
    if (tries > 250) throw new Error('fixture command timeout');
    await new Promise(resolve => setTimeout(resolve, 10));
    command = (await request('/commands/' + command.commandId)).command;
  }
  if (command.state !== 'accepted_by_dsh') throw new Error(JSON.stringify(command));
  return command;
};
const a = (await command({ kind: 'session.create', modelProfileId: 'synthetic' })).sessionId;
const b = (await command({ kind: 'session.create', modelProfileId: 'synthetic' })).sessionId;
await session.fromPartition('persist:weftmate-desktop').cookies.set({ url: origin, path: '/personal/v1', name: cookie.split('=')[0], value: cookie.split('=')[1], httpOnly: true });
desktop = createPersonalDesktop({ browserReader: browser, startInTray: true, libraryDesktopToken: service.libraryDesktopToken,
  origin, isQuitting: () => quitting });
await desktop.ready;
desktop.window.setContentSize(1200, 800);
desktop.window.webContents.setBackgroundThrottling(false);
globalThis.browserTest = { browser, desktop, service, ownerId: auth.account.ownerId, a, b, origin, request,
  async agent(sessionId, url) {
    const text = '读取这个网页 ' + url;
    const source = await command({ kind: 'session.message', sessionId, text });
    const input = { sessionId, browserAction: 'open', url, turn: 1,
      receiptId: source.receiptId, callId: 'call-' + randomUUID(), messageHash: createHash('sha256').update(text).digest('hex') };
    globalThis.browserTest.lastInput = input;
    return service.browse(input);
  },
  follow(snapshotId, linkId) {
    return service.browse({ ...globalThis.browserTest.lastInput, browserAction: 'follow', snapshotId, linkId, callId: 'follow-' + randomUUID() });
  },
  async close() { await desktop.close(); await service.close(); desktop.window.destroy(); },
};
}).catch(error => { console.error(error); app.exit(1); });
