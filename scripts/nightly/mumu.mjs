import { execFileSync } from 'node:child_process';

export const mumuManager = process.env.WEFTMATE_MUMU_MANAGER || 'MuMuManager.exe';
export const adbExecutable = process.env.WEFTMATE_ADB || 'adb';
export class AndroidEnvironmentError extends Error {
  constructor(reason) { super(`环境问题：未拍（${reason}）`); this.name = 'AndroidEnvironmentError'; }
}

export function parseMuMuInfo(output) {
  let info;
  try { info = JSON.parse(String(output).replace(/^\uFEFF/, '').trim()); }
  catch { throw new AndroidEnvironmentError('MuMu 管理工具没有返回有效 JSON'); }
  if (info.error_code || !info.is_android_started || !info.is_process_started)
    throw new AndroidEnvironmentError('MuMu 模拟器未开启或 Android 尚未就绪');
  const port = Number(info.adb_port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new AndroidEnvironmentError('MuMu 管理工具没有返回有效 adb_port');
  return { serial: `127.0.0.1:${port}`, androidVersion: String(info.android_version || 'unknown') };
}

// One authoritative lookup. Never fall back to a remembered port or scan ports.
export function readMuMuInfo(execute = execFileSync) {
  let output;
  try { output = execute(mumuManager, ['info', '-v', '0'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }); }
  catch { throw new AndroidEnvironmentError('无法读取 MuMuManager info -v 0'); }
  return parseMuMuInfo(output);
}

export async function connectMuMu(run) {
  let info;
  try { info = parseMuMuInfo((await run(mumuManager, ['info', '-v', '0'], { name: 'mumu-info', limit: 10000 })).output); }
  catch (error) { if (error instanceof AndroidEnvironmentError) throw error; throw new AndroidEnvironmentError('无法读取 MuMuManager info -v 0'); }
  try {
    const result = await run(adbExecutable, ['connect', info.serial], { name: 'adb-connect', limit: 10000 });
    if (!/connected to|already connected to/.test(result.output)) throw Error('not connected');
  } catch { await run(adbExecutable, ['disconnect', info.serial], { name: 'adb-disconnect', allowFailure: true, limit: 5000 }).catch(() => {}); throw new AndroidEnvironmentError('管理工具给出的安卓调试地址无法连接'); }
  return info;
}

export function verifyAndroidSerial(expected, actual) {
  if (!/^127\.0\.0\.1:\d+$/.test(expected || '') || String(actual).trim() !== expected)
    throw new AndroidEnvironmentError('本轮安卓序列号与操作设备不一致');
}

// Confirm the existing connection, without another manager lookup or port probe.
export async function assertAndroidDevice(serial, run) {
  try {
    const result = await run(adbExecutable, ['-s', serial, 'get-serialno'], { name: 'android-device-identity', limit: 10000 });
    verifyAndroidSerial(serial, result.output);
  } catch (error) {
    if (error instanceof AndroidEnvironmentError) throw error;
    throw new AndroidEnvironmentError('本轮安卓设备连接已变化或不可核实');
  }
}
