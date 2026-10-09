import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyPersonalRisk } from '../src/plugins/personal-approval-policy.mjs'
import { trackNativeFiles, appendNativeArtifacts, conversationCreatedFiles } from '../src/plugins/personal-native-files.mjs'
import { shellScriptInvocations, scriptWriteTargets } from '../src/plugins/personal-write-targets.mjs'

const run = promisify(execFile)
const script = `import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'result.json');
writeFileSync(out, '{"total":49}');`

test('FX-13: external requested script output has durable conversation provenance, including restart and another cwd', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fx13-script-'))
  try {
    const cwd = join(root, 'conversation'), requested = join(root, 'requested'), other = join(root, 'other')
    for (const dir of [cwd, requested, other]) await mkdir(dir)
    const file = join(requested, 'sum.mjs'), output = join(requested, 'result.json')
    await writeFile(file, script)
    const frames: any[] = []
    const bridge = { request: async (frame: any) => { frames.push(frame); return { artifactId: `artifact-${frames.length}` } } }
    const session: any = { header: { agentPreset: 'personal-remote', cwd }, events: [] }
    const exec = { name: 'pwsh', arguments: { command: `node "${file}"` }, agent: { session } }
    const native = { content: [{ type: 'text', text: 'native' }] }
    await trackNativeFiles(bridge, exec, async () => { await run(process.execPath, [file], { cwd }); return native }, () => ({}))
    const post = await appendNativeArtifacts(exec, native, async () => ({ kind: 'accept' }))
    assert.equal(frames.length, 1)
    assert.equal(frames[0].filePath, output)
    const restarted = JSON.parse(JSON.stringify({ events: [{ type: 'tool/result', data: { message: {
      content: [{ type: 'tool-result', content: post.content }] } } }] }))
    const created = conversationCreatedFiles(restarted)
    assert.deepEqual([...created], [output])
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: `Set-Location "${other}"; node "${file}"` }, cwd, new Set(), { createdFiles: created }), [])
    if (process.platform === 'win32') {
      const command = `Set-Location C:\\; node "${file}"`
      assert.deepEqual(classifyPersonalRisk('pwsh', { command }, cwd, new Set(), { createdFiles: created }), [], 'exact QA2 command still writes beside the script')
      assert.deepEqual(scriptWriteTargets(shellScriptInvocations(command, cwd)[0]), [output])
    }
    await run(process.execPath, [file], { cwd: other })
    assert.equal(await readFile(output, 'utf8'), '{"total":49}')
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: `node "${file}"` }, cwd), ['overwrite'], 'another conversation cannot inherit creation')
    await rm(output)
    await writeFile(output, 'pre-existing user content')
    frames.length = 0
    await trackNativeFiles(bridge, exec, async () => { await run(process.execPath, [file], { cwd }); return native }, () => ({}))
    const updated = await appendNativeArtifacts(exec, native, async () => ({ kind: 'accept' }))
    assert.equal(JSON.parse(updated.content[1].text).createdFilePath, undefined, 'updating a user file cannot grant future writes')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('FX-13: script-relative outputs and cwd-relative user collisions stay distinct after shell location changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fx13-location-'))
  try {
    const other = join(root, 'other'); await mkdir(other)
    const fixed = join(root, 'fixed.mjs'), relative = join(root, 'relative.mjs'), resolved = join(root, 'resolved.mjs')
    await writeFile(fixed, script)
    await writeFile(relative, "import {writeFileSync} from 'node:fs'; writeFileSync('result.json', '{}');")
    await writeFile(resolved, "import {writeFileSync} from 'node:fs'; import path from 'node:path'; const out = path.resolve(process.cwd(), 'result.json'); writeFileSync(out, '{}');")
    await writeFile(join(other, 'result.json'), 'user content')
    for (const shell of ['pwsh', 'bash']) {
      const change = shell === 'pwsh' ? 'Set-Location' : 'cd'
      const spelling = (file: string) => shell === 'bash' ? file.replaceAll('\\', '/') : file
      assert.deepEqual(classifyPersonalRisk(shell, { command: `${change} "${spelling(other)}"; node "${spelling(fixed)}"` }, root), [])
      for (const file of [relative, resolved]) {
        const command = `${change} "${spelling(other)}"; node "${spelling(file)}"`
        assert.deepEqual(classifyPersonalRisk(shell, { command }, root), ['overwrite'])
        assert.deepEqual(classifyPersonalRisk(shell, { command }, root, new Set(), { createdFiles: new Set([join(root, 'result.json')]) }), ['overwrite'], 'creation in old cwd does not grant writes in new cwd')
        assert.deepEqual(scriptWriteTargets(shellScriptInvocations(command, root, shell !== 'bash')[0]), [join(other, 'result.json')])
      }
    }
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: `Set-Location $unknown; node "${resolved}"` }, root), ['overwrite'])
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: `Set-Location "${other}"; & node "${relative}"` }, root), ['overwrite'])
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: `pwsh -Command 'Set-Location "${other}"; node "${relative}"'` }, root), ['overwrite'])
    assert.deepEqual(scriptWriteTargets(shellScriptInvocations(`Set-Location $unknown; node "${resolved}"`, root)[0]), [])
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: `node "${relative}"; Set-Location "${other}"; node "${relative}"` }, root), ['overwrite'], 'inspect repeated launches in each execution directory')
    await writeFile(relative, "import {unlinkSync} from 'node:fs'; unlinkSync('result.json');")
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: `node "${relative}"` }, root), ['delete'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('FX-13: observation keeps unresolved output expressions unknown and handles literal argv destinations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fx13-argv-'))
  try {
    const file = join(root, 'sum.mjs')
    await writeFile(file, "import {writeFileSync} from 'node:fs'; import path from 'node:path'; const out = path.resolve(process.argv[2] ?? 'result.json'); writeFileSync(out, '{}');")
    assert.deepEqual(scriptWriteTargets(shellScriptInvocations(`node "${file}" explicit.json`, root)[0]), [join(root, 'explicit.json')])
    assert.deepEqual(scriptWriteTargets(shellScriptInvocations(`node "${file}" $unknown`, root)[0]), [])
    await writeFile(file, "writeFileSync(getPath(), '{}');")
    assert.deepEqual(scriptWriteTargets(shellScriptInvocations(`node "${file}"`, root)[0]), [])
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: `node "${file}"` }, root), ['overwrite'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('FX-13: changing script source during execution cannot claim an existing external file as newly created', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fx13-source-change-'))
  try {
    const cwd = join(root, 'conversation'), requested = join(root, 'requested')
    await mkdir(cwd); await mkdir(requested)
    const file = join(requested, 'sum.mjs'), user = join(requested, 'user.json')
    await writeFile(file, script)
    await writeFile(user, 'existing user file')
    const frames: any[] = []
    const bridge = { request: async (frame: any) => { frames.push(frame); return { artifactId: 'artifact' } } }
    const exec = { name: 'pwsh', arguments: { command: `node "${file}"` }, agent: {
      session: { header: { agentPreset: 'personal-remote', cwd } } } }
    const native = { content: [{ type: 'text', text: 'native' }] }
    await trackNativeFiles(bridge, exec, async () => {
      await writeFile(file, script.replace('result.json', 'user.json'))
      await writeFile(user, 'updated user file')
      return native
    }, () => ({}))
    assert.deepEqual(frames, [], 'post-execution source cannot enlarge the before/after observation set')
    assert.equal((await appendNativeArtifacts(exec, native, async () => ({ kind: 'accept' }))).content, undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})
