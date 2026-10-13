import path from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { durableWrite } from '../personal-backup/archive.mjs';

const fileFor = root => path.join(root,'personal-backup','cloud-vault-restore.json');
async function read(root) { return readFile(fileFor(root),'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;}); }
const matches = (journal,sourceFile) => journal?.version===1 && typeof sourceFile==='string' &&
  typeof journal.outputFile==='string' && path.resolve(journal.outputFile)===path.resolve(sourceFile);
/** The data transaction may only follow this exact archive's joint commit intent. */
export async function cloudVaultRestoreCommitted(root,sourceFile) {
  if(typeof sourceFile!=='string')return false;
  const journal=await read(root);
  return matches(journal,sourceFile)&&journal.state==='committed';
}
export async function commitCloudVaultRestore(root,sourceFile) {
  if(typeof sourceFile!=='string')return;
  const journal=await read(root);
  if(matches(journal,sourceFile)&&journal.state==='applying') {
    journal.state='committed';await durableWrite(fileFor(root),journal);
  }
}
// The journal contains only ciphertext for this installation, never portable plaintext.
export async function stageCloudVaultRestore(root,vault,credentials,{outputFile}={}) {
  const ciphertext=vault.prepareCloudVaultBytes(credentials);
  await durableWrite(fileFor(root),{version:1,state:'prepared',before:vault.snapshotVaultBytes()?.toString('base64')??null,after:ciphertext.toString('base64'),...(outputFile?{outputFile}:{})});
}
export async function reconcileCloudVaultRestore(root,vault,restoredStartup) {
  const journal=await read(root); if(!journal)return;
  if(journal.version!==1 || !['prepared','applying','committed'].includes(journal.state)) throw Object.assign(new Error('CLOUD_BACKUP_CORRUPT'),{code:'CLOUD_BACKUP_CORRUPT'});
  if(journal.state==='committed') {
    // The paired data transaction was committed, or startup just completed it.
    // Keep current bytes: a healthy process may have saved a newer credential.
    await finishCloudVaultRestore(root,vault,true);return;
  }
  if(restoredStartup) {
    journal.state='applying'; await durableWrite(fileFor(root),journal);
    vault.restoreVaultBytes(Buffer.from(journal.after,'base64'));
  } else {
    await finishCloudVaultRestore(root,vault,false);
  }
}
export async function finishCloudVaultRestore(root,vault,success) {
  const journal=await read(root); if(!journal)return;
  if(!success && journal.state==='applying')vault.restoreVaultBytes(journal.before===null?null:Buffer.from(journal.before,'base64'));
  if(journal.outputFile) {
    const control=path.resolve(root,'personal-backup','cloud'),target=path.resolve(journal.outputFile);
    if(target.startsWith(control+path.sep)&&path.basename(target)==='restored.wmb')await rm(target,{force:true});
  }
  await rm(fileFor(root),{force:true});
}
