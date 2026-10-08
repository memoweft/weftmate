// Exercise real main-process shutdown and snapshots, but let Playwright own each subsequent launch.
import { app } from 'electron';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
app.relaunch = () => {};
registerHooks({ load(url, context, nextLoad) {
  if (url === new URL('../../src/main.mjs', import.meta.url).href) {
    const source = readFileSync(new URL(url), 'utf8').replace('await personalBackupManager?.started();',
      `await personalBackupManager?.started(); globalThis.bkDailyTick = async () => { const previous = (await personalBackupManager.view()).settings; await personalBackupManager.configure({ enabled: true }); try { await personalBackupManager.checkDaily(); return await personalBackupManager.view(); } finally { await personalBackupManager.configure({ enabled: previous.enabled }); } };`);
    return { format: 'module', source, shortCircuit: true };
  }
  return nextLoad(url, context);
} });
globalThis.bkSeedCredentials = async key => {
  const settings = await import('../../src/settings.ts'), vault = await import('../../src/config-store.ts');
  const routes = await import('../../src/harness-model-routes.ts'), official = await import('../../src/dsh-settings-migration.ts');
  for (const model of settings.listModelProfiles().profiles) if (model.name === 'MiMo BK-1')
    vault.saveCredential(official.officialCredentialRef(routes.routeForProfile(model.id).provider), key);
};
await import('./personal-baseline-bootstrap.mjs');
