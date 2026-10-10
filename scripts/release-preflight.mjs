import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const manifestFiles = ['package.json', 'package-lock.json'];
const localReferences = [];

function findLocalReferences(value, path) {
  if (typeof value === 'string') {
    if (value.startsWith('file:')) localReferences.push(`${path} = ${value}`);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => findLocalReferences(item, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => findLocalReferences(item, `${path}.${key}`));
  }
}

for (const file of manifestFiles) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  findLocalReferences(parsed, file);
}

if (localReferences.length > 0) {
  console.error('Release preflight failed: local file: dependencies are not publishable.');
  localReferences.forEach(reference => console.error(`- ${reference}`));
  process.exit(1);
}

const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) {
  console.error('Release preflight failed: run it through `npm run release:preflight`.');
  process.exit(1);
}

const audit = spawnSync(
  process.execPath,
  [npmExecPath, 'audit', '--omit=dev', '--audit-level=high', '--registry=https://registry.npmjs.org'],
  { stdio: 'inherit' },
);

if (audit.error) {
  console.error(`Release preflight failed: could not run npm audit (${audit.error.message}).`);
  process.exit(1);
}

if (audit.status !== 0) process.exit(audit.status ?? 1);

console.log('Release dependency preflight passed: no local dependencies or high-severity production advisories. Packaging, package contents, signing and application startup are NOT verified; use the Windows packaged smoke gate.');
