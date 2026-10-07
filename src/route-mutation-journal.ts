import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

type RouteMutationSnapshot = { settingsSnapshot: Buffer | null; vaultSnapshot: Buffer | null; patchSnapshot: Buffer | null };
type ParsedJournal = { version: 1; settingsBytes: string | null; vaultCiphertext: string | null; patchBytes: string | null };

function decodeBase64(value: string): Buffer | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value ? decoded : null;
}

function parseJournal(text: string): ParsedJournal {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('模型路由恢复记录损坏；已拒绝继续启动。'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('模型路由恢复记录损坏；已拒绝继续启动。');
  const value = raw as { version?: unknown; settingsBytes?: unknown; vaultCiphertext?: unknown; patchBytes?: unknown };
  if (value.version !== 1 || (typeof value.settingsBytes !== 'string' && value.settingsBytes !== null)
    || (typeof value.vaultCiphertext !== 'string' && value.vaultCiphertext !== null)
    || (typeof value.patchBytes !== 'string' && value.patchBytes !== null)
    || (typeof value.settingsBytes === 'string' && decodeBase64(value.settingsBytes) === null)
    || (typeof value.vaultCiphertext === 'string' && decodeBase64(value.vaultCiphertext) === null)
    || (typeof value.patchBytes === 'string' && decodeBase64(value.patchBytes) === null)) throw new Error('模型路由恢复记录损坏；已拒绝继续启动。');
  return { version: 1, settingsBytes: value.settingsBytes, vaultCiphertext: value.vaultCiphertext, patchBytes: value.patchBytes };
}

function restoreRawBytes(path: string, bytes: Buffer | null): void {
  if (bytes === null) { if (existsSync(path)) rmSync(path, { force: true }); return; }
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.recovery.tmp`;
  try { writeFileSync(temporary, bytes, { mode: 0o600 }); renameSync(temporary, path); }
  catch (error) { try { rmSync(temporary, { force: true }); } catch {} throw error; }
}

/**
 * Bootstrap-only recovery: it deliberately knows no settings or vault module.
 * This must run before either module can migrate, validate, read, or rewrite a
 * document whose old bytes the journal promises to restore.
 */
export function recoverRouteMutationJournalFiles(input: {
  journalPath: string;
  settingsPath: string;
  vaultPath: string;
  patchPath: string;
}): void {
  if (!existsSync(input.journalPath)) return;
  // Validate every encoded field before the first original is modified.
  const journal = parseJournal(readFileSync(input.journalPath, 'utf8'));
  const settings = journal.settingsBytes === null ? null : decodeBase64(journal.settingsBytes)!;
  const vault = journal.vaultCiphertext === null ? null : decodeBase64(journal.vaultCiphertext)!;
  const patch = journal.patchBytes === null ? null : decodeBase64(journal.patchBytes)!;
  restoreRawBytes(input.settingsPath, settings);
  restoreRawBytes(input.vaultPath, vault);
  restoreRawBytes(input.patchPath, patch);
  rmSync(input.journalPath, { force: true });
}

export function createRouteMutationJournal(input: {
  journalPath: string;
  patchPath: string;
  restoreSettingsBytes: (bytes: Buffer | null) => void;
  restoreVaultBytes: (bytes: Buffer | null) => void;
}) {
  const clear = () => { if (existsSync(input.journalPath)) rmSync(input.journalPath, { force: true }); };
  return {
    write(snapshot: RouteMutationSnapshot): void {
      const temporary = `${input.journalPath}.${process.pid}.tmp`;
      const text = JSON.stringify({ version: 1, settingsBytes: snapshot.settingsSnapshot?.toString('base64') ?? null,
        vaultCiphertext: snapshot.vaultSnapshot?.toString('base64') ?? null,
        patchBytes: snapshot.patchSnapshot?.toString('base64') ?? null });
      writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, input.journalPath);
    },
    clear,
    recover(): void {
      if (!existsSync(input.journalPath)) return;
      // Parse every field and validate byte encodings before modifying any
      // original public, vault, or patch file.
      const journal = parseJournal(readFileSync(input.journalPath, 'utf8'));
      const settings = journal.settingsBytes === null ? null : decodeBase64(journal.settingsBytes)!;
      const vault = journal.vaultCiphertext === null ? null : decodeBase64(journal.vaultCiphertext)!;
      const patch = journal.patchBytes === null ? null : decodeBase64(journal.patchBytes)!;
      input.restoreSettingsBytes(settings);
      input.restoreVaultBytes(vault);
      if (patch === null) { if (existsSync(input.patchPath)) rmSync(input.patchPath, { force: true }); }
      else writeFileSync(input.patchPath, patch, { mode: 0o600 });
      clear();
    },
  };
}

/** Small fault-injectable transaction core for profile/public/vault/patch changes. */
export async function runRecoverableProfileMutation<T, Snapshot>(input: {
  snapshot: Snapshot;
  writeJournal: (snapshot: Snapshot) => void | Promise<void>;
  apply: () => Promise<T>;
  restore: (snapshot: Snapshot) => Promise<void>;
  clearJournal: () => void | Promise<void>;
}): Promise<T> {
  await input.writeJournal(input.snapshot);
  try {
    const result = await input.apply();
    await input.clearJournal();
    return result;
  } catch (error) {
    try { await input.restore(input.snapshot); await input.clearJournal(); }
    catch { throw new Error('模型更改失败，且自动恢复旧运行时失败；恢复记录已保留以供下次启动。'); }
    throw error;
  }
}
