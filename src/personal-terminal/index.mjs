import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { failure } from '../personal-access/common.mjs';

export function terminalShell() {
  return process.platform === 'win32'
    ? { file: join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      args: ['-NoLogo', '-NoProfile', '-NoExit', '-Command', '[Console]::InputEncoding = [Console]::OutputEncoding = $OutputEncoding = [System.Text.UTF8Encoding]::new()'] }
    : { file: process.env.SHELL || '/bin/sh', args: ['-i'] };
}

export function terminalSize(cols, rows) {
  if (!Number.isInteger(cols) || cols < 2 || cols > 500 || !Number.isInteger(rows) || rows < 1 || rows > 300)
    throw failure('INVALID_REQUEST');
  return { cols, rows };
}

/** A panel owns its shell; transport subscriptions never own the process. */
export function createTerminalManager({ shell = terminalShell(), maxBufferBytes = 2 * 1024 * 1024 } = {}) {
  const terminals = new Map();
  let closing = false;
  const project = t => ({ terminalId: t.id, conversationId: t.conversationId, tabId: t.tabId,
    cwd: t.cwd, cols: t.cols, rows: t.rows, state: t.exited ? 'exited' : 'running', exitCode: t.exitCode ?? null });
  function get(ownerId, deviceId, id) {
    const t = terminals.get(id);
    if (!t || t.ownerId !== ownerId || t.deviceId !== deviceId) throw failure('NOT_FOUND', 404);
    return t;
  }
  function emit(t, event) { for (const notify of [...t.listeners]) notify(event); }
  async function destroy(t) {
    if (t.destroying) return t.destroying;
    t.destroying = (async () => {
      // The worker and its descendants are this terminal's owned process tree.
      if (t.process.exitCode === null && process.platform === 'win32') await new Promise(resolve => {
        execFile('taskkill.exe', ['/PID', String(t.process.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => resolve());
      });
      if (t.process.exitCode === null && process.platform !== 'win32') {
        if (t.shellPid) { try { process.kill(-t.shellPid, 'SIGKILL'); } catch { /* Already exited. */ } }
        t.process.kill('SIGKILL');
      }
      await t.exit;
      emit(t, { type: 'closed' });
      t.listeners.clear();
      terminals.delete(t.id);
    })();
    return t.destroying;
  }
  return {
    async create({ ownerId, deviceId, conversationId, tabId, cwd, cols = 80, rows = 24 }) {
      if (closing) throw failure('SERVICE_CLOSING', 503);
      terminalSize(cols, rows);
      const prior = [...terminals.values()].find(t => t.ownerId === ownerId && t.deviceId === deviceId &&
        t.conversationId === conversationId && t.tabId === tabId);
      if (prior) { await prior.started; return { ...project(prior), releaseToken: prior.releaseToken }; }
      if ([...terminals.values()].filter(t => t.ownerId === ownerId).length >= 24) throw failure('SESSION_BUSY', 409);
      // Do not put host model/connector credentials in a user shell's environment.
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        !/(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|ELECTRON_RUN_AS_NODE|NODE_OPTIONS)/i.test(key)));
      const processHandle = fork(fileURLToPath(new URL('./worker.mjs', import.meta.url)), [], {
        execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      });
      processHandle.stderr.resume();
      let resolveExit, resolveStarted, rejectStarted;
      const t = { id: `terminal-${randomUUID()}`, ownerId, deviceId, conversationId, tabId, cwd, cols, rows,
        releaseToken: randomBytes(32).toString('base64url'),
        process: processHandle, listeners: new Set(), chunks: [], bytes: 0, seq: 0, exited: false,
        exit: new Promise(resolve => { resolveExit = resolve; }),
        started: new Promise((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject; }) };
      processHandle.on('message', message => {
        if (message.type === 'started') { t.shellPid = message.pid; resolveStarted(); return; }
        if (message.type === 'failed') { rejectStarted(failure('BACKEND_UNAVAILABLE', 503)); return; }
        if (message.type === 'exit') { t.exited = true; t.exitCode = message.exitCode; emit(t, message); return; }
        const event = { type: 'output', seq: ++t.seq, data: message.data };
        t.chunks.push(event); t.bytes += Buffer.byteLength(message.data);
        while (t.bytes > maxBufferBytes && t.chunks.length > 1) t.bytes -= Buffer.byteLength(t.chunks.shift().data);
        emit(t, event);
      });
      processHandle.on('exit', exitCode => {
        rejectStarted(failure('BACKEND_UNAVAILABLE', 503));
        if (!t.exited) { t.exited = true; t.exitCode = exitCode; emit(t, { type: 'exit', exitCode }); }
        resolveExit();
      });
      processHandle.on('error', () => { rejectStarted(failure('BACKEND_UNAVAILABLE', 503)); if (!processHandle.pid) resolveExit(); });
      terminals.set(t.id, t);
      processHandle.send({ type: 'start', shell, cwd, cols, rows,
        env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } });
      const deadline = setTimeout(() => rejectStarted(failure('BACKEND_UNAVAILABLE', 503)), 10000);
      try { await t.started; } catch (error) { await destroy(t); throw error; } finally { clearTimeout(deadline); }
      return { ...project(t), releaseToken: t.releaseToken };
    },
    info(ownerId, deviceId, id) { return project(get(ownerId, deviceId, id)); },
    subscribe(ownerId, deviceId, id, after, notify) {
      const t = get(ownerId, deviceId, id);
      if (!Number.isSafeInteger(after) || after < 0 || after > t.seq) throw failure('INVALID_REQUEST');
      const first = t.chunks[0]?.seq ?? 1;
      if (after < first - 1) notify({ type: 'gap', firstSeq: first });
      for (const chunk of t.chunks) if (chunk.seq > after) notify(chunk);
      notify({ type: 'ready', ...project(t), cursor: t.seq });
      t.listeners.add(notify);
      return () => t.listeners.delete(notify);
    },
    input(ownerId, deviceId, id, data) {
      const t = get(ownerId, deviceId, id);
      if (typeof data !== 'string' || Buffer.byteLength(data) > 64 * 1024) throw failure('INVALID_REQUEST');
      if (t.exited || t.destroying) throw failure('SESSION_BUSY', 409);
      t.process.send({ type: 'input', data });
    },
    resize(ownerId, deviceId, id, cols, rows) {
      const t = get(ownerId, deviceId, id); terminalSize(cols, rows);
      if (!t.exited && !t.destroying) t.process.send({ type: 'resize', cols, rows });
      Object.assign(t, { cols, rows });
    },
    destroy(ownerId, deviceId, id) { return destroy(get(ownerId, deviceId, id)); },
    async release(id, token) {
      const t = terminals.get(id);
      if (!t) return;
      if (!timingSafeEqual(Buffer.from(token), Buffer.from(t.releaseToken))) throw failure('FORBIDDEN', 403);
      await destroy(t);
    },
    async close() { closing = true; await Promise.all([...terminals.values()].map(destroy)); },
  };
}
