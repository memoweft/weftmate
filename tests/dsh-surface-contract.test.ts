import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const preload = readFileSync(new URL('../src/dsh-surface-preload.cjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const client = readFileSync(new URL('../src/plugins/weftmate-client/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('official DSH surface shell contract', () => {
  it('starts the shared official runtime before a model/profile exists', () => {
    assert.match(main, /sessionReferenceScan = \{ state: 'ready', error: null \};/);
    assert.match(main, /let origin = await ensureSharedRuntime\(\{ reload: true \}\)/);
    assert.doesNotMatch(main, /if \(publicModelView\(\)\.configured === true\)[\s\S]{0,500}ensureSharedRuntime/);
  });

  it('uses the child IPC credential provider and maps only legal refs to safeStorage', () => {
    assert.match(main, /credentialRequestHandler,/);
    assert.match(main, /\^\[A-Za-z_\]\[A-Za-z0-9_\]\*\$/);
    assert.match(main, /configStoreMod\.saveCredential\(ref, value\)/);
    assert.match(main, /configStoreMod\.removeCredential\(ref\)/);
    assert.match(main, /migrateLegacyCredentialRef\(ref\)/);
    assert.doesNotMatch(main, /credentialEnv: \(\) =>/);
  });

  it('places a final credential-provider security overlay after the route patch without disabling official Models', () => {
    assert.match(main, /const SECURITY_PATCH = join\(dshHome, 'weftmate-security-credentials\.patch\.yml'\)/);
    assert.match(main, /patchFiles: \[ROUTES_PATCH, SECURITY_PATCH\]/);
    assert.match(main, /'- id: credentials',\n\s*'  disabled: true'/);
    assert.match(main, /'- id: weftmate-credentials',\n\s*'  disabled: true'/);
    assert.match(main, /'    - id: weftmate-safe-credentials',\n\s*'      name: \.\/plugins\/weftmate-credentials\.mjs'/);
    assert.doesNotMatch(main, /id: ui-settings-models[\s\S]{0,100}disabled: true/);
  });

  it('migrates legacy base routes through the official settings API before retiring the patch', () => {
    assert.match(main, /createOfficialDshSettingsClient\(\{ origin: runtimeOrigin \}\)/);
    assert.match(main, /await migrateLegacyRoutes\(officialDsh, expectedRoutes\.map\(\(item\) => item\.routeProjection\)\)/);
    assert.match(main, /officialCredentialRef\(route\.provider\)/);
    assert.match(main, /legacyRoutePatchRetired = true;\n\s*writeModelRoutesPatch\(ROUTES_PATCH, \[\]\);\n\s*const restarted = await replaceSharedRuntime\(\)/);
    assert.match(main, /const migratedRouteNames = expectedRoutes\.map\(\(item\) => item\.route\.provider\);\n\s*writeOfficialRouteMigrationMarker\(migratedRouteNames\)/);
    assert.match(main, /officialRouteMigrationComplete = restoredOfficialMigrationRoutes !== null;\n\s*officialRouteMigrationRoutes = restoredOfficialMigrationRoutes \?\? new Set\(\);\n\s*legacyRoutePatchRetired = officialRouteMigrationComplete \|\| isRoutePatchRetired\(\)/);
    assert.match(main, /function cleanupMarkedLegacyCredentialAliases\(\)[\s\S]*configStoreMod\.removeCredential\(route\.apiKeyEnv\)[\s\S]*configStoreMod\.removeCredential\(profile\.id\)/);
    assert.match(main, /try \{ cleanupMarkedLegacyCredentialAliases\(\); \}/);
    assert.doesNotMatch(main, /settings\.yaml/);
  });

  it('exposes no old stage-one renderer bridge to the official page', () => {
    assert.match(preload, /wm:dsh-surface:theme/);
    for (const forbidden of ['wm:stage1:', 'wm:stage2:', 'sessions:', 'apiKey']) {
      assert.doesNotMatch(preload, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.deepEqual([...preload.matchAll(/ipcRenderer\.on\('([^']+)'/g)].map(match => match[1]), ['wm:mod-window:open-project']);
    assert.match(preload, /removeListener\('wm:mod-window:open-project', listener\)/);
  });

  it('accepts only bounded computed body colors and mirrors the exact accepted color to native chrome', () => {
    assert.match(preload, /function normalizeSurfaceColor\(value\)/);
    assert.match(preload, /#\(\?:\[0-9a-f\]\{3,4\}/);
    assert.match(preload, /rgba\?\\\(/);
    assert.match(main, /const normalizeSurfaceColor = \(value\) =>/);
    assert.match(main, /const background = normalizeSurfaceColor\(payload\?\.color\);\s*if \(!background\) return \{ ok: false \}/);
    assert.match(main, /dshSurfaceBackgroundColor = background;\s*updateNativeWindowColors\(value, background\)/);
    assert.match(main, /win\.setTitleBarOverlay\(\{ color: background/);
    assert.doesNotMatch(main, /dshResolvedTheme = value;\s*nativeTheme\.themeSource/);
  });

  it('keeps visual integration to a drag strip and resolved DSH theme observation', () => {
    assert.match(client, /weftmate-electron-drag-region/);
    assert.match(client, /background: var\(--dsw-alias-bg-base, Canvas\)/);
    assert.match(client, /dragRegion\.innerHTML = '<span class="weftmate-mark">W<\/span><span class="weftmate-wordmark">WeftMate<\/span>'/);
    // The current fixed DSH has changed its hashed class names. Assert the
    // retained collapsed-brand and button geometry, not a historical hash.
    assert.match(client, /\.[\w-]+_collapsed \.[\w-]+_brand \{ display: none; \}/);
    assert.match(client, /\.[\w-]+_collapsed \.[\w-]+_toggle \{ width: 36px; height: 36px; \}/);
    assert.match(client, /-webkit-app-region: drag/);
    assert.match(client, /-webkit-app-region: no-drag/);
    assert.match(client, /getComputedStyle\(dragRegion\)\.backgroundColor/);
    assert.match(client, /attributeFilter: \['data-ds-dark-theme', 'style'\]/);
    assert.match(client, /bridge\.syncTheme\(theme, color\)/);
    assert.match(main, /trustedRuntimeOrigin = origin;[\s\S]*await win\.loadURL\(origin\)/);
    assert.match(main, /const request = surfaceNavigation\.catch\(\(\) => undefined\)\.then/);
    assert.match(main, /surfaceNavigation = request\.catch\(\(\) => undefined\)/);
    assert.doesNotMatch(main, /dshResolvedTheme[\s\S]{0,160}nativeTheme\.themeSource/);
    assert.match(main, /webContents\.on\('page-title-updated', \(event\) => \{\s*event\.preventDefault\(\);\s*if \(!win\.isDestroyed\(\)\) win\.setTitle\('WeftMate'\)/);
  });

  it('keeps additive Mod integration without replacing the official conversation or root', () => {
    const applyStart = client.indexOf("apply: function (ctx) {");
    assert.ok(applyStart >= 0);
    assert.match(client.slice(applyStart), /installElectronWindowChrome\(\)/);
    assert.match(client.slice(applyStart), /name: 'shell\.overlay',\s*id: 'weftmate-v2-shell'/);
    assert.match(client.slice(applyStart), /name: 'sidebar\.workspaces', id: 'weftmate-v2-sessions'/);
    assert.doesNotMatch(client.slice(applyStart), /register\(\{\s*name:\s*['"](?:root|conversation|sidebar|details)['"]/);
  });
});
