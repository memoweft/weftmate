/** Small fault-injectable transaction core for profile/public/vault/patch changes. */
export async function runRecoverableProfileMutation<T, Snapshot>(input: {
  snapshot: Snapshot;
  writeJournal: (snapshot: Snapshot) => void | Promise<void>;
  apply: () => Promise<T>;
  restore: (snapshot: Snapshot) => Promise<void>;
  clearJournal: () => void | Promise<void>;
}): Promise<T> {
  await input.writeJournal(input.snapshot);
  try {
    const result = await input.apply();
    await input.clearJournal();
    return result;
  } catch (error) {
    try { await input.restore(input.snapshot); await input.clearJournal(); }
    catch { throw new Error('模型更改失败，且自动恢复旧运行时失败；恢复记录已保留以供下次启动。'); }
    throw error;
  }
}
