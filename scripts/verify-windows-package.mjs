#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import asarApi from '@electron/asar'
import { buildMachineIdentity, containsDevelopmentPath, forbiddenArchiveEntry, packagedTextViolation } from './windows-package-policy.mjs'

const { extractFile, listPackage, statFile, uncache } = asarApi

const here = dirname(fileURLToPath(import.meta.url))

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

function decodeText(bytes) {
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0xfe && bytes[1] === 0xff
  if (!utf16 && bytes.includes(0)) return null
  try { return new TextDecoder(utf16 ? (bytes[0] === 0xff ? 'utf-16le' : 'utf-16be') : 'utf-8', { fatal: true }).decode(bytes) }
  catch { return null }
}
function binaryViolation(bytes, file, identity) {
  // Native binaries can carry PDB/source paths. Check paths and host names in
  // UTF-8 and UTF-16 too; short bare usernames in random bytes are not text.
  const binaryIdentity = { ...identity, username: null }
  for (const value of [bytes.toString('utf8'), bytes.toString('utf16le')]) {
    const violation = packagedTextViolation(value, file, binaryIdentity)
    if (violation) return violation
  }
  return null
}
async function scanTextTree(root, identity) {
  const pending = [root]
  let scannedFiles = 0
  let runtimeTextFiles = 0
  let binaryFiles = 0
  while (pending.length > 0) {
    const current = pending.pop()
    const stat = await lstat(current)
    if (stat.isDirectory()) {
      for (const entry of await readdir(current)) pending.push(join(current, entry))
      continue
    }
    if (!stat.isFile() || current === join(root, 'app.asar')) continue
    const bytes = await readFile(current)
    const text = decodeText(bytes)
    const file = relative(root, current)
    const violation = text === null ? binaryViolation(bytes, file, identity) : packagedTextViolation(text, file, identity)
    if (violation) throw new Error(`packaged text contains ${violation}: ${file}`)
    if (text !== null) {
      scannedFiles += 1
      if (file.replaceAll('\\', '/').startsWith('dsh-runtime/')) runtimeTextFiles += 1
    } else binaryFiles += 1
  }
  return { scannedFiles, runtimeTextFiles, binaryFiles }
}

export async function verifyWindowsPackage({ unpacked, installer, identity = buildMachineIdentity() }) {
  unpacked = resolve(unpacked)
  installer = resolve(installer)
  identity = { ...identity, roots: [...(identity.roots ?? []), resolve(here, '..')] }
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

  // A release process may inspect successive builds at the same archive path.
  uncache(asar)
  const entries = listPackage(asar, { isPack: false })
  const forbidden = entries.filter(forbiddenArchiveEntry)
  if (forbidden.length > 0) throw new Error(`app.asar contains forbidden development or user-data entries: ${forbidden.slice(0, 8).join(', ')}`)
  if (!entries.some((entry) => entry.replaceAll('\\', '/').endsWith('/src/main.mjs'))) throw new Error('app.asar does not contain src/main.mjs')

  let asarTextFiles = 0
  let asarDirectories = 0
  let asarLinks = 0
  let asarBinaryFiles = 0
  for (const entry of entries) {
    const archivePath = entry.replace(/^[/\\]+/, '')
    const metadata = statFile(asar, archivePath, false)
    if ('files' in metadata) {
      asarDirectories += 1
      continue
    }
    if ('link' in metadata) {
      const target = String(metadata.link)
      if (target.startsWith('/') || /^[a-z]:[/\\]/i.test(target) || containsDevelopmentPath(target) || packagedTextViolation(target, entry, identity)) {
        throw new Error(`app.asar contains an unsafe link target: ${entry}`)
      }
      asarLinks += 1
      continue
    }
    const bytes = extractFile(asar, archivePath, false)
    const text = decodeText(bytes)
    const violation = text === null ? binaryViolation(bytes, entry, identity) : packagedTextViolation(text, entry, identity)
    if (violation) throw new Error(`app.asar contains ${violation}: ${entry}`)
    if (text !== null) asarTextFiles += 1
    else asarBinaryFiles += 1
  }

  await assertNoReparsePoints(runtime)
  // Include unpacked app dependencies, relay configuration and all loose resources.
  const resourceScan = await scanTextTree(resources, identity)

  const result = {
    schemaVersion: 1,
    installer: { file: basename(installer), bytes: (await lstat(installer)).size, sha256: sha256(installer) },
    appArchive: {
      entries: entries.length,
      directories: asarDirectories,
      links: asarLinks,
      scannedTextFiles: asarTextFiles,
      scannedBinaryFiles: asarBinaryFiles,
      forbiddenEntries: 0,
      unsafeLinks: 0,
    },
    vendor: {
      packageVersion: vendor.dsh?.packageVersion ?? null,
      commit: vendor.dsh?.commit ?? null,
      closureCount: Array.isArray(vendor.closure) ? vendor.closure.length : null,
      carriedButNotMounted: vendor.carriedButNotMounted.length,
      manifestSha256: sha256(vendorManifest),
      scannedTextFiles: resourceScan.runtimeTextFiles,
      reparsePoints: 0,
    },
    looseResources: { scannedTextFiles: resourceScan.scannedFiles, scannedBinaryFiles: resourceScan.binaryFiles },
    boundaries: {
      developmentPaths: 0,
      buildMachineIdentityHits: 0,
      userDataFiles: 0,
      dogfoodOrRepositoryTests: 0,
      credentialsFiles: 0,
    },
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await verifyWindowsPackage({ unpacked: option('--unpacked'), installer: option('--installer') }), null, 2))
}
