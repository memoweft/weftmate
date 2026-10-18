// A synthetic readiness gate; production storage and startup remain unchanged.
const { app, safeStorage } = require('electron');
const { pathToFileURL } = require('node:url');
const { join } = require('node:path');
const root = require('node:path').resolve(__dirname, '../..');
app.setAppPath(root);
const available = safeStorage.isEncryptionAvailable.bind(safeStorage);
app.credentialStartupGate = { entered: false, released: false };
safeStorage.isEncryptionAvailable = () => {
  const gate = app.credentialStartupGate;
  if (!gate.released) { gate.entered = true; app.emit('credential-startup-gated'); return false; }
  if (gate.fail) throw Error('synthetic readiness failure');
  return available();
};
const childProcess = require('node:child_process');
const spawn = childProcess.spawn;
const runtimes = [];
childProcess.spawn = function(command, args, options) {
  const child = spawn.call(this, command, args, options);
  if (args?.some(value => String(value).endsWith('weftmate-secure-snapshot-bootstrap.mjs'))) {
    const closed = new Promise(resolve => child.once('close', resolve));
    runtimes.push(closed);
    app.credentialStartupGate.runtimeStarted = true;
    app.emit('credential-startup-runtime');
  }
  return child;
};
require('node:module').syncBuiltinESMExports();
app.credentialStartupGate.waitRuntimeClosed = () => Promise.all(runtimes);
import(pathToFileURL(join(root, 'src/main.mjs')).href).catch(()=>app.exit(75));

app.credentialStartupGate.check = async () => {
  const store=await import(pathToFileURL(join(root,'src/config-store.ts')).href);
  let message;try{store.saveCredential('synthetic-startup','synthetic-startup-key');}catch(error){message=error.message;}
  return {message,written:require('node:fs').existsSync(join(app.getPath('userData'),'weftmate-model.enc'))};
};
