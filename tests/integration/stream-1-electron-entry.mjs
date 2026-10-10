import { app, safeStorage } from 'electron';
import { pathToFileURL } from 'node:url';
app.getAppPath=()=>process.cwd();
if(process.env.STREAM1_MIMO_KEY){
 const decrypt=safeStorage.decryptString,encrypt=safeStorage.encryptString;
 safeStorage.decryptString=bytes=>decrypt.call(safeStorage,bytes).replaceAll('synthetic-not-provider-key',process.env.STREAM1_MIMO_KEY);
 safeStorage.encryptString=text=>encrypt.call(safeStorage,text.replaceAll(process.env.STREAM1_MIMO_KEY,'synthetic-not-provider-key'));
}
await import('./stream-1-wire-hook.mjs');
process.env.NODE_OPTIONS='--import='+pathToFileURL(process.env.STREAM1_HOOK).href;
await import('../../src/main.mjs');
