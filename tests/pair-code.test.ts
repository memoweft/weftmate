import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { hostCommitment, phoneCommitment, verificationCode } from '../src/personal-cloud/pairing.mjs';

test('PAIR-CODE published fixed vector preserves encoding and changes SAS for each participating value', () => {
  const v=JSON.parse(readFileSync(new URL('./fixtures/pairing-v2.json',import.meta.url),'utf8'));
  const p={transcript:v.transcript,hostNonce:v.hostNonce,phone:{deviceId:v.deviceId,jkt:v.phoneJkt,nonce:v.phoneNonce}};
  assert.equal(hostCommitment(v.transcript,v.hostNonce),v.hostCommitment);
  assert.equal(phoneCommitment(v.transcript[6],v.deviceId,v.phoneJkt,v.phoneNonce),v.phoneCommitment);
  assert.equal(verificationCode(p),v.verificationCode);
  for(let i=0;i<v.transcript.length;i++){const changed=structuredClone(p);changed.transcript[i]=String(changed.transcript[i])+'x';assert.notEqual(verificationCode(changed),v.verificationCode);}
  for(const key of ['deviceId','jkt','nonce']){const changed=structuredClone(p);changed.phone[key]+='x';assert.notEqual(verificationCode(changed),v.verificationCode);}
  const changed=structuredClone(p);changed.hostNonce+='x';assert.notEqual(verificationCode(changed),v.verificationCode);
});

test('PAIR-CODE real Electron completes desktop comparison with light and dark dialogs', {timeout:165000,skip:process.platform!=='win32'}, () => {
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const result=spawnSync(process.execPath,['tests/integration/pair-code.mjs'],{env,encoding:'utf8',windowsHide:true,timeout:155000,maxBuffer:1024*1024});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/PAIR-CODE Electron: .* passed/);
});
