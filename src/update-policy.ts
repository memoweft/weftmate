/** Convert updater failures into bounded user-facing categories without paths, URLs or tokens. */
export function sanitizeUpdateFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '');
  if (/signature|publisher|signed/i.test(text)) return '更新包签名校验未通过。请保留当前版本并联系维护者。';
  if (/sha\d*|checksum|integrity|hash/i.test(text)) return '更新包完整性校验未通过。请稍后重试。';
  if (/timeout|timed out|econn|enotfound|network|http|fetch|socket|offline/i.test(text)) return '无法连接更新源。请检查网络或稍后重试。';
  return '更新未完成。当前版本保持不变，请稍后重试。';
}

/** Both About and tray actions share the same idle/backup/install boundary. */
export async function installPreparedUpdate({ ready, idle, beforeInstall, install }: {
  ready: () => boolean;
  idle: () => Promise<boolean>;
  beforeInstall: () => Promise<void>;
  install: () => boolean;
}): Promise<boolean> {
  if (!ready() || !await idle()) return false;
  try { await beforeInstall(); } catch { return false; }
  if (!ready() || !await idle()) return false;
  return install();
}
