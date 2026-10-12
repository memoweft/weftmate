// Real Electron only. Fault injection stays in this synthetic test process.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { syncBuiltinESMExports } = require('node:module');
const [profile, action, timing, moduleFile] = process.argv.slice(2);
app.setPath('userData', profile);
app.setPath('sessionData', profile);
fs.mkdirSync(join(profile, 'Crashpad'), { recursive: true });
app.setPath('crashDumps', join(profile, 'Crashpad'));
const metadata = () => Object.fromEntries(['Local State', 'weftmate-storage-key.json', 'weftmate-model.enc', ...fs.readdirSync(profile).filter(name=>name.startsWith('weftmate-model.enc.') && name.endsWith('.tmp'))].map(name => {
  try { const s = fs.statSync(join(profile, name)); return [name, { exists: true, bytes: s.size, modifiedAt: s.mtime.toISOString(), ...(name === 'Local State' ? { masterKeyPresent: !!JSON.parse(fs.readFileSync(join(profile,name),'utf8')).os_crypt?.encrypted_key } : {}) }]; }
  catch { return [name, { exists: false }]; }
}));
function checkpoint(stage) {
  process.stdout.write(JSON.stringify({ stage, files: metadata() })+'\n');
  if (stage !== timing) return;
  if (action === 'crash') process.crash();
  if (action === 'power-cut') process.reallyExit(73); // Electron defers process.exit; bypass it and all shutdown/flush callbacks.
  if (action === 'kill') { for (;;) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); } }
}
const originalWrite = fs.writeFileSync, originalRename = fs.renameSync;
fs.writeFileSync = function(file, ...args) {
  if (action === 'power-cut' && String(file).includes('weftmate-model.enc') && args[1]?.flush) args[1] = { ...args[1], flush: false };
  const result = originalWrite.call(this, file, ...args);
  if (String(file).includes('weftmate-model.enc') && String(file).endsWith('.tmp')) checkpoint('during');
  return result;
};
fs.renameSync = function(from, to) {
  const result = originalRename.call(this, from, to);
  if (String(to).endsWith('weftmate-model.enc')) checkpoint('after');
  return result;
};
syncBuiltinESMExports();

app.whenReady().then(async () => {
  const store = await import(pathToFileURL(moduleFile).href);
  if (action === 'read') {
    let readable = false;
    let revision=null;
    let readError=null;
    try { if(store.initializeCredentialStorage) await store.initializeCredentialStorage(); store.preflightVault(); const key=store.getCredential('synthetic-model'); revision=key==='synthetic-rob1-old-key'?'old':key==='synthetic-rob1-key'?'new':null; readable=!!revision; } catch(error) {readError={name:error?.name||'Error',code:error?.code||null};}
    process.stdout.write(JSON.stringify({ stage:'read', readable, revision, readError, files:metadata() })+'\n');
    app.quit(); return;
  }
  if (action === 'refill') { await store.initializeCredentialStorage(); store.saveSubmittedCredential('synthetic-model','synthetic-rob1-key'); app.quit(); return; }
  checkpoint('before');
  if (store.initializeCredentialStorage) await store.initializeCredentialStorage();
  store.saveCredential('synthetic-model', action==='normal'?'synthetic-rob1-old-key':'synthetic-rob1-key');
  if (action === 'normal') app.quit();
}).catch(error => { process.stdout.write(JSON.stringify({stage:'fixture-failure',name:error?.name||'Error',code:error?.code||null})+'\n'); app.exit(74); });
