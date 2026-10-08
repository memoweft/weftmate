import { spawn } from 'node:child_process';
import { outDirectory, repository } from './common.mjs';
for (const surface of ['desktop', 'mobile']) {
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, [`tests/integration/review-capture-${surface}.mjs`, '--out', outDirectory()], { cwd: repository, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => code === 0 ? done() : reject(Error(`${surface} capture failed (${code})`)));
  });
}
