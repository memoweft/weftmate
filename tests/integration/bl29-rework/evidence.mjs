import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
export function outputPath(file) {
  const dir = resolve(process.env.BL29_EVIDENCE_DIR || '.local/bl29-rework');
  mkdirSync(dir, { recursive: true });
  return resolve(dir, file);
}
