/** Retained synthetic releases for the real manual-upgrade acceptance. */
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {parse,join,resolve} from 'node:path';
import {keyId} from '../src/personal-update/manifest.mjs';
import {buildWindowsRelease} from '../scripts/release/windows.mjs';
const temp=mkdtempSync(join(parse(process.env.SystemRoot).root,'weftmate-inst1-signing-'));
const pair=generateKeyPairSync('ed25519'),pub=pair.publicKey.export({type:'spki',format:'pem'});
const previous=process.env.WEFTMATE_UPDATE_PRIVATE_KEY_PATH;
try{
  const key=join(temp,'key.pem'),keys=join(temp,'keys.json');
  writeFileSync(key,pair.privateKey.export({type:'pkcs8',format:'pem'}));writeFileSync(keys,JSON.stringify({[keyId(pub)]:pub}));
  process.env.WEFTMATE_UPDATE_PRIVATE_KEY_PATH=key;
  await buildWindowsRelease({version:process.argv[3]||'0.1.2-preview.22',channel:'preview',output:resolve(process.argv[2]||'.local/inst-1-upgrade-fixed'),'trusted-keys':keys,'test-identity':'inst1qa','isolate-test-executable':'true','prebuilt-stage':resolve(process.argv[4]||'.local/inst-1-baseline/0.1.1-preview.21/stage')});
}finally{if(previous===undefined)delete process.env.WEFTMATE_UPDATE_PRIVATE_KEY_PATH;else process.env.WEFTMATE_UPDATE_PRIVATE_KEY_PATH=previous;rmSync(temp,{recursive:true,force:true});}
