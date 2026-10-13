/** Real safeStorage across ad-hoc rebuilds, confined to disposable OS keychains. */
import { _electron } from 'playwright';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir, uptime } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PERSONAL_HOST_MARKER, PERSONAL_HOST_MARKER_CONTENT } from '../../src/host-mode.mjs';
const root=await realpath(await mkdtemp(join(tmpdir(),'weftmate-m3-3b-keychain-'))), profile=join(root,'profile');
await mkdir(profile);await writeFile(join(profile,PERSONAL_HOST_MARKER),JSON.stringify(PERSONAL_HOST_MARKER_CONTENT));
const bundle=resolve(process.env.M3_3B_APP || '../trial/WeftMate.app'), rebuilt=join(root,'WeftMate.app');
const secret=randomBytes(32).toString('hex'), password=randomBytes(32).toString('hex');
let executable=join(bundle,'Contents/MacOS/WeftMate'), keychain=join(root,'synthetic.keychain'), app, log='';
const report={ realSafeStorage:true, mockKeychain:false, nativeIsolation:'Security queries/adds scoped to private file; user default/search list unchanged',launches:0,checks:[],completed:false };
const requireCheck=(condition,message)=>{if(!condition)throw Error(message)};
async function launch(){
 const env={...process.env};for(const key of Object.keys(env))if(/^(WEFTMATE_|MEMOWEFT_|MIMO_API_KEY|ELECTRON_RUN_AS_NODE|NODE_OPTIONS|DYLD_)/.test(key))delete env[key];
 Object.assign(env,{WEFTMATE_TEST_HOST_NAME:'synthetic-mac',M3_3B_APP_EXECUTABLE:executable,M3_3B_SECURITY_LIBRARY:resolve('.local/m3-3b/isolated-keychain.dylib'),M3_3B_KEYCHAIN_FILE:keychain,M3_3B_KEYCHAIN_PASSWORD:password});
 report.launches++;
 app=await _electron.launch({executablePath:resolve('tests/helpers/m3-3b/launch-package.py'),env,args:['--disable-gpu','--disable-gpu-compositing','--headless',`--user-data-dir=${profile}`,'--access-port=0'],timeout:60000});
 for(const stream of [app.process().stdout,app.process().stderr])stream?.on('data',b=>{log+=b});
 await app.evaluate(({app})=>app.whenReady());
}
const vault=action=>app.evaluate(async({app,safeStorage},{action,secret})=>{
 const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');
 const store=require('./src/config-store.ts');
 await store.initializeCredentialStorage();
 if(action==='save')store.saveSubmittedCredential('synthetic-trial-key',secret);
 if(action==='refill')store.saveSubmittedCredential('synthetic-trial-key',secret);
 return {available:safeStorage.isEncryptionAvailable(),readable:store.getCredential('synthetic-trial-key')===secret,mock:app.commandLine.hasSwitch('use-mock-keychain')};
},{action,secret});
const signature=bundle=>{
 const r=spawnSync('/usr/bin/codesign',['-d','--verbose=4',bundle],{encoding:'utf8'});
 if(r.status!==0)throw Error('Unable to inspect ad-hoc signature');return r.stderr.match(/CDHash=([a-f0-9]+)/)?.[1];
};
try{
 await launch();report.first=await vault('save');requireCheck(report.first.available&&report.first.readable&&!report.first.mock,'Real safeStorage did not save/read');
 const bytes=await readFile(join(profile,'weftmate-model.enc'));requireCheck(!bytes.includes(Buffer.from(secret)),'Vault contains plaintext');
 await app.close();app=null;await launch();report.sameBuild=await vault('read');requireCheck(report.sameBuild.readable,'Same-build restart lost key');await app.close();app=null;
 execFileSync('/bin/cp',['-cR',bundle,rebuilt]);await writeFile(join(rebuilt,'Contents/Resources/local-rebuild-proof.txt'),'Synthetic resource changed for signature rebuild.\n');
 execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',rebuilt],{stdio:'pipe'});
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',rebuilt],{stdio:'pipe'});
 report.originalCdHash=signature(bundle);report.rebuiltCdHash=signature(rebuilt);requireCheck(report.originalCdHash!==report.rebuiltCdHash,'Resource rebuild did not change code identity');
 executable=join(rebuilt,'Contents/MacOS/WeftMate');await launch();report.rebuilt=await vault('read');await app.close();app=null;
 // Loss of the old Keychain item is a real failure case: keep the ciphertext,
 // boot without crashing, and accept only an explicit user key submission.
 keychain=join(root,'replacement.keychain');await launch();report.lostItem=await vault('read');
 requireCheck(!report.lostItem.readable,'Fresh isolated keychain unexpectedly decrypted prior vault');
 const preserved=await readFile(join(profile,'weftmate-model.enc'));requireCheck(bytes.equals(preserved),'Unreadable startup replaced ciphertext');
 report.refill=await vault('refill');requireCheck(report.refill.readable,'Explicit key refill did not recover');
 report.checks=['real Keychain-backed encrypt/decrypt and ciphertext','same-build restart','changed ad-hoc CDHash rebuild','lost-key startup preserves old vault and returns missing credential','explicit form submission refill recovers'];report.completed=true;
}catch(error){report.failure=String(error.message).replaceAll(root,'<temp>').replace(/\/Users\/[^/\s]+/g,'/Users/<user>');process.exitCode=1}
finally{await app?.close();report.osOperations={successfulReads:(log.match(/M3_3B_KEYCHAIN (?:find|copy) 0/g)||[]).length,successfulAdds:(log.match(/M3_3B_KEYCHAIN (?:legacy-add|add) 0/g)||[]).length,interactionDenied:(log.match(/M3_3B_KEYCHAIN (?:find|copy) -25308/g)||[]).length};await writeFile('tests/evidence/m3-3b/keychain.json',JSON.stringify(report,null,2)+'\n');await rm(root,{recursive:true,force:true});console.log(JSON.stringify({completed:report.completed,launches:report.launches,rebuildReadable:report.rebuilt?.readable}));}
