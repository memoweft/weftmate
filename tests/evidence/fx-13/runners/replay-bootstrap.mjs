// Replay only: select the exact pre-FX13 file observer for a synthetic account.
import {registerHooks} from 'node:module';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const repository=resolve(import.meta.dirname,'../../../..');
if(process.env.FX13_REPLAY_BEFORE==='1')registerHooks({load(url,context,next){if(url===pathToFileURL(resolve(repository,'src/dsh-web-runtime.ts')).href){const source=readFileSync(new URL(url),'utf8').replace("[join(PLUGINS_DIR, 'personal-native-files.mjs'),",`[${JSON.stringify(resolve(repository,'tests/evidence/fx-13/before-approval/native-files-baseline.mjs'))},`);return {format:'module-typescript',source,shortCircuit:true};}return next(url,context);}});
await import('../../../../tests/integration/personal-approval-bootstrap.mjs');
