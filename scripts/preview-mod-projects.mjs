// Disposable real DSH browser preview. Run: node scripts/preview-mod-projects.mjs
// It uses only the pinned vendor runtime and a temporary DSH_HOME.
import { spawn } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = dirname(dirname(fileURLToPath(import.meta.url)))
const vendor = join(repository, 'vendor', 'dsh-runtime')
const cli = join(vendor, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const rootArg = process.argv.indexOf('--root')
if (rootArg >= 0 && (!process.argv[rootArg + 1] || process.argv[rootArg + 1].startsWith('-'))) throw new Error('--root requires an existing preview root path')
const root = rootArg >= 0 ? resolve(process.argv[rootArg + 1]) : await mkdtemp(join(tmpdir(), 'weftmate-mod-project-preview-'))
const realLocal = process.argv.includes('--real-local-model')
const modelConfigArg = process.argv.indexOf('--model-config')
if (realLocal && (modelConfigArg < 0 || !process.argv[modelConfigArg + 1] || process.argv[modelConfigArg + 1].startsWith('-'))) throw new Error('--real-local-model requires --model-config <json-file>')
if (!realLocal && modelConfigArg >= 0) throw new Error('--model-config is only valid with --real-local-model')
const home = join(root, 'dsh-home')
const profile = join(home, 'profiles', 'preview-mod-projects')
let child = null
let closed = false

async function localModelConfig() {
  if (!realLocal) return null
  const value = JSON.parse(await readFile(resolve(process.argv[modelConfigArg + 1]), 'utf8'))
  if (!value || typeof value.baseUrl !== 'string' || typeof value.model !== 'string' || typeof value.apiKeyEnv !== 'string') throw new Error('local model config requires baseUrl, model, and apiKeyEnv')
  const url = new URL(value.baseUrl)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('local model baseUrl must be a credential-free loopback HTTP URL')
  if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(value.apiKeyEnv) || !process.env[value.apiKeyEnv]) throw new Error('local model API key must be supplied through the explicit configured environment variable')
  return { baseUrl: url.toString().replace(/\/$/, ''), model: value.model, apiKeyEnv: value.apiKeyEnv }
}

async function close(code = 0) {
  if (closed) return
  closed = true
  if (child && !child.killed) {
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill('SIGTERM')
    const graceful = await Promise.race([exited.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 10_000))])
    if (!graceful) { child.kill('SIGKILL'); console.error(`[mod-preview] forced stop; retained TEMP_ROOT=${root} for evidence`) }
  }
  // Keep the isolated profile/project state for inspection after either normal
  // or forced shutdown. It is never the user's normal DSH_HOME.
  console.log(`[mod-preview] stopped; retained TEMP_ROOT=${root}`)
  process.exit(code)
}

try {
  const localModel = await localModelConfig()
  await mkdir(root, { recursive: true })
  await mkdir(join(root, 'workspace'), { recursive: true })
  await mkdir(join(profile, 'plugins'), { recursive: true })
  await mkdir(join(profile, 'runtime'), { recursive: true })
  await mkdir(join(home, '.agent-presets', 'mod-maintainer'), { recursive: true })
  await mkdir(join(profile, 'node_modules', '@weftmate'), { recursive: true })
  await cp(join(repository, 'src', 'plugins', 'weftmate-mod-projects.mjs'), join(profile, 'plugins', 'weftmate-mod-projects.mjs'))
  await cp(join(repository, 'src', 'plugins', 'weftmate-client', 'mod-state.mjs'), join(profile, 'plugins', 'weftmate-client', 'mod-state.mjs'))
  await cp(join(repository, 'src', 'plugins', 'weftmate-client', 'mod-window'), join(profile, 'plugins', 'weftmate-client', 'mod-window'), { recursive: true })
  await cp(join(repository, 'src', 'plugins', 'weftmate-client', 'v2-shell'), join(profile, 'plugins', 'weftmate-client', 'v2-shell'), { recursive: true })
  await cp(join(repository, 'src', 'plugins', 'weftmate-mod-development.mjs'), join(profile, 'plugins', 'weftmate-mod-development.mjs'))
  await writeFile(join(home, '.agent-presets', 'mod-maintainer', 'agent.cordis.yml'), '- name: ../../profiles/preview-mod-projects/plugins/weftmate-mod-development.mjs\n', 'utf8')
  await writeFile(join(home, '.agent-presets', 'mod-maintainer', 'preset.yml'), 'name: Mod 开发维护\ndescription: 受控的单项目 Mod 开发通道。\norder: 90\n', 'utf8')
  if (!localModel) await writeFile(join(profile, 'plugins', 'preview-keyless-llm.mjs'), `import { LlmAdapter } from '@deepseek-ai/dsh-llm'
class PreviewAdapter extends LlmAdapter {
  providerInfo(provider) { return { id: provider, name: 'Preview keyless adapter' } }
  providerRetryPolicy() { return undefined }
  async listModels(provider) { return [{ provider, id: 'preview-keyless-model', name: 'Preview keyless model' }] }
  async resolveModel(provider, model) { return { provider, id: model, name: 'Preview keyless model', context: { contextWindow: 32768 } } }
  async *stream(options) { if (options.signal?.aborted) { yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'preview request aborted' } } }; return }; yield { type: 'text-delta', index: 0, text: 'Preview keyless model is active.' }; yield { type: 'finish', reason: { kind: 'stop' } } }
}
export const name = 'preview-keyless-llm'
export const inject = ['llm']
export function apply(ctx) { ctx.llm.registerAdapter(['preview-keyless'], new PreviewAdapter()) }
export default { name, inject, apply }
`, 'utf8')
  await writeFile(join(profile, 'plugins', 'preview-seed.mjs'), `export const name = 'preview-seed'
  export const inject = ['apiProxy', 'agentPresets']
const value = result => { if (result?.result?.ok === true) return result.result.value; if (result?.ok === true) return result.value; throw new Error(result?.result?.error?.message ?? 'preview seed RPC failed') }
  export function apply(ctx) { ctx.effect(async () => {
    const roster = await ctx.agentPresets.list()
    if (!roster.some(preset => preset.id === 'mod-maintainer' && !preset.broken)) throw new Error('preview requires live mod-maintainer preset discovery')
    const workspace = ${JSON.stringify(join(root, 'workspace'))}
    await value(ctx.apiProxy.sessions.create({ payload: { sessionId: 'preview-mod-owner', cwd: workspace } }))
  }) }
export default { name, inject, apply }
`, 'utf8')
  await cp(join(repository, 'src', 'runtime', 'mod-projects'), join(profile, 'runtime', 'mod-projects'), { recursive: true })
  await cp(join(repository, 'src', 'plugins', 'weftmate-client'), join(profile, 'node_modules', '@weftmate', 'client'), { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'weftmate-mod-project-preview', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }, null, 2))
  if (localModel) await writeFile(join(profile, 'preview-local-model.patch.yml'), `- id: llm-pi-ai
  config:
    providers:
      preview-local:
        displayName: "Local preview model"
        apiKeyEnv: ${JSON.stringify(localModel.apiKeyEnv)}
        api: openai-completions
        baseURL: ${JSON.stringify(localModel.baseUrl)}
        models:
          - id: ${JSON.stringify(localModel.model)}
            name: "Local preview model"
            contextWindow: 32768
            maxTokens: 4096
`, 'utf8')
  await writeFile(join(profile, 'cordis.patch.yml'), `- insert:
    - id: weftmate-mod-projects
      name: ./plugins/weftmate-mod-projects.mjs
${localModel ? '' : '    - id: preview-keyless-llm\n      name: ./plugins/preview-keyless-llm.mjs\n'}
    - id: preview-seed
      name: ./plugins/preview-seed.mjs
    - id: '@weftmate/client'
      name: '@weftmate/client'
- id: agent-instructions
  disabled: true
- id: session-title-llm
  disabled: true
- id: llm-deepseek
  disabled: true
- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: ui-directory-picker-browse
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
- id: agent-default-model
  config:
    provider: ${localModel ? 'preview-local' : 'preview-keyless'}
    model: ${localModel ? JSON.stringify(localModel.model) : 'preview-keyless-model'}
- id: webserver
  config:
    host: 127.0.0.1
    port: 0
- id: web-runtime
  config:
    printUrl: true
    surfaceContext: true
`, 'utf8')
  // There is no credentials service, phone/memory plugin, user DSH_HOME, or
  // real model route in this process. Validation remains the Mod host's
  // explicit keyless broker; preview is for UI/control flow only.
  const previewEnv = Object.fromEntries(['PATH', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'LOCALAPPDATA'].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]))
  if (localModel) previewEnv[localModel.apiKeyEnv] = process.env[localModel.apiKeyEnv]
  const cliArgs = [cli, '--profile', 'preview-mod-projects', ...(localModel ? ['--patch', join(profile, 'preview-local-model.patch.yml')] : [])]
  child = spawn(process.execPath, cliArgs, { cwd: join(root, 'workspace'), env: { ...previewEnv, DSH_HOME: home, DSH_AGENTS_HOME: join(root, 'agents'), DSH_BUNDLED_SKILL_DIR: join(root, 'skills'), DSH_PERMISSION_MODE: 'workspace-write' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let probed = false
  const rpc = async (origin, method, payload) => {
    const response = await fetch(origin + '/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'mod-preview-' + method, method, payload }) })
    const body = await response.json()
    if (!response.ok || body?.result?.ok !== true) throw new Error('preview RPC ' + method + ' failed')
    return body.result.value
  }
  const probePreset = async origin => {
    const roster = await rpc(origin, 'agentPreset.list', {})
    if (!roster.presets?.some(preset => preset.id === 'mod-maintainer' && !preset.broken)) throw new Error('live agentPreset.list did not return mod-maintainer')
    const created = await rpc(origin, 'session.create', { sessionId: 'preview-mod-maintainer', cwd: join(root, 'workspace'), agentPreset: 'mod-maintainer' })
    if (created.agentPreset !== 'mod-maintainer') throw new Error('live session.create did not retain mod-maintainer')
    console.log('[mod-preview] LIVE_PRESET=mod-maintainer session=preview-mod-maintainer')
  }
  const line = chunk => {
    const text = chunk.toString('utf8'); process.stdout.write(`[mod-preview] ${text}`)
    const match = text.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/)
    if (match) { console.log(`[mod-preview] READY URL=${match[1]}/`); console.log(`[mod-preview] TEMP_ROOT=${root}`); console.log('[mod-preview] Ctrl+C closes this temporary real DSH profile.'); if (!probed) { probed = true; void probePreset(match[1]).catch(error => { console.error('[mod-preview] FAIL ' + error.message); void close(1) }) } }
  }
  child.stdout.on('data', line); child.stderr.on('data', line)
  child.once('exit', code => { if (!closed) { console.error(`[mod-preview] DSH exited before normal shutdown (${code})`); void close(code ?? 1) } })
  process.on('SIGINT', () => { void close() }); process.on('SIGTERM', () => { void close() })
} catch (error) {
  console.error('[mod-preview] FAIL ' + (error instanceof Error ? error.message : String(error)))
  await close(1)
}
