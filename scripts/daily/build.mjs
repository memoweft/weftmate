// node scripts/daily/build.mjs --builds <builds> --version 0.2.0-preview.N --commit origin/main --previous 0.2.0-preview.P
// node scripts/daily/smoke.mjs --builds <builds> --version 0.2.0-preview.N
// node scripts/daily/install.mjs --builds <builds> --version 0.2.0-preview.N --previous 0.2.0-preview.P
// node scripts/daily/proof.mjs --builds <builds> --version 0.2.0-preview.N
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseOptions, repository, json, shaFile } from './common.mjs';

const { version, commit: ref, output, previousDirectory } = parseOptions('build', ['commit', 'previous']);
const repo = join(output, 'source-final'), build = join(output, 'build-final');
const git = (...args) => execFileSync('git', ['-C', repository, ...args],
  { encoding: 'utf8', maxBuffer: 1 << 24, windowsHide: true }).trim();
const commit = git('rev-parse', '--verify', '--end-of-options', ref + '^{commit}');
const tree = git('rev-parse', commit + '^{tree}');
const run = (command, args, options = {}) => spawnSync(command, args,
  { windowsHide: true, encoding: 'utf8', ...options });
const ok = (result, label, maxCode = 0) => assert.ok(result.status !== null && result.status <= maxCode,
  label + ' ' + (result.error?.message || result.stderr || result.status));

await mkdir(output, { recursive: true });
await mkdir(repo); // 已有 source-final 时 mkdir 失败，绝不覆盖已有版本。
const archive = join(output, 'source-final.tar');
git('archive', '--format=tar', '--output=' + archive, commit, '--',
  'src', 'runtime', 'build', 'design', 'scripts', 'tests', 'services', 'apps/mobile-ui',
  'package.json', 'package-lock.json', 'tsconfig.json');
ok(run('tar.exe', ['-xf', archive, '-C', repo]), 'extract source');
const previousSource = join(previousDirectory, 'source-final');
for (const name of ['package.json', 'package-lock.json']) {
  assert.deepEqual(await readFile(join(repo, name)), await readFile(join(previousSource, name)),
    `${name} differs; install dependencies in the previous version first`);
}
ok(run('robocopy.exe', [join(previousSource, 'node_modules'), join(repo, 'node_modules'),
  '/E', '/SL', '/SJ', '/MT:16', '/R:1', '/W:1', '/NFL', '/NDL', '/NP']), 'copy verified dependency tree', 7);

const config = await json(join(previousDirectory, 'builder.json'));
config.directories.output = build;
config.extraMetadata.version = version;
config.electronDist = join(repo, 'node_modules/electron/dist');
config.extraResources.find(entry => entry.to === 'update-trusted-keys.json').from = join(repo, 'src/personal-update/trusted-keys.json');
const configPath = join(output, 'builder.json');
await writeFile(configPath, JSON.stringify(config, null, 2));
await writeFile(join(output, 'source-commit.txt'), commit + '\n');
console.log(JSON.stringify({ stage: 'source-verified', version, commit, tree }));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:API[_-]?KEY|AUTHORIZATION|BEARER|PASSWORD|SECRET|TOKEN|CSC_LINK|CSC_KEY_PASSWORD|ALICLOUD|^CLOUD_)/i.test(key)));
env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
env.PYTHONDONTWRITEBYTECODE = '1';
ok(run(process.execPath, [join(repo, 'node_modules/electron-builder/out/cli/cli.js'),
  '--win', '--publish', 'never', '--config', configPath], { cwd: repo, env, stdio: 'inherit' }), 'Windows package');
const installer = join(build, 'WeftMate-Setup-' + version + '.exe');
const { verifyWindowsPackage } = await import(pathToFileURL(join(repo, 'scripts/verify-windows-package.mjs')).href);
const verified = await verifyWindowsPackage({ unpacked: join(build, 'win-unpacked'), installer });
const report = { version, sourceCommit: commit, sourceTree: tree, installer, sha256: await shaFile(installer),
  bytes: (await stat(installer)).size, verified, published: false };
await writeFile(join(output, 'daily-build.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, verified: true }));
