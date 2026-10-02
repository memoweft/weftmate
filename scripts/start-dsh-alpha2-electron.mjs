#!/usr/bin/env node
/** Launch the independent minimal Electron host for the Alpha.2 vendor candidate. */
import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const candidate = JSON.parse(await (await import('node:fs/promises')).readFile(join(repository, 'runtime', 'dsh-candidates', 'dsh-v0.1.7-alpha.2.json'), 'utf8'))
const pin = JSON.parse(await (await import('node:fs/promises')).readFile(join(repository, candidate.pinPath), 'utf8'))
const vendor = resolve(repository, candidate.vendorRuntimePath)
const electron = join(repository, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
const requested = process.argv.find(value => value.startsWith('--root='))?.slice('--root='.length)
const testClose = process.argv.find(value => value.startsWith('--test-close-ms='))?.slice('--test-close-ms='.length)
const expectedModels = process.argv.find(value => value.startsWith('--expect-model-count='))?.slice('--expect-model-count='.length)
const dryRun = process.argv.includes('--dry-run')
const root = requested === undefined ? undefined : resolve(requested)
if (!existsSync(electron)) throw new Error('repository Electron executable is missing')
const manifestPath = join(vendor, 'VENDOR-MANIFEST.json')
if (!existsSync(manifestPath)) throw new Error('alpha2 vendor manifest is missing')
const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(manifestPath, 'utf8'))
if (manifest?.dsh?.packageVersion !== candidate.packageVersion || manifest?.dsh?.commit !== candidate.commit || pin.commit !== candidate.commit) throw new Error('alpha2 vendor manifest does not match candidate pin')
const weftMateRoot = resolve(repository, '..')
const harnessStores = join(weftMateRoot, 'Runtime', 'HarnessStores', 'dsh-v0.1.7-alpha.2')
const allowedRoot = value => value.startsWith(`${resolve(tmpdir())}${sep}`) || value.startsWith(`${harnessStores}${sep}`)
if (root !== undefined && !allowedRoot(root)) throw new Error('alpha2 Electron root must be under TEMP or alpha2 HarnessStores')
const scrubbedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:^|[_-])(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)(?:$|[_-])/i.test(key)))
if (dryRun) {
  process.stdout.write(JSON.stringify({ dryRun: true, electron, vendor, root: root ?? null, sideEffects: false }) + '\n')
} else {
  const isolatedRoot = root ?? await mkdtemp(join(process.env.TEMP ?? process.cwd(), 'weftmate-alpha2-electron-'))
  const child = spawn(electron, [join(repository, 'runtime', 'dsh-candidates', 'electron-app')], {
    cwd: repository,
    env: { ...scrubbedEnv, WEFTMATE_ALPHA2_ELECTRON_ROOT: isolatedRoot,
      ...(testClose === undefined ? {} : { WEFTMATE_ALPHA2_ELECTRON_TEST_CLOSE_MS: testClose }),
      ...(expectedModels === undefined ? {} : { WEFTMATE_ALPHA2_ELECTRON_EXPECT_MODELS: expectedModels }) },
    windowsHide: false,
    stdio: 'inherit',
  })
  child.once('exit', code => { process.exitCode = code ?? 1 })
}
