// Exercise real main-process shutdown and snapshots, but let Playwright own each subsequent launch.
import { app } from 'electron';
app.relaunch = () => {};
globalThis.bkSeedCredentials = async key => {
  const settings = await import('../../src/settings.ts'), vault = await import('../../src/config-store.ts');
  const routes = await import('../../src/harness-model-routes.ts'), official = await import('../../src/dsh-settings-migration.ts');
  for (const model of settings.listModelProfiles().profiles) if (model.name === 'MiMo BK-1')
    vault.saveCredential(official.officialCredentialRef(routes.routeForProfile(model.id).provider), key);
};
await import('./personal-baseline-bootstrap.mjs');
