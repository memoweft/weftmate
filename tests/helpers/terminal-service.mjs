import { createPersonalAccessService } from '../../src/personal-access/index.mjs';
import { servePersonalAccessUi } from '../../src/personal-access-ui/index.mjs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectProjectRoot } from '../../src/personal-projects/index.mjs';

export async function terminalService(root = null, { panelHarness = false, withWork = true } = {}) {
  root ??= await mkdtemp(join(tmpdir(), 'weftmate-terminal-service-'));
  const workDir = join(root, 'synthetic-project'); await mkdir(workDir, { recursive: true });
  const backend = { getStatus: async () => ({ runtime: 'ready' }), listModels: async () => [],
    preflight: async () => ({ ok: true }), createSession: async () => ({}), sendMessage: async () => ({}), cancelSession: async () => ({}),
    describeSession: async sessionId => ({ sessionId, title: '合成终端对话' }),
    readEvents: async () => ({ events: [], nextSeq: -1, hasMore: false }) };
  const uiHandler = (request, response) => panelHarness && ['/personal/v1/ui', '/personal/v1/ui/'].includes(request.url)
    ? servePersonalAccessUi(request, {
      writeHead(status, headers) { const copy = { ...headers }; delete copy['content-length']; response.writeHead(status, copy); },
      end(body) { const nonce = body.toString().match(/name="weft-style-nonce" content="([^"]+)"/)[1]; response.end(`<!doctype html><html lang="zh-CN"><head><meta name="weft-style-nonce" content="${nonce}"><link rel="stylesheet" href="/personal/v1/ui/tokens.css"><script defer src="/personal/v1/ui/panels/terminal.js"></script></head><body></body></html>`); },
    }) : servePersonalAccessUi(request, response);
  let service = await createPersonalAccessService({ root, port: 0, backend, uiHandler });
  await service.attachSession('terminal-chat'); await service.attachSession('terminal-work');
  // Seed only synthetic work metadata; all terminal requests below use the real
  // authentication, account store, HTTP dispatcher, WebSocket and native PTY.
  await service.close();
  const file = join(root, 'store.json'), state = JSON.parse(await readFile(file, 'utf8'));
  const owner = state.accounts[state.legacyOwnerId], at = new Date().toISOString();
  if (withWork) {
  owner.projects ??= {};
  owner.projects['terminal-project'] = { projectId: 'terminal-project', ownerId: state.legacyOwnerId,
    name: '合成项目', ...await inspectProjectRoot(workDir), revision: 1, revoked: false,
    fileSecret: 'a'.repeat(64), files: {}, createdAt: at, updatedAt: at, permission: 'write', instructions: '' };
  Object.assign(owner.sessions['terminal-work'], { origin: 'personal-remote', modelProfileId: 'synthetic-terminal', mode: 'work', workHostId: state.hostId, projectId: 'terminal-project', projectRevision: 1 });
  }
  await writeFile(file, JSON.stringify(state));
  service = await createPersonalAccessService({ root, port: 0, backend, uiHandler });
  const { origin } = await service.start();
  const native = { origin, 'x-weftmate-desktop': service.libraryDesktopToken };
  const response = await fetch(origin + '/personal/v1/auth/desktop', { method: 'POST', headers: { ...native, 'content-type': 'application/json' }, body: '{}' });
  if (!response.ok) throw new Error(`Synthetic desktop login failed: ${response.status}`);
  const me = await response.json(), cookie = response.headers.get('set-cookie').split(';')[0];
  const headers = { ...native, cookie, 'x-weftmate-csrf': me.csrfToken };
  const api = async (path, method = 'GET', body, overrides = {}) => {
    const response = await fetch(origin + '/personal/v1' + path, { method,
      headers: { ...headers, 'content-type': 'application/json', ...overrides },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  return { service, root, origin, workDir, headers, me, cookie, api,
    async close() { await service.close(); await rm(root, { recursive: true, force: true }); } };
}
