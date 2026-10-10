// Read the completed synthetic run after a host restart; no new inference is requested.
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { localUiSession } from '../helpers/local-ui-session.mjs';
import { verifyFactUi } from './fact-1-ui.mjs';
const batch=JSON.parse(readFileSync(resolve(process.argv[2]||'tests/evidence/fact-1/serial-performance/mimo/results.json'),'utf8'));
assert.match(batch.root,/^C:[\\/]Temp[\\/]weftmate-fact1-/i);
const c=JSON.parse(readFileSync(join(batch.root,'eval/credentials.json'),'utf8'));
const evidence=resolve('tests/evidence/fact-1/post-merge-ui');mkdirSync(evidence,{recursive:true});
const env={...process.env};for(const name of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_)/.test(name)||['ELECTRON_RUN_AS_NODE','MIMO_API_KEY','MODEL_SWITCH_UNIFIED_KEY'].includes(name))delete env[name];
env.FACT1_PHASE='after';env.WEFTMATE_BASELINE_TRACE=join(evidence,'requests.jsonl');
let app,page,log='';
try {
  app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),cwd:resolve('.'),args:[resolve('tests/integration/fact-1-bootstrap.mjs'),`--user-data-dir=${join(batch.root,'profile')}`,'--personal-host','--access-port=0'],env,timeout:90000});
  app.process().stdout?.on('data',s=>{log+=s;});app.process().stderr?.on('data',s=>{log+=s;});
  page=await app.firstWindow();page.setDefaultTimeout(30000);await page.waitForURL('**/personal/v1/ui');
  const credentials={username:c.username,password:c.password};await localUiSession(page,credentials,'FACT-1 restarted UI');
  const api=(path,body,method=body?'POST':'GET')=>page.evaluate(async({path,body,method})=>{const me=await(await fetch('/personal/v1/auth/me')).json();const response=await fetch('/personal/v1'+path,{method,headers:{'content-type':'application/json','x-weftmate-csrf':me.csrfToken},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};},{path,body,method});
  await verifyFactUi({app,page,api,results:batch.results,evidence,credentials});
} catch(error) {
  writeFileSync(join(evidence,'failure.json'),JSON.stringify({message:error.message}));
  if(page&&!page.isClosed())await page.screenshot({path:join(evidence,'failure.png')});
  throw error;
} finally {await app?.close();writeFileSync(join(evidence,'restart.json'),JSON.stringify({existingSyntheticData:true,noInferenceRequested:true,cleanExit:true,hostStarted:log.includes('personal-host ready')}));}
