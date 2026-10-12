import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
export const quoteWindowsLoginArgs = args => args.map(arg => /\s/.test(arg) ? `"${arg}"` : arg);
export function rebaseLoginCommand(command, executable, { exists = existsSync, force = false } = {}) {
  const match = /^(?:"([^"]+\.exe)"|(.+?\.exe))(?=\s|$)(.*)$/i.exec(command || '');
  if (!match) return null;
  const previous = match[1] || match[2];
  if (previous.toLowerCase() === executable.toLowerCase() || (!force && exists(previous))) return null;
  return `"${executable}"${match[3]}`;
}
export function repairWindowsLoginItem({ name, executable, force = false, platform = process.platform, run = spawnSync, exists = existsSync }) {
  if (platform !== 'win32') return false;
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  try {
    const result = run('reg.exe', ['query', key, '/v', name], { windowsHide: true, encoding: 'utf8' });
    if (result.status !== 0) return false;
    const command = result.stdout.split(/\r?\n/).map(line => /^\s*.+?\s+REG_SZ\s+(.*)$/.exec(line)?.[1]).find(Boolean);
    const repaired = rebaseLoginCommand(command, executable, { force, exists });
    return !!repaired && run('reg.exe', ['add', key, '/v', name, '/t', 'REG_SZ', '/d', repaired, '/f'], { windowsHide: true, encoding: 'utf8' }).status === 0;
  } catch { return false; } // A registry problem must never block ordinary use.
}
export function loginItemEnabled(value, name, path, platform = process.platform) {
  if (platform === 'win32' && Array.isArray(value.launchItems))
    return value.launchItems.some(item => item.name === name && item.scope === 'user' && item.enabled &&
      item.path.replace(/^"|"$/g, '').toLowerCase() === path.toLowerCase());
  return value.openAtLogin === true;
}
