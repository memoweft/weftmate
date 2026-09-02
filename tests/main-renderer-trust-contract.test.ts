import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('main canonical renderer trust wiring', () => {
  it('loads the official runtime surface and trusts only its exact current origin in the main frame', () => {
    assert.match(main, /let origin = await ensureSharedRuntime\(\{ reload: true \}\)/);
    assert.match(main, /await navigateToRuntimeSurface\(origin\)/);
    assert.match(main, /trustedRuntimeOrigin = null;[\s\S]*trustedRuntimeOrigin = origin;[\s\S]*await win\.loadURL\(origin\)/);
    assert.match(main, /catch \(error\) \{\s*if \(trustedRuntimeOrigin === origin\) trustedRuntimeOrigin = null;/);
    assert.match(main, /blocksUnexpectedRendererNavigation\(win\.webContents\.getURL\(\), origin\)[\s\S]{0,180}official DSH navigation did not finish/);
    assert.match(main, /blocksUnexpectedRendererNavigation\(targetUrl, trustedRuntimeOrigin\).*event\.preventDefault\(\)/);
    assert.match(main, /isTrustedRendererInvocation\(\{ expectedOrigin: trustedRuntimeOrigin,/);
    assert.match(main, /senderFrame: event\.senderFrame, mainFrame: win\.webContents\.mainFrame/);
    assert.match(main, /preload: join\(import\.meta\.dirname, 'dsh-surface-preload\.cjs'\)/);
    assert.doesNotMatch(main, /await win\.loadURL\(legacyRendererUrl\)/);
  });

  it('keeps external popups in the system shell and denies every created window', () => {
    const windowOpen = main.slice(main.indexOf('win.webContents.setWindowOpenHandler'));
    assert.match(windowOpen, /protocol === 'http:' \|\| protocol === 'https:'/);
    assert.match(windowOpen, /shell\.openExternal\(url\)/);
    assert.match(windowOpen, /return \{ action: 'deny' \}/);
  });

  it('blocks redirects as well as top-level navigations outside the exact current runtime origin', () => {
    assert.match(main, /webContents\.on\('will-navigate', \(event, targetUrl\) => \{\s*if \(blocksUnexpectedRendererNavigation\(targetUrl, trustedRuntimeOrigin\)\) event\.preventDefault\(\);\s*\}\)/);
    assert.match(main, /webContents\.on\('will-redirect', \(event, targetUrl\) => \{\s*if \(blocksUnexpectedRendererNavigation\(targetUrl, trustedRuntimeOrigin\)\) event\.preventDefault\(\);\s*\}\)/);
  });

  it('places session entry and active/theme writes on the exclusive mutation lane', () => {
    assert.match(main, /const enqueueRouteMutation = \(work\) => routeMutationQueue\.run\(work\)/);
    assert.match(main, /await enqueueRouteMutation\(\(\) => switchActiveModel/);
    assert.match(main, /const savedTheme = await enqueueRouteMutation\(\(\) => settingsMod\.setThemePreference\(theme\)\)/);
    for (const channel of ['wm:stage1:create', 'wm:stage1:select', 'wm:stage1:send']) {
      const from = main.indexOf(`ipcMain.handle('${channel}'`);
      const body = main.slice(from, from + 1_800);
      assert.match(body, /enqueueRouteMutation\(/, `${channel} must not enter after a route idle fence`);
    }
    assert.match(main, /const recorded = settingsMod\.legacyCompatibilityProfileId\(\);[\s\S]*const evidence = configStoreMod\.legacyCompatibilityEvidence\(\);[\s\S]*recorded !== evidence\.id/);
    assert.match(main, /credentialRequestHandler,/);
    assert.doesNotMatch(main, /credentialEnvironment\(/);
  });
});
