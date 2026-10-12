// The pinned DSH plugin owns the protocol, transports, discovery, execution,
// namespace, schema validation and reconnect budget. This isolated process only
// adapts its registry and captures advisory metadata it currently discards.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { isAbsolute, delimiter } from 'node:path';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { connectorError, classifyConnectorTool } from './policy.mjs';
const definitions = new Map(), metadata = new Map(), disposers = [];
const pending = new Map();
const send = value => { if (process.connected) process.send(value); };
let initialized = false;
let validateOutput;
process.on('message', async message => {
  try {
    if (message.action === 'start' && !initialized) {
      initialized = true;
      if (message.config.transport === 'stdio') {
        const command = message.config.command;
        const paths = isAbsolute(command) ? [command] : (process.env.PATH ?? '').split(delimiter).flatMap(dir =>
          ['', ...(process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [])].map(ext => join(dir, command + ext)));
        if (!paths.some(existsSync)) throw Object.assign(new Error('找不到启动命令，请确认程序已安装，并检查命令。'), { code: 'CONNECTOR_COMMAND_MISSING' });
      }
      const { Client } = await import(pathToFileURL(join(message.runtime, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')).href);
      const originalRequest = Client.prototype.request;
      // Read-only observer; unchanged request, response and error. One SDK and
      // one connection per worker. Covered against the pinned native bridge.
      Client.prototype.request = async function(request, ...options) {
        const result = await originalRequest.call(this, request, ...options);
        if (request.method === 'tools/list') for (const tool of result.tools) metadata.set(tool.name, tool);
        return result;
      };
      const native = await import(pathToFileURL(join(message.runtime, 'node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js')).href);
      const nativeTools = await import(pathToFileURL(join(message.runtime, 'node_modules/@deepseek-ai/dsh-tools/lib/index.js')).href);
      validateOutput = nativeTools.validateJsonSchemaValue;
      const snapshot = () => send({ action: 'tools', tools: [...definitions.values()].map(definition => {
        const publicName = rawName => {
          const joined = `mcp__${message.config.serverName}__${rawName}`, normalized = joined.replace(/[^A-Za-z0-9_-]/g, '_');
          return joined === normalized && joined.length <= 64 ? joined : `${normalized.slice(0,51)}_${createHash('sha256').update(`${message.config.serverName}\0${rawName}`).digest('hex').slice(0,12)}`;
        };
        const raw = [...metadata.values()].find(tool => publicName(tool.name) === definition.name);
        return { name: definition.name, rawName: raw?.name ?? definition.name, description: definition.description.slice(0, 500),
          parameters: definition.parameters, category: classifyConnectorTool(raw ?? definition), network: raw?.annotations?.openWorldHint === true };
      }) });
      const ctx = { root: {}, effect(fn) { disposers.push(fn()); }, tools: { register(definition) {
        nativeTools.assertSupportedJsonSchema(definition.output.schema);
        definitions.set(definition.name, definition); snapshot();
        return () => { definitions.delete(definition.name); snapshot(); };
      } }, logger: Object.fromEntries(['warn','error','info'].map(level => [level, text => {
        // Never forward arbitrary server errors, URLs, headers or child stderr.
        const status = /giving up|reconnect stopped/i.test(text) ? 'failed' : /reconnected/i.test(text) ? 'ready' : /reconnect|retrying/i.test(text) ? 'recovering' : undefined;
        if (status) send({ action: 'status', status, attempt: /attempt (\d+)/.exec(text)?.[1] });
      }])) };
      await native.apply(ctx, message.config);
      snapshot(); send({ id: message.id, ok: true });
    } else if (message.action === 'call') {
      const definition = definitions.get(message.name);
      if (!definition) throw new Error('Connector unavailable');
      const controller = new AbortController(); pending.set(message.id, controller);
      try { const result = await definition.execute(message.args, { signal: controller.signal });
        if (validateOutput(definition.output.schema, result).length) throw new Error('Connector output schema mismatch');
        send({ id: message.id, ok: true, result }); }
      finally { pending.delete(message.id); }
    } else if (message.action === 'cancel') pending.get(message.id)?.abort();
    else if (message.action === 'close') {
      for (const controller of pending.values()) controller.abort();
      await Promise.allSettled(disposers.reverse().map(dispose => dispose?.()));
      send({ id: message.id, ok: true }); process.disconnect();
    }
  } catch (error) { send({ id: message.id, ok: false, error: connectorError(error) }); }
});
process.once('disconnect', () => {
  // The host can terminate without its normal shutdown hook. Keep this worker
  // alive until its server tree is killed; merely exiting can orphan a server
  // that has timers or descendants even after its input pipe closes.
  if (process.platform === 'win32') execFile('taskkill.exe', ['/PID', String(process.pid), '/T', '/F'],
    { windowsHide: true, timeout: 5000 }, () => process.exit(0));
  else { try { process.kill(-process.pid, 'SIGKILL'); } catch { process.exit(0); } }
});
