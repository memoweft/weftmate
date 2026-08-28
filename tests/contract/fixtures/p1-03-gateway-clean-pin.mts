// P1-03 exact-pin L2: boot the real DSH web profile with a replay model, then
// exercise it only through WeftMate Gateway HTTP/SSE (the probe never imports
// or calls apiProxy / InProcessApiClient).
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const checkout = process.env.WEFTMATE_CHECKOUT
if (!checkout) throw new Error('WEFTMATE_CHECKOUT required')
const here = dirname(fileURLToPath(import.meta.url)); const url = (file: string) => pathToFileURL(file).href
const { Context } = await import(url(join(checkout, 'vendor/cordis/src/index.ts')))
const { default: Loader } = await import(url(join(checkout, 'vendor/loader/src/index.ts')))
const { default: Include } = await import(url(join(checkout, 'vendor/include/src/index.ts')))
const { default: Group } = await import(url(join(checkout, 'vendor/group/src/index.ts')))
const { assertEntriesLoaded, healProfilesModuleFallback, loadOverlayPatches } = await import(url(join(checkout, 'packages/boot/app-boot/src/index.ts')))
const { dshHomePath } = await import(url(join(checkout, 'packages/util/home-paths/src/index.ts')))
const { provideCmdline } = await import(url(join(checkout, 'packages/boot/cmdline/src/index.ts')))
const { installLlmReplay } = await import(url(join(checkout, 'packages/test-support/llm-replay/src/index.ts')))

const workspace = await mkdtemp(join(tmpdir(), 'weftmate-p1-03-l2-'))
const home = join(workspace, '.dsh-home'); const profile = join(home, 'profiles', 'probe')
const source = join(here, '..', '..', '..', 'src')
const diagnostic = join(tmpdir(), 'weftmate-p1-03-l2-checkpoint.json')
async function checkpoint(stage: string, detail: Record<string, unknown> = {}) { await writeFile(diagnostic, JSON.stringify({ stage, ...detail }), 'utf8') }
const originalCwd = process.cwd()
process.env.DSH_HOME = home; process.env.DSH_AGENTS_HOME = join(workspace, '.agents'); process.env.DSH_BUNDLED_SKILL_DIR = join(workspace, '.skills'); process.env.DSH_PERMISSION_MODE = 'danger-full-access'
const ctx = new Context(); let replay: { assertConsumed(): void } | undefined
const diagnosticEventTypes: string[] = []
try {
  process.chdir(workspace)
  await writeFile(join(workspace, 'weftmate-note.txt'), 'hello-weftmate-note', 'utf8')
  await mkdir(join(profile, 'plugins'), { recursive: true }); await mkdir(join(profile, 'runtime'), { recursive: true }); await mkdir(join(profile, 'node_modules', '@weftmate', 'client'), { recursive: true })
  await cp(join(source, 'plugins', 'weftmate-host.mjs'), join(profile, 'plugins', 'weftmate-host.mjs'))
  await cp(join(source, 'runtime', 'gateway'), join(profile, 'runtime', 'gateway'), { recursive: true })
  await cp(join(source, 'runtime', 'dsh-adapter'), join(profile, 'runtime', 'dsh-adapter'), { recursive: true })
  const patches = [
    ...loadOverlayPatches('P1-03 exact gateway', join(checkout, 'packages/bundle/base/cordis.patch.yml')),
    ...loadOverlayPatches('P1-03 exact gateway', join(checkout, 'packages/bundle/web-app/cordis.patch.yml')),
    { insert: [{ id: 'weftmate-host', name: './plugins/weftmate-host.mjs' }] },
    { id: 'directory-picker', disabled: true }, { insert: [{ id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' }, { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' }] },
    { id: 'agent-presets', config: { default: 'standard', roots: [{ path: join(checkout, 'apps/cli/config/agent-presets'), trust: 'system' }], includeUserRoot: false } },
    { id: 'session-persistence-jsonl', config: { root: join(workspace, '.sessions') } }, { id: 'storage-json', config: { root: join(workspace, '.storage') } },
    { id: 'skill-filesystem', config: { dshHome: home, agentsHome: join(workspace, '.agents'), bundledSkillDir: join(workspace, '.skills'), watch: false } },
    { id: 'agent-instructions', disabled: true }, { id: 'session-title-llm', disabled: true }, { id: 'session-telemetry-otel', disabled: true },
    { id: 'webserver', config: { host: '127.0.0.1', port: 0 } }, { id: 'web-runtime', config: { printUrl: false, surfaceContext: true } }, { id: 'settings', config: { dshHome: home } }, { id: 'credentials', config: { dshHome: home } }, { id: 'llm-deepseek', disabled: true },
  ]
  healProfilesModuleFallback(join(checkout, 'apps/cli/package.json'), home); await writeFile(join(profile, 'cordis.yml'), '[]\n', 'utf8')
  ctx.baseUrl = pathToFileURL(profile).href + '/'; ctx.provide('dshHomePath', dshHomePath); provideCmdline(ctx, { args: [], exit: (code: number) => { throw new Error(`unexpected exit ${code}`) } })
  await checkpoint('loader-plugin'); await ctx.plugin(Loader)
  await checkpoint('loader-builtins'); ctx.loader.builtins.include = Include; ctx.loader.builtins.group = Group
  await checkpoint('loader-create'); await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(profile, 'cordis.yml')).href, patches } })
  await checkpoint('loader-await'); await ctx.loader.await()
  await checkpoint('loader-assert'); assertEntriesLoaded(ctx, 'P1-03 exact gateway')
  if (ctx.get('apiProxy') === undefined) throw new Error('checkpoint apiProxy missing'); await checkpoint('profile-loaded-api-present')
  // Temporary bounded diagnostic: records event type names only, never a raw
  // payload, to distinguish a DSH turn failure from Gateway stream loss.
  ctx.on('session/event', (_session: unknown, event: { type?: unknown }) => {
    if (typeof event.type === 'string') diagnosticEventTypes.push(event.type)
  })
  replay = installLlmReplay(ctx, { file: join(here, 'web-chat-replay.jsonl'), providers: [{ id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 128000 }] }] })
  const base = `http://127.0.0.1:${ctx.get('webServer')?.port}/weftmate/api/v1`
  const createResponse = await fetch(`${base}/sessions`, { method: 'POST', body: '{}' }); if (!createResponse.ok) throw new Error(`checkpoint gateway create HTTP ${createResponse.status}`); const created = await createResponse.json() as { sessionId: string }; await checkpoint('gateway-create', { sessionId: created.sessionId })
  const ac = new AbortController(); const stream = await fetch(`${base}/sessions/${created.sessionId}/events`, { signal: ac.signal }); if (!stream.ok || stream.body === null) throw new Error(`checkpoint SSE HTTP ${stream.status}`); const reader = stream.body.getReader(); const events: any[] = []; let buffer = ''; await checkpoint('sse-opened')
  const read = (async () => { while (!events.some((event) => event.type === 'assistant.completed')) { const item = await reader.read(); if (item.done) break; buffer += new TextDecoder().decode(item.value, { stream: true }); const blocks = buffer.split('\n\n'); buffer = blocks.pop() ?? ''; for (const block of blocks) { const line = block.split('\n').find((row) => row.startsWith('data: ')); if (line) events.push(JSON.parse(line.slice(6))) } } })()
  const sendResponse = await fetch(`${base}/sessions/${created.sessionId}/messages`, { method: 'POST', body: JSON.stringify({ content: [{ type: 'text', text: '读一下文件 weftmate-note.txt' }] }) }); const sent = await sendResponse.json() as { accepted: boolean; error?: unknown }; await checkpoint('gateway-send', { status: sendResponse.status, accepted: sent.accepted ?? null, hasError: sent.error !== undefined }); if (!sendResponse.ok || sent.accepted !== true) throw new Error(`checkpoint gateway send HTTP ${sendResponse.status}`)
  await Promise.race([read, new Promise((_, reject) => setTimeout(() => reject(new Error(`SSE timeout types=${events.map((event) => `${event.type}:${event.rawType}`).join(',')}`)), 60_000))]); await checkpoint('sse-read', { types: events.map((event) => `${event.type}:${event.rawType}`) }); ac.abort(); const resumed = await (await fetch(`${base}/sessions/${created.sessionId}/resume`, { method: 'POST', body: '{}' })).json() as { sessionId: string }
  replay.assertConsumed(); await checkpoint('normalizer-complete', { types: events.map((event) => event.type) }); console.log('[p1-03-l2] EVIDENCE ' + JSON.stringify({ sessionId: created.sessionId, sent: sent.accepted, resumed: resumed.sessionId, types: events.map((event) => event.type), deltas: events.filter((event) => event.type === 'assistant.delta').length, toolCompleted: events.some((event) => event.type === 'tool.completed') }))
  await ctx.fiber.dispose(); await rm(workspace, { recursive: true, force: true }); process.chdir(originalCwd); process.exit(0)
} catch (error) { let previous: unknown = null; try { previous = JSON.parse(await readFile(diagnostic, 'utf8')) } catch {} ; await checkpoint('reject', { previous, message: error instanceof Error ? error.message : String(error), diagnosticEventTypes }); try { await ctx.fiber.dispose() } catch {} ; process.chdir(originalCwd); console.log('[p1-03-l2] REJECT ' + JSON.stringify({ message: error instanceof Error ? error.message : String(error), diagnosticEventTypes })); process.exit(1) }
