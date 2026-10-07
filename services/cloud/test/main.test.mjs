import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import './dependencies.mjs';

const serviceDir = fileURLToPath(new URL('../', import.meta.url));

test('real entrypoint starts on an isolated port, serves health, and closes on SIGTERM', { timeout: 15000 }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'weftmate-cloud-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, ['src/main.mjs'], { cwd: serviceDir,
    env: { ...process.env, CLOUD_HOST: '127.0.0.1', CLOUD_PORT: '0', CLOUD_DATA_DIR: root,
      CLOUD_MAIL_TRANSPORT: 'file', CLOUD_MAIL_FROM: 'test@example.com', CLOUD_MAIL_DIR: path.join(root, 'mail') } });
  const exited = once(child, 'exit');
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const lines = createInterface({ input: child.stdout });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const started = new Promise((resolve, reject) => {
    lines.on('line', (line) => {
      const record = JSON.parse(line);
      if (record.event === 'service.started') resolve(record);
      if (record.event === 'service.start_failed') reject(new Error(line));
    });
    exited.then(([code, signal]) => reject(new Error(`Exited before readiness: ${code}/${signal}: ${stderr}`)));
  });
  const record = await started;
  const response = await fetch(`http://127.0.0.1:${record.port}/healthz`);
  assert.equal(response.status, 200);
  await response.text();
  if (process.platform !== 'win32') {
    for (const name of ['cloud.sqlite', 'cloud.sqlite-wal', 'cloud.sqlite-shm']) {
      assert.equal((await stat(path.join(root, name))).mode & 0o777, 0o600);
    }
  }
  child.kill('SIGTERM');
  assert.deepEqual(await exited, [0, null]);
  const db = new DatabaseSync(path.join(root, 'cloud.sqlite'));
  try { assert.equal(db.prepare('SELECT count(*) AS count FROM schema_migrations').get().count, 2); }
  finally { db.close(); }
});

test('invalid configuration exits nonzero and logs no environment values', { timeout: 15000 }, async () => {
  const child = spawn(process.execPath, ['src/main.mjs'], { cwd: serviceDir,
    env: { ...process.env, CLOUD_PORT: 'fixture-secret-invalid-port' } });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.resume();
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
  assert.equal(JSON.parse(stdout.trim()).event, 'service.start_failed');
  assert.doesNotMatch(stdout, /fixture-secret|stack/);
});
