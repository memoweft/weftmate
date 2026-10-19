import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { presentPersonalPrompt } from '../src/plugins/personal-prompt.mjs';

function selectedCommand(description: string, target: string) {
  // Select the switch from the affirmative instruction actually delivered to the model.
  // Removing or reversing it must reproduce the original interactive command.
  const confirmation = description.match(/when a cmdlet otherwise prompts, use (-Confirm:\$false)\./)?.[1] || '-Confirm';
  return `Remove-Item -LiteralPath '${target.replaceAll("'", "''")}' ${confirmation}`;
}

test('approved PowerShell deletion finishes without a terminal confirmation', { skip: process.platform !== 'win32', timeout: 15000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'w7-delete-confirm-'));
  const target = join(root, 'approved.txt'), keep = join(root, 'keep.txt');
  assert.ok(relative(tmpdir(), root) && !relative(tmpdir(), root).startsWith('..') && !isAbsolute(relative(tmpdir(), root)));
  try {
    writeFileSync(target, 'synthetic approved deletion'); writeFileSync(keep, 'preserve');
    const parameters = { command: { type: 'string', required: true } };
    const projected = presentPersonalPrompt({ sections: [], tools: [{ name: 'pwsh', description: 'native shell', parameters }] }, new Set(['pwsh']));
    const tool = projected.tools.find((row: any) => row.name === 'pwsh');
    assert.deepEqual(tool.parameters, parameters, 'approval/execution schemas are preserved');
    // Model fixture uses the delivered tool contract; with the old description
    // it repeats the observed -Confirm invocation even after UI approval.
    const command = selectedCommand(tool.description, target);
    let failed = false;
    try { execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 10000, stdio: 'pipe' }); }
    catch { failed = true; }
    assert.equal(existsSync(target), false, 'the already approved file must actually be deleted in a non-interactive terminal');
    assert.equal(failed, false);
    assert.equal(existsSync(keep), true);
  } finally {
    for (const path of [target, keep]) if (existsSync(path)) unlinkSync(path);
    rmdirSync(root);
  }
});

test('removing or reversing the delivered Confirm instruction stops the deletion fixture from succeeding', { skip: process.platform !== 'win32', timeout: 15000 }, () => {
  const projected = presentPersonalPrompt({ sections: [], tools: [{ name: 'pwsh', description: 'native shell' }] }, new Set(['pwsh']));
  const description = projected.tools.find((row: any) => row.name === 'pwsh').description;
  const instruction = 'when a cmdlet otherwise prompts, use -Confirm:$false.';
  const root = mkdtempSync(join(tmpdir(), 'w7-confirm-mutation-')), target = join(root, 'synthetic.txt');
  try {
    for (const mutated of [description.replace(instruction, ''), description.replace('-Confirm:$false', '-Confirm:$true'),
      description.replace(instruction, 'when a cmdlet otherwise prompts, do not use -Confirm:$false.')]) {
      writeFileSync(target, 'synthetic');
      assert.throws(() => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', selectedCommand(mutated, target)],
        { windowsHide: true, timeout: 3000, stdio: 'pipe' }), 'without the actual instruction, selection must reproduce the terminal confirmation failure');
      assert.equal(existsSync(target), true, 'a weakened or reversed tool contract must not fabricate a successful deletion');
    }
  } finally { if (existsSync(target)) unlinkSync(target); rmdirSync(root); }
});
