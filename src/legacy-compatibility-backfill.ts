import type { PublicModelProfile } from './stage2-config.ts';

export type LegacyCompatibilityEvidence = { id: string; baseUrl: string; model: string };

/** A v2 vault's retained legacy payload is evidence only when public metadata still matches it exactly. */
export function selectLegacyCompatibilityBackfill(input: {
  recordedId: string | null;
  profiles: readonly PublicModelProfile[];
  evidence: LegacyCompatibilityEvidence | null;
}): string | null {
  if (input.recordedId !== null || !input.evidence) return null;
  const profile = input.profiles.find((item) => item.id === input.evidence!.id);
  return profile && profile.baseUrl === input.evidence.baseUrl && profile.model === input.evidence.model ? profile.id : null;
}
