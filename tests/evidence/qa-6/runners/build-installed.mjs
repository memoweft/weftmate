import {generateKeyPairSync} from 'node:crypto';
import {mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildWindowsRelease} from '../../../../scripts/release/windows.mjs';
import {keyId} from '../../../../src/personal-update/manifest.mjs';
const root=resolve('.local/qa-6');await mkdir(root,{recursive:true});
const privateRoot=await mkdtemp(join(tmpdir(),'weftmate-qa6-signing-'));
const pair=generateKeyPairSync('ed25519');
const pub=pair.publicKey.export({type:'spki',format:'pem'});
await writeFile(privateRoot+'/private.pem',pair.privateKey.export({type:'pkcs8',format:'pem'}));
await writeFile(root+'/keys.json',JSON.stringify({[keyId(pub)]:pub}));
process.env.WEFTMATE_UPDATE_PRIVATE_KEY_PATH=privateRoot+'/private.pem';
try { for(const n of [1])await buildWindowsRelease({version:`0.1.1-preview.${n}`,channel:'preview',output:root+'/releases','trusted-keys':root+'/keys.json','test-identity':'qa6',...(n===3?{'test-bad-main':'true'}:{})});

} finally { await rm(privateRoot,{recursive:true,force:true}); }
