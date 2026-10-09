import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { staticWriteTarget, shellWriteTargets, withoutJavaScriptComments } from './personal-write-targets.mjs';

export const APPROVAL_MODES = ['auto', 'ask', 'accept-edits', 'plan', 'allow-all'];
export const RISK_CATEGORIES = ['delete', 'overwrite', 'system', 'install', 'external', 'spend', 'execute'];
export const RISK_LABELS = { delete: '删除文件，可能无法撤销', overwrite: '修改或覆盖已有文件，恢复需要原内容或备份',
  system: '修改系统设置，可能影响其他程序，恢复需要原配置', install: '安装或卸载软件，撤销需卸载或重装',
  external: '对外发送或发布内容，对方可能已接收，撤回不保证',
  spend: '付款或购买，退款不保证', execute: '执行工具操作，影响与可撤销性见操作详情' };

// A printed arrow is data, not shell redirection. Expandable $(...) bodies
// remain executable, including when they occur inside a double-quoted string.
function quotedPowerShellText(source, offset) {
  // An explicitly launched inner shell parses its quoted command again. Keep
  // the existing conservative scan for that form rather than hiding its writes.
  if (/\b(?:pwsh|powershell|bash|sh)\b[^\n]*\s(?:-Command|-c)\s/i.test(source)) return false;
  let quote = null;
  const expansions = [];
  for (let i = 0; i < offset; i++) {
    const char = source[i], next = source[i + 1];
    if (char === '`' && quote !== "'") { i++; continue; }
    if (quote) {
      if (char === quote) {
        if (next === quote) i++; else quote = null;
      } else if (quote === '"' && char === '$' && next === '(') {
        expansions.push({ quote, depth: 1 }); quote = null; i++;
      }
    } else if (char === "'" || char === '"') quote = char;
    else if (expansions.length) {
      const expansion = expansions.at(-1);
      if (char === '(') expansion.depth++;
      if (char === ')' && --expansion.depth === 0) { quote = expansion.quote; expansions.pop(); }
    }
  }
  return quote !== null;
}

// One policy for all personal tools, including nested code-mode calls. Ordinary moves
// and reads are allowed; force-replacing a destination is an overwrite.
export function classifyPersonalRisk(name, args = {}, cwd = process.cwd(), inspected = new Set(), context = {}) {
  const source = [name, args.command, args.code, args.script, args.action].filter(x => typeof x === 'string').join('\n');
  const categories = new Set();
  const fileKey = file => process.platform === 'win32' ? resolve(file).toLowerCase() : resolve(file);
  const createdFiles = new Set([...(context.createdFiles ?? [])].map(fileKey));
  const overwrites = target => !target || existsSync(resolve(cwd, target)) &&
    !createdFiles.has(fileKey(resolve(cwd, target)));
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
  if (name === 'edit' && overwrites(args.file_path)) categories.add('overwrite');
  if (name === 'write' && typeof args.file_path === 'string' && overwrites(args.file_path)) categories.add('overwrite');
  if (/\btruncate(?:Sync)?\b(?!\s*\()/i.test(source)) categories.add('overwrite');
  for (const match of source.matchAll(/\b(?:writeFile(?:Sync)?|truncate(?:Sync)?|(?:File\]?::)?WriteAll(?:Text|Bytes|Lines))\s*\(\s*(?:'([^']+)'|"([^"]+)"|([^,\n]+))/gi)) {
    if (/WriteAll/i.test(match[0]) && /(?:IO\.|IO\.File\]::|IO\.File::)$/i.test(source.slice(0, match.index))) continue;
    const target = match[1] ?? match[2];
    if (overwrites(target ?? staticWriteTarget(match[3], source, cwd, context.scriptPath, context.scriptArgs))) categories.add('overwrite');
  }
  for (const match of source.matchAll(/\bcopyFile(?:Sync)?\s*\(\s*[^,]+,\s*(?:'([^']+)'|"([^"]+)"|([^,\n]+))/gi)) {
    const target = match[1] ?? match[2];
    if (overwrites(target ?? staticWriteTarget(match[3], source, cwd, context.scriptPath, context.scriptArgs))) categories.add('overwrite');
  }
  for (const match of source.matchAll(/\bopen\s*\(\s*(?:'([^']+)'|"([^"]+)"),\s*['"]w[bt]?['"]/gi))
    if (overwrites(match[1] ?? match[2])) categories.add('overwrite');
  const powershell = !/^(?:bash|sh)$/.test(name) && !/\.sh$/i.test(context.scriptPath ?? '');
  const isShell = typeof args.command === 'string' || /^(?:pwsh|powershell|psh|bash|sh|shell)$/.test(name) ||
    /\.(?:ps1|sh)$/i.test(context.scriptPath ?? '') || !context.scriptPath && typeof args.script === 'string';
  const shellSource = isShell ? [args.command, args.code, args.script, args.action].filter(x => typeof x === 'string').join('\n') : '';
  for (const write of shellWriteTargets(shellSource, cwd, powershell)) {
    let target = write.target;
    if (write.kind === 'directory' && target) {
      try { if (statSync(target).isDirectory()) continue; } catch { /* New directory. */ }
    }
    if (write.kind === 'move' && target) {
      try { if (statSync(target).isDirectory()) target = write.from ? resolve(target, basename(write.from)) : undefined; }
      catch { /* New destination. */ }
    }
    if (overwrites(target)) categories.add('overwrite');
  }
  // Executable substitutions and explicitly launched inner shells may contain
  // writes hidden inside string tokens. They cannot inherit outer bindings.
  for (const match of source.matchAll(/(?:\b(?:Set-Content|Add-Content|Out-File)\s+(?:(?:-LiteralPath|-FilePath|-Path)\s+)?|(?<![>])>>?\s*)(?:'([^']+)'|"([^"]+)"|([^\s;|(){}'"]+))/gi)) {
    if (!quotedPowerShellText(source, match.index) && (/\b(?:pwsh|powershell|bash|sh)\b[^\n]*\s(?:-Command|-c)\s/i.test(source))) {
      const target = match[1] ?? match[2] ?? match[3];
      if (target.includes('$') || overwrites(target)) categories.add('overwrite');
    }
  }
  // Inspect scripts launched from disk as well as inline commands. The source is evidence,
  // never executed by this classifier. Missing scripts remain the tool's ordinary error.
  for (const match of source.matchAll(/(?:\b(?:node|python|python3|pwsh|powershell|bash)\s+(?:-File\s+)?)(?:'([^']+)'|"([^"]+)"|([^\s;|]+\.(?:mjs|cjs|js|py|ps1|sh)))/gi)) {
    const file = resolve(cwd, match[1] ?? match[2] ?? match[3]);
    if (inspected.has(file)) continue;
    inspected.add(file);
    const tail = source.slice(match.index + match[0].length).split(/[;\n|]/)[0].trim();
    // Only literal launch arguments are evidence. Shell variables remain unknown.
    const scriptArgs = /[$`<>]/.test(tail) ? undefined : [...tail.matchAll(/'([^']*)'|"([^"]*)"|([^\s]+)/g)].map(arg => arg[1] ?? arg[2] ?? arg[3]);
    try {
      const text = readFileSync(file, 'utf8');
      const code = /\.[cm]?js$/i.test(file) ? withoutJavaScriptComments(text) : text;
      for (const risk of classifyPersonalRisk('script-source', { code }, cwd, inspected, { ...context, scriptPath: file, scriptArgs })) categories.add(risk);
    }
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
  return `WeftMate approval mode: ${mode}. Respect the user's verbal instructions. Invoke risky tools for native approval; never retry a rejected action through another route. ${mode === 'plan' ? 'In native plan mode, present a Markdown plan starting with a # heading using exit_plan_mode before execution. After confirmation execute under automatic risk approval.' : ''}`;
}
