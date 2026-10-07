import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

function text(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

describe('Stage 3 Windows preview boundaries', () => {
  it('builds candidates from the verified vendor without implicit regeneration or publishing', () => {
    const pkg = JSON.parse(text('../../../package.json'));
    assert.match(pkg.scripts['dist:win'], /vendor:verify/);
    assert.doesNotMatch(pkg.scripts['dist:win'], /vendor:dsh/);
    assert.equal(pkg.build.publish, null);
    assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
    assert.equal(pkg.build.nsis.perMachine, false);

    const build = text('../../../scripts/build-windows-candidate.mjs');
    assert.match(build, /verify-dsh-vendor\.mjs/);
    assert.doesNotMatch(build, /vendor-dsh\.mjs/);
    assert.match(build, /CSC_IDENTITY_AUTO_DISCOVERY = 'false'/);
    assert.match(build, /API\[_-\]\?KEY\|AUTHORIZATION\|BEARER\|PASSWORD\|SECRET\|TOKEN/);
    assert.match(build, /publish: null/);
    assert.match(build, /verify-windows-package\.mjs/);
  });

  it('keeps diagnostics and preview update recovery reachable from the existing tray lifecycle', () => {
    const main = text('../../../src/main.mjs');
    assert.match(main, /label: '导出脱敏诊断…'/);
    assert.match(main, /exportRedactedDiagnosticsFromMain/);
    assert.match(main, /checkPreviewUpdateFromTray/);
    assert.match(main, /installPreviewUpdateFromTray/);
    assert.match(main, /initUpdater\(\(\) => win, \(\) => refreshTrayMenu\(\)\)/);

    const update = text('../../../src/update.ts');
    assert.match(update, /autoInstallOnAppQuit = false/);
    assert.match(update, /sanitizeUpdateFailure/);
    assert.doesNotMatch(update, /state\.error = error instanceof Error \? error\.message/);
    assert.match(main, /officialCredentialRef\(route\.provider\)/);
    const installedRunner = text('../stage3-run-installed.mjs');
    assert.match(installedRunner, /stdio: \['ignore', 'inherit', 'inherit', 'ipc'\]/);
    assert.match(installedRunner, /WEFTMATE_DOGFOOD_CONTROL = '1'/);
    assert.match(installedRunner, /child\.send\(\{ type: 'weftmate:quit' \}\)/);
    const installedDiagnostics = text('../stage3-export-installed-diagnostics.mjs');
    assert.match(installedDiagnostics, /inside\('src\/diagnostics-export\.ts'\)/);
    assert.match(installedDiagnostics, /protectedCredentialProfiles/);
    assert.match(installedDiagnostics, /apiKey\|baseUrl/);
  });

  it('documents exact retained data classes and the unsigned release blocker', () => {
    const doc = text('../../../docs/archive/2026-10-07/WINDOWS-PREVIEW.md');
    for (const required of [
      '%APPDATA%\\com.memoweft.weftmate',
      'weftmate-settings.json',
      'weftmate-model.enc',
      'dsh-home/sessions/',
      'deleteAppDataOnUninstall',
      'retained-on-uninstall',
      '正式发布阻断',
      '干净 Windows 用户环境',
    ]) assert.match(doc, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});
