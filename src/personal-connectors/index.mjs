import { fork, execFile } from 'node:child_process';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { builtinConnectors } from './builtins.mjs';
import { connectorError, externalConnectorContent } from './policy.mjs';
const invalid = () => { throw Object.assign(new Error('请检查连接器名称、命令或地址。'), { code: 'INVALID_REQUEST', status: 400 }); };
const safeName = name => typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(name);
function redact(value, secrets) {
  if (typeof value === 'string') { for (const secret of secrets) if (secret) value = value.split(secret).join('[已隐藏凭据]'); return value; }
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [redact(key,secrets),redact(item,secrets)]));
  return value;
}

function customConfiguration(input) {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) invalid();
  if (!['stdio','streamable-http'].includes(input.transport)) invalid();
  const config = { name: input.name.trim(), transport: input.transport };
  if (input.transport === 'stdio') {
    if (typeof input.command !== 'string' || !input.command.trim() || input.command.length > 2048 || /\r|\n/.test(input.command)) invalid();
    if (!Array.isArray(input.args ?? []) || (input.args ?? []).some(arg => typeof arg !== 'string' || arg.length > 2048)) invalid();
    config.command = input.command.trim(); config.args = input.args ?? [];
  } else {
    let url; try { url = new URL(input.url); } catch { invalid(); }
    // Authentication belongs to the vault, never URL userinfo/query fragments.
    if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
        url.protocol === 'http:' && !['127.0.0.1','localhost','[::1]'].includes(url.hostname)) invalid();
    config.url = url.href;
  }
  return config;
}

export async function createConnectors({ root, runtime, vault, idleMs = 120000, startupMs = 6000, callMs = 8000, builtins = builtinConnectors() }) {
  const file = join(root, 'connectors.json');
  let state;
  try { state = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = { version: 1, accounts: {} }; }
  if (state.version !== 1 || !state.accounts || Array.isArray(state.accounts)) throw new Error('Connector configuration unreadable');
  const live = new Map(), stopping = new Set(); let closed = false, writes = Promise.resolve();
  const key = (owner, id) => `${owner}/${id}`;
  const rows = owner => Object.values(state.accounts[owner] ?? {});
  const get = (owner, id) => { const row = state.accounts[owner]?.[id]; if (!row) throw Object.assign(new Error('连接器已移除。'), { code: 'NOT_FOUND', status: 404 }); return row; };
  const save = () => {
    const work = writes.catch(() => {}).then(async () => {
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600 }); await rename(temporary, file);
    }); writes = work; return work;
  };
  function stop(entry) {
    if (entry.stopWork) return entry.stopWork;
    entry.stopWork = (async () => {
    entry.stopping = true;
    clearTimeout(entry.idle);
    if (live.get(entry.key) === entry) live.delete(entry.key);
    // Kill while the parent is still alive, so Windows closes the whole tree.
    // SDK disposal alone can orphan descendants of a custom server.
    if (entry.child.exitCode === null) {
      if (process.platform === 'win32') await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(entry.child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, resolve));
      else { try { process.kill(-entry.child.pid, 'SIGKILL'); } catch {} }
      await new Promise(resolve => { if (entry.child.exitCode !== null || entry.child.signalCode) resolve(); else entry.child.once('exit', resolve); });
    }
    for (const pending of entry.pending.values()) pending.reject(Object.assign(new Error('连接器已停止。'), { code: 'CONNECTOR_UNAVAILABLE' }));
    entry.pending.clear();
    })();
    stopping.add(entry.stopWork);
    entry.stopWork.finally(() => stopping.delete(entry.stopWork)).catch(() => {});
    return entry.stopWork;
  }
  function rpc(entry, action, body = {}, timeout = callMs, signal) {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const finish = (error, value) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); entry.pending.delete(id); error ? reject(error) : resolve(value); };
      const abort = () => { if (entry.child.connected) entry.child.send({ action: 'cancel', id }); finish(Object.assign(new Error('已取消操作。'), { code: 'CONNECTOR_CANCELLED' })); };
      const timer = setTimeout(() => { finish(Object.assign(new Error('Connector timeout'), { code: 'CONNECTOR_TIMEOUT' })); void stop(entry); }, timeout);
      entry.pending.set(id, { resolve: value => finish(null, value), reject: error => finish(error) });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) return abort();
      entry.child.send({ id, action, ...body }, error => { if (error) finish(Object.assign(new Error('Connector unavailable'), { code: 'CONNECTOR_UNAVAILABLE' })); });
    });
  }
  function armIdle(entry) {
    clearTimeout(entry.idle);
    entry.idle = setTimeout(() => { if (!entry.calls) void stop(entry); else armIdle(entry); }, idleMs); entry.idle.unref();
  }
  async function start(owner, row, draftSecrets) {
    if (closed || !row.enabled) throw Object.assign(new Error('连接器已停用。'), { code: 'CONNECTOR_UNAVAILABLE' });
    const identity = key(owner, row.id), prior = live.get(identity);
    if (prior) { await prior.ready; return prior; }
    const { scrubbedParentEnv } = await import(pathToFileURL(join(runtime, 'node_modules/@deepseek-ai/dsh-subprocess/lib/index.js')).href);
    // Recheck after import so concurrent calls share exactly one process.
    if (closed || !row.enabled) throw new Error('Connector unavailable');
    if (live.has(identity)) { const entry = live.get(identity); await entry.ready; return entry; }
    const child = fork(join(import.meta.dirname, 'native-worker.mjs'), [], { execPath: process.execPath,
      env: { ...scrubbedParentEnv(), ELECTRON_RUN_AS_NODE: '1' }, execArgv: [], silent: true, windowsHide: true, detached: process.platform !== 'win32' });
    // Custom server stderr is never written to application logs.
    child.stdout.resume(); child.stderr.resume();
    const entry = { child, key: identity, pending: new Map(), calls: 0, tools: [], status: 'starting' }; live.set(identity, entry);
    child.on('message', message => {
      if (message.action === 'tools') {
        entry.tools = message.tools.filter(tool => !Object.values(binding).some(value => value?.length >= 8 && tool.name.includes(value))).map(tool => ({ ...tool,
          network: row.transport === 'streamable-http' || tool.network === true,
          rawName: redact(tool.rawName, Object.values(binding)), description: redact(tool.description, Object.values(binding)), parameters: redact(tool.parameters, Object.values(binding)) }));
        row.tools = entry.tools;
      }
      else if (message.action === 'status') { entry.status = message.status; entry.attempt = Number(message.attempt ?? 0); if (message.status === 'ready') row.problem = undefined; }
      else { const pending = entry.pending.get(message.id); if (pending) message.ok ? pending.resolve(message.result) : pending.reject(Object.assign(new Error(message.error.message), message.error)); }
    });
    child.on('error', () => { entry.status = 'failed'; });
    child.on('exit', () => {
      entry.status = 'failed';
      if (!entry.stopping) row.problem = '连接器进程已退出，请测试连接后重试。';
      for (const pending of [...entry.pending.values()]) pending.reject(Object.assign(new Error('Connector unavailable'), { code: 'CONNECTOR_UNAVAILABLE' }));
      if (live.get(identity) === entry) live.delete(identity);
    });
    const binding = Object.fromEntries((row.slots ?? []).map(slot => [slot, draftSecrets?.[slot] ?? vault.get(owner, row.id, slot)]).filter(([, value]) => value !== null));
    let resolved = row;
    if (row.builtinId) resolved = { ...row, ...builtins.find(item => item.id === row.builtinId).configure(row.fields ?? {}, binding) };
    const config = { ...resolved, serverName: row.id, toolCallTimeoutMs: callMs, failOnStartupError: true,
      reconnect: { enabled: true, initialDelayMs: 250, maxDelayMs: 30000, maxAttempts: 2 },
      env: { ...(resolved.environment ?? {}), ...binding }, headers: binding, cwd: root };
    entry.ready = rpc(entry, 'start', { runtime, config }, startupMs).then(() => {
      entry.status = 'ready'; row.tools = entry.tools; row.problem = undefined; armIdle(entry); return entry;
    }).catch(async error => { row.problem = connectorError(error).message; await stop(entry); throw error; });
    return entry.ready;
  }
  function visible(owner) {
    return rows(owner).map(row => {
      const entry = live.get(key(owner, row.id));
      const tools = row.tools ?? [];
      return { id: row.id, name: row.name, enabled: row.enabled, builtinId: row.builtinId,
        status: !row.enabled ? 'disabled' : entry?.status ?? (row.problem ? 'failed' : 'idle'),
        message: row.problem ?? (entry?.status === 'recovering' ? `连接中断，正在重试（${entry.attempt}/2）。` : entry?.status === 'failed' ? '连接器已停止重试，请测试连接后再使用。' : ''),
        tools: tools.map(({ name, rawName, description, category, network }) => ({ name, rawName, description, category, network })),
        credentials: vault.list(owner, row.id), activeToolCount: Math.min(16, tools.length), totalToolCount: tools.length };
    });
  }
  const manager = {
    list: visible,
    builtins: () => builtins.map(({ id, name, description, fields }) => ({ id, name, description, fields })),
    async test(owner, input) {
      const row = input.id ? get(owner, input.id) : makeDraft(input);
      const draft = { ...row, enabled: true };
      let entry;
      try {
        const previous = live.get(key(owner, row.id)); if (previous) await stop(previous);
        entry = await start(owner, draft, input.credentials);
        if (input.id) { row.tools = entry.tools; row.problem = undefined; await save(); }
        return { ok: true, tools: entry.tools.map(({ name, rawName, description, category }) => ({ name, rawName, description, category })) };
      }
      catch (error) { return { ok: false, ...connectorError(error), tools: [] }; }
      finally { if (entry && (!input.id || !row.enabled)) await stop(entry); }
    },
    async add(owner, input) {
      const row = makeDraft(input), secrets = input.credentials ?? {};
      const entry = await start(owner, row, secrets);
      try {
        for (const [slot, value] of Object.entries(secrets)) vault.save(owner, row.id, slot, value);
        (state.accounts[owner] ??= {})[row.id] = row; await save();
        return visible(owner).find(item => item.id === row.id);
      } catch (error) { vault.removeConnector(owner, row.id); delete state.accounts[owner]?.[row.id]; throw error; }
      finally { await stop(entry); }
    },
    async enable(owner, id, enabled) {
      if (typeof enabled !== 'boolean') invalid();
      const row = get(owner, id); row.enabled = enabled; row.problem = undefined;
      const entry = live.get(key(owner, id)); if (entry) await stop(entry); await save();
    },
    async remove(owner, id) {
      const row = get(owner, id); row.enabled = false;
      const entry = live.get(key(owner, id)); if (entry) await stop(entry);
      vault.removeConnector(owner, id); delete state.accounts[owner][id]; await save(); return (row.tools ?? []).map(tool => tool.name);
    },
    async rotate(owner, id, credentials) {
      const row = get(owner, id); validateCredentials(credentials, true);
      for (const [slot, value] of Object.entries(credentials ?? {})) {
        if (value === null) vault.remove(owner,id,slot); else vault.rotate(owner,id,slot,value);
      }
      row.slots = [...new Set([...row.slots, ...Object.keys(credentials ?? {})])].filter(slot => credentials?.[slot] !== null);
      const entry = live.get(key(owner, id)); if (entry) await stop(entry); await save();
    },
    catalog(owner) {
      const tools = [];
      for (const row of rows(owner)) if (row.enabled) {
        const entry = live.get(key(owner, row.id));
        if (!entry && !row.problem) void start(owner, row).catch(() => {});
        if (!row.problem && !['failed','recovering'].includes(entry?.status)) tools.push(...(row.tools ?? []).slice(0, 16).map(tool => ({ ...tool, connectorId: row.id, connectorName: row.name })));
      }
      return tools;
    },
    async call(owner, id, name, args, signal) {
      const row = get(owner, id);
      if (!row.enabled || !(row.tools ?? []).slice(0, 16).some(tool => tool.name === name)) throw Object.assign(new Error('连接器工具已停用。'), { code: 'CONNECTOR_UNAVAILABLE' });
      const entry = await start(owner, row); entry.calls++; clearTimeout(entry.idle);
      try {
        const result = await rpc(entry, 'call', { name, args }, callMs + 1000, signal);
        // Redact stored values even if a server echoes its own environment.
        const cleaned = redact(result, row.slots.map(slot => vault.get(owner, id, slot)).filter(Boolean));
        return { ...cleaned, content: [{ type: 'text', text: externalConnectorContent(row.name,
          (cleaned.content ?? []).map(block => block.type === 'text' ? block.text : '[非文字内容]').join('\n')) }] };
      } catch (error) { row.problem = connectorError(error).message; throw Object.assign(new Error(row.problem), { code: 'CONNECTOR_UNAVAILABLE' }); }
      finally { entry.calls--; if (live.get(entry.key) === entry) armIdle(entry); }
    },
    async close() { closed = true; const active = [...live.values()].map(stop); await Promise.all([...active, ...stopping]); await writes; },
  };
  function validateCredentials(value = {}, allowRemove = false) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([slot, secret]) => !safeName(slot) || !(allowRemove && secret === null) && (typeof secret !== 'string' || !secret || secret.length > 4096))) invalid();
  }
  function makeDraft(input) {
    validateCredentials(input.credentials);
    let config;
    if (input.builtinId) {
      const builtin = builtins.find(item => item.id === input.builtinId); if (!builtin) invalid();
      const fields = input.fields ?? {};
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).some(name => !builtin.fields.some(field => field.name === name && !field.secret))) invalid();
      const checked = {};
      for (const field of builtin.fields) {
        const value = field.secret ? input.credentials?.[field.name] ?? '' : fields[field.name] ?? field.default ?? '';
        if (field.required && !value || typeof value !== 'string' || value.length > 4096) invalid();
        if (!field.secret) checked[field.name] = value;
      }
      config = { name: builtin.name, builtinId: builtin.id, fields: checked };
    }
    else config = customConfiguration(input);
    const publicText = JSON.stringify(config);
    if (Object.values(input.credentials ?? {}).some(value => value.length >= 8 && (publicText.includes(value) || publicText.includes(JSON.stringify(value).slice(1,-1))))) invalid();
    return { ...config, id: `c_${randomUUID().replaceAll('-','').slice(0,24)}`, enabled: true, slots: Object.keys(input.credentials ?? {}), tools: [] };
  }
  const operations = new Map();
  for (const name of ['test','add','enable','remove','rotate']) {
    const operation = manager[name];
    manager[name] = (owner, ...args) => {
      const prior = operations.get(owner) ?? Promise.resolve();
      const work = prior.catch(() => {}).then(() => { if (closed) throw new Error('Connector manager closed'); return operation(owner,...args); });
      operations.set(owner,work);work.finally(() => {if(operations.get(owner)===work)operations.delete(owner);}).catch(()=>{});return work;
    };
  }
  return manager;
}
