import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const PROTOCOL = 'memoweft.dsh_rpc';
const VERSION = 2;
const SCHEMA = 1;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_PENDING = 32;

const failed = (code) => Object.assign(new Error(code), { code });

/** One official MemoWeft RPC v2 stdio transport for one account. */
export class MemoWeftRpc {
  constructor({ python, pythonPath, env = {}, requestTimeoutMs = 15_000 }) {
    if (typeof python !== 'string' || !python || typeof pythonPath !== 'string' || !pythonPath ||
        !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1_000 || requestTimeoutMs > 60_000) {
      throw failed('MEMORY_CONFIGURATION_INVALID');
    }
    this.python = python;
    this.pythonPath = pythonPath;
    this.env = env;
    this.requestTimeoutMs = requestTimeoutMs;
    this.child = null;
    this.closed = false;
    this.pending = new Map();
    this.buffer = '';
  }

  start() {
    if (this.closed) throw failed('MEMORY_CLOSING');
    if (this.child) return;
    const child = spawn(this.python, ['-m', 'memoweft.integrations.dsh_bridge'], {
      env: { ...process.env, ...this.env, PYTHONPATH: this.pythonPath },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (part) => this.consume(String(part)));
    // RPC stderr may contain private source text. It is never forwarded to HTTP or logs.
    child.stderr.resume();
    child.on('error', () => this.failAll('MEMORY_PROCESS_UNAVAILABLE'));
    child.on('close', () => {
      if (this.child === child) this.child = null;
      this.failAll('MEMORY_PROCESS_UNAVAILABLE');
    });
  }

  consume(part) {
    this.buffer += part;
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_FRAME_BYTES && !this.buffer.includes('\n')) {
      this.failAll('MEMORY_RESPONSE_TOO_LARGE');
      this.child?.kill();
      this.buffer = '';
      return;
    }
    let breakAt;
    while ((breakAt = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, breakAt).replace(/\r$/, '');
      this.buffer = this.buffer.slice(breakAt + 1);
      if (!line) continue;
      if (Buffer.byteLength(line, 'utf8') > MAX_FRAME_BYTES) {
        this.failAll('MEMORY_RESPONSE_TOO_LARGE');
        this.child?.kill();
        return;
      }
      let frame;
      try { frame = JSON.parse(line); } catch { this.failAll('MEMORY_PROTOCOL_ERROR'); this.child?.kill(); return; }
      const entry = this.pending.get(frame?.request_id);
      if (!entry) continue;
      this.pending.delete(frame.request_id);
      clearTimeout(entry.timer);
      if (frame.protocol !== PROTOCOL || frame.protocol_version !== VERSION || frame.schema_version !== SCHEMA) {
        entry.reject(failed('MEMORY_PROTOCOL_ERROR'));
      } else if (frame.ok === true) entry.resolve(frame.result);
      else entry.reject(failed(typeof frame.error?.code === 'string' && /^[a-z_]{2,80}$/.test(frame.error.code)
        ? frame.error.code : 'MEMORY_RPC_ERROR'));
    }
  }

  failAll(code) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(failed(code));
    }
    this.pending.clear();
  }

  request(method, params = {}, timeoutMs = this.requestTimeoutMs) {
    if (this.closed) return Promise.reject(failed('MEMORY_CLOSING'));
    if (!/^[a-z_]{2,80}$/.test(method) || !params || typeof params !== 'object' || Array.isArray(params) ||
        !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
      return Promise.reject(failed('MEMORY_CONFIGURATION_INVALID'));
    }
    if (this.pending.size >= MAX_PENDING) return Promise.reject(failed('MEMORY_BUSY'));
    try { this.start(); } catch { return Promise.reject(failed('MEMORY_PROCESS_UNAVAILABLE')); }
    const requestId = `weftmate-${randomUUID()}`;
    const frame = { protocol: PROTOCOL, protocol_version: VERSION, schema_version: SCHEMA,
      request_id: requestId, method, params };
    const data = `${JSON.stringify(frame)}\n`;
    if (Buffer.byteLength(data, 'utf8') > MAX_FRAME_BYTES) {
      return Promise.reject(failed('MEMORY_REQUEST_TOO_LARGE'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(requestId)) return;
        reject(failed('MEMORY_TIMEOUT'));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try { this.child.stdin.write(data, 'utf8'); }
      catch { clearTimeout(timer); this.pending.delete(requestId); reject(failed('MEMORY_PROCESS_UNAVAILABLE')); }
    });
  }

  async close() {
    if (this.closed) return;
    try { if (this.child) await this.request('shutdown', {}, 3_000); } catch { /* Bounded shutdown. */ }
    this.closed = true;
    const child = this.child;
    if (child) {
      child.kill();
      await Promise.race([new Promise((resolve) => child.once('close', resolve)),
        new Promise((resolve) => setTimeout(resolve, 2_000))]);
    }
    this.child = null;
    this.failAll('MEMORY_CLOSING');
  }
}
