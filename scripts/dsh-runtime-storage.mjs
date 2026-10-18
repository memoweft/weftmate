/** Filesystem boundary for immutable published runtimes and owned build scratch. */
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, symlink, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_WINDOWS_CACHE_ROOT = fileURLToPath(new URL('../.local/dsh-cache', import.meta.url))

export function isWithin(parent, child) {
  const rel = relative(parent, child)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

export async function pathStat(path) {
  try { return await lstat(path) }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null }
}

// Check ancestors too: lstat(leaf) alone cannot detect a parent junction.
export async function assertUnlinkedPath(path) {
  for (let current = resolve(path); ; current = dirname(current)) {
    if ((await pathStat(current))?.isSymbolicLink()) throw Error(`拒绝经联接或符号链接写入：${current}`)
    if (dirname(current) === current) return
  }
}

export async function assertRuntimeDestination(destination, cacheRoot) {
  destination = resolve(destination); cacheRoot = resolve(cacheRoot)
  await assertUnlinkedPath(cacheRoot)
  await assertUnlinkedPath(dirname(destination))
  // Redirecting cache builds must not turn the normal shared root into an output.
  const protectedRoots = [cacheRoot, ...(process.platform === 'win32' ? [resolve(DEFAULT_WINDOWS_CACHE_ROOT)] : [])]
  for (const root of protectedRoots) {
    if (relative(destination, root) === '' || isWithin(root, destination) || isWithin(destination, root)) {
      throw Error(`运行时输出与只读缓存根重叠：${destination}`)
    }
  }
}

/** Existing directories are retained, never recursively cleared or assembled in place. */
export async function pointRuntime(destination, cache, cacheRoot) {
  await assertRuntimeDestination(destination, cacheRoot)
  await mkdir(dirname(destination), { recursive: true })
  const stat = await pathStat(destination)
  if (stat?.isSymbolicLink()) {
    try { if (await realpath(destination) === await realpath(cache)) return }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  await retainRuntimeDestination(destination)
  await symlink(cache, destination, process.platform === 'win32' ? 'junction' : 'dir')
}

export async function retainRuntimeDestination(destination) {
  await assertUnlinkedPath(dirname(destination))
  const stat = await pathStat(destination)
  if (stat?.isSymbolicLink()) await unlink(destination)
  else if (stat) {
    const retained = `${destination}.replaced-${randomUUID()}`
    await rename(destination, retained)
    console.log(`[vendor-dsh] 保留原运行时目录：${retained}`)
  }
}

/** Only this object can clean the scratch directory it just created. */
export async function createRuntimeScratch(parent) {
  await assertUnlinkedPath(parent)
  await mkdir(parent, { recursive: true })
  const canonicalParent = await realpath(parent)
  const root = await mkdtemp(join(canonicalParent, 'weftmate-dsh-build-'))
  const owner = await lstat(root)
  const assertOwned = async (path = root) => {
    await assertUnlinkedPath(path)
    const current = await lstat(root)
    if (!current.isDirectory() || current.dev !== owner.dev || current.ino !== owner.ino
      || !isWithin(canonicalParent, await realpath(root))) throw Error(`拒绝清理非本次创建的临时目录：${root}`)
    const actual = await realpath(path)
    if (actual !== root && !isWithin(root, actual)) throw Error(`临时路径越界：${path}`)
  }
  const runtime = join(root, 'runtime')
  await mkdir(runtime)
  return {
    root, runtime, assertOwned,
    async publish(cache) {
      await assertOwned(runtime)
      await assertUnlinkedPath(dirname(cache))
      if (await pathStat(cache)) throw Error(`同身份缓存已存在；保留缓存，拒绝重新发布：${cache}`)
      // Directory rename fails if a competing nonempty cache has appeared.
      await rename(runtime, cache)
    },
    async dispose() {
      await assertOwned()
      // Unlink nested package-manager junctions explicitly before recursive removal.
      const detach = async dir => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name), stat = await lstat(path)
          if (stat.isSymbolicLink()) await unlink(path)
          else if (stat.isDirectory()) await detach(path)
        }
      }
      await detach(root)
      await assertOwned()
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
    },
  }
}
