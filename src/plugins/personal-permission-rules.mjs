import { shellWriteTargets } from './personal-write-targets.mjs';
import { approvalRequired } from './personal-approval-policy.mjs';

export const PERMISSION_TYPES = [
  { id: 'read', label: '读文件', default: 'allow' },
  { id: 'write', label: '写文件', default: 'ask', description: '默认新建文件自动允许，修改已有文件询问；选择后应用于所有写入。' },
  { id: 'delete', label: '删除', default: 'ask', restricted: true, description: '删除可能无法撤销，不能长期放行。' },
  { id: 'command', label: '运行命令', default: 'allow', description: '默认普通命令自动允许，危险操作仍按对应类别询问。' },
  { id: 'network', label: '联网', default: 'allow' },
  { id: 'external', label: '对外发送', default: 'ask', restricted: true, description: '对方可能已收到，撤回不保证，不能长期放行。' },
  { id: 'spend', label: '花钱', default: 'ask', restricted: true, description: '付款与购买不保证可退款，不能长期放行。' },
  { id: 'install', label: '安装软件', default: 'ask' },
  { id: 'system', label: '改系统设置', default: 'ask' }
];
const ids = new Set(PERMISSION_TYPES.map(row => row.id));
export const riskPermissionType = risk => ({ overwrite: 'write', execute: 'command' }[risk] ?? risk);
export function validPermissionRules(rules, { patch = false } = {}) {
  return !!rules && typeof rules === 'object' && !Array.isArray(rules) && Object.entries(rules).every(([type, value]) =>
    ids.has(type) && (patch && value === null || ['allow', 'ask', 'deny'].includes(value) &&
      !(value === 'allow' && PERMISSION_TYPES.find(row => row.id === type).restricted)));
}
export function mergePermissionRules(current = {}, patch) {
  const rules = { ...current };
  for (const [type, value] of Object.entries(patch)) { if (value === null) delete rules[type]; else rules[type] = value; }
  return rules;
}
export function permissionCategories(name, args = {}, risks = []) {
  const types = new Set(risks.map(riskPermissionType));
  if (/^(read|read_file|grep|glob|list_directory)$/.test(name)) types.add('read');
  if (/^(write|edit|write_file|apply_patch)$/.test(name)) types.add('write');
  if (/^(pwsh|powershell|bash|shell|sh|exec_command)$/.test(name) || typeof args.command === 'string') types.add('command');
  const source = [name, args.command, args.code, args.script, args.action].filter(x => typeof x === 'string').join('\n');
  if (/web_fetch|web_search|browser|\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|fetch)\b/i.test(source)) types.add('network');
  if (/\b(?:writeFile(?:Sync)?|WriteAllText|copyFile(?:Sync)?)\b/i.test(source) || typeof args.command === 'string' && shellWriteTargets(args.command, undefined, !/^(bash|sh)$/.test(name)).some(row=>row.kind!=='directory')) types.add('write');
  if (/\b(?:Get-Content|readFile(?:Sync)?|cat|head|tail)\b/i.test(source)) types.add('read');
  return [...types].filter(type => ids.has(type));
}
// Missing overrides deliberately retain D12's current modes and overwrite/new-file distinction.
export function decidePermission(policy, types, risks = []) {
  const global = policy.permissionRules ?? {}, project = policy.projectPermissionRules ?? {};
  const rules = { ...global, ...project }, legacy = approvalRequired(policy.mode, risks, policy.allowedCategories);
  const blocked = types.filter(type => rules[type] === 'deny');
  const ask = new Set(legacy.filter(risk => rules[riskPermissionType(risk)] === undefined && !(risk === 'execute' && !types.includes('command') && types.length && types.every(type=>rules[type]==='allow'))));
  for (const type of types) if (rules[type] === 'ask') ask.add(type === 'write' ? 'overwrite' : type === 'command' ? 'execute' : type);
  return { decision: blocked.length ? 'deny' : ask.size ? 'ask' : 'allow', blocked, required: [...ask], types,
    source: types.some(type => project[type] !== undefined) ? 'project' : types.some(type => global[type] !== undefined) ? 'global' : 'default' };
}
export function permissionSummary(name, args = {}) {
  return `${name} · ${args.file_path ?? args.path ?? args.command ?? args.url ?? args.description ?? args.action ?? ''}`.replace(/\s+/g, ' ').slice(0, 500);
}

export function migratePermissionRules(account) {
  let changed = false;
  for (const value of [account, ...Object.values(account.projects ?? {})]) {
    if (value && value.permissionRules !== undefined && !validPermissionRules(value.permissionRules)) {
      delete value.permissionRules; changed = true;
    }
  }
  return changed;
}

export function permissionApprovalCategories(selected) {
  return [...new Set(selected.required.flatMap(risk => risk === 'execute' && selected.types.length && !selected.types.includes('command')
    ? selected.types.map(type => type === 'write' ? 'overwrite' : type)
    : [risk]))];
}
