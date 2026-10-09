// Test-only launch seams: volatile keys, request measurements, sustained Core outage.
// All memory formation/recall/deletion and the desktop host remain production code.
import { app, dialog } from 'electron';
import { registerHooks } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
const repository = resolve(import.meta.dirname, '../..');
app.getAppPath = () => repository;
if (process.env.WEFTMATE_BASELINE_TRACE) {
  const directory = join(dirname(process.env.WEFTMATE_BASELINE_TRACE), 'downloads');
  mkdirSync(directory, {recursive:true});
  dialog.showSaveDialog = async (_window, options) => ({canceled:false,filePath:join(directory,basename(options.defaultPath))});
}
globalThis.m2ExitKeys = new Map();
globalThis.m2ExitRpcs = new Set();
globalThis.m2ExitFault = false;
globalThis.m2ExitSeedCredentials = async credentials => {
  const settings = await import('../../src/settings.ts');
  const vault = await import('../../src/config-store.ts');
  const routes = await import('../../src/harness-model-routes.ts');
  const official = await import('../../src/dsh-settings-migration.ts');
  for (const model of settings.listModelProfiles().profiles) {
    const key = credentials[model.name];
    if (key) vault.saveCredential(official.officialCredentialRef(routes.routeForProfile(model.id).provider), key);
  }
};
globalThis.m2ExitRestoreCore = () => { globalThis.m2ExitFault = false; };
globalThis.m2ExitBreakCore = () => {
  globalThis.m2ExitFault = true;
  return [...globalThis.m2ExitRpcs].filter(rpc => rpc.child).map(rpc => {
    const pid = rpc.child.pid;
    rpc.child.kill();
    return pid;
  });
};
await import('./baseline-request-trace.mjs');
registerHooks({ load(url, context, nextLoad) {
  const file = name => pathToFileURL(resolve(repository, name)).href;
  if (process.env.WEFTMATE_BASELINE_RECALL_TRACE && url === file('src/personal-memory/index.mjs')) {
    const source = "import { appendFileSync as trackRecall } from 'node:fs';\n" + readFileSync(new URL(url), 'utf8')
      .replace("const contextText = fragments.join('\\n\\n').slice(0, recallMaxChars);",
        "const contextText = fragments.join('\\n\\n').slice(0, recallMaxChars); trackRecall(process.env.WEFTMATE_BASELINE_RECALL_TRACE, JSON.stringify({query,sessionId,recallMaxItems,recallMaxChars,world,style,identity,interaction,contextText,memories})+'\\n');");
    return { format: 'module', source, shortCircuit: true };
  }
  if (url === file('src/config-store.ts')) {
    const source = readFileSync(new URL(url), 'utf8')
      .replace('return readSecrets().credentials[id] ?? null;', 'return globalThis.m2ExitKeys.get(id) ?? null;')
      .replace('encryptedVault().save(id, apiKey);', 'globalThis.m2ExitKeys.set(id, apiKey);')
      .replace('encryptedVault().remove(id);', 'globalThis.m2ExitKeys.delete(id);');
    return { format: 'module-typescript', source, shortCircuit: true };
  }
  if (url === file('src/personal-memory/rpc.mjs')) {
    const source = "import { appendFileSync as trackCoreProcess } from 'node:fs';\n" + readFileSync(new URL(url), 'utf8')
      .replace('this.python = python;', 'this.python = python; globalThis.m2ExitRpcs.add(this);')
      .replace('start() {', "start() { if (globalThis.m2ExitFault) throw failed('MEMORY_PROCESS_UNAVAILABLE');")
      .replace('this.child = child;', "this.child = child; trackCoreProcess(process.env.WEFTMATE_BASELINE_TRACE, JSON.stringify({kind:'core-process',pid:child.pid,at:new Date().toISOString()})+'\\n');");
    return { format: 'module', source, shortCircuit: true };
  }
  if (url === file('src/dsh-web-runtime.ts')) {
    const source = readFileSync(new URL(url), 'utf8').replace('spawn(spec.command, args, {',
      `spawn(spec.command, ['--import', ${JSON.stringify(file('tests/integration/baseline-request-trace.mjs'))}, ...args], {`);
    return { format: 'module-typescript', source, shortCircuit: true };
  }
  if (url === file('src/personal-access/http.mjs')) {
    const source = "import { appendFileSync as trackExitHttpError } from 'node:fs';\n" + readFileSync(new URL(url), 'utf8')
      .replace('if (response.headersSent) return response.destroy();',
        "trackExitHttpError(process.env.WEFTMATE_BASELINE_TRACE, JSON.stringify({kind:'http-error',at:new Date().toISOString(),path:new URL(request.url,'http://127.0.0.1').pathname,code:error?.code??null,name:error?.name,stackFrames:String(error?.stack??'').split('\\n').slice(1,5)})+'\\n'); if (response.headersSent) return response.destroy();");
    return { format: 'module', source, shortCircuit: true };
  }
  return nextLoad(url, context);
} });
await import(pathToFileURL(resolve(repository, 'src/main.mjs')).href);
