import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, lstat, writeFile, cp } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

export const now = () => new Date().toISOString()
const writeChains = new Map()

export function id(value, label = 'identifier') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error(`Invalid ${label}`)
  return value
}

export async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) { if (error?.code === 'ENOENT') return null; throw error }
}

export async function atomicJson(path, value) {
  const previous = writeChains.get(path) ?? Promise.resolve()
  const write = previous.catch(() => {}).then(async () => {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
  })
  writeChains.set(path, write)
  try { await write } finally { if (writeChains.get(path) === write) writeChains.delete(path) }
}

async function entries(path) {
  return readdir(path, { withFileTypes: true }).catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error))
}

export class ModProjectStore {
  constructor(root) { this.root = root }
  projectsRoot() { return join(this.root, 'projects') }
  projectRoot(projectId) { return join(this.projectsRoot(), id(projectId, 'project id')) }
  projectFile(projectId) { return join(this.projectRoot(projectId), 'project.json') }
  workspace(projectId) { return join(this.projectRoot(projectId), 'workspace') }
  versionRoot(projectId, versionId) { return join(this.projectRoot(projectId), 'versions', id(versionId, 'version id')) }
  source(projectId, versionId) { return join(this.versionRoot(projectId, versionId), 'source') }
  versionFile(projectId, versionId) { return join(this.versionRoot(projectId, versionId), 'version.json') }
  data(projectId) { return join(this.projectRoot(projectId), 'data') }
  recoveryRoot(projectId) { return join(this.projectRoot(projectId), 'recovery') }
  runsRoot(projectId) { return join(this.projectRoot(projectId), 'runs') }
  runFile(projectId, runId) { return join(this.runsRoot(projectId), `${id(runId, 'run id')}.json`) }
  requirementsRoot(projectId) { return join(this.projectRoot(projectId), 'requirements') }
  incidentsRoot() { return join(this.root, 'incidents') }
  incidentFile(incidentId) { return join(this.incidentsRoot(), `${id(incidentId, 'incident id')}.json`) }

  async initialize() {
    await Promise.all([mkdir(this.projectsRoot(), { recursive: true }), mkdir(this.incidentsRoot(), { recursive: true })])
  }
  async createProject(project) {
    const root = this.projectRoot(project.project_id)
    await mkdir(root, { recursive: false })
    await Promise.all(['workspace', 'versions', 'data', 'runs', 'requirements', 'recovery'].map(name => mkdir(join(root, name), { recursive: true })))
    await atomicJson(this.projectFile(project.project_id), project)
    return project
  }
  project(projectId) { return readJson(this.projectFile(projectId)) }
  async saveProject(project) { await atomicJson(this.projectFile(project.project_id), project); return project }
  async projectIds() { return (await entries(this.projectsRoot())).filter(item => item.isDirectory()).map(item => item.name).filter(name => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) }
  async writeWorkspace(projectId, files) {
    const destination = this.workspace(projectId)
    const stage = `${destination}.stage-${randomUUID()}`
    await mkdir(stage, { recursive: false })
    try {
      for (const [relative, content] of Object.entries(files)) {
        if (typeof content !== 'string' && !Buffer.isBuffer(content)) throw new Error(`Project file must be text or bytes: ${relative}`)
        const target = safeRelative(stage, relative)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, content)
      }
      // Workspace remains editable, but a failed bulk edit never erases its
      // prior source tree.  Rename is the only switch after staging succeeds.
      const previous = `${destination}.previous-${randomUUID()}`
      const present = await lstat(destination).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error))
      if (present?.isSymbolicLink()) throw new Error('Workspace may not be a symbolic link or reparse point')
      if (present) await rename(destination, previous)
      await rename(stage, destination)
      if (present) await rm(previous, { recursive: true, force: true })
    } catch (error) { await rm(stage, { recursive: true, force: true }); throw error }
  }
  async snapshot(projectId, version) {
    const source = this.source(projectId, version.version_id)
    await mkdir(join(source, '..'), { recursive: true })
    await assertOrdinaryTree(this.workspace(projectId))
    await cp(this.workspace(projectId), source, { recursive: true, errorOnExist: true, verbatimSymlinks: true, filter: entry => !forbiddenName(entry) })
    await atomicJson(this.versionFile(projectId, version.version_id), version)
    return version
  }
  version(projectId, versionId) { return readJson(this.versionFile(projectId, versionId)) }
  async saveVersion(projectId, version) { await atomicJson(this.versionFile(projectId, version.version_id), version); return version }
  async versions(projectId) {
    const root = join(this.projectRoot(projectId), 'versions')
    const names = (await entries(root)).filter(item => item.isDirectory()).map(item => item.name)
    return (await Promise.all(names.map(name => this.version(projectId, name)))).filter(Boolean).sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
  async saveRun(projectId, run) { await atomicJson(this.runFile(projectId, run.run_id), run); return run }
  async checkpointData(projectId, checkpoint) {
    const idValue = id(checkpoint, 'recovery checkpoint id')
    const target = join(this.recoveryRoot(projectId), idValue)
    await mkdir(target, { recursive: false })
    const data = this.data(projectId)
    await assertOrdinaryTree(data)
    await cp(data, join(target, 'data'), { recursive: true, errorOnExist: true, verbatimSymlinks: true })
    return target
  }
  async restoreData(projectId, checkpoint) {
    const source = join(this.recoveryRoot(projectId), id(checkpoint, 'recovery checkpoint id'), 'data')
    await assertOrdinaryTree(source)
    const destination = this.data(projectId)
    const present = await lstat(destination).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error))
    if (present?.isSymbolicLink()) throw new Error('Project data may not be a symbolic link or reparse point')
    if (present) await rm(destination, { recursive: true, force: true })
    await cp(source, destination, { recursive: true, errorOnExist: true, verbatimSymlinks: true })
  }
  run(projectId, runId) { return readJson(this.runFile(projectId, runId)) }
  async runs(projectId) {
    const names = (await entries(this.runsRoot(projectId))).filter(item => item.isFile() && item.name.endsWith('.json')).map(item => item.name)
    return (await Promise.all(names.map(name => readJson(join(this.runsRoot(projectId), name))))).filter(Boolean).sort((a, b) => b.started_at.localeCompare(a.started_at))
  }
  async saveRequirement(projectId, requirement) {
    await atomicJson(join(this.requirementsRoot(projectId), `${id(requirement.requirement_id, 'requirement id')}.json`), requirement)
    return requirement
  }
  async saveIncident(incident) { await atomicJson(this.incidentFile(incident.incident_id), incident); return incident }
  incident(incidentId) { return readJson(this.incidentFile(incidentId)) }
  async incidents() {
    const names = (await entries(this.incidentsRoot())).filter(item => item.isFile() && item.name.endsWith('.json')).map(item => item.name)
    return (await Promise.all(names.map(name => readJson(join(this.incidentsRoot(), name))))).filter(Boolean).sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
}

export function safeRelative(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || relative.includes('\\') || relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) throw new Error(`Unsafe project path: ${relative}`)
  const base = resolve(root)
  const target = resolve(base, ...relative.split('/'))
  const outside = relativePath(base, target)
  if (outside === '..' || outside.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || outside === '') throw new Error(`Unsafe project path: ${relative}`)
  return target
}

function relativePath(base, target) { return relative(base, target) }

function forbiddenName(entry) {
  const name = entry.replace(/\\/g, '/').split('/').at(-1)
  return ['.git', 'node_modules', '.env', '.npmrc', 'credentials', 'secrets', 'runtime'].includes(name.toLowerCase())
}

export async function sourceDigest(root) {
  const hash = createHash('sha256')
  async function visit(directory, prefix = '') {
    for (const item of (await entries(directory)).sort((a, b) => a.name.localeCompare(b.name))) {
      if (forbiddenName(item.name)) continue
      const path = join(directory, item.name)
      const relative = `${prefix}${item.name}`
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw new Error(`Source tree contains a symbolic link or reparse point: ${relative}`)
      if (item.isDirectory()) { hash.update(`D:${relative}\n`); await visit(path, `${relative}/`); continue }
      if (!item.isFile()) continue
      hash.update(`F:${relative}:${info.size}\n`)
      hash.update(await readFile(path))
    }
  }
  await visit(root)
  return hash.digest('hex')
}

export async function assertOrdinaryTree(root) {
  async function visit(directory) {
    const self = await lstat(directory)
    if (self.isSymbolicLink()) throw new Error('Project source may not contain symbolic links or reparse points')
    for (const item of await entries(directory)) {
      if (forbiddenName(item.name)) throw new Error(`Forbidden project source path: ${item.name}`)
      const path = join(directory, item.name)
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw new Error(`Project source may not contain symbolic links or reparse points: ${item.name}`)
      if (info.isDirectory()) await visit(path)
      else if (!info.isFile()) throw new Error(`Project source must contain ordinary files: ${item.name}`)
    }
  }
  await visit(root)
}
