/** Build and sign a local upload tree. This command never uploads or creates a tag. */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createPublicKey } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { downloadFrp } from '../download-frp.mjs';
import { packageRelease } from './package.mjs';
import { keyId, signingKeyFromEnvironment, compareVersions } from '../../src/personal-update/manifest.mjs';
import { verifyWindowsPackage } from '../verify-windows-package.mjs';

export function assertReleaseVersion(version, channel) {
  compareVersions(version, '0.0.0');
  if (!['stable', 'preview'].includes(channel) || (channel === 'stable' && version.includes('-')) ||
    (channel === 'preview' && !/^\d+\.\d+\.\d+-preview\.\d+$/.test(version))) throw new Error('Release version must be X.Y.Z (stable) or X.Y.Z-preview.N (preview)');
  return version;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) { if (!args[i]?.startsWith('--') || !args[i+1] || args[i+1].startsWith('--')) throw new Error('Expected named arguments'); options[args[i].slice(2)] = args[i+1]; }
  await buildWindowsRelease(options);
}
export async function buildWindowsRelease(options) {
  const version = assertReleaseVersion(options.version, options.channel || 'stable'), channel = options.channel || 'stable';
  const repository = resolve(import.meta.dirname, '../..'), output = resolve(options.output || '.local/windows-release', version);
  const privateKey = await signingKeyFromEnvironment();
  const keysFile = resolve(options['trusted-keys'] || 'src/personal-update/trusted-keys.json');
  const keys = JSON.parse(await readFile(keysFile, 'utf8'));
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  if (keys[keyId(publicKey)] !== publicKey) throw new Error('Signing key must match a reviewed packaged public key');
  const pkg = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
  const run = (script, argv = []) => {
    const result = spawnSync(process.execPath, [script, ...argv], { cwd: repository, stdio: 'inherit', env: process.env });
    if (result.status !== 0) throw new Error(`Build step failed: ${script}`);
  };
  await mkdir(output, { recursive: true });
  if (!options['prebuilt-stage']) {
    run('scripts/verify-dsh-vendor.mjs');
    run('scripts/stage-dsh-runtime.mjs', ['--stage-root', join(output, 'stage')]);
  }
  const stage = resolve(options['prebuilt-stage'] || join(output, 'stage'));
  const frp = await downloadFrp({ destination: resolve('.local/frp') });
  const relay = join(stage, 'relay'); await mkdir(relay, { recursive: true });
  await copyFile(join(frp, 'frpc.exe'), join(relay, 'frpc.exe'));
  await writeFile(join(relay, 'transport-ca.pem'), rootCertificates.join('\n') + '\n');
  const identity = options['test-identity'];
  if (identity && !/^[a-z0-9]+$/.test(identity)) throw new Error('Invalid test identity');
  if (options['isolate-test-executable'] === 'true' && !identity) throw new Error('An isolated test executable requires a test identity');
  const config = { ...pkg.build, extraMetadata: { version, ...(identity ? { name: `weftmate-${identity}`, desktopAppId: `com.memoweft.weftmate.${identity}`, desktopIdentity: `WeftMate ${identity}` } : {}) },
    extraResources: [{ from: stage, to: '', filter: ['dsh-runtime/**/*', 'relay/**/*'] }, { from: keysFile, to: 'update-trusted-keys.json' }],
    ...(identity ? { appId: `com.memoweft.weftmate.${identity}`, nsis: { ...pkg.build.nsis, shortcutName: `WeftMate ${identity}`, uninstallDisplayName: `WeftMate ${identity}`, createDesktopShortcut: false } } : {}),
    ...(options['isolate-test-executable'] === 'true' ? { executableName: `WeftMate-${identity}` } : {}),
    directories: { ...pkg.build.directories, output: join(output, 'build') },
    publish: { provider: 'generic', url: `https://weftmate.com/updates/windows/x64/${channel}/`, channel: channel === 'stable' ? 'latest' : 'preview' } };
  if (options['test-bad-main'] === 'true') {
    if (!identity) throw new Error('An intentionally broken build requires a separate test identity');
    const badSource = join(output, 'bad-source'); await mkdir(badSource, { recursive: true });
    await writeFile(join(badSource, 'main.mjs'), 'throw new Error("R01_INTENTIONAL_BAD_RELEASE");\n' + await readFile(join(repository, 'src/main.mjs'), 'utf8'));
    config.files = [...pkg.build.files, '!src/main.mjs', { from: badSource, to: 'src', filter: ['main.mjs'] }];
  }
  const configFile = join(output, 'builder.json'); await writeFile(configFile, JSON.stringify(config, null, 2));
  run('node_modules/electron-builder/out/cli/cli.js', ['--win', '--publish', 'never', '--config', configFile]);
  const packageCheck = await verifyWindowsPackage({ unpacked: join(output, 'build/win-unpacked'), installer: join(output, 'build', `WeftMate-Setup-${version}.exe`) });
  await writeFile(join(output, 'package-check.json'), JSON.stringify(packageCheck, null, 2));
  console.log(JSON.stringify(packageCheck, null, 2));
  const upload = join(output, 'upload/updates/windows/x64', channel);
  const releaseNotes = options.notes ? await readFile(resolve(options.notes), 'utf8') : '';
  const previous = options.previous ? JSON.parse(await readFile(resolve(options.previous), 'utf8')) : null;
  await packageRelease({ layer: 'app', version, channel, outputDir: upload, sourceDir: join(output, 'build'), previousManifest: previous, privateKey, releaseNotes });
  await packageRelease({ layer: 'ui', version: options['ui-version'] || version, channel, outputDir: upload, privateKey, releaseNotes });
  // Keep previous EXE/blockmap assets in the same channel root when uploading; delta requests need both.
  await copyFile(keysFile, join(output, 'upload/update-public-keys.json'));
  const signature = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '[Console]::Out.Write((Get-AuthenticodeSignature -LiteralPath $env:WEFTMATE_RELEASE_INSTALLER).Status.ToString())'],
    { encoding: 'utf8', windowsHide: true, env: { ...process.env, WEFTMATE_RELEASE_INSTALLER: join(output, 'build', `WeftMate-Setup-${version}.exe`),
      PSModulePath: join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules') } });
  if (signature.status !== 0) throw new Error('Could not inspect installer Authenticode status');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain=v1'], { cwd: repository, encoding: 'utf8' });
  if (head.status !== 0 || status.status !== 0) throw new Error('Could not record release source revision');
  const report = { version, channel, tag: `v${version}`, upload, uploaded: false, authenticode: signature.stdout.trim() === 'Valid', authenticodeStatus: signature.stdout.trim(),
    source: { gitHead: head.stdout.trim(), dirty: !!status.stdout.trim() },
    dataIncluded: false, releaseNotesIncluded: !!releaseNotes, preservePreviousArtifacts: true };
  await writeFile(join(output, 'release.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  return { ...report, packageCheck };
}
