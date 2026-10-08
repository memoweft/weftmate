import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { APPROVAL_MODES, approvalRequired, classifyPersonalRisk, approvalCategories, approvalPrompt } from '../src/plugins/personal-approval-policy.mjs'

for (const mode of APPROVAL_MODES) test(`${mode}: ordinary tools and all six risk classes use the same approval policy`, () => {
  assert.deepEqual(approvalRequired(mode, []), mode === 'ask' ? ['execute'] : [])
  for (const risk of ['delete', 'overwrite', 'system', 'install', 'external', 'spend']) {
    const expected = mode === 'allow-all' || mode === 'accept-edits' && risk === 'overwrite' ? []
      : mode === 'ask' ? [risk, 'execute'] : [risk]
    assert.deepEqual(approvalRequired(mode, [risk]), expected)
    assert.deepEqual(approvalRequired(mode, [risk], [risk, 'execute']), [])
  }
})

test('risk recognition covers PowerShell, native file tools, code and launched scripts while ordinary moves remain automatic', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'weftmate-risk-'))
  try {
    writeFileSync(join(cwd, 'existing.txt'), 'user fixture')
    writeFileSync(join(cwd, 'delete.mjs'), "import fs from 'node:fs'; fs.unlinkSync('existing.txt')")
    for (const command of ['Remove-Item -LiteralPath existing.txt', 'rm -rf old', 'del /q old', "node -e \"require('fs').rmSync('old')\"", 'node delete.mjs'])
      assert.ok(classifyPersonalRisk('pwsh', { command }, cwd).includes('delete'), command)
    assert.deepEqual(classifyPersonalRisk('write', { file_path: 'existing.txt' }, cwd), ['overwrite'])
    assert.deepEqual(classifyPersonalRisk('write', { file_path: 'new.txt' }, cwd), [])
    assert.deepEqual(classifyPersonalRisk('edit', { file_path: 'existing.txt' }, cwd), ['overwrite'])
    assert.ok(classifyPersonalRisk('pwsh', { command: "'new' > existing.txt" }, cwd).includes('overwrite'))
    assert.ok(classifyPersonalRisk('pwsh', { command: 'Move-Item incoming.txt -Destination existing.txt -Force' }, cwd).includes('overwrite'))
    assert.ok(classifyPersonalRisk('bash', { command: 'mv incoming.txt existing.txt' }, cwd).includes('overwrite'))
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: "'new' > new.txt" }, cwd), [])
    assert.ok(classifyPersonalRisk('pwsh', { command: 'reg add HKCU\\Software\\Fixture /v Value /d 1' }, cwd).includes('system'))
    assert.ok(classifyPersonalRisk('pwsh', { command: 'winget install fixture' }, cwd).includes('install'))
    assert.ok(classifyPersonalRisk('pwsh', { command: 'git push origin main' }, cwd).includes('external'))
    assert.ok(classifyPersonalRisk('pay_invoice', {}, cwd).includes('spend'))
    assert.ok(classifyPersonalRisk('weftmod', { description: '点击发送邮件', action: 'desktop' }, cwd).includes('external'))
    assert.deepEqual(classifyPersonalRisk('pwsh', { description: '读取内容后准备删除文件', command: 'Get-Content existing.txt' }, cwd), [])
    for (const command of ['Get-ChildItem .', 'Move-Item report.txt documents/report.txt', 'Move-Item report.txt -Destination new.txt -Force', 'mkdir documents', 'Get-Content existing.txt'])
      assert.deepEqual(classifyPersonalRisk('pwsh', { command }, cwd), [], command)
    assert.deepEqual(approvalCategories('[weftmate:delete,external] operation'), ['delete', 'external'])
    assert.match(approvalPrompt('plan'), /exit_plan_mode/)
    assert.match(approvalPrompt('auto'), /verbal instructions/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('printed arrows do not request overwrite approval; actual redirections and quoted substitutions still do', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'weftmate-risk-arrow-'))
  try {
    writeFileSync(join(cwd, 'existing.txt'), 'keep')
    const command = `foreach ($u in @('https://nodejs.org/api/')) { $r = Invoke-WebRequest -Uri $u; Write-Output ("$u -> " + $r.StatusCode + " LEN:" + $r.Content.Length) }`
    assert.deepEqual(classifyPersonalRisk('pwsh', { command }, cwd), [])
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: String.raw`Write-Output (\"$u -> \" + $r.StatusCode)` }, cwd), [])
    assert.deepEqual(classifyPersonalRisk('pwsh', { command: `Write-Output 'status -> $target'` }, cwd), [])
    for (const command of [
      `Write-Output "$u -> ok" > existing.txt`,
      `Write-Output 'ok' > $target`,
      `Write-Output "$(Write-Output ok > existing.txt)"`,
      `powershell -Command "Write-Output ok > existing.txt"`,
      `powershell -NoProfile -Command "Write-Output ok > existing.txt"`,
      `Write-Output "$(Remove-Item existing.txt)"`,
    ]) assert.ok(classifyPersonalRisk('pwsh', { command }, cwd).length > 0, command)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('conversation-created files can be corrected; existing user files and unresolved writes still ask', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'weftmate-created-'))
  try {
    writeFileSync(join(cwd, 'mine.md'), 'first draft')
    writeFileSync(join(cwd, 'user.md'), 'user original')
    const context = { createdFiles: new Set([join(cwd, 'mine.md')]) }
    const risk = (name: string, args: any) => classifyPersonalRisk(name, args, cwd, new Set(), context)
    assert.deepEqual(risk('write', { file_path: 'mine.md' }), [])
    assert.deepEqual(risk('edit', { file_path: 'mine.md' }), [])
    assert.deepEqual(risk('pwsh', { command: "Set-Content mine.md 'corrected'" }), [])
    assert.deepEqual(risk('write', { file_path: 'user.md' }), ['overwrite'])
    assert.deepEqual(risk('edit', { file_path: 'user.md' }), ['overwrite'])
    assert.deepEqual(risk('pwsh', { command: "Remove-Item mine.md" }), ['delete'])
    const script = `// fsPromises.writeFile(data[, options]) documented signature, not an operation.
      /* writeFileSync(unknown, data); Remove-Item user.md */
      import { writeFileSync } from 'node:fs';
      import path from 'node:path'; import { fileURLToPath } from 'node:url';
      const here = path.dirname(fileURLToPath(import.meta.url));
      const outPath = path.join(here, 'result.json');
      writeFileSync(outPath, '{}');`
    writeFileSync(join(cwd, 'sum.mjs'), script)
    assert.deepEqual(risk('pwsh', { command: 'node sum.mjs' }), [])
    writeFileSync(join(cwd, 'result.json'), 'user result')
    assert.deepEqual(risk('pwsh', { command: 'node sum.mjs' }), ['overwrite'])
    context.createdFiles.add(join(cwd, 'result.json'))
    assert.deepEqual(risk('pwsh', { command: 'node sum.mjs' }), [])
    writeFileSync(join(cwd, 'sum.mjs'), script.replace("path.join(here, 'result.json')", "path.resolve(process.argv[3] ?? path.join(here, 'result.json'))"))
    assert.deepEqual(risk('pwsh', { command: 'node sum.mjs' }), [])
    assert.deepEqual(risk('pwsh', { command: 'node sum.mjs input.csv user.md' }), ['overwrite'])
    assert.deepEqual(risk('pwsh', { command: 'node sum.mjs input.csv $unknown' }), ['overwrite'])
    assert.deepEqual(risk('pwsh', { command: 'node -e "writeFileSync(process.argv[2], data)"' }), ['overwrite'])
    assert.deepEqual(classifyPersonalRisk('write', { file_path: 'mine.md' }, cwd), ['overwrite'], 'another conversation cannot inherit creation')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
