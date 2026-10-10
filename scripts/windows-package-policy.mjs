import { isAbsolute, parse, relative, resolve, sep } from 'node:path'

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
  const value = String(text)
  return /D:[\\/]AIProjects[\\/](?:WeftMate[\\/]Repository|Shared[\\/]Dependencies)/i.test(value)
    || /[A-Za-z]:[\\/]+Users[\\/]+(?:<user>|[^\\/\r\n"\x27<>]+)(?:[\\/]|$)/i.test(value)
}
