import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export const APPROVAL_MODES = ['auto', 'ask', 'accept-edits', 'plan', 'allow-all'];
export const RISK_CATEGORIES = ['delete', 'overwrite', 'system', 'install', 'external', 'spend', 'execute'];
export const RISK_LABELS = { delete: '删除文件，可能无法撤销', overwrite: '修改或覆盖已有文件，恢复需要原内容或备份',
  system: '修改系统设置，可能影响其他程序，恢复需要原配置', install: '安装或卸载软件，撤销需卸载或重装',
  external: '对外发送或发布内容，对方可能已接收，撤回不保证',
  spend: '付款或购买，退款不保证', execute: '执行工具操作，影响与可撤销性见操作详情' };

// One policy for all personal tools, including nested code-mode calls. Ordinary moves
// and reads are allowed; force-replacing a destination is an overwrite.
export function classifyPersonalRisk(name, args = {}, cwd = process.cwd(), inspected = new Set()) {
  const source = [name, args.command, args.code, args.script, args.action].filter(x => typeof x === 'string').join('\n');
  const categories = new Set();
  // Device/UI tools expose intent in their description even when the primitive
  // is a click or keypress. File content and fetched pages are not intent fields.
  const description = !args.command && !args.code && !args.script && typeof args.description === 'string' ? args.description : '';
  if (/删除.*(?:文件|目录|文件夹)|(?:delete|remove).*(?:file|folder|directory)/i.test(description)) categories.add('delete');
  if (/覆盖.*文件|overwrite.*file/i.test(description)) categories.add('overwrite');
  if (/修改.*系统|更改.*系统|change.*system.*setting/i.test(description)) categories.add('system');
  if (/安装.*(?:软件|程序)|install.*(?:software|application|package)/i.test(description)) categories.add('install');
  if (/发送(?:邮件|消息)|发布|上传|send.*(?:email|message)|publish|upload/i.test(description)) categories.add('external');
  if (/付款|支付|购买|purchase|payment|pay invoice/i.test(description)) categories.add('spend');
  if (/\b(?:Remove-Item|Clear-RecycleBin|rm|rmdir|del|erase|unlink(?:Sync)?|rmtree|remove_all|DeleteFile|delete_file)\b|\.(?:rm|rmSync|remove|removeSync)\s*\(|\[?(?:System\.IO\.)?(?:File|Directory)\]?::Delete\s*\(/i.test(source)) categories.add('delete');
  if (/\b(?:Set-ItemProperty|New-ItemProperty|Remove-ItemProperty|Set-Service|Stop-Service|Set-ExecutionPolicy|shutdown|Restart-Computer|chmod|chown)\b|\b(?:sc(?:\.exe)?\s+(?:config|create|delete|start|stop)|reg(?:\.exe)?\s+(?:add|delete)|netsh\b[^\n]*\b(?:set|add|delete|reset)|systemctl\s+(?:enable|disable|start|stop|restart))\b/i.test(source)) categories.add('system');
  if (/\b(?:msiexec|Install-Package|Install-Module)\b|\b(?:winget|choco|scoop|npm|pnpm|pip|pip3|apt|brew|yum)\s+(?:install|add|remove|uninstall|upgrade|update)\b/i.test(source)) categories.add('install');
  if (/\b(?:Send-MailMessage|send_email|send_message|publish|upload)\b|\bgit\s+push\b|\b(?:curl|Invoke-RestMethod|Invoke-WebRequest)\b[^\n]*(?:-X\s*(?:POST|PUT|PATCH|DELETE)|-Method\s+(?:Post|Put|Patch|Delete)|--data|-Body)|\bfetch\s*\([^\n]*method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/i.test(source)) categories.add('external');
  if (/\b(?:purchase|create_checkout|checkout_session|pay_invoice|send_payment|transfer_money|charge_card)\b/i.test(source)) categories.add('spend');
  if (name === 'edit') categories.add('overwrite');
  if (name === 'write' && typeof args.file_path === 'string' && existsSync(resolve(cwd, args.file_path))) categories.add('overwrite');
  if (/\btruncate(?:Sync)?\b/i.test(source)) categories.add('overwrite');
  for (const match of source.matchAll(/\b(?:writeFile(?:Sync)?|(?:File\]?::)?WriteAll(?:Text|Bytes|Lines))\s*\(\s*(?:'([^']+)'|"([^"]+)"|([^,\n]+))/gi)) {
    const target = match[1] ?? match[2];
    if (!target || existsSync(resolve(cwd, target))) categories.add('overwrite');
  }
  for (const match of source.matchAll(/\bcopyFile(?:Sync)?\s*\(\s*[^,]+,\s*(?:'([^']+)'|"([^"]+)"|([^,\n]+))/gi)) {
    const target = match[1] ?? match[2];
    if (!target || existsSync(resolve(cwd, target))) categories.add('overwrite');
  }
  for (const match of source.matchAll(/\bopen\s*\(\s*(?:'([^']+)'|"([^"]+)"),\s*['"]w[bt]?['"]/gi))
    if (existsSync(resolve(cwd, match[1] ?? match[2]))) categories.add('overwrite');
  // Common literal move/copy commands: creating a new destination is ordinary work.
  // A force flag alone is not a risk when the target does not already exist.
  const word = "(?:'([^']+)'|\"([^\"]+)\"|([^\\s;|]+))";
  const moves = new RegExp(`\\b(?:Move-Item|Copy-Item|mv|cp)\\s+(?:(?:-LiteralPath|-Path)\\s+)?${word}\\s+(?:-Destination\\s+)?${word}`, 'gi');
  for (const match of source.matchAll(moves)) {
    const from = match[1] ?? match[2] ?? match[3], to = match[4] ?? match[5] ?? match[6];
    if (from.startsWith('-') || to.startsWith('-')) continue;
    let target = resolve(cwd, to);
    try { if (statSync(target).isDirectory()) target = resolve(target, basename(from)); } catch { /* New destination. */ }
    if (existsSync(target)) categories.add('overwrite');
  }
  // Literal output targets can be checked locally. Dynamic write targets need a decision.
  for (const match of source.matchAll(/(?:\b(?:Set-Content|Out-File)\s+(?:(?:-LiteralPath|-FilePath|-Path)\s+)?|(?<![>])>(?!>)\s*)(?:'([^']+)'|"([^"]+)"|([^\s;|]+))/gi)) {
    const target = match[1] ?? match[2] ?? match[3];
    if (target.includes('$') || existsSync(resolve(cwd, target))) categories.add('overwrite');
  }
  // Inspect scripts launched from disk as well as inline commands. The source is evidence,
  // never executed by this classifier. Missing scripts remain the tool's ordinary error.
  for (const match of source.matchAll(/(?:\b(?:node|python|python3|pwsh|powershell|bash)\s+(?:-File\s+)?)(?:'([^']+)'|"([^"]+)"|([^\s;|]+\.(?:mjs|cjs|js|py|ps1|sh)))/gi)) {
    const file = resolve(cwd, match[1] ?? match[2] ?? match[3]);
    if (inspected.has(file)) continue;
    inspected.add(file);
    try { for (const risk of classifyPersonalRisk('script-source', { code: readFileSync(file, 'utf8') }, cwd, inspected)) categories.add(risk); }
    catch { /* The producer reports unreadable scripts. */ }
  }
  return [...categories];
}

export function approvalCategories(reason) {
  const prefix = /^\[weftmate:([a-z,\-]+)\]/.exec(reason ?? '');
  return prefix ? prefix[1].split(',').filter(x => RISK_CATEGORIES.includes(x)) : [];
}

export function approvalRequired(mode, risks, allowed = []) {
  if (mode === 'allow-all') return [];
  const effective = mode === 'ask' ? [...new Set([...risks, 'execute'])] : risks;
  return effective.filter(risk => !allowed.includes(risk) && !(mode === 'accept-edits' && risk === 'overwrite'));
}

export function approvalPrompt(mode) {
  return `WeftMate approval mode: ${mode}. Respect the user's verbal instructions for this task (for example work independently, or ask before a particular step). Use ask_user_question for any requested checkpoint. Never retry a rejected action through another tool or command. ${mode === 'plan' ? 'When native plan mode is active, present a Markdown plan starting with a # heading using exit_plan_mode before executing tools. After confirmation execute under automatic risk approval.' : ''}`;
}
