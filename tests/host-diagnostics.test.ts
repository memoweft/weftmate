import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, utimesSync, symlinkSync, openSync, ftruncateSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createHostDiagnostics } from '../src/host-diagnostics.mjs';
import { createHostLog, redactSecretText, sanitizeErrorDiagnostic } from '../src/host-log.mjs';

const appRoot = resolve('.');
function fixture() { const root = mkdtempSync(join(tmpdir(), 'diag1-storage-')); return { root, remove: () => rmSync(root, { recursive: true, force: true }) }; }
function rows(root: string) { return readdirSync(join(root, 'logs')).filter(name => name.endsWith('.jsonl')).flatMap(name => readFileSync(join(root, 'logs', name), 'utf8').trim().split('\n').map(line => JSON.parse(line))); }

const redactions = [
  ['API key', 'api_key=synthetic-private-key', 'synthetic-private-key', 'api method available'],
  ['token', 'refresh_token="synthetic private token"', 'synthetic private token', 'token counter 3'],
  ['password', "password='synthetic password'", 'synthetic password', 'password required'],
  ['cookie', 'Cookie: session=synthetic-cookie; theme=dark', 'synthetic-cookie', 'cookie support enabled'],
  ['authorization', 'Authorization: Bearer synthetic-bearer', 'synthetic-bearer', 'authorization failed'],
  ['email', 'synthetic@example.invalid', 'synthetic@example.invalid', 'address unavailable'],
  ['random token', 'aB91xK73nP02dQ49vR65tZ18mS28', 'aB91xK73nP02dQ49vR65tZ18mS28', 'short-technical-code'],
  ['URL query', 'https://example.invalid/check?token=private&account=synthetic', 'private', 'fetch failed'],
  ['absolute path', 'C:\\Users\\<user>\\private-file.txt', 'synthetic-user', 'disk unavailable'],
  ['Unix path', '/home/synthetic-user/private.txt', 'synthetic-user', 'ENOENT: system operation failed'],
  ['standalone key', 'sk-syntheticsecret1234567890', 'syntheticsecret', 'key missing'],
  ['JSON secret', '{"api_key":"synthetic-json-secret"}', 'synthetic-json-secret', 'JSON parse failed'],
];
for (const [name, input, privateText, positive] of redactions) test(`redaction ${name}: sensitive example removed and technical example preserved`, () => {
  assert.equal(redactSecretText(input).includes(privateText), false);
  assert.equal(redactSecretText(positive), positive);
});

test('free messages, model output, file names and account names cannot enter diagnostics; templates remain useful', () => {
  for (const text of ['My conversation body is private', 'prompt synthetic secret', 'model output private', 'report-private.txt', 'synthetic-account', 'Error when reading report-private.txt']) {
    const clean = sanitizeErrorDiagnostic(new Error(text), { appRoot });
    assert.equal(clean.message, undefined); assert.equal(JSON.stringify(clean).includes(text), false);
  }
  const clean = sanitizeErrorDiagnostic({ name: 'TypeError', code: 'ENOENT', message: "Cannot read properties of undefined (reading 'synthetic-account')" }, { appRoot });
  assert.equal(clean.name, 'TypeError'); assert.equal(clean.code, 'ENOENT'); assert.equal(clean.message, 'Cannot read properties of undefined');
  assert.equal(sanitizeErrorDiagnostic({ name: 'synthetic-account', code: 'PRIVATE_NAME', message: 'fetch failed' }).name, 'Error');
  assert.equal(sanitizeErrorDiagnostic({ code: 'PRIVATE_NAME' }).code, 'HOST_ERROR');
  assert.equal(sanitizeErrorDiagnostic({ message: 'x'.repeat(2000) }).message, undefined);
});

test('stack frames only retain existing program source paths and line/column; functions, external paths and unknown files are removed', () => {
  const main = join(appRoot, 'src', 'main.mjs');
  const error = { name: 'Error', stack: 'Error: private\n' + [
    `    at syntheticAccount (${main}:20:3)`, `    at ${pathToFileURL(main).href}:21:4`,
    '    at privateMethod (C:\\Users\\<user>\\private.txt:4:5)',
    `    at secret (${join(appRoot, 'src', 'synthetic-private.mjs')}:1:2)`,
    `    at node_modules (${join(appRoot, 'node_modules', 'private.mjs')}:1:2)`,
    ...Array.from({ length: 20 }, () => `    at privateName (${main}:23:4)`),
  ].join('\n') };
  const clean = sanitizeErrorDiagnostic(error, { appRoot });
  assert.equal(clean.stackFrames.length, 8); assert.equal(clean.stackFrames[0], 'src/main.mjs:20:3');
  assert.equal(clean.stackFrames[1], 'src/main.mjs:21:4');
  for (const text of ['syntheticAccount', 'privateMethod', 'synthetic-user', 'synthetic-private', 'node_modules', appRoot]) assert.equal(JSON.stringify(clean).includes(text), false);
});

test('generic write rejects privileged message/name/stack fields; failure only persists canonical diagnostics', () => {
  const f = fixture();
  try {
    const log = createHostLog(f.root, { appRoot });
    const raw = { name: 'TypeError', message: 'private', stackFrames: ['private'], text: 'private', account: 'private' };
    const record = log.write('host.failure', raw);
    assert.equal(record.message, undefined); assert.equal(record.name, undefined); assert.equal(record.stackFrames, undefined);
    const failure = log.failure('startup', Object.assign(new Error('ENOENT: reading synthetic-file.txt'), { code: 'ENOENT' }));
    assert.equal(failure.message, 'ENOENT: system operation failed'); assert.equal(JSON.stringify(rows(f.root)).includes('synthetic-file'), false);
  } finally { f.remove(); }
});

test('startup is durable, idempotent and scoped by generated runId; unbegun instance never changes marker', () => {
  const f = fixture();
  try {
    const secondary = createHostDiagnostics(f.root, { appRoot }); secondary.exit('single-instance', 0);
    assert.equal(readdirSync(f.root).length, 0);
    const diag = createHostDiagnostics(f.root, { appRoot }); assert.equal(diag.begin({ mode: 'desktop' }), null); diag.begin();
    assert.equal(rows(f.root).filter(row => row.event === 'host.start').length, 1);
    const marker = JSON.parse(readFileSync(join(f.root, 'logs', 'current-run.json'), 'utf8'));
    assert.equal(marker.runId, diag.runId); assert.equal(marker.state, 'running');
    const before = readFileSync(join(f.root, 'logs', 'current-run.json'), 'utf8');
    secondary.write('host.start', { reason: 'single-instance' }); secondary.write('host.exit', { reason: 'single-instance' });
    assert.equal(readFileSync(join(f.root, 'logs', 'current-run.json'), 'utf8'), before);
    assert.equal(diag.status().runId, diag.runId); assert.equal(diag.status().state, 'ready');
    assert.equal(readdirSync(join(f.root, 'logs')).some(name => name.endsWith('.tmp')), false);
  } finally { f.remove(); }
});

test('clean exit contains runtime duration and cleanup timing, repeated exit is idempotent, next launch has no unclean event', () => {
  const f = fixture(); let time = new Date('2026-10-11T01:00:00Z');
  try {
    const diag = createHostDiagnostics(f.root, { appRoot, version: '3.1.0', now: () => time }); diag.begin();
    diag.step('dsh', 'complete', 3000); time = new Date(time.getTime() + 4500);
    const exit = diag.exit('user-quit', 0); assert.equal(exit.durationMs, 4500); assert.equal(exit.normal, true);
    assert.equal(diag.exit('startup-failure', 1), null);
    const marker = JSON.parse(readFileSync(join(f.root, 'logs', 'current-run.json'), 'utf8')); assert.equal(marker.state, 'exited');
    const next = createHostDiagnostics(f.root, { appRoot, now: () => time }); const previous = next.begin();
    assert.equal(previous.normal, true); assert.equal(previous.reason, 'user-quit'); assert.equal(previous.exitCode, 0);
    assert.equal(next.status().uncleanCount7Days, 0); assert.equal(rows(f.root).filter(row => row.event === 'host.previous_unclean_exit').length, 0);
  } finally { f.remove(); }
});

test('missing exit recovers prior last event even with a truncated final JSONL line and counts each run once', () => {
  const f = fixture(); let time = new Date('2026-10-11T01:00:00Z');
  try {
    const diag = createHostDiagnostics(f.root, { appRoot, now: () => time }); diag.begin();
    time = new Date(time.getTime() + 5000); diag.write('runtime.state', { code: 'READY' });
    const name = readdirSync(join(f.root, 'logs')).find(name => name.endsWith('.jsonl'))!;
    writeFileSync(join(f.root, 'logs', name), '{"event":"truncated', { flag: 'a' });
    time = new Date(time.getTime() + 1000);
    const next = createHostDiagnostics(f.root, { appRoot, now: () => time }); const previous = next.begin();
    assert.equal(previous.runId, diag.runId); assert.equal(previous.normal, false); assert.equal(previous.lastEvent, 'runtime.state');
    assert.equal(previous.lastAt, '2026-10-11T01:00:05.000Z'); assert.equal(previous.exitCode, null);
    assert.equal(next.status().uncleanCount7Days, 1); assert.ok(next.status().summary.includes('异常'));
  } finally { f.remove(); }
});

test('retained exit marker keeps normal result after old JSONL expires without a false crash', () => {
  const f = fixture(); let time = new Date('2026-10-01T01:00:00Z');
  try {
    const diag = createHostDiagnostics(f.root, { appRoot, now: () => time }); diag.begin(); diag.exit('user-quit', 0);
    for (const name of readdirSync(join(f.root, 'logs'))) if (name.endsWith('.jsonl')) rmSync(join(f.root, 'logs', name));
    time = new Date('2026-10-11T01:00:00Z');
    const next = createHostDiagnostics(f.root, { appRoot, now: () => time }); const previous = next.begin();
    assert.equal(previous.normal, true); assert.equal(previous.reason, 'user-quit'); assert.equal(previous.exitCode, 0);
    assert.equal(next.status().uncleanCount7Days, 0);
    assert.equal(rows(f.root).some(row => row.event === 'host.previous_unclean_exit'), false);
  } finally { f.remove(); }
});

test('recorded Windows session end explains an interrupted run without inventing an exit code', () => {
  const f = fixture();
  try {
    const diag = createHostDiagnostics(f.root, {appRoot}); diag.begin(); diag.write('host.session_end',{reason:'system-shutdown'});
    const next = createHostDiagnostics(f.root, {appRoot}); const previous = next.begin();
    assert.equal(previous.normal,false); assert.equal(previous.reason,'system-shutdown'); assert.equal(previous.exitCode,null);
    assert.equal(rows(f.root).find(row=>row.event==='host.previous_unclean_exit')?.reason,'system-shutdown');
  } finally {f.remove();}
});

test('fsynced exit is authoritative if old running marker remains; startup failure remains abnormal', () => {
  const f = fixture();
  try {
    const diag = createHostDiagnostics(f.root, { appRoot }); diag.begin();
    const markerPath = join(f.root, 'logs', 'current-run.json'), old = readFileSync(markerPath);
    diag.exit('update-restart', 0); writeFileSync(markerPath, old);
    const next = createHostDiagnostics(f.root, { appRoot }); assert.equal(next.begin().normal, true);
    next.failure('startup', new Error('fetch failed')); next.exit('startup-failure', 1, { cleanupComplete: false });
    const third = createHostDiagnostics(f.root, { appRoot }); assert.equal(third.begin().normal, false);
    assert.equal(third.status().uncleanCount7Days, 1); assert.ok(third.status().summary.includes('fetch failed'));
  } finally { f.remove(); }
});

test('abnormal counts expire after seven days and clean child exits do not pollute summary', () => {
  const f = fixture(); let time = new Date('2026-10-01T01:00:00Z');
  try {
    const first = createHostDiagnostics(f.root, { now: () => time }); first.begin();
    const next = createHostDiagnostics(f.root, { now: () => time }); next.begin(); assert.equal(next.status().uncleanCount7Days, 1);
    next.write('host.process_gone', { reason: 'clean-exit', processType: 'renderer' });
    assert.equal(next.status().summary.includes('renderer'), false);
    time = new Date('2026-10-10T01:00:00Z'); assert.equal(next.status().uncleanCount7Days, 0);
  } finally { f.remove(); }
});

test('unavailable disk and corrupted marker are reported without throwing during begin/write/failure/exit', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'logs'), 'synthetic file blocking directory');
    const diag = createHostDiagnostics(f.root, { appRoot });
    assert.doesNotThrow(() => { diag.begin(); diag.write('host.event'); diag.failure('startup', new Error('fetch failed')); diag.exit('user-quit', 0); });
    assert.equal(diag.status().state, 'error'); rmSync(join(f.root, 'logs')); mkdirSync(join(f.root, 'logs'));
    writeFileSync(join(f.root, 'logs', 'current-run.json'), '{broken');
    const next = createHostDiagnostics(f.root, { appRoot }); next.begin(); assert.equal(next.status().state, 'error');
  } finally { f.remove(); }
});

test('logs rotate below single-file and total limits and remove expired days only', () => {
  const f = fixture(); let time = new Date('2026-10-01T12:00:00Z');
  try {
    const log = createHostLog(f.root, { now: () => time, maxBytes: 300, maxTotalBytes: 900 }); log.write('host.start');
    writeFileSync(join(f.root, 'logs', 'keep.json'), 'synthetic');
    time = new Date('2026-10-11T12:00:00Z'); for (let i = 0; i < 30; i++) log.write('host.state', { phase: 'starting', pid: i });
    const files = readdirSync(log.directory).filter(name => name.endsWith('.jsonl'));
    assert.ok(files.length > 1); assert.ok(files.every(name => !name.includes('2026-10-01')));
    assert.ok(files.every(name => readFileSync(join(log.directory, name)).length <= 300));
    assert.ok(files.reduce((sum, name) => sum + readFileSync(join(log.directory, name)).length, 0) <= 900);
    assert.equal(readFileSync(join(log.directory, 'keep.json'), 'utf8'), 'synthetic');
  } finally { f.remove(); }
});

test('dump retention caps count, size and age; previous-run correspondence is explicitly an inference', () => {
  const f = fixture(); const time = new Date('2026-10-11T12:00:00Z');
  try {
    const first = createHostDiagnostics(f.root, { now: () => new Date(time.getTime() - 60000) }); first.begin();
    const directory = join(f.root, 'Crashpad', 'reports'); mkdirSync(directory, { recursive: true });
    for (let i = 0; i < 8; i++) { const path = join(directory, `${randomUUID()}.dmp`); writeFileSync(path, 'synthetic dump'); const at = new Date(time.getTime() - i * 1000); utimesSync(path, at, at); }
    const old = join(directory, `${randomUUID()}.dmp`); writeFileSync(old, 'old'); utimesSync(old, new Date('2026-09-01'), new Date('2026-09-01'));
    const next = createHostDiagnostics(f.root, { now: () => time }); const previous = next.begin();
    assert.equal(readdirSync(directory).length, 5); assert.equal(previous.dumps.length, 5); assert.equal(previous.dumpMatch, 'time-window-inference');
    assert.ok(previous.dumps.every((item: any) => !item.file && item.size === 14));
    const event = rows(f.root).find(row => row.event === 'host.previous_unclean_exit');
    assert.equal(event.dumpCount, 5); assert.equal(event.dumps.length, 5); assert.equal(JSON.stringify(event).includes('synthetic dump'), false);
    const huge = join(directory, `${randomUUID()}.dmp`); const fd = openSync(huge, 'w');
    ftruncateSync(fd, 101 * 1024 * 1024); closeSync(fd); utimesSync(huge, time, time);
    const third = createHostDiagnostics(f.root, { now: () => time }); third.begin();
    assert.equal(readdirSync(directory).includes(huge.split(/[\\/]/).at(-1)!), false);
  } finally { f.remove(); }
});

test('dump pruning never follows directory symlinks or Windows junctions including the Crashpad root', () => {
  const f = fixture();
  try {
    const target = join(f.root, 'unrelated'); mkdirSync(target);
    const dump = join(target, `${randomUUID()}.dmp`); writeFileSync(dump, 'must remain');
    utimesSync(dump, new Date('2020-01-01'), new Date('2020-01-01'));
    const crash = join(f.root, 'Crashpad'); mkdirSync(crash);
    symlinkSync(target, join(crash, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const first = createHostDiagnostics(f.root); first.begin();
    assert.equal(readFileSync(dump, 'utf8'), 'must remain');
    rmSync(crash, { recursive: true, force: true });
    symlinkSync(target, crash, process.platform === 'win32' ? 'junction' : 'dir');
    const next = createHostDiagnostics(f.root); next.begin();
    assert.equal(readFileSync(dump, 'utf8'), 'must remain'); assert.equal(next.status().previous.dumps.length, 0);
  } finally { f.remove(); }
});

test('diagnostic summary revalidates persisted error text and frames and includes OS version without identities', () => {
  const f = fixture();
  try {
    const first = createHostDiagnostics(f.root, { appRoot, version: '3.1.0' }); first.begin();
    const file = readdirSync(join(f.root, 'logs')).find(name => name.endsWith('.jsonl'))!;
    writeFileSync(join(f.root, 'logs', file), JSON.stringify({ at: new Date().toISOString(), event: 'host.failure', runId: first.runId,
      name: 'SyntheticPrivateAccount', code: 'PRIVATE_SECRET', message: 'Confidential private conversation body',
      stackFrames: ['C:\\Users\\<user>\\notes.txt:1:2', 'src/main.mjs:10:2'] }) + '\n', { flag: 'a' });
    const next = createHostDiagnostics(f.root, { appRoot, version: '3.1.0' }); next.begin();
    const summary = next.status().summary;
    for (const text of ['SyntheticPrivateAccount', 'PRIVATE_SECRET', 'Confidential private', 'synthetic-private', 'notes.txt']) assert.equal(summary.includes(text), false);
    assert.ok(summary.includes('src/main.mjs:10:2')); assert.ok(summary.includes(process.platform)); assert.ok(summary.includes('WeftMate 3.1.0'));
    assert.doesNotMatch(summary, /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/);
  } finally { f.remove(); }
});

test('unsafe dump names and arbitrary signals are rejected, recognized process signals remain metadata', () => {
  const f = fixture();
  try {
    const log = createHostLog(f.root);
    const list = [{ name: 'synthetic-account.dmp', size: 15 }, { name: `${randomUUID()}.dmp`, size: 23 }];
    const item = log.write('host.event', { dumps: list, signal: 'synthetic-account' });
    assert.equal(item.dumps, undefined); assert.equal(item.signal, undefined);
    assert.equal(log.previousUnclean({}, list).dumps.length, 1);
    assert.equal(log.write('host.event', { signal: 'SIGTERM' }).signal, 'SIGTERM');
  } finally { f.remove(); }
});
