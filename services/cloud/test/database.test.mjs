import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, migrate } from '../src/database.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'weftmate-cloud-db-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('initialization is durable, idempotent, and enables SQLite foreign keys/WAL', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'state', 'cloud.sqlite');
  let opened = await openDatabase(file);
  try {
    assert.equal(opened.schemaVersion, 2);
    assert.equal(opened.database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(opened.database.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    opened.database.prepare('INSERT INTO service_metadata VALUES (?, ?)').run('fixture', 'preserved');
  } finally { opened.database.close(); }
  opened = await openDatabase(file);
  try {
    assert.equal(opened.database.prepare('SELECT count(*) AS count FROM schema_migrations').get().count, 2);
    assert.equal(opened.database.prepare('SELECT value FROM service_metadata WHERE key = ?').get('fixture').value, 'preserved');
    if (process.platform !== 'win32') {
      assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
      assert.equal((await stat(file)).mode & 0o777, 0o600);
    }
  } finally { opened.database.close(); }
});

test('new migration applies once; a failing migration rolls back schema and history together', async (t) => {
  const root = await fixture(t);
  const migrationsDir = path.join(root, 'migrations');
  await mkdir(migrationsDir);
  await writeFile(path.join(migrationsDir, '001-first.sql'), 'CREATE TABLE original (value TEXT);');
  const { database } = await openDatabase(path.join(root, 'cloud.sqlite'), { migrationsDir });
  t.after(() => database.close());
  await writeFile(path.join(migrationsDir, '002-next.sql'), 'CREATE TABLE next (value TEXT); INSERT INTO next VALUES (\'kept\');');
  assert.equal(await migrate(database, migrationsDir), 2);
  assert.equal(await migrate(database, migrationsDir), 2);
  await writeFile(path.join(migrationsDir, '003-broken.sql'), 'CREATE TABLE rolled_back (value TEXT); INSERT INTO missing VALUES (1);');
  await assert.rejects(migrate(database, migrationsDir), /missing/);
  assert.equal(database.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'rolled_back'").get().count, 0);
  assert.equal(database.prepare('SELECT count(*) AS count FROM schema_migrations').get().count, 2);
  assert.equal(database.prepare('SELECT value FROM next').get().value, 'kept');
});

test('edited applied migrations and older releases cannot silently open a newer schema', async (t) => {
  const root = await fixture(t);
  const migrationsDir = path.join(root, 'migrations');
  await mkdir(migrationsDir);
  const first = path.join(migrationsDir, '001-foundation.sql');
  const source = await readFile(fileURLToPath(new URL('../migrations/001-foundation.sql', import.meta.url)), 'utf8');
  await writeFile(first, source);
  const { database } = await openDatabase(path.join(root, 'cloud.sqlite'), { migrationsDir });
  t.after(() => database.close());
  await writeFile(first, `${source}\n-- changed\n`);
  await assert.rejects(migrate(database, migrationsDir), /history differs/);
  await writeFile(first, source);
  database.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)').run(2, '002-future.sql', 'fixture', new Date().toISOString());
  await assert.rejects(migrate(database, migrationsDir), /history differs/);
});

test('gaps in migration numbers fail without applying SQL', async (t) => {
  const root = await fixture(t);
  const migrationsDir = path.join(root, 'migrations');
  await mkdir(migrationsDir);
  await writeFile(path.join(migrationsDir, '002-gap.sql'), 'CREATE TABLE unused (value TEXT);');
  await assert.rejects(openDatabase(path.join(root, 'cloud.sqlite'), { migrationsDir }), /consecutively/);
});
