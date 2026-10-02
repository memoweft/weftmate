import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'
import { safeRelative, sourceDigest } from './store.mjs'

const excluded = new Set(['.git', 'node_modules', '.env', '.npmrc', 'credentials', 'secrets', 'runtime'])
const sourceExtensions = new Set(['.js', '.mjs'])
const importExpression = /(?:\bimport\s*(?:[^'"()]*?\s+from\s*)?|\bexport\s+[^'"()]*?\s+from\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/g
const knownCapabilities = new Set(['ui.customAsset', 'ui.shared', 'memory.read', 'memory.write', 'model.call', 'state.read', 'state.write', 'dependencies.install'])

function sourceError(message) { const error = new Error(message); error.code = 'MOD_SOURCE_INVALID'; return error }

function capabilityList(value, label) {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length > 16 || value.some(item => typeof item !== 'string' || !knownCapabilities.has(item))) throw sourceError(`${label} must contain only known bounded capability ids`)
}

function validateManifestExtension(manifest) {
  if (manifest.manifestVersion !== undefined && manifest.manifestVersion !== 1) throw sourceError('manifestVersion, when supplied, must be 1')
  if (manifest.capabilities !== undefined) {
    if (!manifest.capabilities || typeof manifest.capabilities !== 'object' || Array.isArray(manifest.capabilities)) throw sourceError('manifest.capabilities must be an object')
    capabilityList(manifest.capabilities.required, 'manifest.capabilities.required')
    capabilityList(manifest.capabilities.optional, 'manifest.capabilities.optional')
  }
  if (manifest.settings !== undefined || manifest.contributes !== undefined) throw sourceError('manifest.settings and manifest.contributes are not implemented runtime capabilities')
}

export async function validateSourceTree(source, manifest) {
  if (!manifest || typeof manifest !== 'object' || typeof manifest.entry !== 'string' || !manifest.entry.endsWith('.mjs')) throw sourceError('manifest.entry must name a project-relative .mjs module')
  if (manifest.validate !== 'selfTest') throw sourceError('manifest.validate must be "selfTest"; a smoke import is not a validation receipt')
  if (manifest.state !== undefined && (typeof manifest.state !== 'string' || !manifest.state.startsWith('data/'))) throw sourceError('manifest.state, when present, must be under data/')
  if (manifest.state !== undefined) try { safeRelative(resolve(source, '..', 'state-check'), manifest.state.slice('data/'.length)) } catch { throw sourceError('manifest.state escapes the project data directory') }
  validateManifestExtension(manifest)
  if (manifest.ui !== undefined) {
    if (!manifest.ui || typeof manifest.ui !== 'object' || typeof manifest.ui.assets !== 'string') throw sourceError('manifest.ui.assets must name a project-relative directory')
    try { safeRelative(source, manifest.ui.assets) } catch { throw sourceError('manifest.ui.assets escapes the project source tree') }
  }
  const entry = safeRelative(source, manifest.entry)
  const seen = new Set()
  async function check(path) {
    const absolute = resolve(path)
    if (seen.has(absolute)) return
    const throughRoot = relative(source, absolute)
    if (throughRoot.startsWith('..') || throughRoot.includes('..\\')) throw sourceError('Import escapes the project source tree')
    const info = await lstat(absolute).catch(() => null)
    if (!info || !info.isFile() || info.isSymbolicLink()) throw sourceError(`Project source is missing or linked: ${throughRoot}`)
    seen.add(absolute)
    if (!sourceExtensions.has(extname(absolute))) return
    const text = await readFile(absolute, 'utf8')
    for (const match of text.matchAll(importExpression)) {
      const specifier = match[1]
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw sourceError(`Only project-relative ESM imports are allowed: ${specifier}`)
      const resolved = resolve(dirname(absolute), specifier)
      await check(resolved)
    }
  }
  async function scan(directory) {
    const info = await lstat(directory)
    if (info.isSymbolicLink()) throw sourceError('Project source may not contain symbolic links or reparse points')
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (excluded.has(item.name.toLowerCase())) throw sourceError(`Forbidden source path: ${item.name}`)
      const path = resolve(directory, item.name)
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw sourceError(`Project source may not contain symbolic links or reparse points: ${item.name}`)
      if (item.isDirectory()) await scan(path)
    }
  }
  await scan(source)
  await check(entry)
  await realpath(entry) // detects an unusual Windows link after traversal too.
  return { digest: await sourceDigest(source), entry }
}
