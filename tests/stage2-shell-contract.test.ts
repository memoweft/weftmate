import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../src/dsh-surface-preload.cjs', import.meta.url), 'utf8');
const html = readFileSync(new URL('../src/web/weftmate.html', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/web/weftmate.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/web/weftmate.css', import.meta.url), 'utf8');
const vault = readFileSync(new URL('../src/config-store.ts', import.meta.url), 'utf8');
const discovery = readFileSync(new URL('../src/openai-compatible.ts', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/openai-compatible-client.ts', import.meta.url), 'utf8');
const sessionGuards = readFileSync(new URL('../src/stage2-session-guards.ts', import.meta.url), 'utf8');
const journal = readFileSync(new URL('../src/route-mutation-journal.ts', import.meta.url), 'utf8');

describe('Stage 2 settings, model management and product surface', () => {
  it('uses the official DSH surface for model CRUD and exposes only a narrow native-theme bridge', () => {
    assert.match(preload, /wm:dsh-surface:theme/);
    for (const forbidden of ['discoverModels', 'saveModel', 'testModel', 'setActiveModel', 'deleteModel', 'setTheme', 'exportDiagnostics', 'runtimeOrigin', 'apiKey']) {
      assert.doesNotMatch(preload, new RegExp(forbidden));
    }
    assert.match(main, /preload: join\(import\.meta\.dirname, 'dsh-surface-preload\.cjs'\)/);
    assert.match(main, /createOfficialDshSettingsClient/);
  });

  it('does real OpenAI-compatible discovery and selected-model verification without arbitrary headers', () => {
    assert.match(main, /verifyOpenAICompatibleModel/); assert.match(client, /authorization: `Bearer \$\{input\.apiKey\}`/);
    assert.match(client, /parseOpenAICompatibleModels/); assert.match(discovery, /Array\.isArray\(.*data/); assert.match(discovery, /returned no models/); assert.match(client, /selected model was not returned/);
    assert.match(client, /chat\/completions/); assert.match(client, /redirect: 'error'/);
    assert.doesNotMatch(main, /headers:\s*input\.headers/);
  });

  it('keeps persistent model metadata separate from the safeStorage secret-only map', () => {
    assert.match(vault, /schemaVersion: 2; credentials: Record<string, string>/);
    assert.match(vault, /migrateLegacyProfiles/); assert.match(vault, /saveCredential/);
    assert.doesNotMatch(vault, /writeSecrets\([^)]*profiles/);
    assert.match(main, /configStoreMod\.saveCredential/); assert.match(main, /settingsMod\.upsertModelProfile/);
    assert.match(vault, /legacyPayload/); assert.match(vault, /模型凭据保险库不可读或尚未完成迁移/);
  });

  it('exposes safe model states and real switch/delete/stream interaction controls', () => {
    assert.match(main, /hasKey/); assert.match(main, /switchActiveModel/); assert.match(main, /bindSessionModel/);
    assert.match(html, /id="set-active-model"/); assert.match(html, /id="delete-confirm"/); assert.match(html, /id="confirm-delete"/);
    assert.match(ui, /window\.weftmate\.setActiveModel/); assert.match(ui, /state\.runtimeReady/); assert.match(ui, /profile\?\.hasKey === true/);
    assert.match(ui, /#reading-rail/); assert.match(ui, /shouldFollowStream/); assert.match(ui, /applyMessageUpdate/); assert.match(ui, /messageNode\(update\.message\.id\)/);
    assert.match(ui, /conversation\.inert = true/); assert.match(ui, /event\.key === 'Escape'/); assert.match(ui, /state\.settingsTrigger/);
    assert.match(ui, /#delete-confirm'\)\.hidden = false/); assert.match(ui, /#cancel-delete/);
  });

  it('wires every imported Stage 2 renderer helper with its production argument shape', () => {
    const retryCalls = ui.match(/retryPromptForSession\(state\.lastPromptBySession, state\.messages, state\.current\)/g) ?? [];
    assert.equal(retryCalls.length, 2, 'status render and retry click must both pass the two Maps plus session id');
    assert.match(ui, /deriveWorkspaceState\(\{ profile, runtimeReady: state\.runtimeReady, running: state\.running \}\)/);
    assert.match(ui, /applyMessageUpdate\(list, kind, text, \(\) => crypto\.randomUUID\(\)\)/);
    assert.match(ui, /appendMessageNode\(\$\('#messages'\), update\.message, createMessageNode\)/);
    assert.match(ui, /updateMessageNode\(\$\('#messages'\), update\.message\.id, update\.message\.text\)/);
    assert.match(ui, /captureThemeRollback\(document\.documentElement\.dataset\.theme \|\| 'system', stored\)/);
    assert.match(ui, /rollbackThemePreference\(previous\)/);
    assert.match(ui, /beginApproval\(\{ request, error: '', submitting: false \}\)/);
    assert.match(ui, /settleApproval\(approvalState, result\)/);
    assert.match(ui, /receiveApproval\(\{ request: state\.pendingApproval, error: '', submitting: false \}, event\.data\)/);
    assert.match(ui, /editorProfileForSettings\(mode, activeProfile\(\), selected\)/);
    assert.match(ui, /#empty-add-model'\)\.onclick = \(\) => openSettings\(activeProfile\(\) \? 'edit' : 'new'\)/);
  });

  it('keeps old session ownership explicit and wires all route-changing entry points through one journal queue', () => {
    assert.match(sessionGuards, /resolveSafeSessionBinding/);
    assert.doesNotMatch(sessionGuards, /\?\? input\.active/);
    assert.doesNotMatch(sessionGuards, /if \(!input\.active\) return/);
    assert.match(sessionGuards, /legacyCompatibilityProfileId/);
    assert.match(main, /resolveSafeSessionBinding\(\{ provider: selected\?\.current\?\.provider/);
    assert.doesNotMatch(main, /settingsMod\.bindSessionModel\(sessionId, active\.id/);
    assert.match(main, /error\?\.code === 'session-model-ownership-unknown'/);
    assert.match(main, /recoverRouteMutationJournalFiles\(\{ journalPath: ROUTE_MUTATION_JOURNAL/);
    assert.ok(main.indexOf('recoverRouteMutationJournalFiles') < main.indexOf("await import('./config-store.ts')"), 'crash recovery must precede vault/settings imports and migration');
    assert.match(journal, /export function recoverRouteMutationJournalFiles/);
    assert.match(main, /const routeMutationQueue = createRouteMutationQueue\(\)/);
    assert.match(main, /const enqueueRouteMutation = \(work\) => routeMutationQueue\.run\(work\)/);
    const saveRoute = main.slice(main.indexOf('saveModelRoute = async'), main.indexOf('configureLocalModel = async'));
    assert.match(saveRoute, /saveModelRoute = async \(input, \{ catalogOnly = false \} = \{\}\) =>/);
    assert.match(saveRoute, /return enqueueRouteMutation\(async \(\) =>/);
    assert.match(saveRoute, /if \(childEnvironmentChanged\) \{\s*await hydrateLegacySessionBindings\(\);\s*assertSessionReferenceScanComplete\(\);/);
    const deleteRoute = main.slice(main.indexOf("ipcMain.handle('wm:stage2:delete-model'"), main.indexOf("ipcMain.handle('wm:stage2:set-theme'"));
    assert.match(deleteRoute, /await enqueueRouteMutation\(async \(\) => \{\s*await hydrateLegacySessionBindings\(\);\s*assertSessionReferenceScanComplete\(\)/);
    assert.match(main, /async function activateStageOneConfig[\s\S]*return saveModelRoute\(\{ \.\.\.clean, provider: 'openai-compatible' \}\)/);
    assert.match(main, /wm:stage1:import-current-local-model[\s\S]*await activateStageOneConfig/);
    assert.match(main, /if \(childEnvironmentChanged\) \{\s*await hydrateLegacySessionBindings\(\);\s*assertSessionReferenceScanComplete\(\);/);
    assert.match(sessionGuards, /const legacyHeader = provider === 'deepseek-official'/);
    assert.doesNotMatch(sessionGuards, /provider === '' \|\| provider === 'deepseek-official'/);
    assert.match(main, /backfillLegacyCompatibilityProfile\(configStoreMod\.legacyCompatibilityEvidence\(\)\)/);
  });

  it('has exactly the three useful settings groups, dual semantic palettes and reduced-motion support', () => {
    for (const label of ['GENERAL', 'MODELS', 'DATA &amp; DIAGNOSTICS']) assert.match(html, new RegExp(label));
    assert.match(html, /id="theme-select"/); assert.match(html, /value="system"/); assert.match(html, /value="light"/); assert.match(html, /value="dark"/);
    assert.match(css, /:root\[data-theme="dark"\]/); assert.match(css, /@media \(prefers-color-scheme:dark\)/); assert.match(css, /prefers-reduced-motion:reduce/);
    assert.match(css, /grid-template-columns:256px minmax\(0,1fr\)/); assert.match(css, /\.composer\{[^}]*border-radius:15px/);
    assert.match(css, /color-scheme:light/); assert.match(css, /@media\(max-width:840px\)/);
    assert.match(html, /class="window-drag-region" aria-hidden="true"/);
    assert.match(css, /--titlebar-height:env\(titlebar-area-height, 40px\)/);
    assert.match(css, /\.window-drag-region\{[^}]*-webkit-app-region:drag/);
    assert.match(css, /button,input,textarea,select,a,\[role="button"\]\{-webkit-app-region:no-drag\}/);
    assert.match(css, /\.app\{[^}]*height:calc\(100% - var\(--titlebar-height\)\)[^}]*margin-top:var\(--titlebar-height\)/);
    assert.match(css, /\.settings\{[^}]*inset:var\(--titlebar-height\) 0 0 256px/);
    assert.doesNotMatch(css, /radial-gradient|box-shadow:0 20px 60px/);
  });

  it('keeps one no-model action, one Settings entry, and an explicit model-list action', () => {
    assert.match(html, /id="new-chat"[^>]*>新对话</);
    assert.match(html, /id="empty-add-model"[^>]*>添加模型</);
    assert.match(html, /id="open-settings"[^>]*>设置</);
    assert.match(html, /id="active-model"[^>]*hidden/);
    assert.doesNotMatch(html, /id="header-settings"/);
    assert.doesNotMatch(ui, /#new-chat'\)\.textContent\s*=\s*state\.configured/);
    assert.match(ui, /#new-chat'\)\.disabled = !state\.configured/);
    assert.match(ui, /#active-model'\)\.hidden = !profile/);
    assert.match(html, /id="discover-models"[^>]*>获取模型列表</);
    assert.match(html, /id="model-name-select"[^>]*disabled/);
    assert.match(ui, /id: \$\('#model-id'\)\.value \|\| undefined/);
    assert.match(ui, /#model-provider'\)\.onchange = invalidateDiscoveredModels/);
    assert.match(ui, /#model-base-url'\)\.oninput = invalidateDiscoveredModels/);
    assert.match(ui, /#model-api-key'\)\.oninput = invalidateDiscoveredModels/);
    assert.match(ui, /available\.length === 1 \? available\[0\] : ''/);
    assert.match(ui, /available\.length > 1\) \$\('#model-name-select'\)\.focus\(\)/);
    assert.match(ui, /button\.textContent = '正在获取…'/);
    assert.match(ui, /button\.textContent = '获取模型列表'/);
    assert.doesNotMatch(html, /id="discover-models"[^>]*class="plain-button|id="discover-models"[^>]*class="secondary-button/);
  });

  it('lets DSH own preference while only mirroring its resolved palette into the native Electron frame', () => {
    assert.match(main, /let dshResolvedTheme = null/);
    assert.match(main, /dshResolvedTheme = value;\s*dshSurfaceBackgroundColor = background;\s*updateNativeWindowColors\(value, background\)/);
    assert.match(main, /nativeTheme\.themeSource = 'system'/);
    assert.doesNotMatch(main, /dshResolvedTheme = value;\s*nativeTheme\.themeSource/);
    assert.match(main, /nativeTheme\.on\('updated'/);
  });
});
