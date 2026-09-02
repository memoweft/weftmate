#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import asarApi from '@electron/asar'
import { containsDevelopmentPath, forbiddenArchiveEntry } from './windows-package-policy.mjs'

const { extractFile, listPackage, statFile } = asarApi

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

function option(name, required = true) {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (required && (!value || value.startsWith('--'))) throw new Error(`${name} is required`)
  return value
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

async function assertNoReparsePoints(root) {
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    const stat = await lstat(current)
    if (stat.isSymbolicLink()) throw new Error(`packaged resource contains a reparse point: ${relative(root, current)}`)
    if (!stat.isDirectory()) continue
    for (const entry of await readdir(current)) pending.push(join(current, entry))
  }
}

const textExtensions = new Set(['.cjs', '.css', '.html', '.js', '.json', '.mjs', '.ts', '.txt', '.yml', '.yaml'])
async function scanTextTree(root) {
  const pending = [root]
  let scannedFiles = 0
  while (pending.length > 0) {
    const current = pending.pop()
    const stat = await lstat(current)
    if (stat.isDirectory()) {
      for (const entry of await readdir(current)) pending.push(join(current, entry))
      continue
    }
    if (!stat.isFile() || stat.size > 5_000_000 || !textExtensions.has(extname(current).toLowerCase())) continue
    const text = await readFile(current, 'utf8')
    if (containsDevelopmentPath(text)) throw new Error(`packaged text contains a development-machine path: ${relative(root, current)}`)
    scannedFiles += 1
  }
  return scannedFiles
}

const unpacked = resolve(option('--unpacked'))
const installer = resolve(option('--installer'))
const resources = join(unpacked, 'resources')
const asar = join(resources, 'app.asar')
const runtime = join(resources, 'dsh-runtime')
const vendorManifest = join(runtime, 'VENDOR-MANIFEST.json')

for (const required of [unpacked, installer, asar, runtime, vendorManifest]) {
  if (!existsSync(required)) throw new Error(`required packaged artifact is missing: ${basename(required)}`)
}

const vendor = JSON.parse(readFileSync(vendorManifest, 'utf8'))
const runtimeEntry = join(runtime, ...String(vendor.webRuntimeEntry ?? '').split('/'))
if (!existsSync(runtimeEntry)) throw new Error('packaged DSH runtime entry is missing')
if (!Array.isArray(vendor.carriedButNotMounted) || vendor.carriedButNotMounted.length !== 0) {
  throw new Error('packaged vendor manifest reports unmounted runtime packages')
}

const entries = listPackage(asar, { isPack: false })
const forbidden = entries.filter(forbiddenArchiveEntry)
if (forbidden.length > 0) throw new Error(`app.asar contains forbidden development or user-data entries: ${forbidden.slice(0, 8).join(', ')}`)
if (!entries.some((entry) => entry.replaceAll('\\', '/').endsWith('/src/main.mjs'))) throw new Error('app.asar does not contain src/main.mjs')

let asarTextFiles = 0
let asarDirectories = 0
let asarLinks = 0
for (const entry of entries) {
  const archivePath = entry.replace(/^[/\\]+/, '')
  const metadata = statFile(asar, archivePath, false)
  if ('files' in metadata) {
    asarDirectories += 1
    continue
  }
  if ('link' in metadata) {
    const target = String(metadata.link)
    if (target.startsWith('/') || /^[a-z]:[/\\]/i.test(target) || containsDevelopmentPath(target)) {
      throw new Error(`app.asar contains an unsafe link target: ${entry}`)
    }
    asarLinks += 1
    continue
  }
  if (!textExtensions.has(extname(entry).toLowerCase())) continue
  const bytes = extractFile(asar, archivePath, false)
  if (bytes.length > 5_000_000) continue
  if (containsDevelopmentPath(bytes.toString('utf8'))) throw new Error(`app.asar contains a development-machine path: ${entry}`)
  asarTextFiles += 1
}

await assertNoReparsePoints(runtime)
const runtimeTextFiles = await scanTextTree(runtime)

const result = {
  schemaVersion: 1,
  installer: { file: basename(installer), bytes: (await lstat(installer)).size, sha256: sha256(installer) },
  appArchive: {
    entries: entries.length,
    directories: asarDirectories,
    links: asarLinks,
    scannedTextFiles: asarTextFiles,
    forbiddenEntries: 0,
    unsafeLinks: 0,
  },
  vendor: {
    packageVersion: vendor.dsh?.packageVersion ?? null,
    commit: vendor.dsh?.commit ?? null,
    closureCount: Array.isArray(vendor.closure) ? vendor.closure.length : null,
    carriedButNotMounted: vendor.carriedButNotMounted.length,
    manifestSha256: sha256(vendorManifest),
    scannedTextFiles: runtimeTextFiles,
    reparsePoints: 0,
  },
  boundaries: {
    developmentPaths: 0,
    userDataFiles: 0,
    dogfoodOrRepositoryTests: 0,
    credentialsFiles: 0,
  },
}
console.log(JSON.stringify(result, null, 2))
