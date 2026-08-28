import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { basename, dirname, parse, resolve } from 'node:path';

const MARKER_PREFIX = 'weftmate-wipe-';
const MAX_MARKER_AGE_MS = 10 * 60_000;

interface WipeMarker {
  version: 1;
  token: string;
  target: string;
  createdAt: string;
}

export function localDataWipeLaunchRequest(argv: readonly string[]): { markerPath: string; token: string } | null {
  const markerArg = argv.find((arg) => arg.startsWith('--weftmate-wipe-marker='));
  const tokenArg = argv.find((arg) => arg.startsWith('--weftmate-wipe-token='));
  if (!markerArg && !tokenArg) return null;
  const markerPath = markerArg?.slice('--weftmate-wipe-marker='.length) ?? '';
  const token = tokenArg?.slice('--weftmate-wipe-token='.length) ?? '';
  if (!markerPath || !token) throw new Error('本机数据擦除启动参数不完整');
  return { markerPath, token };
}

function comparablePath(value: string, platform = process.platform): string {
  const normalized = resolve(value);
  return platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

export function isSafeWipeTarget(target: string, expectedUserData: string, platform = process.platform): boolean {
  const resolvedTarget = resolve(target);
  const resolvedExpected = resolve(expectedUserData);
  if (comparablePath(resolvedTarget, platform) !== comparablePath(resolvedExpected, platform)) return false;
  return comparablePath(resolvedTarget, platform) !== comparablePath(parse(resolvedTarget).root, platform);
}

export function createLocalDataWipeMarker(input: {
  tempDir: string;
  userData: string;
  now?: Date;
}): { markerPath: string; token: string } {
  const tempDir = resolve(input.tempDir);
  const userData = resolve(input.userData);
  if (!isSafeWipeTarget(userData, userData)) throw new Error('拒绝为根目录创建擦除标记');
  mkdirSync(tempDir, { recursive: true });
  const token = randomBytes(32).toString('hex');
  const markerPath = resolve(tempDir, `${MARKER_PREFIX}${randomUUID()}.json`);
  const marker: WipeMarker = {
    version: 1,
    token,
    target: userData,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
  writeFileSync(markerPath, `${JSON.stringify(marker)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return { markerPath, token };
}

function safeTokenEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function consumeLocalDataWipeMarker(input: {
  markerPath: string;
  token: string;
  userData: string;
  tempDir: string;
  now?: Date;
}): string {
  const markerPath = resolve(input.markerPath);
  const tempDir = resolve(input.tempDir);
  if (dirname(markerPath) !== tempDir || !basename(markerPath).startsWith(MARKER_PREFIX)) {
    throw new Error('擦除标记不在系统临时目录');
  }
  const stat = lstatSync(markerPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('擦除标记不是普通文件');
  const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as Partial<WipeMarker>;
  if (marker.version !== 1 || typeof marker.token !== 'string' || typeof marker.target !== 'string' || typeof marker.createdAt !== 'string') {
    throw new Error('擦除标记格式无效');
  }
  if (!safeTokenEqual(marker.token, input.token)) throw new Error('擦除标记 token 不匹配');
  if (!isSafeWipeTarget(marker.target, input.userData)) throw new Error('擦除目标不是当前 WeftMate userData');
  const age = (input.now ?? new Date()).getTime() - Date.parse(marker.createdAt);
  if (!Number.isFinite(age) || age < -60_000 || age > MAX_MARKER_AGE_MS) throw new Error('擦除标记已过期');
  // 先销毁一次性授权，再碰 userData；擦除失败也不能复用旧 token 重放。
  unlinkSync(markerPath);
  return resolve(marker.target);
}

export function wipeLocalDataFromMarker(input: {
  markerPath: string;
  token: string;
  userData: string;
  tempDir: string;
  now?: Date;
}): void {
  const target = consumeLocalDataWipeMarker(input);
  rmSync(target, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
  if (existsSync(target)) throw new Error('WeftMate 本机数据未能完整删除');
}
