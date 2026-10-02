import { FORMAL_LOCAL_BASE_URL } from '../local-model-config.mjs';

/** The session owner comes from the durable access store; model output supplies no identity. */
export function memorySessionPolicy({ binding, described, selected, access }) {
  if (!binding || !['personal-remote', 'shared-chat'].includes(binding.origin)) {
    return { allowed: false, reasonCode: 'MEMORY_OWNER_UNAVAILABLE' };
  }
  const preset = binding.origin === 'shared-chat' ? 'personal-shared-chat' : 'personal-remote';
  if (described?.agentPreset !== preset) return { allowed: false, reasonCode: 'MEMORY_OWNER_UNAVAILABLE' };
  if (!selected) return { allowed: true, ownerId: binding.ownerId };
  const profile = selected.profile;
  if (binding.modelProfileId !== profile?.id || profile.baseUrl !== FORMAL_LOCAL_BASE_URL ||
      access?.canUseModelProfile?.(binding.ownerId, profile.id) !== true ||
      access?.isFormalLocalProfile?.(profile.id) !== true) {
    return { allowed: false, reasonCode: 'MEMORY_DESTINATION_BLOCKED' };
  }
  return { allowed: true, ownerId: binding.ownerId };
}

/** Resolve recall from the host's durable route; a DSH pre-step must not query DSH again. */
export function memoryRecallDestination({ binding, described, boundProfileId, profiles, access, hasCredential }) {
  const ownership = memorySessionPolicy({ binding, described, access });
  if (!ownership.allowed) return ownership;
  if (typeof boundProfileId !== 'string' || !boundProfileId ||
      boundProfileId !== binding.modelProfileId) {
    return { allowed: false, reasonCode: 'MEMORY_DESTINATION_BLOCKED' };
  }
  const matches = Array.isArray(profiles) ? profiles.filter((item) => item?.id === boundProfileId) : [];
  if (matches.length !== 1 || hasCredential?.(matches[0]) !== true) {
    return { allowed: false, reasonCode: 'MEMORY_DESTINATION_BLOCKED' };
  }
  return memorySessionPolicy({ binding, described, selected: { profile: matches[0] }, access });
}
