import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runtimeIdentity } from '../../scripts/dsh-runtime-identity.mjs'

export async function treeDigest(root) {
  const hash = createHash('sha256'); let files = 0
  const walk = async (dir, prefix = '') => {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name), rel = prefix + name, stat = await lstat(path)
      if (stat.isSymbolicLink()) throw Error('digest source must not contain links')
      hash.update(`${stat.isDirectory() ? 'd' : 'f'}:${rel}\0`)
      if (stat.isDirectory()) await walk(path, rel + '/')
      else { files++; hash.update(await readFile(path)) }
    }
  }
  await walk(root)
  return { files, sha256: hash.digest('hex') }
}

export async function prepareMatrixProject(root, vendorScript = resolve('scripts/vendor-dsh.mjs')) {
  const project = join(root, 'project')
  await mkdir(join(project, 'scripts'), { recursive: true })
  for (const file of ['dsh-runtime-identity.mjs', 'dsh-vendor-closure.mjs', 'dsh-runtime-storage.mjs']) {
    await cp(resolve('scripts', file), join(project, 'scripts', file)).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
  await cp(vendorScript, join(project, 'scripts/vendor-dsh.mjs'))
  await cp(resolve('tests/contract/support/checkout.ts'), join(project, 'tests/contract/support/checkout.ts'))
  await cp(resolve('tests/contract/dsh-pin.json'), join(project, 'tests/contract/dsh-pin.json'))
  await cp(resolve('patches/dsh'), join(project, 'patches/dsh'), { recursive: true })
  await writeFile(join(project, 'package.json'), JSON.stringify({ type: 'module', scripts: { 'vendor:dsh': 'node scripts/vendor-dsh.mjs' } }))
  const source = await readFile(vendorScript, 'utf8')
  const names = [...source.matchAll(/\{ name: '(@deepseek-ai\/[^']+)', why:/g)].map(match => match[1])
  return { project, names, identity: await runtimeIdentity(project), pin: JSON.parse(await readFile(join(project, 'tests/contract/dsh-pin.json'))) }
}

async function payload(path, context, kind) {
  await mkdir(join(path, 'node_modules/@deepseek-ai/dsh/lib'), { recursive: true })
  await mkdir(join(path, 'bin'), { recursive: true }); await mkdir(join(path, 'tarballs'), { recursive: true })
  await writeFile(join(path, 'package.json'), '{"private":true}')
  await writeFile(join(path, 'bin/dsh-web.cmd'), 'synthetic wrapper')
  await writeFile(join(path, 'tarballs/fixture.tgz'), 'synthetic tarball')
  await writeFile(join(path, 'node_modules/@deepseek-ai/dsh/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: context.pin.packageVersion, main: 'lib/bin.js' }))
  if (kind !== 'incomplete') await writeFile(join(path, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '// intact synthetic cache\n')
  await writeFile(join(path, 'VENDOR-MANIFEST.json'), JSON.stringify({ dsh: context.pin, ...(kind === 'legacy' ? {} : { runtimeIdentity: context.identity }) }))
}

export async function runCacheMatrix(root, context, { phases = ['success', 'compile', 'assemble', 'verify', 'interrupt'], shells = [null], inheritedInstallPaths = false } = {}) {
  const rows = []
  for (const shell of shells) for (const pointer of ['legacy', 'matching', 'incomplete', 'directory', 'absent']) {
    for (const cached of ['good', 'invalid', 'absent']) for (const phase of phases) {
      const label = `${shell ? basename(shell) : 'node'}-${pointer}-${cached}-${phase}`.replaceAll(/[^\w-]/g, '_')
      const dir = join(root, label), shared = join(dir, 'cache'), output = join(dir, 'repo/vendor/dsh-runtime'), other = join(shared, 'other-cache')
      await mkdir(shared, { recursive: true }); await mkdir(join(dir, 'repo/vendor'), { recursive: true })
      await payload(other, context, pointer === 'legacy' ? 'legacy' : pointer === 'incomplete' ? 'incomplete' : 'good')
      const cache = join(shared, `dsh-runtime-${context.identity.commit.slice(0, 12)}-${context.identity.patchesSha256.slice(0, 16)}`)
      if (cached !== 'absent') await payload(cache, context, cached === 'good' ? 'good' : 'incomplete')
      if (['legacy', 'matching', 'incomplete'].includes(pointer)) await symlink(other, output, process.platform === 'win32' ? 'junction' : 'dir')
      else if (pointer === 'directory') await payload(output, context, 'legacy')
      const before = await treeDigest(other), beforeCache = cached === 'absent' ? null : await treeDigest(cache)
      const env = { ...process.env, WEFTMATE_DSH_CACHE_ROOT: shared, WEFTMATE_DSH_RUNTIME_DIR: output,
        WEFTMATE_DSH_PIN_FILE: join(context.project, 'tests/contract/dsh-pin.json'), WEFTMATE_DSH_CHECKOUT: join(dir, 'synthetic-source'), WEFTMATE_PNPM: 'synthetic-pnpm',
        WEFTMATE_VENDOR_FIXTURE_ROOT: dir, WEFTMATE_VENDOR_FIXTURE_PHASE: phase, WEFTMATE_VENDOR_FIXTURE_PACKAGES: JSON.stringify(context.names),
        NODE_OPTIONS: `--import=${pathToFileURL(resolve('tests/helpers/vendor-command-fixture.mjs')).href}` }
      if (inheritedInstallPaths) Object.assign(env, {
        npm_config_modules_dir: '../../other-cache/node_modules', npm_config_lockfile_dir: other,
        npm_config_virtual_store_dir: join(other, 'node_modules/.pnpm'), npm_config_global: 'true',
      })
      const result = shell
        ? spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'npm run vendor:dsh > vendor.log 2>&1; exit $LASTEXITCODE'], { cwd: context.project, env, encoding: 'utf8', windowsHide: true, timeout: 30000 })
        : spawnSync(process.execPath, [join(context.project, 'scripts/vendor-dsh.mjs')], { cwd: context.project, env, encoding: 'utf8', windowsHide: true, timeout: 30000 })
      assert.ifError(result.error)
      const logs = shell ? await readFile(join(context.project, 'vendor.log')).then(buffer => buffer[0] === 255 ? buffer.toString('utf16le') : buffer.toString('utf8')) : result.stdout + result.stderr
      const expectedStatus = cached === 'good' || (cached === 'absent' && phase === 'success') ? 0 : phase === 'interrupt' && cached === 'absent' ? 86 : 1
      assert.equal(result.status, expectedStatus, `${label}: ${logs}`)
      assert.deepEqual(await treeDigest(other), before, `${label}: linked cache changed`)
      if (beforeCache) assert.deepEqual(await treeDigest(cache), beforeCache, `${label}: published cache changed`)
      if (cached === 'good' || phase === 'success' && cached === 'absent') assert.equal(await realpath(output), await realpath(cache))
      rows.push({ pointer, cached, phase, shell: shell || 'node', status: result.status, protectedFiles: before.files, protectedSha256: before.sha256, unchanged: true })
    }
  }
  return rows
}
