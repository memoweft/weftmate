/** Bounded loopback acceptance controller. Mailbox and codes remain in memory. */
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createControlAccess } from '../control-access.mjs';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const repo = resolve(import.meta.dirname, '../../..');
const evidence = resolve(process.argv[2]);
const locks = resolve(process.argv[3]);
const phoneOnly = process.argv.includes('--phone-only');
let app, page, lock, controlServer, reply, email = '', code = '', closed = false;
const password = 'B2-' + randomBytes(24).toString('base64url') + '!a9';
const secrets = new Set([password, process.env.MIMO_API_KEY].filter(Boolean));
const controlAccess = createControlAccess();
secrets.add(controlAccess.token);
const owner = 'R-B2 cloud source ' + new Date().toISOString();
const redact = value => {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of secrets) text = text.replaceAll(secret, '[redacted]');
  return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[address]').replace(/\b\d{6}\b/g, '[code]');
};
for (const stream of [process.stdout, process.stderr]) stream.on('error', () => {});
const emit = value => { const output = redact(value); if (!process.stdout.destroyed) process.stdout.write(output + '\n'); if (reply) { reply.end(output); reply = null; } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, ms = 45000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const result = await check(); if (result) return result; await delay(150); }
  throw Error('ConditionTimeout');
}
async function save(name, value) { await writeFile(join(evidence, name), redact(value)); }
async function phone(request) {
  const session = JSON.parse(await readFile(join(evidence, 'session.json'), 'utf8'));
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: session.forwardPort });
    socket.setTimeout(65000); let buffer = '';
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'));
    socket.on('data', data => { buffer += data; if (buffer.includes('\n')) { socket.end(); const response = JSON.parse(buffer.split('\n')[0]); response.ok ? resolve(response.result) : reject(Error(response.error)); } });
    socket.on('error', reject); socket.on('timeout', () => { socket.destroy(); reject(Error('PhoneTimeout')); });
  });
}
async function web(script) {
  let value = (await phone({ action: 'web', script })).value;
  for (let i = 0; i < 2; i++) { try { value = JSON.parse(value); } catch { break; } }
  return value;
}
async function close() {
  if (closed) return; closed = true; clearTimeout(timer);
  const child = app?.process(); let closeTimer;
  try { await Promise.race([app?.close(), new Promise((_, reject) => { closeTimer = setTimeout(() => reject(Error('CloseDeadline')), 15000); })]); }
  catch {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
      else child.kill('SIGKILL');
    }
  } finally { clearTimeout(closeTimer); }
  controlServer?.close();
  if (lock && await readFile(lock, 'utf8').catch(() => '') === owner) await unlink(lock);
}
const timer = setTimeout(async () => { emit({ deadline: true }); await close(); process.exit(0); }, 26 * 60000);
try {
  await mkdir(evidence, { recursive: true });
  if (!phoneOnly) {
  for (let i = 1; i <= 3; i++) {
    const candidate = join(locks, `heavy-${i}.lock`);
    try { const fd = await open(candidate, 'wx'); await fd.writeFile(owner); await fd.close(); lock = candidate; break; } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  if (!lock) throw Error('NoHeavySlot');
  const profile = join(evidence, 'desktop-profile');
  await mkdir(profile, { recursive: true });
  await mkdir(join(evidence, 'work'), { recursive: true });
  await writeFile(join(profile, '.weftmate-personal-host-profile.json'), JSON.stringify({ schemaVersion: 1, purpose: 'isolated-personal-host' }));
  const env = { ...process.env, WEFTMATE_USER_DATA: profile, WEFTMATE_DOGFOOD_CONTROL: '1',
    WEFTMATE_CLOUD_ISSUER: 'https://api.weftmate.com/personal/v1/cloud/oidc',
    WEFTMATE_CLOUD_DESKTOP_CLIENT_ID: 'weftmate-desktop', WEFTMATE_CLOUD_WEB_CLIENT_ID: 'weftmate-desktop',
    WEFTMATE_CLOUD_DESKTOP_REDIRECT_URI: 'http://127.0.0.1:18186/personal/v1/ui/',
    WEFTMATE_RELAY_ENABLED: 'true', WEFTMATE_RELAY_ACME_ENABLED: 'true',
    WEFTMATE_ACME_DIRECTORY_URL: 'https://acme-v02.api.letsencrypt.org/directory', WEFTMATE_TEST_HOST_NAME: 'B2 cloud synthetic desktop' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: require('electron'), cwd: repo,
    args: ['.', '--personal-host', '--start-in-tray', `--user-data-dir=${profile}`, '--access-port=0', `--workspace-dir=${join(evidence, 'work')}`], env, timeout: 90000 });
  app.process().stdout?.on('data', data => { void save('desktop-last-output.txt', data.toString()); });
  app.process().stderr?.on('data', () => {});
  page = await app.firstWindow(); page.setDefaultTimeout(12000);
  await page.waitForURL('**/personal/v1/ui*', { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.hide(); });
  }
  let queue = Promise.resolve();
  controlServer = createServer((request, response) => {
    if (!controlAccess.authorize(request, response)) return;
    if (request.method !== 'POST' || request.url !== '/') { response.writeHead(404).end(); return; }
    let line = ''; request.setEncoding('utf8'); request.on('data', data => { line += data; });
    request.on('end', () => { queue = queue.then(async () => {
    reply = response; response.setHeader('content-type', 'application/json');
    let id;
    try {
      const request = JSON.parse(line); id = request.id;
      if (request.op === 'email') { email = request.value; secrets.add(email); emit({ id, emailReady: true }); return; }
      if (request.op === 'code') { code = request.value; secrets.add(code); emit({ id, codeReady: /^\d{6}$/.test(code) }); return; }
      if (request.op === 'close') { await close(); emit({ id, closed: true }); return; }
      if (request.op !== 'run') throw Error('UnknownOperation');
      const execute = new Function('page', 'app', 'phone', 'web', 'email', 'code', 'password', 'save', 'until', 'delay', 'evidence', 'apiKey', `return (async()=>{${request.script}\n})()`);
      let actionTimer;
      const result = await Promise.race([execute(page, app, phone, web, email, code, password, save, until, delay, evidence, process.env.MIMO_API_KEY), new Promise((_, reject) => { actionTimer = setTimeout(() => reject(Error('ActionDeadline')), 180000); })]).finally(() => clearTimeout(actionTimer));
      emit({ id, result });
    } catch (error) { emit({ id, error: error.name, message: error.message }); }
  }); }); });
  await new Promise(resolve => controlServer.listen(0, '127.0.0.1', resolve));
  const controlPort = controlServer.address().port;
  await controlAccess.publish(join(evidence, phoneOnly ? 'cloud-control-phone.json' : 'cloud-control.json'), { controlPort, pid: process.pid });
  emit({ ready: true, sourceDesktop: !phoneOnly, port: page ? new URL(page.url()).port : null, controlPort, hidden: true });
} catch (error) { emit({ startupError: error.message }); await close(); process.exitCode = 1; }
