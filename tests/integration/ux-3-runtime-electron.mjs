import { app, safeStorage } from 'electron';
const decrypt = safeStorage.decryptString, encrypt = safeStorage.encryptString;
safeStorage.decryptString = bytes => decrypt.call(safeStorage,bytes).replaceAll('synthetic-not-provider-key',process.env.UX3_MIMO_KEY);
safeStorage.encryptString = text => encrypt.call(safeStorage,text.replaceAll(process.env.UX3_MIMO_KEY,'synthetic-not-provider-key'));
app.getAppPath = () => process.cwd();
/** Isolated production entry. Actual provider key exists only in this process's environment. */
const originalFetch = globalThis.fetch;
globalThis.ux3Wire = [];
globalThis.fetch = async (url, options = {}) => {
  if (new URL(url).hostname !== 'api.xiaomimimo.com') return originalFetch(url, options);
  const headers = new Headers(options.headers); headers.set('authorization', `Bearer ${process.env.UX3_MIMO_KEY}`);
  if (options.method === 'POST') {
    const body = JSON.parse(options.body);
    globalThis.ux3Wire.push({model:body.model,thinking:body.thinking ?? null,reasoning_effort:body.reasoning_effort ?? null});
  }
  return originalFetch(url, {...options,headers});
};
process.env.NODE_OPTIONS = '--import=' + process.env.UX3_HOOK_MODULE;
await import('../../src/main.mjs');
