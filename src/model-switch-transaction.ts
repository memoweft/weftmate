/**
 * Main-process model switch transaction.
 *
 * Credentials are checked before touching persistent activeId. The active
 * preference is consumed only by future session creation; it must never swap
 * the shared DSH child or rewrite an existing session's persisted selection.
 */
export interface SwitchModelDependencies<TProfile extends { id: string }> {
  id: string;
  list: () => { profiles: TProfile[]; activeId: string | null };
  hasCredential: (id: string) => boolean;
  setActive: (id: string | null) => boolean;
}

export async function switchActiveModel<TProfile extends { id: string }>(deps: SwitchModelDependencies<TProfile>): Promise<void> {
  const before = deps.list();
  if (!before.profiles.some((profile) => profile.id === deps.id)) throw new Error('unknown model');
  if (!deps.hasCredential(deps.id)) throw new Error('missing model credential');
  if (before.activeId === deps.id) return;
  if (!deps.setActive(deps.id)) throw new Error('cannot activate model');
}
