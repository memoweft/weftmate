import { evidencePath } from '../../helpers/evidence-path.mjs';
/** Sanitize retained calibration/gate evidence, including embedded base64 paths. */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hostname } from 'node:os';
const evidence = evidencePath('sec-2');
const plain = text => String(text).replaceAll(hostname(), '<host>')
  .replace(/(?:[A-Z]:[\\/]+Users[\\/]+[^\\/]+[\\/]+AppData[\\/]+Local[\\/]+Temp|[A-Z]:[\\/]+Temp)[\\/]+weftmate-synthetic-stop-stage11-sec2-[a-z0-9-]+/gi, '%TEMP%/sec2')
  .replace(/[A-Z]:[\\/]+weftmate-ci-[a-z0-9_-]+/gi, '%TEMP%/ci')
  .replace(/([A-Z]:[\\/]+Users[\\/]+)[^\\/\s"']+/gi, '$1<user>');
const sanitize = text => plain(text).replace(/[A-Za-z0-9+/]{80,}={0,2}/g, encoded => { const decoded = Buffer.from(encoded, 'base64').toString('utf8'), safe = plain(decoded); return decoded !== safe ? Buffer.from(safe).toString('base64') : encoded; });
function walk(path) { for (const e of readdirSync(path, { withFileTypes: true })) { const file = join(path, e.name); if (e.isDirectory()) walk(file); else if (/\.(?:json|md|txt)$/.test(e.name)) { const raw = readFileSync(file, 'utf8'), safe = sanitize(raw); if (raw !== safe) writeFileSync(file, safe); } } }
walk(evidence);
