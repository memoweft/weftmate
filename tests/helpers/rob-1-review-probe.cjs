const assert=require('node:assert/strict');
const {syncBuiltinESMExports}=require('node:module');
const {app,safeStorage}=require('electron');
const fs=require('node:fs');
const {join,resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
const [root,action,source]=process.argv.slice(2);
app.setPath('userData',root);app.setPath('sessionData',root);
fs.mkdirSync(join(root,'Crashpad'),{recursive:true});app.setPath('crashDumps',join(root,'Crashpad'));
const file=join(root,'weftmate-model.enc');

app.whenReady().then(async()=>{
 const store=await import(pathToFileURL(source).href);
 if(action==='seed'){
  if(store.initializeCredentialStorage)await store.initializeCredentialStorage();
  store.saveCredential('synthetic-model','synthetic-review-preserve-me');
  console.log(JSON.stringify({action,readable:store.getCredential('synthetic-model')==='synthetic-review-preserve-me'}));
 }else{
  if(action==='refill-check') {
   const originalBytes=fs.readFileSync(file); const failures=[]; await store.initializeCredentialStorage(e=>failures.push(e.code));
   const encrypt=safeStorage.encryptString.bind(safeStorage);
   safeStorage.encryptString=()=>{throw Error('synthetic encryption unavailable');};
   assert.throws(()=>store.saveSubmittedCredential('synthetic-model','synthetic-review-preserve-me'));
   safeStorage.encryptString=encrypt;assert.deepEqual(fs.readFileSync(file),originalBytes);
   assert.equal(fs.readdirSync(root).some(n=>n.includes('.replaced-')),false);
   const rename=fs.renameSync;
   fs.renameSync=(from,to)=>{if(String(from).endsWith('.tmp')&&to===file)throw Object.assign(Error(),{code:'EACCES'});return rename(from,to);};syncBuiltinESMExports();
   assert.throws(()=>store.saveSubmittedCredential('synthetic-model','synthetic-review-preserve-me'),{code:'EACCES'});
   fs.renameSync=rename;syncBuiltinESMExports();assert.deepEqual(fs.readFileSync(file),originalBytes);
   assert.equal(fs.readdirSync(root).some(n=>n.includes('.replaced-')),false);
   store.saveSubmittedCredential('synthetic-model','synthetic-review-preserve-me');
   const first=fs.readdirSync(root).filter(n=>n.includes('.replaced-'));assert.equal(first.length,1);assert.deepEqual(fs.readFileSync(join(root,first[0])),originalBytes);
   const next=Buffer.from('synthetic second unreadable vault');fs.writeFileSync(file,next);
   store.saveSubmittedCredential('synthetic-model','synthetic-review-preserve-me');
   const kept=fs.readdirSync(root).filter(n=>n.includes('.replaced-'));assert.equal(kept.length,1);assert.deepEqual(fs.readFileSync(join(root,kept[0])),next);
   assert.equal(store.getCredential('synthetic-model'),'synthetic-review-preserve-me');assert.equal(failures.length,1);
   console.log(JSON.stringify({action,encryptionFailureRetainsOriginal:true,commitFailureRestoresOriginal:true,replacedRetained:kept.length,readable:true}));app.quit();return;
  }
  const beforeState=fs.readFileSync(join(root,'Local State')); const beforeCipher=fs.readFileSync(file);
  const original=safeStorage.decryptString.bind(safeStorage),available=safeStorage.isEncryptionAvailable.bind(safeStorage);
  if(action==='transient') { let calls=0; safeStorage.decryptString=(bytes)=>{if(++calls===1)throw Error('synthetic transient');return original(bytes);}; }
  if(action==='unavailable')safeStorage.isEncryptionAvailable=()=>false;
  let error=null;const failures=[];
  if(action!=='raw-read')try{await store.initializeCredentialStorage(e=>failures.push(e.code));}catch(e){error=e.code;}
  const ciphertextRetained=fs.existsSync(file)&&fs.readFileSync(file).equals(beforeCipher);
  const localStateRetained=fs.readFileSync(join(root,'Local State')).equals(beforeState);
  safeStorage.decryptString=original;safeStorage.isEncryptionAvailable=available;
  let direct=false;try{direct=JSON.parse(original(fs.readFileSync(file))).credentials['synthetic-model']==='synthetic-review-preserve-me';}catch{}
  const archived=fs.readdirSync(root).filter(n=>n.includes('.unreadable-'));
  let archiveReadable=false;try{archiveReadable=archived.some(n=>JSON.parse(original(fs.readFileSync(join(root,n)))).credentials['synthetic-model']==='synthetic-review-preserve-me');}catch{}
  console.log(JSON.stringify({action,error,failures,localStateRetained,ciphertextRetained,readable:store.getCredential('synthetic-model')==='synthetic-review-preserve-me',direct,archiveReadable,archived:archived.length,recovery:fs.existsSync(file+'.recovery.json')}));
 }
 app.quit();
}).catch(e=>{console.log(JSON.stringify({fatal:e.code||e.message}));app.exit(75);});