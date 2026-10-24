import { readFileSync } from 'node:fs';
import { win32 as windowsPath } from 'node:path';
import { spawnSync } from 'node:child_process';

export function installationScope({ executable = process.execPath, platform = process.platform, read = readFileSync, run = spawnSync } = {}) {
  if (platform !== 'win32') return 'CurrentUser';
  try {
    const metadata = JSON.parse(read(windowsPath.join(windowsPath.dirname(executable), 'resources/weftmate-install.json'), 'utf8'));
    if (['all', 'CurrentUser'].includes(metadata.scope)) return metadata.scope;
  } catch {}
  // Existing releases predate install metadata. Match the exact registered folder.
  try {
    const result = run('reg.exe', ['query', 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s', '/v', 'UninstallString', '/reg:64'], { encoding: 'utf8', windowsHide: true });
    const folder = windowsPath.dirname(executable).replace(/[\\/]+$/, '').toLowerCase();
    if (result.status === 0 && result.stdout.split(/\r?\n/).some(line => {
      const uninstaller = /REG_SZ\s+"([^"]+)"/.exec(line)?.[1];
      return uninstaller && windowsPath.dirname(uninstaller).toLowerCase() === folder;
    })) return 'all';
  } catch {}
  return 'CurrentUser';
}
export const manualUpdateMessage = '新版已下载。这次请右键安装包，选择“以管理员身份运行”，迁移为仅当前用户安装；对话、记忆和设置会保留，以后更新无需管理员授权。';
