/** Pure Stage 2 guards for the one shared DSH session root. */
export type SessionReferenceScanState = { state: 'pending' | 'ready' | 'failed'; error: string | null };

export function assertSessionReferenceScanReady(scan: SessionReferenceScanState): void {
  if (scan.state === 'ready') return;
  throw new Error(scan.state === 'failed'
    ? '无法确认历史会话引用；请检查 Harness 连接后重试，暂不能修改或删除模型。'
    : '正在确认历史会话引用；确认完成前暂不能修改或删除模型。');
}

/** DSH /sessions is the authority for a route reload; renderer SSE is not. */
export function assertAuthoritativeSessionsIdle(response: unknown): void {
  const items = (response as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.some((item) => !item || typeof item !== 'object' || typeof (item as { sessionId?: unknown }).sessionId !== 'string' || typeof (item as { running?: unknown }).running !== 'boolean')) {
    throw new Error('Harness 会话状态无效，不能安全修改模型路由。');
  }
  if (items.some((item) => (item as { running: boolean }).running)) throw new Error('Harness 仍报告有生成中的会话。请等待完成或停止后重试。');
}

export type SafeSessionBindingSource = 'internal-header' | 'durable-binding' | 'legacy-compatibility';

/** The active profile is only a future-session preference, never evidence for an old DSH session. */
export function resolveSafeSessionBinding<TProfile extends { id: string }>(input: {
  provider: unknown;
  profiles: TProfile[];
  providerForProfile: (profile: TProfile) => string;
  priorBinding: string | null;
  legacyCompatibilityProfileId: string | null;
}): { profile: TProfile; source: SafeSessionBindingSource } {
  const provider = typeof input.provider === 'string' ? input.provider : '';
  const headerProfile = input.profiles.find((profile) => input.providerForProfile(profile) === provider);
  if (headerProfile) return { profile: headerProfile, source: 'internal-header' };
  const durableProfile = input.profiles.find((profile) => profile.id === input.priorBinding);
  if (durableProfile) return { profile: durableProfile, source: 'durable-binding' };
  // An empty header can be a Stage 2 session that crashed after POST but before
  // its explicit bind.  Only the exact Stage 1 provider has compatibility
  // evidence; empty must still carry a pre-existing durable binding.
  const legacyHeader = provider === 'deepseek-official';
  const compatibilityProfile = input.profiles.find((profile) => profile.id === input.legacyCompatibilityProfileId);
  if (legacyHeader && compatibilityProfile) return { profile: compatibilityProfile, source: 'legacy-compatibility' };
  const error = new Error('历史会话没有可确认的模型归属。请在设置中恢复原模型或完成旧版兼容迁移后重试；为安全起见未向任何模型服务发送请求。') as Error & { code?: string };
  error.code = 'session-model-ownership-unknown';
  throw error;
}

export async function scanSharedSessionBindings<TProfile extends { id: string }>(input: {
  profiles: TProfile[];
  listSessions: () => Promise<unknown>;
  readSelectedModel: (sessionId: string) => Promise<unknown>;
  providerForProfile: (profile: TProfile) => string;
  priorBinding: (sessionId: string) => string | null;
  legacyCompatibilityProfileId: string | null;
  bind: (sessionId: string, profileId: string) => void;
}): Promise<void> {
  const listed = await input.listSessions();
  const items = (listed as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) throw new Error('session reference scan returned an invalid response');
  const recovered: Array<{ sessionId: string; profileId: string }> = [];
  for (const item of items) {
    const sessionId = (item as { sessionId?: unknown } | null)?.sessionId;
    if (typeof sessionId !== 'string') throw new Error('session reference scan returned an invalid session');
    const selected = await input.readSelectedModel(sessionId) as { current?: { provider?: unknown } };
    const chosen = resolveSafeSessionBinding({ provider: selected?.current?.provider, profiles: input.profiles,
      providerForProfile: input.providerForProfile, priorBinding: input.priorBinding(sessionId),
      legacyCompatibilityProfileId: input.legacyCompatibilityProfileId });
    recovered.push({ sessionId, profileId: chosen.profile.id });
  }
  // Avoid partially binding a root that contains one unknown session: a later retry starts from unchanged durable state.
  for (const value of recovered) input.bind(value.sessionId, value.profileId);
}

/**
 * Persistent-session protection for Stage 2 profile changes.  The caller reads
 * its `referenced` fact from the schema-validated on-disk session binding, not
 * from a renderer/sidebar cache, so a cold start is protected before any UI
 * session list is opened.
 */
export function assertModelProfileMutationAllowed(input: {
  referenced: boolean;
  operation: 'edit' | 'delete';
  displayNameOnly?: boolean;
}): void {
  if (!input.referenced) return;
  if (input.operation === 'edit' && input.displayNameOnly === true) return;
  if (input.operation === 'delete') throw new Error('此模型仍被历史会话引用，不能删除其凭据。请保留该配置或新增替代模型。');
  throw new Error('此模型已被历史会话引用。只能修改名称；请新增配置并切换，历史会话不会被改写。');
}
