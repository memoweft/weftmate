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
