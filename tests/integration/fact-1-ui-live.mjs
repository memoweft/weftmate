// Inspect a FACT-1 isolated host while its independent model tasks continue.
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { verifyFactUi } from './fact-1-ui.mjs';
const directory=resolve(process.argv[2]||'tests/evidence/fact-1/acceptance/mimo-node');
const batch=JSON.parse(readFileSync(join(directory,'results.json'),'utf8'));
const c=JSON.parse(readFileSync(join(batch.root,'eval/credentials.json'),'utf8'));
const profile=join('C:/Temp','weftmate-fact1-ui-'+randomUUID());mkdirSync(profile,{recursive:true});
const evidence=resolve('tests/evidence/fact-1/ui');mkdirSync(evidence,{recursive:true});
const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
let app,page;
try {
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),
    args:[resolve('scripts/review-gallery/electron.mjs')],env:{...env,REVIEW_PROFILE:profile,REVIEW_ORIGIN:c.host,REVIEW_THEME:'light'}});
  const credentials={username:c.username,password:c.password};
  page=await app.firstWindow();page.setDefaultTimeout(20000);await localUiSession(page,credentials,'FACT-1 visual');
  await verifyFactUi({app,page,results:batch.results,evidence,credentials,observeOnly:true});
}catch(error){if(page){await page.screenshot({path:join(evidence,'failure.png')});writeFileSync(join(evidence,'failure.txt'),error.message+'\n'+await page.locator('body').innerText());}throw error;}
finally{await app?.close();}
