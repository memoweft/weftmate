import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { assertPackageEntrypoints, isSkippedPlatformOptional } from './dsh-vendor-closure.mjs'

/** Identity is based on patch names and complete LF content, never cache directory names. */
export async function runtimeIdentity(repoRoot, { pinFile = process.env.WEFTMATE_DSH_PIN_FILE } = {}) {
  const pin = JSON.parse(await readFile(pinFile ? resolve(repoRoot, pinFile) : join(repoRoot, 'tests/contract/dsh-pin.json'), 'utf8'))
  let names
  try { names = (await readdir(join(repoRoot, 'patches/dsh'))).filter(name => name.endsWith('.patch')).sort() }
  catch (error) { if (error.code !== 'ENOENT') throw error; names = [] }
  const hash = createHash('sha256')
  const patches = []
  for (const name of names) {
    const content = Buffer.from((await readFile(join(repoRoot, 'patches/dsh', name), 'utf8')).replaceAll('\r\n', '\n'))
    hash.update(`${Buffer.byteLength(name)}:${name}:${content.length}:`).update(content)
    patches.push({ name, sha256: createHash('sha256').update(content).digest('hex') })
  }
  const patchesSha256 = hash.digest('hex')
  return { schemaVersion: 1, commit: pin.commit, packageVersion: pin.packageVersion,
    patchesSha256, patches, key: `${pin.commit}-${patchesSha256}` }
}

export async function assertRuntimeIdentity(runtime, repoRoot, options) {
  const expected = await runtimeIdentity(repoRoot, options)
  let manifest
  try { manifest = JSON.parse(await readFile(join(runtime, 'VENDOR-MANIFEST.json'), 'utf8')) }
  catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    throw new Error(`运行时过期：缺少有效 VENDOR-MANIFEST.json（${error.code ?? 'invalid JSON'}）；运行 npm run vendor:dsh`)
  }
  const actual = manifest.runtimeIdentity
  if (manifest.dsh?.commit !== expected.commit || manifest.dsh?.packageVersion !== expected.packageVersion
    || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`运行时过期：固定提交或补丁内容不匹配（期望 ${expected.key}，实际 ${actual?.key ?? '无补丁身份'}）；运行 npm run vendor:dsh`)
  }
  // An interrupted or incomplete assembly cannot be reused as a cache hit.
  await readFile(join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'))
  // A surviving CLI alone does not make a partially deleted closure reusable.
  // Legacy synthetic identity-only fixtures have no closure; generated runtimes do.
  if (Array.isArray(manifest.closure)) {
    try {
      for (const entry of manifest.closure) {
        if (!isSkippedPlatformOptional(entry)) {
          const pkg = JSON.parse(await readFile(join(runtime, 'node_modules', entry.name, 'package.json'), 'utf8'))
          if (pkg.version !== entry.version) throw Error(`包版本不匹配：${entry.name}`)
        }
        if (entry.tarball && entry.sha256) {
          const hash = createHash('sha256').update(await readFile(join(runtime, 'tarballs', entry.tarball))).digest('hex')
          if (hash !== entry.sha256) throw Error(`tarball SHA-256 不匹配：${entry.name}`)
        }
      }
      await assertPackageEntrypoints(join(runtime, 'node_modules'), manifest.closure)
    } catch (error) {
      throw Error(`运行时过期：缓存内容不完整（${error.message}）；保留缓存，运行 npm run vendor:dsh`)
    }
  }
  return expected
}
