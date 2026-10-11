import { open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function acquireHeavySlot(directory, operation, { deadline = Infinity, cancelled = () => false, retryMs = 120000, onWait = console.log } = {}) {
  while (!cancelled() && Date.now() < deadline) {
    for (let index = 1; index <= 3; index++) {
      const path = join(directory, `heavy-${index}.lock`);
      try {
        // Rule 13 explicitly permits reclaiming abandoned slots after 45 minutes.
        const old = await stat(path).catch(() => null);
        if (old && Date.now() - old.mtimeMs > 45 * 60000) {
          onWait(`释放超过45分钟的遗留名额：heavy-${index}.lock`);
          await rm(path);
        }
        const handle = await open(path, 'wx');
        await handle.writeFile(JSON.stringify({ package: 'NIGHT-3a', pid: process.pid, operation, at: new Date().toISOString() }));
        await handle.close();
        let released = false;
        return { index, takenAt: Date.now(), async release() { if (!released) { released = true; await rm(path, { force: true }); } } };
      } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    onWait(`等待重活名额：${operation}`);
    // Short waits keep cancellation observable, while retries remain two minutes apart.
    const next = Math.min(Date.now() + retryMs, deadline);
    while (!cancelled() && Date.now() < next) await new Promise(done => setTimeout(done, Math.min(1000, next - Date.now())));
  }
  throw Error('等待重活名额时已停止或整晚截止时间已到');
}
