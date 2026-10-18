import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { presentPersonalPrompt } from '../src/plugins/personal-prompt.mjs';

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
    const nonInteractive = tool.description.includes('non-interactive') && tool.description.includes('native approval');
    const command = `Remove-Item -LiteralPath '${target.replaceAll("'", "''")}' ${nonInteractive ? '-Confirm:$false' : '-Confirm'}`;
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
