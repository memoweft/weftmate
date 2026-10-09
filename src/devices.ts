/**
 * WeftMate 设备接缝（R8-01，main 侧）——手机自研 App 的配对与上报面。
 *
 * 方向（owner 拍板 2026-08-17）：官方 webserver 保持 127.0.0.1 loopback + trust fence 不变；
 * 手机端经 ADB/局域网反向隧道把请求转发到本机 127.0.0.1（协议见 docs/R8-DEVICE-PROTOCOL.md）。
 *
 * 职责：
 *  - 配对 token：运行时生成（32 hex），TTL 10 分钟，随状态文件出给插件做等值+时效校验；
 *    过期自动轮换；token 不落明文敏感之外的文件（状态文件在本地 dsh-home，与既有双工同纪律）；
 *  - 设备登记：pair 成功后记录 {id, name, lastSeenAt}（持久于状态文件）；
 *  - 观察消费：插件校验通过写请求文件 → 本模块轮询消费 → 手机源开关开时写
 *    <dsh-home>/weftmate-device-observations.json（最近 5 条）→ perception.ts 采样合并进
 *    手机段（UI 展示/模型注入走既有感知面）；开关关时观察丢弃（不开不收）。
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { createLatestFileWriter } from './latest-file-writer.mjs';
import { join } from 'node:path';
import { getMobilePerceptionEnabled } from './settings.ts';

const PAIRING_TTL_MS = 10 * 60_000;
const MAX_OBSERVATIONS = 5;
const OBSERVATION_MAX_CHARS = 500;

export interface DeviceObservation {
  id: string;
  content: string;
  occurredAt: string;
  deviceName: string;
}

export interface DeviceStateFile {
  schemaVersion: 1;
  pairing: { token: string; expiresAt: number } | null;
  devices: Array<{ id: string; name: string; lastSeenAt: string }>;
}

export interface DevicesRuntime {
  dispose(): void;
  /** 最近手机观察（供 perception.ts 采样合并；只读拷贝）。 */
  readMobileObservations(): DeviceObservation[];
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function initDevices(opts: { dshHome: string }): DevicesRuntime {
  const stateFile = join(opts.dshHome, 'weftmate-device-state.json');
  const requestFile = join(opts.dshHome, 'weftmate-device-request.json');
  const observationsFile = join(opts.dshHome, 'weftmate-device-observations.json');
  let disposed = false;
  let stateTimer: NodeJS.Timeout | null = null;
  let requestTimer: NodeJS.Timeout | null = null;
  let observations: DeviceObservation[] = [];

  try {
    if (existsSync(observationsFile)) {
      const parsed = JSON.parse(readFileSync(observationsFile, 'utf8'));
      if (Array.isArray(parsed)) {
        observations = parsed
          .filter((item) => item && typeof item.content === 'string')
          .slice(0, MAX_OBSERVATIONS);
      }
    }
  } catch { observations = []; }

  const readState = async (): Promise<DeviceStateFile> => {
    try {
      const parsed = JSON.parse(await readFile(stateFile, 'utf8'));
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.devices)) {
        return parsed as DeviceStateFile;
      }
    } catch { /* 半写/坏文件走重置 */ }
    return { schemaVersion: 1, pairing: null, devices: [] };
  };

  const writeStateSnapshot = createLatestFileWriter(stateFile);
  const writeObservationSnapshot = createLatestFileWriter(observationsFile);
  const writeState = (next: DeviceStateFile): Promise<void> =>
    writeStateSnapshot(`${JSON.stringify(next, null, 2)}\n`).catch(() => {});
  const persistObservations = (): Promise<void> =>
    writeObservationSnapshot(`${JSON.stringify(observations, null, 2)}\n`).catch(() => {});
  // State rotation and pairing share one queue, avoiding lost async updates.
  let stateQueue = Promise.resolve();
  const stateWork = (work: () => Promise<void>): void => {
    stateQueue = stateQueue.then(work).catch(() => {});
  };
  /** 每 tick：token 缺/过期即轮换；设备与过期配对状态随文件出给插件。 */
  const tickState = async (): Promise<void> => {
    if (disposed) return;
    const state = await readState();
    const now = Date.now();
    if (state.pairing === null || typeof state.pairing.expiresAt !== 'number' || now >= state.pairing.expiresAt) {
      state.pairing = { token: randomBytes(16).toString('hex'), expiresAt: now + PAIRING_TTL_MS };
      await writeState(state);
    }
  };

  /** 消费插件写入的请求（消费即删，防重复）。 */
  const tickRequests = async (): Promise<void> => {
    if (disposed) return;
    let raw: any = null;
    try {
      raw = JSON.parse(await readFile(requestFile, 'utf8'));
    } catch { return; } // 半写/坏文件下轮再读
    if (!raw || typeof raw.action !== 'string') return;
    try { await rm(requestFile, { force: true }); } catch { /* 删不掉下轮再试 */ }
    if (raw.action === 'pair') {
      const name = cleanText(raw.deviceName, 80) || '未命名设备';
      const state = await readState();
      const existing = state.devices.find((device) => device.name === name);
      const device = existing ?? { id: randomBytes(8).toString('hex'), name, lastSeenAt: '' };
      device.lastSeenAt = new Date().toISOString();
      state.devices = [
        device,
        ...state.devices.filter((item) => item.name !== name),
      ].slice(0, 20);
      await writeState(state);
      return;
    }
    if (raw.action === 'observation') {
      // 手机源开关关：不收（opt-in 红线）。
      if (getMobilePerceptionEnabled() !== true) return;
      const deviceName = cleanText(raw.deviceName, 80);
      const list = Array.isArray(raw.observations) ? raw.observations : [];
      for (const item of list) {
        const content = cleanText(item?.content, OBSERVATION_MAX_CHARS);
        if (!content) continue;
        observations.unshift({
          id: randomBytes(8).toString('hex'),
          content,
          occurredAt: cleanText(item?.occurredAt, 64) || new Date().toISOString(),
          deviceName,
        });
      }
      observations = observations.slice(0, MAX_OBSERVATIONS);
      await persistObservations();
    }
  };

  stateWork(tickState);
  stateWork(tickRequests);
  stateTimer = setInterval(() => stateWork(tickState), 1_000);
  stateTimer.unref?.();
  requestTimer = setInterval(() => stateWork(tickRequests), 1_000);
  requestTimer.unref?.();

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (stateTimer) clearInterval(stateTimer);
      if (requestTimer) clearInterval(requestTimer);
      stateTimer = null;
      requestTimer = null;
    },
    readMobileObservations(): DeviceObservation[] {
      return observations.map((item) => ({ ...item }));
    },
  };
}
