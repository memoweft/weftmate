import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { outDirectory, repository, catalog, capturePlatforms } from './common.mjs';
const out = outDirectory();
await mkdir(out, { recursive: true });
// A new run must not silently publish an earlier run's successful screenshots.
for (const platform of capturePlatforms) for (const scene of catalog.scenes) for (const theme of catalog.themes) {
  for (const extension of ['png', 'json']) await rm(join(out, `review-${platform.id}-${scene.id}-${theme}.${extension}`), { force: true });
}
for (const name of ['index.html', 'manifest.json', 'verification.json']) await rm(join(out, name), { force: true });
for (const surface of ['desktop', 'mobile']) {
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, [`tests/integration/review-capture-${surface}.mjs`, '--out', outDirectory()], { cwd: repository, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => code === 0 ? done() : reject(Error(`${surface} capture failed (${code})`)));
  });
}
