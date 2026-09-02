/**
 * Stage 2 non-secret product configuration.
 *
 * This module deliberately has no Electron dependency so its schema, migration,
 * corruption recovery, atomic replacement and write serialisation can be tested
 * without a desktop process.  API keys never belong to this data shape.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const PRODUCT_CONFIG_SCHEMA_VERSION = 3;
export type ThemePreference = 'system' | 'light' | 'dark';
export type ProviderKind = 'openai-compatible';

export interface PublicModelProfile {
  id: string;
  name: string;
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  reasoningEffort?: 'off' | 'low' | 'medium' | 'high';
}

export interface SessionModelBinding {
  profileId: string;
  /** True only for a Stage 2 route that must be re-selected after DSH restart. */
  restoreInternalRoute: boolean;
}

export interface ProductConfig {
  schemaVersion: typeof PRODUCT_CONFIG_SCHEMA_VERSION;
  appearance: { theme: ThemePreference };
  models: { profiles: PublicModelProfile[]; activeId: string | null };
  /** Non-secret durable guard for sessions that predate a persisted DSH header. */
  sessionBindings: Record<string, SessionModelBinding>;
  /** Written only by the explicit Stage 1 -> 2 migration, never inferred from activeId. */
  legacyCompatibilityProfileId: string | null;
  // Existing non-sensitive preferences stay here for backwards compatibility.
  perception?: Record<string, unknown>;
  desktopPet?: Record<string, unknown>;
}

const empty = (): ProductConfig => ({
  schemaVersion: PRODUCT_CONFIG_SCHEMA_VERSION,
  appearance: { theme: 'system' },
  models: { profiles: [], activeId: null },
  sessionBindings: {},
  legacyCompatibilityProfileId: null,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;
}

/**
 * Endpoint text is persisted in ordinary settings and can appear in a
 * diagnostics export.  Reject URL forms that can smuggle credentials or other
 * sensitive material into that public surface.
 */
export function normalizeApiBaseUrl(value: unknown): string | null {
  const candidate = stringValue(value, 2_048);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    const hostname = parsed.hostname.toLowerCase();
    const loopback = hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(hostname);
    if (parsed.protocol === 'http:' && !loopback) return null;
    return parsed.toString().replace(/\/+$/, '');
  } catch { return null; }
}

function validProfile(value: unknown): PublicModelProfile | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id, 160);
  const name = stringValue(value.name, 120);
  const baseUrl = normalizeApiBaseUrl(value.baseUrl);
  const model = stringValue(value.model, 240);
  if (!id || !name || !baseUrl || !model || value.provider !== 'openai-compatible') return null;
  const reasoningEffort = ['off', 'low', 'medium', 'high'].includes(String(value.reasoningEffort))
    ? value.reasoningEffort as PublicModelProfile['reasoningEffort'] : undefined;
  return { id, name, provider: 'openai-compatible', baseUrl, model, ...(reasoningEffort ? { reasoningEffort } : {}) };
}

/** Validate and migrate v0 (legacy settings) / v1 into the current schema. */
export function normalizeProductConfig(raw: unknown): ProductConfig {
  if (!isRecord(raw)) throw new TypeError('settings document must be an object');
  const appearance = isRecord(raw.appearance) && ['system', 'light', 'dark'].includes(String(raw.appearance.theme))
    ? { theme: raw.appearance.theme as ThemePreference } : { theme: 'system' as ThemePreference };
  const rawModels = isRecord(raw.models) ? raw.models : {};
  const profiles = Array.isArray(rawModels.profiles) ? rawModels.profiles.map(validProfile).filter((item): item is PublicModelProfile => item !== null) : [];
  const activeCandidate = typeof rawModels.activeId === 'string' ? rawModels.activeId : null;
  const activeId = profiles.some((item) => item.id === activeCandidate) ? activeCandidate : (profiles[0]?.id ?? null);
  const knownProfileIds = new Set(profiles.map((profile) => profile.id));
  const legacyCompatibilityCandidate = stringValue(raw.legacyCompatibilityProfileId, 160);
  const legacyCompatibilityProfileId = legacyCompatibilityCandidate && knownProfileIds.has(legacyCompatibilityCandidate)
    ? legacyCompatibilityCandidate : null;
  const rawBindings = isRecord(raw.sessionBindings) ? raw.sessionBindings : {};
  const sessionBindings: Record<string, SessionModelBinding> = {};
  for (const [sessionId, rawBinding] of Object.entries(rawBindings)) {
    const safeSessionId = stringValue(sessionId, 240);
    const rawProfileId = typeof rawBinding === 'string' ? rawBinding : (isRecord(rawBinding) ? rawBinding.profileId : null);
    const safeProfileId = stringValue(rawProfileId, 160);
    const restoreInternalRoute = isRecord(rawBinding) && rawBinding.restoreInternalRoute === true;
    if (safeSessionId && safeProfileId && knownProfileIds.has(safeProfileId)) sessionBindings[safeSessionId] = { profileId: safeProfileId, restoreInternalRoute };
  }
  return {
    schemaVersion: PRODUCT_CONFIG_SCHEMA_VERSION,
    appearance,
    models: { profiles, activeId },
    sessionBindings,
    legacyCompatibilityProfileId,
    ...(isRecord(raw.perception) ? { perception: raw.perception } : {}),
    ...(isRecord(raw.desktopPet) ? { desktopPet: raw.desktopPet } : {}),
  };
}

function corruptBackupName(filePath: string): string {
  return `${filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
}

export class ProductConfigStore {
  private static queues = new Map<string, Promise<void>>();
  readonly filePath: string;
  constructor(filePath: string) { this.filePath = filePath; }

  read(): ProductConfig {
    if (!existsSync(this.filePath)) return empty();
    try {
      return normalizeProductConfig(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch {
      // Never overwrite an unreadable user file. Preserve it next to the new
      // default, so support can recover it without exposing data to renderer.
      try { copyFileSync(this.filePath, corruptBackupName(this.filePath)); } catch {
        // A later write after a failed backup would destroy the sole copy.
        // Fail closed and leave the original bytes untouched.
        throw new Error('设置文件损坏且无法创建恢复备份；已拒绝覆盖原文件。');
      }
      return empty();
    }
  }

  write(config: ProductConfig): ProductConfig {
    const safe = normalizeProductConfig(config);
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(safe, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, this.filePath);
      return safe;
    } catch (error) {
      try { rmSync(temporary, { force: true }); } catch { /* preserve previous file */ }
      throw error;
    }
  }

  /** In-process serialisation prevents two IPC handlers from losing a write. */
  update(mutator: (current: ProductConfig) => ProductConfig): Promise<ProductConfig> {
    const previous = ProductConfigStore.queues.get(this.filePath) ?? Promise.resolve();
    let finish!: () => void;
    const current = new Promise<void>((resolve) => { finish = resolve; });
    const queued = previous.then(() => current);
    ProductConfigStore.queues.set(this.filePath, queued);
    return previous.then(() => this.write(mutator(this.read()))).finally(() => {
      finish();
      if (ProductConfigStore.queues.get(this.filePath) === queued) ProductConfigStore.queues.delete(this.filePath);
    });
  }
}
