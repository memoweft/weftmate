#!/usr/bin/env node
import { mkdirSync as prepareEvidenceDirectory } from 'node:fs';
import { evidencePath } from '../tests/helpers/evidence-path.mjs';
/** Local x64 .app only. No DMG, updater, publishing, or developer credentials. */
import { build, Platform, Arch } from 'electron-builder';
import packageInfo from '../package.json' with { type: 'json' };
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, rename, writeFile, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stageDshRuntime } from './stage-dsh-runtime.mjs';
import { verifyWindowsPackage } from './verify-windows-package.mjs';
prepareEvidenceDirectory(evidencePath('m3-3b'), { recursive: true });

const repository = resolve(import.meta.dirname, '..');
const option = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
if (process.platform !== 'darwin' || process.arch !== 'x64') throw Error('This trial builds only on macOS x64');
const output = resolve(option('--output', join(repository, '.local/mac-trial')));
const destination = join(output, 'WeftMate.app');
if (existsSync(destination)) throw Error('Trial already exists; preserve it before building another candidate');
const scratch = await mkdtemp(join(repository, '.local/m3-3b-package-'));
const bytesFree = () => Number(execFileSync('/bin/df', ['-k', output], { encoding: 'utf8' }).trim().split('\n').at(-1).split(/\s+/)[3]) * 1024;
await mkdir(output, { recursive: true });
try {
  if (bytesFree() < 8 * 1024 ** 3) throw Error('Less than 8 GiB free; packaging stopped');
  execFileSync(process.execPath, [join(repository, 'scripts/verify-dsh-vendor.mjs')], { stdio: 'inherit' });
  const stage = join(scratch, 'stage');
  await stageDshRuntime({ stageRoot: stage });
  await build({ targets: Platform.MAC.createTarget(['dir'], Arch.x64), projectDir: repository,
    config: { directories: { output: join(scratch, 'build') },
      extraMetadata: { macTrial: true },
      // get-windows uses its upstream Swift executable on Mac. The npm
      // fallback addon/Makefiles are Windows build output, with local paths.
      files: [...packageInfo.build.files, '!node_modules/get-windows/build-tmp-*/**/*', '!node_modules/get-windows/lib/binding/**/*'],
      extraResources: [{ from: 'src/personal-update/trusted-keys.json', to: 'update-trusted-keys.json' },
        { from: stage, to: '', filter: ['dsh-runtime/**/*'] }],
      mac: { identity: null, hardenedRuntime: false, gatekeeperAssess: false, notarize: false,
        icon: 'build/icon.png', target: [{ target: 'dir', arch: ['x64'] }] }, publish: null },
  });
  const candidate = join(scratch, 'build/mac/WeftMate.app');
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', candidate], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', candidate], { stdio: 'inherit' });
  const audit = await verifyWindowsPackage({ unpacked: candidate, resourcesDirectory: join(candidate, 'Contents/Resources'), installer: join(candidate, 'Contents/MacOS/WeftMate'), platform: 'darwin' });
  const sizeKiB = Number(execFileSync('/usr/bin/du', ['-sk', candidate], { encoding: 'utf8' }).split(/\s/)[0]);
  await writeFile(evidencePath('m3-3b/package.json'), JSON.stringify({
    platform: 'darwin-x64', sizeKiB, signing: 'ad-hoc; no Developer ID; not notarized',
    audit: { ...audit, installer: { ...audit.installer, file: 'Contents/MacOS/WeftMate' } },
    includes: ['Electron + Node', 'WeftMate desktop/host', 'pinned patched DSH closure'],
    external: ['existing Python 3.11 venv', 'read-only MemoWeft Core'],
    absent: ['Python distribution', 'semantic recall model', 'Mac relay binary', 'updates', 'developer certificate'],
  }, null, 2) + '\n');
  await rename(candidate, destination);
  console.log(JSON.stringify({ built: true, sizeKiB, adHocSignatureVerified: true, closureAuditPassed: true }));
} finally { await rm(scratch, { recursive: true, force: true }); }
