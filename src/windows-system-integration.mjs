import { spawnSync } from 'node:child_process';
import { win32 } from 'node:path';
import { approvalCategories, RISK_CATEGORIES } from './plugins/personal-approval-policy.mjs';

export const SEND_TO_FLAG = '--send-to-weftmate';
export function parseWindowsSendTo(argv) {
  const index = argv.indexOf(SEND_TO_FLAG);
  if (index < 0) return [];
  return [...new Set(argv.slice(index + 1).filter(path => typeof path === 'string' && win32.isAbsolute(path) && !path.includes('\0')))];
}
export function forwardWindowsSendTo(argv, desktop, pending) {
  const paths = parseWindowsSendTo(argv);
  if (paths.length && desktop) desktop.sendTo(paths);
  else pending.push(...paths);
}
export function sendToRegistryKeys(appId) {
  return ['*', 'Directory'].map(type => `HKCU\\Software\\Classes\\${type}\\shell\\${appId}.SendTo`);
}
export function windowsSendToCommand(executable, args = []) {
  return [...[executable, ...args].map(value => `"${value.replaceAll('"', '')}"`), SEND_TO_FLAG, '"%1"'].join(' ');
}
export function createWindowsSendTo({ appId, executable, args = [], platform = process.platform, run = spawnSync }) {
  const preference = `HKCU\\Software\\WeftMate\\SystemIntegration\\${appId}`;
  const keys = sendToRegistryKeys(appId);
  const reg = argv => run('reg.exe', argv, { windowsHide: true, encoding: 'utf8' });
  const required = argv => { const result = reg(argv); if (result.status !== 0) throw new Error('SEND_TO_REGISTRATION_FAILED'); };
  const enabled = () => platform === 'win32' && keys.every(key => reg(['query', key + '\\command', '/ve']).status === 0);
  function setEnabled(value) {
    if (platform !== 'win32') throw new Error('UNAVAILABLE');
    required(['add', preference, '/v', 'SendToEnabled', '/t', 'REG_DWORD', '/d', value ? '1' : '0', '/f']);
    for (const key of keys) {
      if (!value) { if (reg(['query', key]).status === 0) required(['delete', key, '/f']); continue; }
      required(['add', key, '/ve', '/d', '发送到 WeftMate', '/f']);
      required(['add', key, '/v', 'Icon', '/d', `"${executable}",0`, '/f']);
      required(['add', key, '/v', 'MultiSelectModel', '/d', 'Player', '/f']);
      required(['add', key + '\\command', '/ve', '/d', windowsSendToCommand(executable, args), '/f']);
    }
    return enabled();
  }
  return { enabled, setEnabled };
}

// Only execution-only approvals can be answered without seeing their details.
// Risk classification itself remains the existing host policy's responsibility.
export function windowsApprovalNotification(approval) {
  const risks = approval.riskCategories ?? approvalCategories(approval.reason);
  const direct = risks.length > 0 && risks.every(risk => risk === 'execute') && approval.status === 'pending';
  const category = risks.find(risk => RISK_CATEGORIES.includes(risk) && risk !== 'execute');
  const body = ({ delete: '想要删除文件', overwrite: '想要修改已有文件', system: '想要修改系统设置', install: '想要安装或卸载软件',
    external: '想要对外发送内容', spend: '想要付款或购买' })[category] || '想要运行一条命令';
  return { title: '需要你批准', body, actions: (direct ? ['允许', '拒绝'] : ['查看']).map(text => ({ type: 'button', text })), direct };
}
export async function actOnWindowsApproval({ index, original, read, decide, open }) {
  const presentation = windowsApprovalNotification(original);
  if (!presentation.direct) { if (index === 0) open(); return { viewed: true }; }
  if (![0, 1].includes(index)) return null;
  const fresh = await read();
  const fields = ['approvalId', 'sessionId', 'taskId', 'sourceCommandId', 'sourceReceiptId', 'createdAt', 'turn', 'callId', 'rootCallId', 'toolName', 'runtimeId', 'argumentsHash', 'messageHash'];
  if (!fresh || fresh.status !== 'pending' || !windowsApprovalNotification(fresh).direct || fields.some(key => original[key] !== fresh[key])) {
    return { title: '审批已变化', body: '请打开对话查看最新状态' };
  }
  const outcome = index === 0 ? 'allowed-once' : 'rejected';
  await decide(outcome);
  return { title: index === 0 ? '已允许' : '已拒绝', body: index === 0 ? '这次操作可以继续' : '这次操作不会执行' };
}
