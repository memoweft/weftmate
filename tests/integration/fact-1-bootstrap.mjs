// Isolated baseline entry: memory-only vault and a timing-only DSH preload.
import { app } from 'electron';
import { registerHooks } from 'node:module';
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const repository = resolve(import.meta.dirname, '../..');
app.getAppPath = () => repository;
await import('./fact-1-runtime-preload.mjs');
registerHooks({ load(url, context, nextLoad) {
  if (process.env.WEFTMATE_BASELINE_FORMATION_WAIT_MS && url === pathToFileURL(resolve(repository, 'src/personal-memory/index.mjs')).href) {
    // Explicit fixture configuration reproduces M2f's original formation wait.
    // Product startup continues to use the unchanged default of zero.
    const source = readFileSync(new URL(url), 'utf8').replace('formationWaitMs = 0,',
      'formationWaitMs = Number(process.env.WEFTMATE_BASELINE_FORMATION_WAIT_MS),');
    appendFileSync(process.env.WEFTMATE_BASELINE_TRACE, JSON.stringify({kind:'formation-fixture',
      waitMs:Number(process.env.WEFTMATE_BASELINE_FORMATION_WAIT_MS), at:new Date().toISOString()})+'\n');
    return { format: 'module', source, shortCircuit: true };
  }
  if (url === pathToFileURL(resolve(repository, 'src/personal-memory/rpc.mjs')).href) {
    const source = "import { appendFileSync as appendCoreLog } from 'node:fs';\n" + readFileSync(new URL(url), 'utf8')
      .replace('child.stderr.resume();', `child.stderr.on('data', part => appendCoreLog(process.env.WEFTMATE_BASELINE_TRACE.replace('requests.jsonl', 'core.log'), String(part)));`);
    return { format: 'module', source, shortCircuit: true };
  }
  if (url === pathToFileURL(resolve(repository, 'src/model-scheduler.mjs')).href) {
    const source = "import { appendFileSync as appendSchedulerTrace } from 'node:fs';\nlet traceSerial = 0;\n" + readFileSync(new URL(url), 'utf8')
      .replace('let release;', `let release; const traceId = 'scheduler-' + (++traceSerial), traceStart = Date.now();
        const trace = phase => appendSchedulerTrace(process.env.WEFTMATE_BASELINE_TRACE, JSON.stringify({id:traceId, at:new Date().toISOString(), elapsedMs:Date.now()-traceStart, kind:'scheduler', phase, queue:queue.status()})+'\\n');`)
      .replace("if (match[2] === 'chat/completions') {", "if (match[2] === 'chat/completions') { trace('accepted');")
      .replace("release = await selectedQueue.acquire('background', controller.signal);", "{ trace('queued'); release = await selectedQueue.acquire('background', controller.signal); trace('granted'); }")
      .replace('const upstream = await fetchImpl(endpoint,', "trace('upstream-start'); const upstream = await fetchImpl(endpoint,")
      .replace('response.writeHead(upstream.status,', "trace('upstream-headers'); response.writeHead(upstream.status,")
      .replace('release?.();', "{ release?.(); trace('closed'); }");
    return { format: 'module', source, shortCircuit: true };
  }
  if (url === pathToFileURL(resolve(repository, 'src/config-store.ts')).href) {
    let source = 'const ephemeralKeys = new Map<string, string>();\n' + readFileSync(new URL(url), 'utf8');
    source = source.replace('return readSecrets().credentials[id] ?? null;', 'return ephemeralKeys.get(id) ?? null;')
      .replace('encryptedVault().save(id, apiKey);', 'ephemeralKeys.set(id, apiKey);')
      .replace('encryptedVault().remove(id);', 'ephemeralKeys.delete(id);');
    return { format: 'module-typescript', source, shortCircuit: true };
  }
  if (url === pathToFileURL(resolve(repository, 'src/dsh-web-runtime.ts')).href) {
    const original = process.env.FACT1_PHASE === 'before'
      ? execFileSync('git', ['show', '56f08f58ce447b3e3b7f872de25b5bf62ba9b956:src/dsh-web-runtime.ts'], {cwd:repository,encoding:'utf8',windowsHide:true})
      : readFileSync(new URL(url), 'utf8');
    const source = original.replace('spawn(spec.command, args, {',
      `spawn(spec.command, ['--import', ${JSON.stringify(pathToFileURL(resolve(import.meta.dirname, 'fact-1-runtime-preload.mjs')).href)}, ...args], {`);
    return { format: 'module-typescript', source, shortCircuit: true };
  }
  return nextLoad(url, context);
} });
await import(pathToFileURL(resolve(repository, 'src/main.mjs')).href);
