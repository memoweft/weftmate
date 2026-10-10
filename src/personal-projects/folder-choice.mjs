import path from 'node:path';
import { homedir } from 'node:os';

export function folderWarning(rootPath, home = homedir(), system = process.env.SystemRoot || 'C:\\Windows') {
  const normalize = value => path.win32.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
  const target = normalize(rootPath);
  if (target === normalize(path.win32.parse(rootPath).root)) return '这是整盘根目录，会开放大量文件。建议选择一个专用文件夹，并保持只读。';
  if (target === normalize(home)) return '这是个人主文件夹，可能包含私人资料。建议选择里面的专用文件夹，并保持只读。';
  if ([system, 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData'].some(value => target === normalize(value) || target.startsWith(normalize(value) + '\\')))
    return '这是系统或程序文件夹，修改可能影响电脑运行。建议保持只读。';
  return '';
}

export const folderPathHint = rootPath => (rootPath || '').replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).slice(-2).join(' / ');
