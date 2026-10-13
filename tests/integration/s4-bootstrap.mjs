// Production main and durable system vault. Only test dialogs/relaunch/network conditions differ.
import { app, dialog } from 'electron';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = resolve(import.meta.dirname, '../..');
app.getAppPath = () => repo;
app.relaunch = () => {};
dialog.showSaveDialog = async (_window, options) => {
  if (options?.title !== '保存恢复码' || !process.env.WEFTMATE_S4_FIXTURE_ROOT) throw Error('S4 fixture forbids unexpected native save dialogs');
  return { canceled: false, filePath: resolve(process.env.WEFTMATE_S4_FIXTURE_ROOT, 'synthetic-recovery-code.txt') };
};
dialog.showOpenDialog = async () => { throw Error('S4 fixture forbids native open dialogs'); };
dialog.showMessageBox = async () => { throw Error('S4 fixture forbids native message dialogs'); };
dialog.showMessageBoxSync = () => { throw Error('S4 fixture forbids native message dialogs'); };
process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
globalThis.s4SyntheticModelCredential = async () => {
  const vault = await import('../../src/config-store.ts');
  return vault.listCredentialIds().map(id => vault.getCredential(id)).find(value => value?.startsWith('S4_SYNTHETIC_SAVED_MODEL_KEY_'));
};
globalThis.s4CredentialMatches = async expected => {
  const vault = await import('../../src/config-store.ts');
  return vault.listCredentialIds().some(id => vault.getCredential(id) === expected);
};
registerHooks({ load(url, context, next) {
  if (url === pathToFileURL(resolve(repo, 'src/runtime/dsh-adapter/snapshot-files.mjs')).href && process.env.WEFTMATE_S4_DIAGNOSTICS) {
    const source = readFileSync(new URL(url), 'utf8').replace('readSync(input, bytes)', "(()=>{try{return readSync(input,bytes);}catch(error){error.message+=' source='+source;error.path=source;throw error;}})()");
    return { format: 'module', source, shortCircuit: true };
  }
  if (url === pathToFileURL(resolve(repo, 'src/personal-cloud-backup/index.mjs')).href && process.env.WEFTMATE_S4_DIAGNOSTICS) {
    const source = "import { appendFileSync as s4DiagnosticWrite } from 'node:fs';\n" + readFileSync(new URL(url), 'utf8')
      .replace('}catch(e){state.status=', "}catch(e){s4DiagnosticWrite(process.env.WEFTMATE_S4_DIAGNOSTICS,JSON.stringify({code:e.code,message:e.message,stack:e.stack}).replace(/([A-Z]:[\\\\/]+Users[\\\\/]+)[^\\\\/\\s]+/gi,'$1<user>')+'\\n');state.status=");
    return { format: 'module', source, shortCircuit: true };
  }
  if (url === pathToFileURL(resolve(repo, 'src/main.mjs')).href) {
    const source = readFileSync(new URL(url), 'utf8');
    const original = 'canUpload:()=>privateNetworkOnPower(powerMonitor),';
    if (!source.includes(original)) throw Error('S4 upload-condition fixture no longer matches production');
    return { format: 'module', source: source.replace(original, 'canUpload:async()=>true,'), shortCircuit: true };
  }
  return next(url, context);
} });
await import(pathToFileURL(resolve(repo, 'src/main.mjs')).href);
