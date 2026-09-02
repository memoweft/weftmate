import type { PublicModelProfile } from './stage2-config.ts';

/** Restore only Stage 2 internal-route bindings after a shared DSH restart. */
export async function restoreInternalSessionRoute(input: {
  sessionId: string;
  profile: PublicModelProfile;
  provider: string;
  needsRestore: boolean;
  current: () => Promise<{ current?: { provider?: string; model?: string } }>;
  select: (value: { provider: string; model: string; reasoningEffort?: string }) => Promise<unknown>;
}): Promise<boolean> {
  if (!input.needsRestore) return false;
  const selected = await input.current();
  if (selected?.current?.provider === input.provider && selected?.current?.model === input.profile.model) return false;
  await input.select({ provider: input.provider, model: input.profile.model,
    ...(input.profile.reasoningEffort && input.profile.reasoningEffort !== 'off' ? { reasoningEffort: input.profile.reasoningEffort } : {}) });
  return true;
}
