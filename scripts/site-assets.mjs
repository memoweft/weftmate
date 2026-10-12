import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result=spawnSync(process.execPath,[fileURLToPath(new URL('./capture-site.mjs',import.meta.url)),'--assets'],{stdio:'inherit'});
process.exitCode=result.status??1;
