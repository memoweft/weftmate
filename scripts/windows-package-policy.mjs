import { isAbsolute, parse, relative, resolve, sep } from 'node:path'
import { homedir, hostname, userInfo } from 'node:os'

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
  const index = parts.lastIndexOf('node_modules')
  if (index < 0) return false
  // WeftMate plugins remain first party even when mounted as packages.
  const name = parts[index + 1] ?? ''
  return !/^(@weftmate|weftmate(?:-|$))/i.test(name)
}

export function packagedTextViolation(text, file, identity = buildMachineIdentity()) {
  if (containsBuildMachineIdentity(text, identity)) return 'build-machine-identity'
  if (!isThirdPartyPackageFile(file) && containsDevelopmentPath(text)) return 'development-path'
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
