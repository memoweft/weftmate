import { isAbsolute, parse, relative, resolve, sep } from 'node:path'
import { homedir, hostname, userInfo } from 'node:os'
import { createHash } from 'node:crypto'

export const CANDIDATE_VERSION_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-[a-z][a-z0-9-]*\.(?:0|[1-9]\d*)$/i

export function assertCandidateVersion(value) {
  if (typeof value !== 'string' || !CANDIDATE_VERSION_RE.test(value)) {
    throw new Error('candidate version must match major.minor.patch-label.N')
  }
  return value
}

export function assertIsolatedOutput(repoRoot, requested) {
  const root = resolve(repoRoot)
  const output = resolve(requested)
  if (output === parse(output).root) throw new Error('candidate output cannot be a filesystem root')
  const rel = relative(root, output)
  if (output === root || rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return output
  }
  // Repository-local build output is allowed only below the ignored dist tree.
  const dist = resolve(root, 'dist')
  const distRel = relative(dist, output)
  if (output !== dist && (distRel === '..' || distRel.startsWith(`..${sep}`) || isAbsolute(distRel))) {
    throw new Error('repository-local candidate output must stay below dist')
  }
  return output
}

export function forbiddenArchiveEntry(entry) {
  const normalized = String(entry).replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase()
  const topLevel = [
    'dogfood/', 'tests/', 'scripts/', '.git/', '.stage/', 'dist/', 'vendor/',
  ]
  if (topLevel.some((prefix) => normalized.startsWith(prefix))) return true
  const basename = normalized.split('/').at(-1)
  return basename === '.env'
    || basename?.startsWith('.env.')
    || basename === '.credentials.yaml'
    || basename === 'weftmate-model.enc'
    || basename === 'weftmate-settings.json'
    || basename === 'weftmate-crash.log'
}

export function containsDevelopmentPath(text) {
  const value = normalizePackagedText(text)
  return /D:[\\/]AIProjects[\\/](?:WeftMate[\\/]Repository|Shared[\\/]Dependencies)/i.test(value)
    || /[A-Za-z]:[\\/]+Users[\\/]+(?:<user>|[^\\/\r\n"\x27<>]+)(?:[\\/]|$)/i.test(value)
}

export function stageRuntimeEntry(entry) {
  const path = String(entry).replaceAll('\\', '/')
  if (path === 'tarballs' || path.startsWith('tarballs/')) return false
  // Hoisted vendor packages are physical directories. These generated pnpm
  // files are install/cache state and machine-specific command shims, not the
  // runtime entrypoints (bin/dsh-web and each package's main/exports).
  return !/(?:^|\/)node_modules\/(?:\.bin|\.pnpm)(?:\/|$)/.test(path)
    && !/(?:^|\/)node_modules\/(?:\.modules\.yaml|\.pnpm-workspace-state-v1\.json)$/.test(path)
}

// Compare literal paths, JSON escapes and forward slashes with the same policy.
function normalizePackagedText(text) {
  return String(text).replace(/\\+/g, '/').toLowerCase()
}

export function buildMachineIdentity() {
  return { home: homedir(), username: userInfo().username, hostname: hostname(), roots: [process.cwd(), process.env.WEFTMATE_DSH_CHECKOUT].filter(Boolean) }
}

export function containsBuildMachineIdentity(text, identity = buildMachineIdentity()) {
  const value = normalizePackagedText(text)
  // Preserve the pre-existing source-checkout rule across every dependency.
  if (/D:[\/]AIProjects[\/](?:WeftMate[\/]Repository|Shared[\/]Dependencies)/i.test(value)) return true
  for (const path of [identity.home, ...(identity.roots ?? [])].filter(Boolean)) {
    if (value.includes(normalizePackagedText(path))) return true
  }
  // Names are tokens: a short username must not match inside unrelated words.
  for (const name of [identity.username, identity.hostname].filter(Boolean)) {
    const escaped = String(name).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(?<![\\p{L}\\p{N}_-])${escaped}(?![\\p{L}\\p{N}_-])`, 'u').test(value)) return true
  }
  return false
}

export function isThirdPartyPackageFile(file) {
  const parts = String(file).replaceAll('\\', '/').replace(/^\/+/, '').split('/')
  // Locked upstream Python wheels can contain their publisher's PDB paths,
  // just as npm dependencies contain upstream source examples. The complete
  // memory manifest is verified before scanning; local builder identity is
  // still rejected by packagedTextViolation for every byte/file.
  if (parts[0] === 'memory-runtime' && parts[1] === 'site-packages') return true
  const index = parts.lastIndexOf('node_modules')
  if (index < 0) return false
  // WeftMate plugins remain first party even when mounted as packages.
  const name = parts[index + 1] ?? ''
  return !/^(@weftmate|weftmate(?:-|$))/i.test(name)
}

function publisherIdentity(value, file, identity) {
  // Original files from lock.json's tokenizers 0.22.2, hf-xet 1.7.0 and
  // NumPy 2.4.3 Windows wheels carry their publisher's public GitHub runner
  // HOME/account. Those can equal our builder. Match raw bytes and the full
  // resource path; source roots and host names are never waived.
  const publisherFiles = {
    'memory-runtime/site-packages/tokenizers/tokenizers.pyd': '7acb83f5b89136597e0d14b788d82917bf2870df94575bf77e12731c4e49c4df',
    'memory-runtime/site-packages/hf_xet/hf_xet.pyd': '246516c4a365fcd9befa6f901a82ec3478bcdf7952c04fba2d0926024711ccc2',
    'memory-runtime/site-packages/numpy/__config__.py': '621939d2b6fcf0c162f654ea53a2deb8027a16ab2556c69ae4697679ae227df6',
    'memory-runtime/site-packages/numpy-2.4.3.dist-info/DELVEWHEEL': 'f0b8626921a4df68c3b04c5968d0a5611c67b9fd15b30fddf10c319fdec18971',
  }
  const expected = publisherFiles[String(file).replaceAll('\\', '/').replace(/^\/+/, '')]
  if (!expected) return identity
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value
  if (createHash('sha256').update(bytes).digest('hex') !== expected) return identity
  return { ...identity,
    home: normalizePackagedText(identity.home).replace(/\/$/, '') === 'c:/users/runneradmin' ? null : identity.home,
    username: String(identity.username).toLowerCase() === 'runneradmin' ? null : identity.username,
  }
}

export function packagedTextViolation(text, file, identity = buildMachineIdentity()) {
  identity = publisherIdentity(text, file, identity)
  // Public labels, tokenizer vocabulary and mathematical references may match
  // a short builder name. Only these exact fixed publisher bytes have that
  // provenance. Changed bytes and all paths retain full identity checks.
  const publicNames = {
    'node_modules/tlds/index.json': '39498bb22800167e8b6fa73740b2686decb4ffdbea3e8333f32020f5714938f2',
    'memory-runtime/models/tokenizer.json': '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
    'memory-runtime/site-packages/sympy/polys/sqfreetools.py': 'a1116538b85c5f3e4e2a373d490b4eb8484cbda72f907c93484aa193a4a78756',
  }
  const publicHash = publicNames[String(file).replaceAll('\\','/').replace(/^\/+/, '')]
  if (publicHash && publicHash === createHash('sha256').update(text).digest('hex')) {
    return containsBuildMachineIdentity(text, {...identity, username:null, hostname:null}) ? 'build-machine-identity' : null
  }
  if (containsBuildMachineIdentity(text, identity)) return 'build-machine-identity'
  if (!isThirdPartyPackageFile(file) && containsDevelopmentPath(text)) return 'development-path'
  return null
}

export function packagedBinaryViolation(bytes, file, identity = buildMachineIdentity()) {
  // Native binaries can carry PDB/source paths. Check paths and host names in
  // UTF-8 and UTF-16 too; short bare usernames in random bytes are not text.
  const binaryIdentity = publisherIdentity(bytes, file, { ...identity, username: null })
  for (const value of [bytes.toString('utf8'), bytes.toString('utf16le')]) {
    const violation = packagedTextViolation(value, file, binaryIdentity)
    if (violation) return violation
  }
  return null
}

export function redactBuildMachineIdentity(text, identity = buildMachineIdentity()) {
  let value = String(text)
  for (const [name, replacement] of [[identity.username, '<user>'], [identity.hostname, '<host>']]) {
    if (!name) continue
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    value = value.replace(new RegExp(`(?<![\\p{L}\\p{N}_-])${escaped}(?![\\p{L}\\p{N}_-])`, 'giu'), replacement)
  }
  return value
}
