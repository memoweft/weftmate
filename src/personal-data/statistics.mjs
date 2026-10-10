import { Worker } from 'node:worker_threads';
import { dataError } from './paths.mjs';
export const DATA_CATEGORIES = [
  { id: 'conversations', name: '对话记录', icon: 'chat', description: '对话、执行记录与本账户的工作文件。' },
  { id: 'memory', name: '记忆', icon: 'memory', description: '记忆、来源和个性化；用量及健康记录也保存在此账户。' },
  { id: 'files', name: '成果与文件', icon: 'folder', description: '成果原件和上传的附件；项目文件仅登记在原位置。' },
  { id: 'cache', name: '附件与图片缓存', icon: 'image', description: '可重新生成的缩略图，不含附件原件。', cleanable: true, pureCache: true },
  { id: 'offline', name: '离线副本', icon: 'desktop', description: '已过期的电脑端副本；其他设备在下次连接时清理。', cleanable: true },
  { id: 'logs', name: '日志与诊断', icon: 'tool', description: '本账户的诊断记录；清理只移除七天前的记录。', cleanable: true },
  { id: 'backups', name: '备份', icon: 'archive', description: '本账户保存的备份；整机备份和已导出的外部文件需在原位置处理。' },
  { id: 'temporary', name: '临时文件', icon: 'clock', description: '一天前过期的临时文件，不含临时对话。', cleanable: true },
];
export function scanStatistics(sources, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const worker = new Worker(new URL('./statistics-worker.mjs', import.meta.url), { workerData: { sources, categories: DATA_CATEGORIES.map(row => row.id) } });
    const cancel = () => { void worker.terminate(); reject(signal.reason); };
    signal?.addEventListener('abort', cancel, { once: true });
    worker.once('error', reject);
    worker.once('message', value => { signal?.removeEventListener('abort', cancel); value.error ? reject(dataError(value.error.code)) : resolve(value.categories); });
    worker.once('exit', () => signal?.removeEventListener('abort', cancel));
  });
}
