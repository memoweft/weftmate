/** Main-only diagnostics projection. Keep this deliberately structural: never spread arbitrary runtime inputs. */
export function buildRedactedDiagnostics(input: {
  version: string;
  settings: { schemaVersion: number; appearance: { theme: string }; models: { profiles: unknown[]; activeId: string | null } };
  models: { profiles: unknown[]; activeId: string | null };
  configured: boolean;
  ready: boolean;
  packaged?: boolean;
  safeStorageAvailable?: boolean;
  aiGame?: { managed?: boolean; state?: string; reasonCode?: string; runtimeVersion?: string | null; apiVersion?: string | null; retryable?: boolean };
  update?: { enabled?: boolean; status?: string; version?: string | null; error?: string | null };
}) {
  const profiles = input.models.profiles.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const profile = candidate as Record<string, unknown>;
    if (typeof profile.id !== 'string' || typeof profile.name !== 'string'
      || typeof profile.provider !== 'string' || typeof profile.model !== 'string') return [];
    return [{
      id: profile.id,
      name: profile.name,
      provider: profile.provider,
      model: profile.model,
      active: profile.id === input.models.activeId,
      credentialProtected: profile.hasKey === true,
    }];
  });
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    app: { name: 'WeftMate', version: input.version, packaged: input.packaged === true },
    settings: {
      schemaVersion: input.settings.schemaVersion,
      appearance: { theme: input.settings.appearance.theme },
      models: { profiles, activeId: input.models.activeId },
    },
    runtime: { configured: input.configured, ready: input.ready },
    aiGame: {
      managed: input.aiGame?.managed === true,
      state: typeof input.aiGame?.state === 'string' ? input.aiGame.state : 'not_installed',
      reasonCode: typeof input.aiGame?.reasonCode === 'string' ? input.aiGame.reasonCode : 'runtime_not_installed',
      runtimeVersion: typeof input.aiGame?.runtimeVersion === 'string' ? input.aiGame.runtimeVersion : null,
      apiVersion: typeof input.aiGame?.apiVersion === 'string' ? input.aiGame.apiVersion : null,
      retryable: input.aiGame?.retryable === true,
    },
    security: {
      safeStorageAvailable: input.safeStorageAvailable === true,
      protectedCredentialProfiles: profiles.filter((profile) => profile.credentialProtected).length,
    },
    update: {
      enabled: input.update?.enabled === true,
      status: typeof input.update?.status === 'string' ? input.update.status : 'disabled',
      version: typeof input.update?.version === 'string' ? input.update.version : null,
      error: typeof input.update?.error === 'string' ? input.update.error : null,
    },
    dataPolicy: {
      programFiles: 'installer-managed',
      userConfiguration: 'retained-on-uninstall',
      dshSessions: 'retained-on-uninstall',
      safeStorageVault: 'retained-on-uninstall',
      localDiagnostics: 'retained-on-uninstall',
    },
  };
}
