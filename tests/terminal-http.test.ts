import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocket } from 'ws';
import { homedir } from 'node:os';
import { terminalService } from './helpers/terminal-service.mjs';

function connection(f, id, after = 0, csrf = f.me.csrfToken) {
  const ws = new WebSocket(f.origin.replace('http:', 'ws:') + `/personal/v1/terminals/${id}/connect`, { headers: f.headers });
  const messages: any[] = []; ws.on('message', data => messages.push(JSON.parse(data.toString())));
  ws.on('open', () => ws.send(JSON.stringify({ type: 'resume', after, csrfToken: csrf })));
  return { ws, messages, wait: (check: (messages: any[]) => boolean) => new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { ws.off('message', read); reject(new Error('websocket output timed out')); }, 12000);
    const read = () => { if (check(messages)) { clearTimeout(timeout); ws.off('message', read); resolve(); } };
    ws.on('message', read); read();
  }) };
}
test('fresh account without a registered project can open a chat terminal in its home directory', { timeout: 20000 }, async () => {
  const f = await terminalService(null, { withWork: false });
  try {
    const result = await f.api('/terminals', 'POST', { conversationId: 'terminal-chat', tabId: 'fresh-tab' });
    assert.equal(result.status, 201, JSON.stringify(result.body)); assert.equal(result.body.cwd, homedir());
  } finally { await f.close(); }
});
test('authenticated host terminal: directories, conversation/tab isolation, cursor reconnect, CSRF and close', { timeout: 40000, skip: process.platform === 'linux' && 'Host project registration supports Windows/macOS' }, async () => {
  const f = await terminalService(); const clients: WebSocket[] = [];
  try {
    const a = await f.api('/terminals', 'POST', { conversationId: 'terminal-chat', tabId: 'tab-chat' });
    assert.equal(a.status, 201, JSON.stringify(a.body)); assert.equal(a.body.cwd, homedir());
    const b = await f.api('/terminals', 'POST', { conversationId: 'terminal-work', tabId: 'tab-work' });
    assert.equal(b.status, 201, JSON.stringify(b.body)); assert.equal(b.body.cwd, f.workDir);
    assert.notEqual(a.body.terminalId, b.body.terminalId);
    assert.equal((await f.api('/terminals', 'POST', { conversationId: 'terminal-chat', tabId: 'tab-chat' })).body.terminalId, a.body.terminalId);
    assert.equal((await f.api('/terminals', 'POST', { conversationId: 'other-conversation', tabId: 'tab' })).status, 404);
    assert.equal((await f.api('/terminals', 'POST', { conversationId: 'terminal-chat', tabId: 'tab', computerId: 'another-computer' })).status, 409);
    assert.equal((await f.api('/terminals', 'POST', { conversationId: 'terminal-chat', tabId: 'bad', cwd: f.workDir })).status, 400);
    assert.equal((await f.api('/terminals', 'POST', { conversationId: 'terminal-chat', tabId: 'bad' }, { 'x-weftmate-csrf': 'invalid' })).status, 403);
    const guestResponse = await fetch(f.origin + '/personal/v1/auth/register', { method: 'POST',
      headers: { origin: f.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'terminal-guest', password: 'synthetic terminal guest password', deviceName: 'guest-browser' }) });
    assert.equal(guestResponse.status, 201);
    const guest = await guestResponse.json();
    const guestTerminal = await f.api('/terminals', 'POST', { conversationId: 'terminal-chat', tabId: 'guest-tab' },
      { cookie: guestResponse.headers.get('set-cookie')!.split(';')[0], 'x-weftmate-csrf': guest.csrfToken });
    assert.equal(guestTerminal.status, 403, 'a shared-chat account is not allowed to use the host terminal');
    const rejected = connection(f, a.body.terminalId, 0, 'wrong'); clients.push(rejected.ws);
    await new Promise(resolve => rejected.ws.once('close', resolve)); assert.deepEqual(rejected.messages, []);
    const c = connection(f, a.body.terminalId); clients.push(c.ws);
    await c.wait(rows => rows.some(e => e.type === 'ready'));
    const command = process.platform === 'win32' ? "Write-Output ('实时' + '中文'); Start-Sleep -Milliseconds 500; Write-Output ('断线' + '输出')\r" : "printf '实时中文\\n'; sleep 1; printf '断线输出\\n'\n";
    c.ws.send(JSON.stringify({ type: 'input', data: command }));
    await c.wait(rows => rows.some(e => e.type === 'output' && e.data.includes('实时中文')));
    const cursor = Math.max(...c.messages.filter(e => e.type === 'output').map(e => e.seq)); c.ws.terminate();
    const reconnected = connection(f, a.body.terminalId, cursor); clients.push(reconnected.ws);
    await reconnected.wait(rows => rows.some(e => e.type === 'output' && e.data.includes('断线输出')));
    assert.ok(reconnected.messages.filter(e => e.type === 'output').every(e => e.seq > cursor));
    assert.equal((await f.api(`/terminals/${a.body.terminalId}`, 'DELETE')).status, 200);
    const closing = connection(f, b.body.terminalId); clients.push(closing.ws);
    await closing.wait(rows => rows.some(e => e.type === 'ready'));
    assert.equal((await f.api(`/terminals/${b.body.terminalId}/release`, 'POST', {releaseToken:'A'.repeat(43)})).status, 403);
    assert.equal((await f.api(`/terminals/${b.body.terminalId}/release`, 'POST', {releaseToken:b.body.releaseToken}, {origin:'https://foreign.example.invalid'})).status, 403);
    await f.service.revokeDevice(f.me.device.id);
    assert.equal((await f.api(`/terminals/${b.body.terminalId}/release`, 'POST', {releaseToken:b.body.releaseToken})).status, 200);
    await closing.wait(rows => rows.some(e => e.type === 'closed'));
    await f.service.close(); // live work shell and all upgraded sockets are drained.
  } finally { for (const ws of clients) ws.terminate(); await f.close(); }
});
