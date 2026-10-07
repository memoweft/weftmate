import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const defaultMigrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));

export async function migrate(database, migrationsDir = defaultMigrationsDir) {
  const names = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  const migrations = await Promise.all(names.map(async (name, index) => {
    const match = /^(\d{3})-[a-z0-9-]+\.sql$/.exec(name);
    if (!match || Number(match[1]) !== index + 1) throw new Error('Migrations must be numbered consecutively from 001');
    const sql = await readFile(path.join(migrationsDir, name), 'utf8');
    return { version: index + 1, name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT`);
  const applied = database.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all();
  for (const [index, row] of applied.entries()) {
    const source = migrations[index];
    if (!source || row.version !== source.version || row.name !== source.name || row.checksum !== source.checksum) {
      throw new Error('Database migration history differs from this release; restore the matching release or backup');
    }
  }
  for (const migration of migrations.slice(applied.length)) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      database.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)')
        .run(migration.version, migration.name, migration.checksum, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  return migrations.length;
}

export async function openDatabase(databasePath, { migrationsDir = defaultMigrationsDir } = {}) {
  // This directory belongs to the cloud service, not a shared user directory.
  await mkdir(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(databasePath), 0o700);
  const database = new DatabaseSync(databasePath);
  try {
    await chmod(databasePath, 0o600);
    database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    const schemaVersion = await migrate(database, migrationsDir);
    return { database, schemaVersion };
  } catch (error) {
    database.close();
    throw error;
  }
}
