import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

test('ESM and CommonJS writers share an external evidence root across child processes and working directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'weftmate-evidence-root-'));
  try {
    for (const kind of ['mjs', 'cjs']) {
      const helper = resolve(`tests/helpers/evidence-path.${kind}`);
      const load = kind === 'mjs' ? `import {evidencePath} from ${JSON.stringify(pathToFileURL(helper).href)};` : `const {evidencePath}=require(${JSON.stringify(helper)});`;
      const code = `${load} const fs=${kind==='mjs'?"await import('node:fs')":"require('node:fs')"}; const path=evidencePath('synthetic/report-${kind}.json'); fs.mkdirSync(${kind==='mjs'?"(await import('node:path')).dirname(path)":"require('node:path').dirname(path)"},{recursive:true}); fs.writeFileSync(path,'synthetic evidence'); console.log(path);`;
      const child = spawnSync(process.execPath, [kind === 'mjs' ? '--input-type=module' : '--input-type=commonjs', '-e', code], {cwd:tmpdir(), env:{...process.env, WEFTMATE_EVIDENCE_DIR:root}, encoding:'utf8', windowsHide:true});
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stdout.trim(), join(root, `synthetic/report-${kind}.json`));
      assert.equal(readFileSync(child.stdout.trim(), 'utf8'), 'synthetic evidence');
    }
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {evidencePath} from ${JSON.stringify(pathToFileURL(resolve('tests/helpers/evidence-path.mjs')).href)}; console.log(evidencePath('synthetic'));`], {cwd:tmpdir(), env:{...process.env, WEFTMATE_EVIDENCE_DIR:''}, encoding:'utf8', windowsHide:true});
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), resolve('.local/evidence/synthetic'));
  } finally { rmSync(root, {recursive:true, force:true}); }
});
