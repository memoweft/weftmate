import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { managedMkdtempSync, managedTempRoot, disposeManagedTemp } from './helpers/managed-temp.mjs';

const helper = pathToFileURL(resolve('tests/helpers/managed-temp.mjs')).href;
const runner = pathToFileURL(resolve('tests/helpers/managed-test-process.mjs')).href;
function environment(root: string) {
  const env = { ...process.env, WEFTMATE_MANAGED_TEMP_ROOT: root };
  delete env.WEFTMATE_TEST_TEMP_SCOPE;
  return env;
}

test('managed temporary fixtures share one anonymous parent and cannot delete unowned paths', () => {
  const roots = [managedMkdtempSync('C:/old-root/rev-fixture-'), managedMkdtempSync('weftmate-fail-fixture-')];
  try {
    for (const root of roots) {
      assert.equal(resolve(root, '..'), managedTempRoot());
      assert.ok(basename(root).startsWith('weftmate-'));
      assert.equal(JSON.parse(readFileSync(join(root, '.weftmate-temp-owner.json'), 'utf8')).pid, process.pid);
    }
    assert.throws(() => disposeManagedTemp(managedTempRoot()), /not owned/);
  } finally { for (const root of roots) disposeManagedTemp(root); }
  for (const root of roots) assert.equal(existsSync(root), false);
});

test('representative fixture processes leave no directories on success, failure or handled interruption', () => {
  const root = managedMkdtempSync('weftmate-temp-lifecycle-');
  try {
    const parent = join(root, 'managed');
    for (const outcome of ['success', 'failure', 'SIGINT', 'SIGTERM']) {
      const source = `import {managedMkdtempSync} from ${JSON.stringify(helper)};
        managedMkdtempSync('C:/legacy/weftmate-ci-'); managedMkdtempSync('weftmate-ux10-');
        ${outcome === 'success' ? '' : outcome === 'failure' ? "throw Error('synthetic fixture failure');" : `process.emit('${outcome}');`}`;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { env: environment(parent), encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, outcome === 'success' ? 0 : outcome === 'failure' ? 1 : outcome === 'SIGINT' ? 130 : 143);
      assert.deepEqual(readdirSync(parent), [], `${outcome} left fixture directories`);
    }
  } finally { disposeManagedTemp(root); }
});

test('asynchronous CI runner handles interruption while its child is running and removes the complete temp scope', async () => {
  const root = managedMkdtempSync('weftmate-ci-interrupt-test-');
  try {
    const parent = join(root, 'managed'), suite = join(root, 'synthetic-suite.mjs'), driver = join(root, 'driver.mjs');
    writeFileSync(suite, `import {managedMkdtempSync} from ${JSON.stringify(helper)};
      managedMkdtempSync('weftmate-worker-'); console.log('ready'); setInterval(()=>{},1000);`);
    writeFileSync(driver, `import {managedMkdtempSync,disposeManagedTemp} from ${JSON.stringify(helper)};
      import {runManagedTestProcess} from ${JSON.stringify(runner)};
      const scope=managedMkdtempSync('weftmate-ci-');
      const env={...process.env,TEMP:scope,TMP:scope,TMPDIR:scope,WEFTMATE_TEST_TEMP_SCOPE:scope};
      const timer=setTimeout(()=>process.emit('SIGTERM'),1200);
      try { const result=await runManagedTestProcess(process.execPath,[${JSON.stringify(suite)}],{env,commandRoots:[${JSON.stringify(suite)},scope]});
        if(result.interrupted!=='SIGTERM') throw Error('interruption was not handled');
      } finally {clearTimeout(timer);disposeManagedTemp(scope);}`);
    const child = spawn(process.execPath, [driver], { env: environment(parent), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', data => { stderr += data; });
    const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
    assert.equal(code, 0, stderr);
    assert.deepEqual(readdirSync(parent), [], 'CI runner left its worker scope');
  } finally { disposeManagedTemp(root); }
});

test('temp pruner defaults to 24 hours, scopes approved legacy prefixes and protects live owner markers', { skip: process.platform !== 'win32' }, () => {
  const root = managedMkdtempSync('weftmate-prune-owner-test-');
  try {
    const parent = join(root, 'fixtures'); mkdirSync(parent);
    for (const name of ['weftmate-ci-old', 'weftmate-nightly-other', 'weftmate-ci-live']) mkdirSync(join(parent, name));
    writeFileSync(join(parent, 'weftmate-ci-live', '.weftmate-temp-owner.json'), JSON.stringify({pid:process.pid}));
    execFileSync('pwsh', ['-NoProfile', '-Command',
      '$env:WEFTMATE_PRUNE_TEST_ROOT | Get-ChildItem -Directory | ForEach-Object { $_.CreationTime=(Get-Date).AddHours(-25); $_.LastWriteTime=(Get-Date).AddHours(-25) }'],
      {env:{...process.env,WEFTMATE_PRUNE_TEST_ROOT:parent},windowsHide:true});
    const result = JSON.parse(execFileSync('pwsh', ['-NoProfile', '-File', resolve('scripts/nightly/prune-temp.ps1'), '-Roots', parent, '-Prefixes', 'weftmate-ci-', '-Apply'], {encoding:'utf8',windowsHide:true}).trim());
    assert.equal(result.hours,24); assert.equal(result.deleted,1); assert.equal(result.keptInUse,1);
    assert.equal(existsSync(join(parent,'weftmate-ci-old')),false);
    assert.equal(existsSync(join(parent,'weftmate-ci-live')),true);
    assert.equal(existsSync(join(parent,'weftmate-nightly-other')),true);
  } finally {disposeManagedTemp(root);}
});

test('next process prunes a stale fixture left by a force-killed owner', { skip: process.platform !== 'win32' }, async () => {
  const root = managedMkdtempSync('weftmate-killed-owner-test-');
  let child;
  try {
    const parent = join(root, 'managed');
    child = spawn(process.execPath, ['--input-type=module', '-e',
      `import {managedMkdtempSync} from ${JSON.stringify(helper)}; console.log(managedMkdtempSync('weftmate-killed-')); setInterval(()=>{},1000);`],
      { env: environment(parent), windowsHide: true, stdio: ['ignore','pipe','pipe'] });
    const directory = await new Promise<string>((done,reject) => {child.stdout.once('data', data=>done(data.toString().trim()));child.once('error',reject);});
    const closed = new Promise(done => child.once('close',done)); child.kill('SIGKILL'); await closed;
    assert.equal(existsSync(directory),true);
    execFileSync('pwsh',['-NoProfile','-Command',
      '$d=Get-Item -LiteralPath $env:WEFTMATE_PRUNE_TEST_ROOT; $d.CreationTime=(Get-Date).AddHours(-25); $d.LastWriteTime=(Get-Date).AddHours(-25)'],
      {env:{...process.env,WEFTMATE_PRUNE_TEST_ROOT:directory},windowsHide:true});
    const next = spawnSync(process.execPath,['--input-type=module','-e',
      `import {managedMkdtempSync} from ${JSON.stringify(helper)}; managedMkdtempSync('weftmate-next-');`],
      {env:environment(parent),encoding:'utf8',windowsHide:true});
    assert.equal(next.status,0,next.stderr); assert.deepEqual(readdirSync(parent),[]);
  } finally {
    if(child && child.exitCode===null && child.signalCode===null) {const closed=new Promise(done=>child.once('close',done));child.kill('SIGKILL');await closed;}
    disposeManagedTemp(root);
  }
});
