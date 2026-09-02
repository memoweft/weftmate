/**
 * Pure Stage 1 combined-vault migration preparation.
 *
 * The returned legacyPayload keeps the complete old encrypted document inside
 * the new encrypted vault.  It is never part of ProductConfig, IPC, preload,
 * diagnostics, or a renderer view.  That preserves write/embed credentials
 * and tiers until their owning product surface is formally implemented.
 */
import { normalizeApiBaseUrl, type PublicModelProfile } from './stage2-config.ts';

export interface LegacyVaultPayload {
  source: 'stage1-combined';
  document: Record<string, unknown>;
}

export interface PreparedLegacyVaultMigration {
  publicProfiles: PublicModelProfile[];
  activeId: string | null;
  credentials: Record<string, string>;
  legacyPayload: LegacyVaultPayload;
}

interface LegacyLlm { baseUrl?: unknown; apiKey?: unknown; model?: unknown; }
interface LegacyProfile { id?: unknown; name?: unknown; llm?: LegacyLlm; write?: unknown; embed?: unknown; }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function validId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 160; }
function validKey(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 4096; }
function text(value: unknown, max: number): string | null { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null; }
function cloneDocument(value: Record<string, unknown>): Record<string, unknown> { return structuredClone(value); }

/**
 * Returns null when supplied a v2 vault, and throws for an unreadable/unknown
 * old vault. Callers must then preserve the original ciphertext and refuse a
 * write rather than silently replacing it with an empty document.
 */
export function prepareLegacyVaultMigration(raw: unknown): PreparedLegacyVaultMigration | null {
  if (!isRecord(raw)) throw new TypeError('legacy vault is not an object');
  if (raw.schemaVersion === 2) return null;
  const hasSingleProfile = ['llm', 'write', 'embed'].some((key) => Object.prototype.hasOwnProperty.call(raw, key));
  const records: LegacyProfile[] = Array.isArray(raw.profiles)
    ? raw.profiles.filter(isRecord) as LegacyProfile[]
    : hasSingleProfile ? [{ id: 'p-legacy', name: isRecord(raw.llm) ? raw.llm.model : undefined, llm: isRecord(raw.llm) ? raw.llm : undefined, write: raw.write, embed: raw.embed }]
      : (() => { throw new TypeError('legacy vault has no model profiles'); })();
  const credentials: Record<string, string> = {};
  const publicProfiles: PublicModelProfile[] = [];
  const usedIds = new Set<string>();
  for (const [index, item] of records.entries()) {
    let id = validId(item.id) ? item.id : `legacy-${index + 1}`;
    while (usedIds.has(id)) id = `legacy-${index + 1}-${usedIds.size + 1}`;
    usedIds.add(id);
    const baseUrl = normalizeApiBaseUrl(item.llm?.baseUrl);
    const model = text(item.llm?.model, 240);
    if (!baseUrl || !model) continue;
    if (validKey(item.llm?.apiKey)) credentials[id] = item.llm!.apiKey;
    publicProfiles.push({ id, name: text(item.name, 120) ?? model, provider: 'openai-compatible', baseUrl, model });
  }
  const requested = typeof raw.activeId === 'string' ? raw.activeId : null;
  return {
    publicProfiles,
    activeId: publicProfiles.some((item) => item.id === requested) ? requested : publicProfiles[0]?.id ?? null,
    credentials,
    legacyPayload: { source: 'stage1-combined', document: cloneDocument(raw) },
  };
}
