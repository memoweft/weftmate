import { evidencePath } from '../../helpers/evidence-path.mjs';
/** Local required gates, one global heavy slot per invocation, released in finally. */
import { openSync, closeSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve, join } from 'node:path';
import { hostname } from 'node:os';
const repo = resolve(import.meta.dirname, '../../..'), evidence = evidencePath('sec-2');
const modes = process.argv.slice(2).length ? process.argv.slice(2) : ['required', 'vendor'];
for (const mode of modes) {
  if (!['required', 'vendor'].includes(mode)) throw Error('Use required or vendor');
  let lock;
  while (!lock) {
    for (let slot = 1; slot <= 3; slot++) { const path = `D:/AIProjects/WeftMate/Runtime/Orchestrator/heavy-${slot}.lock`; try { const fd = openSync(path, 'wx'); writeFileSync(fd, `SEC-2 ${new Date().toISOString()} ${mode} gate`); closeSync(fd); lock = path; break; } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    if (!lock) { console.log(`SEC-2 ${mode}: all heavy slots occupied; retry in two minutes`); await new Promise(r => setTimeout(r, 120000)); }
  }
  try {
    const child = spawn(process.execPath, [join(repo, '.github/scripts/ci-unit-tests.mjs'), mode, '--report', join(evidence, `${mode}-summary.json`)], { cwd: repo, windowsHide: true });
    let output = ''; child.stdout.on('data', c => { output += c; }); child.stderr.on('data', c => { output += c; });
    const [code] = await once(child, 'close');
    output = output.replaceAll(hostname(), '<host>').replace(/([A-Z]:[\\/]+Users[\\/]+)[^\\/\s]+/gi, '$1<user>');
    writeFileSync(join(evidence, `${mode}-tests.txt`), output);
    console.log(output.trim().split('\n').slice(-10).join('\n'));
    if (code) { process.exitCode = code; break; }
  } finally { unlinkSync(lock); }
}
