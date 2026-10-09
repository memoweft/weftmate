import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join, dirname, toNamespacedPath } from 'node:path';
import { tmpdir } from 'node:os';
import { sqliteSnapshot } from '../src/personal-backup/archive.mjs';
test('Windows upgrade snapshot preserves SQLite rows with source and destination beyond MAX_PATH', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'r01-sqlite-'));
  const source = join(root, 'source-' + 'a'.repeat(100), 'nested-' + 'b'.repeat(100), 'memory.sqlite3');
  const destination = join(root, 'snapshot-' + 'c'.repeat(100), 'nested-' + 'd'.repeat(100), 'memory.sqlite3');
  try {
    assert.ok(source.length > 260 && destination.length > 260);
    await mkdir(dirname(source), { recursive: true }); await mkdir(dirname(destination), { recursive: true });
    const input = new DatabaseSync(toNamespacedPath(source));
    input.exec("CREATE TABLE memories(id integer, text text); INSERT INTO memories VALUES(1, 'retained rehearsal memory');"); input.close();
    await sqliteSnapshot(source, destination);
    const output = new DatabaseSync(toNamespacedPath(destination), { readOnly: true });
    try { assert.equal(output.prepare('SELECT text FROM memories WHERE id=1').get()?.text, 'retained rehearsal memory'); }
    finally { output.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
