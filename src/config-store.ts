/**
 * Main-process credential vault.
 *
 * Since Stage 2, the encrypted document is intentionally a secret-only map.
 * Display names, endpoints, selected models, theme and all other non-secret
 * state live in settings.ts / weftmate-settings.json. This module imports the
 * Stage 1 combined encrypted file once, preserving every existing model/key
 * before future writes use the v2 shape.
 */
import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { prepareLegacyVaultMigration, type LegacyVaultPayload } from './legacy-vault-migration.ts';
import type { LegacyCompatibilityEvidence } from './legacy-compatibility-backfill.ts';
import type { PublicModelProfile } from './stage2-config.ts';
import { createEncryptedCredentialVaultStore, validateCredentialVaultDocument } from './credential-vault-document.ts';
import { durableReplace, persistWrappedStorageKey, persistedWindowsStorageKey } from './windows-vault-storage.mjs';

export interface ModelGroup { baseUrl: string; apiKey: string; model: string; }
export type LegacyPublicProfile = PublicModelProfile;
interface SecretDocument { schemaVersion: 2; credentials: Record<string, string>; legacyPayload?: LegacyVaultPayload; }

function configPath(): string { return join(app.getPath('userData'), 'weftmate-model.enc'); }
let wrappedStorageKey: string | null = null;
let initialization: Promise<void> | null = null;
let initializationFailed = false;
export function credentialRecoveryRequired(): boolean { return existsSync(`${configPath()}.recovery.json`); }
export async function initializeCredentialStorage(onFailure: (error: Error) => void = () => {}): Promise<void> {
  if (initialization) return initialization;
  initialization = (async () => {
    if (process.platform === 'win32' && !wrappedStorageKey) {
      const key = await persistedWindowsStorageKey(safeStorage, app.getPath('sessionData'));
      persistWrappedStorageKey(app.getPath('userData'), key);
      wrappedStorageKey = key; // Writes become possible only after the protected key is flushed.
    }
    initializationFailed = false;
    if (!existsSync(configPath())) return;
    try { const raw = decryptRaw(); if (!(raw && prepareLegacyVaultMigration(raw))) validateSecretDocument(raw); }
    catch {
      // Preserve the exact unreadable bytes. Persist the recovery state BEFORE
      // retiring the vault; interruption here repeats the safe startup check.
      durableReplace(`${configPath()}.recovery.json`, Buffer.from('{"needsRefill":true}'));
      renameSync(configPath(), `${configPath()}.unreadable-${randomUUID()}`);
      onFailure(Object.assign(new Error('模型凭据需要重新填写。'), { code: 'CREDENTIAL_VAULT_UNREADABLE' }));
    }
  })();
  try { await initialization; } catch (error) { initializationFailed = true; initialization = null; throw error; }
}
function decryptVaultBytes(bytes: Buffer): string {
  return safeStorage.decryptString(bytes);
}
function encryptVaultText(text: string): Buffer {
  if (process.platform === 'win32' && !wrappedStorageKey) throw Object.assign(new Error('本机加密存储尚未准备好，请稍后重新保存密钥。'), { code: 'CREDENTIAL_STORAGE_NOT_READY' });
  const ciphertext = safeStorage.encryptString(text);
  return ciphertext;
}
function validId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 160; }
function validKey(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 4096; }

/**
 * V2 is a small encrypted document, so validation is deliberately whole
 * document rather than best-effort.  Filtering one bad entry would turn the
 * next ordinary save into irreversible loss of a different credential.
 */
function validLegacyPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (value as { source?: unknown }).source !== 'stage1-combined'
    || !(value as { document?: unknown }).document
    || typeof (value as { document?: unknown }).document !== 'object'
    || Array.isArray((value as { document?: unknown }).document)) return false;
  try { return prepareLegacyVaultMigration((value as LegacyVaultPayload).document) !== null; } catch { return false; }
}

function validateSecretDocument(raw: unknown): SecretDocument {
  try { return validateCredentialVaultDocument(raw, validLegacyPayload) as SecretDocument; }
  catch { throw new Error('模型凭据保险库不可读或尚未完成迁移。'); }
}

function decryptRaw(): unknown {
  const file = configPath();
  if (!existsSync(file)) return null;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('本机没有可用的加密后端，无法读取模型凭据。');
  return JSON.parse(decryptVaultBytes(readFileSync(file)));
}

function readSecrets(): SecretDocument {
  return encryptedVault().read() as SecretDocument;
}

function writeSecrets(document: SecretDocument): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('本机没有可用的加密后端，无法安全保存模型凭据。');
  writeVaultCiphertext(encryptVaultText(JSON.stringify(document)));
}

function writeVaultCiphertext(ciphertext: Buffer): void {
  durableReplace(configPath(), ciphertext);
}

function encryptedVault() {
  return createEncryptedCredentialVaultStore({
    exists: () => existsSync(configPath()),
    readBytes: () => readFileSync(configPath()),
    writeBytes: writeVaultCiphertext,
    decrypt: (bytes) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('本机没有可用的加密后端，无法读取模型凭据。');
      return decryptVaultBytes(bytes);
    },
    encrypt: (text) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('本机没有可用的加密后端，无法安全保存模型凭据。');
      return encryptVaultText(text);
    },
    validateLegacyPayload: validLegacyPayload,
  });
}

function readLegacyProfiles() {
  const raw = decryptRaw();
  return raw === null ? null : prepareLegacyVaultMigration(raw);
}

/**
 * Read, but deliberately do not yet replace, the Stage 1 combined vault.
 * The caller first commits the public profile metadata to the non-secret
 * configuration. That ordering means an interrupted migration leaves the old
 * encrypted document intact rather than losing the profile/key association.
 */
export function migrateLegacyProfiles(): { pending: boolean; profiles: LegacyPublicProfile[]; activeId: string | null } {
  // A deferred/unavailable crypto backend must not turn migration's optional
  // startup probe into a fatal exit. Keep every old byte until initialization can retry.
  if (initializationFailed) return { pending: false, profiles: [], activeId: null };
  const legacy = readLegacyProfiles();
  return legacy ? { pending: true, profiles: legacy.publicProfiles, activeId: legacy.activeId } : { pending: false, profiles: [], activeId: null };
}

/** Finalise only after settings.ts has durably accepted the public metadata. */
export function completeLegacyMigration(): void {
  const legacy = readLegacyProfiles();
  if (legacy) writeSecrets({ schemaVersion: 2, credentials: legacy.credentials, legacyPayload: legacy.legacyPayload });
}

/** The legacy owner is derived only from the encrypted migration payload, never from current activeId. */
export function legacyCompatibilityEvidence(): LegacyCompatibilityEvidence | null {
  try {
    const payload = readSecrets().legacyPayload;
    if (!payload || typeof payload !== 'object' || (payload as LegacyVaultPayload).source !== 'stage1-combined') return null;
    const prepared = prepareLegacyVaultMigration((payload as LegacyVaultPayload).document);
    const profile = prepared?.publicProfiles.find((item) => item.id === prepared.activeId);
    return profile ? { id: profile.id, baseUrl: profile.baseUrl, model: profile.model } : null;
  } catch { return null; }
}

export function legacyCompatibilityProfileId(): string | null { return legacyCompatibilityEvidence()?.id ?? null; }

export function encryptionAvailable(): boolean { return safeStorage.isEncryptionAvailable(); }
/** Main-process-only transaction helpers. They intentionally return raw bytes,
 * never a decoded secret, and are not exported through preload. */
export function preflightVault(): void { if (existsSync(configPath())) void readSecrets(); }
export function snapshotVaultBytes(): Buffer | null { return existsSync(configPath()) ? readFileSync(configPath()) : null; }
export function restoreVaultBytes(snapshot: Buffer | null): void {
  const target = configPath();
  if (snapshot === null) { if (existsSync(target)) rmSync(target, { force: true }); return; }
  durableReplace(target, snapshot);
}
export function getCredential(id: string): string | null {
  if (!validId(id)) return null;
  try { return readSecrets().credentials[id] ?? null; } catch { return null; }
}
export function saveCredential(id: string, apiKey: string): void {
  if (!validId(id) || !validKey(apiKey)) throw new TypeError('credential input is invalid');
  encryptedVault().save(id, apiKey);
}
export function removeCredential(id: string): void {
  if (!validId(id)) return;
  encryptedVault().remove(id);
}

/** Compatibility accessor for the DSH child-env seam; caller supplies active profile metadata. */
export function readActiveLlms(activeId?: string | null, profile?: { baseUrl: string; model: string } | null): { llm: ModelGroup | null } {
  if (!activeId || !profile) return { llm: null };
  const apiKey = getCredential(activeId);
  return apiKey ? { llm: { baseUrl: profile.baseUrl, model: profile.model, apiKey } } : { llm: null };
}
