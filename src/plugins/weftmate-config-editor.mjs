import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
import yaml from 'js-yaml'

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function mergeLayers(inherited, override) {
  if (!isRecord(inherited) || !isRecord(override)) return structuredClone(override)
  const merged = structuredClone(inherited)
  for (const [key, value] of Object.entries(override)) {
    Object.defineProperty(merged, key, {
      value: Object.hasOwn(merged, key) ? mergeLayers(merged[key], value) : structuredClone(value),
      enumerable: true, configurable: true, writable: true,
    })
  }
  return merged
}

export default class WeftMateConfigEditor extends Service {
  static inject = ['loader']

  constructor(ctx) {
    super(ctx, 'configEditor')
    this.inherited = new Map()
    this.overrides = new Map()
    this.queue = Promise.resolve()
    const profileDir = process.env.WEFTMATE_SECURE_BOOTSTRAP_PROFILE_DIR
    const runtimePackageAnchor = process.env.WEFTMATE_SECURE_BOOTSTRAP_PACKAGE_ANCHOR
    ctx.provide('profileContext', {
      name: 'weftmate', dir: profileDir, patchPath: this.documentPath,
      installAnchor: runtimePackageAnchor, startedBundles: [], cwd: process.cwd(),
      home: join(profileDir, '.weftmate-settings-home'), overlays: [], telemetryDisabledEnv: '1',
    })
  }

  get documentPath() { return join(process.env.DSH_HOME || '', 'settings.yaml') }

  async [Service.init]() {
    let source
    try { source = await readFile(this.documentPath, 'utf8') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    if (source !== undefined) {
      const sections = yaml.load(source) ?? {}
      if (!isRecord(sections)) throw new Error('Settings document must contain top-level sections')
      for (const [id, override] of Object.entries(sections)) this.overrides.set(id, override)
    }
    // Waiting inside Service.init would prevent the Loader itself from settling.
    this.ready = this.ctx.root.loader.await().then(async () => {
      for (const { entry, inherited, override } of this.configuration()) {
        if (this.overrides.has(entry.options.id)) await entry.update({ config: mergeLayers(inherited, override) })
      }
    })
    void this.ready.catch(error => this.ctx.logger.error(error))
  }

  entries() {
    const candidates = [...this.ctx.loader.entries()].filter(entry => entry.parent?.tree?.ctx?.fiber?.entry?.id === 'include')
    const counts = new Map()
    for (const entry of candidates) counts.set(entry.options.id, (counts.get(entry.options.id) ?? 0) + 1)
    return candidates.filter(entry => counts.get(entry.options.id) === 1)
  }

  configuration() {
    return this.entries().map(entry => {
      const id = entry.options.id
      if (!this.inherited.has(id)) this.inherited.set(id, structuredClone(entry.options.config ?? {}))
      return { entry, inherited: structuredClone(this.inherited.get(id)), override: structuredClone(this.overrides.get(id) ?? {}) }
    })
  }

  edit(entry, change) {
    const run = this.queue.then(async () => {
      await this.ready
      const layers = this.configuration().find(row => row.entry === entry)
      if (!layers || !entry.fiber) throw new Error('Configuration entry is no longer available')
      const { inherited, override } = layers
      const current = mergeLayers(inherited, override)
      const next = change(structuredClone(current), structuredClone(inherited))
      entry.fiber.resolveConfig(next)
      this.overrides.set(entry.options.id, structuredClone(next))
      await mkdir(dirname(this.documentPath), { recursive: true })
      await writeFile(this.documentPath, yaml.dump(Object.fromEntries(this.overrides)), { encoding: 'utf8', mode: 0o600 })
      await entry.update({ config: mergeLayers(inherited, next) })
      this.ctx.root.emit('app-boot/config-reload')
    })
    this.queue = run.catch(() => {})
    return run
  }
}
