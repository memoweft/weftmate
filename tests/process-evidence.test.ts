import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { createProcessEvidence, describeExit, matchesOwnedProcess, redactEvidenceText } from './helpers/process-evidence.mjs'

test('process exit codes preserve signed decimal and Windows hexadecimal with useful meanings', () => {
  for (const [code, hex, meaning] of [[-1073740791, '0xC0000409', /abort/], [3221225477, '0xC0000005', /访问冲突/], [3221225773, '0xC000012D', /内存/], [1455, '0x000005AF', /内存/]] as const) {
    const result = describeExit(code)
    assert.equal(result.decimal, code); assert.equal(result.hexadecimal, hex); assert.match(result.meaning, meaning)
  }
  assert.equal(describeExit(null, 'SIGTERM').signal, 'SIGTERM')
  assert.equal(describeExit(0).meaning, '正常退出')
})

test('process ownership requires creation time, exact executable and isolated command path simultaneously', () => {
  const startedAt = Date.parse('2026-10-11T00:00:00Z')
  const options = { startedAt, executables: ['C:\\synthetic\\electron.exe'], commandRoots: ['C:\\synthetic\\profile'] }
  const process = { createdAt: '2026-10-11T00:00:01Z', executable: 'C:\\synthetic\\electron.exe', commandLine: '--user-data-dir=C:\\synthetic\\profile' }
  assert.equal(matchesOwnedProcess(process, options), true)
  assert.equal(matchesOwnedProcess({ ...process, createdAt: '2026-10-10T23:59:59Z' }, options), false)
  assert.equal(matchesOwnedProcess({ ...process, executable: 'C:\\daily\\electron.exe' }, options), false)
  assert.equal(matchesOwnedProcess({ ...process, commandLine: '--user-data-dir=C:\\daily\\profile' }, options), false)
  assert.equal(matchesOwnedProcess({ ...process, createdAt: 'invalid' }, options), false)
})

test('abnormal children retain stdout/stderr tails, commit counters, metadata logs and dump inventory before profile deletion', async () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-evidence-test-'))
  try {
    const profile = join(root, 'profile'), output = join(root, 'out')
    mkdirSync(join(profile, 'logs'), { recursive: true }); mkdirSync(join(profile, 'crashes', 'pending'), { recursive: true })
    writeFileSync(join(profile, 'logs', 'host-2026-10-11.jsonl'), JSON.stringify({ event: 'host.failure', path: ['C:', 'Users', 'synthetic-account', 'tmp'].join('\\') }) + '\n')
    writeFileSync(join(profile, 'logs', 'credentials.json'), 'must not be preserved')
    writeFileSync(join(profile, 'crashes', 'pending', 'synthetic.dmp'), 'native memory must not be copied')
    const evidence = createProcessEvidence({ outputDir: output, profileDirectory: profile, memoryReader: () => ({ available: true, availableBytes: 123456 }) })
    const { done } = evidence.spawn(process.execPath, ['-e', 'process.stdout.write("synthetic stdout");process.stderr.write("synthetic stderr");process.exit(7)'])
    const record = await done
    assert.equal(record.decimal, 7); assert.equal(record.hexadecimal, '0x00000007')
    assert.equal(record.stdoutTail, 'synthetic stdout'); assert.equal(record.stderrTail, 'synthetic stderr')
    assert.equal(record.systemCommit.availableBytes, 123456)
    assert.ok(existsSync(join(output, 'logs', 'host-2026-10-11.jsonl')))
    assert.equal(existsSync(join(output, 'logs', 'credentials.json')), false)
    assert.equal(readFileSync(join(output, 'logs', 'host-2026-10-11.jsonl'), 'utf8').includes('synthetic-account'), false)
    const manifest = JSON.parse(readFileSync(join(output, 'crash-dumps.json'), 'utf8'))
    assert.equal(manifest.dumps[0].file, 'synthetic.dmp'); assert.equal(manifest.dumpContentsCopied, false)
    assert.equal(existsSync(join(output, 'synthetic.dmp')), false)
    rmSync(profile, { recursive: true })
    assert.equal(JSON.parse(readFileSync(join(output, 'process-results.json'), 'utf8')).records[0].decimal, 7)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('synchronous runner preserves original spawnSync results and failed output; successful runs do not copy profile logs', () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-evidence-test-'))
  try {
    const evidence = createProcessEvidence({ outputDir: join(root, 'out'), memoryReader: () => ({ available: false }) })
    const result = evidence.runSync(process.execPath, ['-e', 'console.log("okay")'])
    assert.equal(result.status, 0); assert.equal(result.stdout, 'okay\n')
    assert.equal(existsSync(join(root, 'out', 'crash-dumps.json')), false)
    const failed = evidence.runSync(process.execPath, ['-e', 'process.stderr.write("failure");process.exit(2)'])
    assert.equal(failed.status, 2); assert.equal(failed.stderr, 'failure')
    assert.equal(evidence.records[1].stderrTail, 'failure')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('evidence identity and secret redaction leaves useful synthetic diagnostics readable', () => {
  const userPath = ['C:', 'Users', 'synthetic-account', 'Temp', 'profile'].join('\\')
  assert.equal(redactEvidenceText(`${userPath} apiKey=secret123 Bearer tok123 https://invalid.test/?token=abc`), 'C:\\Users\\<user>\\Temp\\profile [secret] [authorization] https://invalid.test/?[secret]')
  assert.equal(redactEvidenceText('exit 0xC0000409 synthetic-host'), 'exit 0xC0000409 synthetic-host')
})

test('evidence roots redact Windows, escaped TAP/JSON, slash and encoded file URL forms before user masking', () => {
  const root = String.raw`D:\Synthetic Private\用户\workspace`
  const userRoot = ['C:', 'Users', 'Synthetic Person', 'workspace'].join('\\')
  for (const directory of [root, userRoot]) {
    const slash = directory.replaceAll('\\', '/')
    const forms = [directory, directory.replaceAll('\\', '\\\\'), directory.replaceAll('\\', '\\\\\\\\'), slash,
      slash.replace(/^[A-Z]/, x => x.toLowerCase()),
      'file:///' + slash.split('/').map(encodeURIComponent).join('/'),
      'file:///' + slash.split('/').map(encodeURIComponent).join('/').replaceAll('%3A', ':'),
      'file:///' + encodeURIComponent(slash),
    ]
    for (const value of forms) assert.equal(redactEvidenceText(`location: '${value}/fixture.ts:1:1'`, [directory]),
      "location: '%TEMP%/fixture.ts:1:1'", value)
  }
})

test('existing process evidence callers also redact serialized child output with explicit scope roots', () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-escaped-evidence-'))
  try {
    const evidence = createProcessEvidence({ outputDir: join(root, 'out'), commandRoots: [root], memoryReader: () => ({ available: false }) })
    const output = JSON.stringify({ location: join(root, 'synthetic.ts') })
    const result = evidence.runSync(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(output)});process.exit(7)`], { timeout: 5000 })
    assert.equal(result.status, 7)
    assert.equal(result.stdout, output, 'the original process result is unchanged')
    assert.ok(evidence.records[0].stdoutTail.includes('%TEMP%'))
    assert.equal(evidence.records[0].stdoutTail.includes(root.replaceAll('\\', '\\\\')), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('bounded output tails retain the entire final window and spawn failures retain their original error code', async () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-evidence-test-'))
  try {
    const evidence = createProcessEvidence({ outputDir: join(root, 'out'), tailBytes: 32, memoryReader: () => { throw Error('unavailable') } })
    const { done } = evidence.spawn(process.execPath, ['-e', 'process.stdout.write("x".repeat(100)+"FINAL");process.exit(3)'])
    const record = await done
    assert.equal(record.stdoutTail, 'x'.repeat(27) + 'FINAL')
    assert.equal(record.systemCommit.available, false)
    const missing = evidence.spawn(join(root, 'missing-executable'), [])
    assert.equal((await missing.done).spawnErrorCode, 'ENOENT')
    const launch = evidence.recordLaunchFailure(Error('Playwright process did exit: exitCode=3221226505, signal=null'))
    assert.equal(launch.hexadecimal, '0xC0000409')
    assert.match(launch.meaning, /abort/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
