// 保护：改密码或邮箱找回若绕过原口令验证，会让新设备读到旧钥匙；旧协议不得恢复解密能力。
import test from 'node:test';
import assert from 'node:assert/strict';
import './dependencies.mjs';
const opaque=await import('@serenity-kit/opaque'),jose=await import('jose');
import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {fixture,P,PASSWORD,NEXT_PASSWORD,EMAIL} from './identity-helpers.mjs';
import {appDevice,control,proof} from './app-helpers.mjs';
import {passwordWrappingKey,sealPasswordKey,openPasswordKey} from '../../../src/ui-core/password-key.mjs';
await opaque.ready;
const hash=b=>createHash('sha256').update(b).digest('base64url');
async function activate(f,d,password,extra={}){
 const secret=randomBytes(32),keyId=hash(secret),salt=randomBytes(16).toString('base64url');
 f.db.prepare('INSERT OR REPLACE INTO account_data_keys VALUES(?,?)').run(d.account.id,keyId);
 const start=opaque.client.startRegistration({password});
 const response=(await control(d,'/password/registration',{registrationRequest:start.registrationRequest,...extra})).data;
 const done=opaque.client.finishRegistration({...start,...response,password,keyStretching:'memory-constrained'});
 const key=await passwordWrappingKey(done.exportKey,salt,f.config.issuer,d.account.id);
 const wrappedKey=await sealPasswordKey(jose,key,secret,{issuer:f.config.issuer,sub:d.account.id,keyId,salt});
 const pair=await jose.generateKeyPair('ES256'),hostId='source-host',pub=JSON.stringify(await jose.exportJWK(pair.publicKey));
 f.db.prepare('INSERT INTO cloud_hosts(host_id,public_jwk,jkt,tls_spki) VALUES(?,?,?,?)').run(hostId,pub,'source-jkt','source-tls');
 f.db.prepare('INSERT INTO host_claims VALUES(?,?,?,?,?,?,?,?,?)').run('source-claim',hostId,pub,'source-jkt','source-tls','challenge',f.now+600000,d.account.id,'active');
 f.db.prepare("INSERT INTO host_memberships(host_id,account_id,claim_id,role) VALUES(?,?,?,'owner')").run(hostId,d.account.id,'source-claim');
 const proof=await new jose.SignJWT({action:'password-activate',sub:d.account.id,flowId:response.flowId,recordHash:hash(done.registrationRecord),wrappedHash:hash(JSON.stringify(wrappedKey))})
  .setProtectedHeader({alg:'ES256',typ:'wm-host-request+jwt'}).setIssuer(hostId).setAudience(f.config.issuer).setIssuedAt().setExpirationTime('60s').setJti(randomUUID()).sign(pair.privateKey);
 await control(d,'/password/commit',{flowId:response.flowId,registrationRecord:done.registrationRecord,wrappedKey},403);
 await control(d,'/password/commit',{flowId:response.flowId,registrationRecord:done.registrationRecord,wrappedKey,activationProof:{hostId,proof}});
 return {secret,keyId,wrappedKey,exportKey:done.exportKey};
}
async function logged(f,d,password){
 const verifier=randomBytes(32).toString('base64url'),state=randomUUID(),nonce=randomUUID();
 const p=(await d.client(P+'/auth/authorization',{method:'POST',status:200,body:{clientId:'test-native',redirectUri:'com.example.weftmate:/callback',deviceId:d.deviceId,publicJwk:d.publicJwk,codeChallenge:hash(verifier),state,nonce}})).data;
 const fields={...p,email:EMAIL,deviceId:d.deviceId,publicJwk:d.publicJwk};
 const start=opaque.client.startLogin({password});
 const response=(await d.client(P+'/auth/opaque/start',{method:'POST',status:200,body:{...fields,startLoginRequest:start.startLoginRequest}})).data;
 const done=opaque.client.finishLogin({...start,...response,password,keyStretching:'memory-constrained'});
 if(!done)return null;
 let result=await d.client(P+'/auth/opaque/finish',{method:'POST',body:{...fields,flowId:response.flowId,finishLoginRequest:done.finishLoginRequest},status:200});
 const resumed=(await d.client(P+'/auth/authorization/resume',{method:'POST',body:{resumeUrl:result.data.resumeUrl},status:200})).data;
 const callback=new URL(resumed.callbackUrl),url=f.origin+P+'/oidc/token';
 d.tokens=(await d.client(P+'/oidc/token',{method:'POST',headers:{dpop:await proof(d,url)},form:{grant_type:'authorization_code',client_id:'test-native',redirect_uri:'com.example.weftmate:/callback',code:callback.searchParams.get('code'),code_verifier:verifier},status:200})).data;
 return done;
}
test('OPAQUE upgrade and password rotation keep the data key while retiring old authentication',async t=>{
 const f=await fixture(t,{env:{CLOUD_REPLICA_ENABLED:'true'}});const account=await f.verified(),d=await appDevice(f,'password-device');d.account={id:account.cloudAccountId};
 const key=await activate(f,d,NEXT_PASSWORD);
 assert.equal(f.db.prepare('SELECT password FROM cloud_accounts').get().password,'null');
 const done=await logged(f,d,NEXT_PASSWORD);assert.ok(done);
 assert.deepEqual(Buffer.from(await openPasswordKey(jose,done.exportKey,key.wrappedKey,{issuer:f.config.issuer,sub:d.account.id})),key.secret);
 assert.equal(await logged(f,d,'wrong synthetic password'),null);
 const a=opaque.client.startLogin({password:NEXT_PASSWORD});
 const b=(await control(d,'/password/unlock/start',{startLoginRequest:a.startLoginRequest})).data;
 const c=opaque.client.finishLogin({...a,...b,password:NEXT_PASSWORD,keyStretching:'memory-constrained'});
 const verified=(await control(d,'/password/unlock/finish',{flowId:b.flowId,finishLoginRequest:c.finishLoginRequest})).data;
 const password='rotated synthetic password',start=opaque.client.startRegistration({password});
 const response=(await control(d,'/password/registration',{proof:verified.proof,registrationRequest:start.registrationRequest})).data;
 const registration=opaque.client.finishRegistration({...start,...response,password,keyStretching:'memory-constrained'});
 const salt=randomBytes(16).toString('base64url'),wrap=await passwordWrappingKey(registration.exportKey,salt,f.config.issuer,d.account.id);
 const wrappedKey=await sealPasswordKey(jose,wrap,key.secret,{issuer:f.config.issuer,sub:d.account.id,keyId:key.keyId,salt});
 await control(d,'/password/commit',{flowId:response.flowId,registrationRecord:registration.registrationRecord,wrappedKey});
 assert.equal(await logged(f,d,NEXT_PASSWORD),null);
 const fresh=await logged(f,d,password);
 assert.deepEqual(Buffer.from(await openPasswordKey(jose,fresh.exportKey,(await control(d,'/password/read',{})).data.wrappedKey,{issuer:f.config.issuer,sub:d.account.id})),key.secret);
 await assert.rejects(openPasswordKey(jose,done.exportKey,wrappedKey,{issuer:f.config.issuer,sub:d.account.id}));
});
test('mailbox reset restores login without revealing the previous data key or permitting a plaintext reset',async t=>{
 const f=await fixture(t,{env:{CLOUD_REPLICA_ENABLED:'true'}});const account=await f.verified(),d=await appDevice(f,'reset-device');d.account={id:account.cloudAccountId};
 const key=await activate(f,d,NEXT_PASSWORD);
 const challenge=(await f.api(P+'/auth/recovery/request',{method:'POST',body:{email:EMAIL},status:200})).data;
 const ticket=(await f.api(P+'/auth/recovery/verify',{method:'POST',body:{challengeId:challenge.challengeId,code:await f.mailCode(challenge.challengeId)},status:200})).data;
 await f.api(P+'/auth/recovery/complete',{method:'POST',body:{passwordTicket:ticket.passwordTicket,password:PASSWORD},status:409});
 const password='reset synthetic password',start=opaque.client.startRegistration({password});
 const response=(await f.api(P+'/password/registration',{method:'POST',body:{...ticket,purpose:'reset',registrationRequest:start.registrationRequest},status:200})).data;
 const registration=opaque.client.finishRegistration({...start,...response,password,keyStretching:'memory-constrained'});
 await f.api(P+'/password/commit',{method:'POST',body:{...ticket,flowId:response.flowId,registrationRecord:registration.registrationRecord,wrappedKey:null},status:200});
 const fresh=await logged(f,d,password);
 assert.equal((await control(d,'/password/read',{})).data.wrappedKey,null);
 await assert.rejects(openPasswordKey(jose,fresh.exportKey,key.wrappedKey,{issuer:f.config.issuer,sub:d.account.id}));
 assert.equal(f.db.prepare('SELECT key_id FROM account_data_keys').get().key_id,key.keyId);
});

test('email-verified OPAQUE registration authorizes its original app key without a second email challenge',async t=>{
 const f=await fixture(t,{env:{CLOUD_REPLICA_ENABLED:'true'}}),client=f.browser(),key=await jose.generateKeyPair('ES256');
 const d={f,client,key,publicJwk:await jose.exportJWK(key.publicKey),deviceId:'new-app'};
 await client(P+'/auth/authorization',{method:'POST',status:200,body:{clientId:'test-native',redirectUri:'com.example.weftmate:/callback',deviceId:d.deviceId,publicJwk:d.publicJwk,codeChallenge:hash(randomBytes(32)),state:randomUUID(),nonce:randomUUID()}});
 const challenge=(await client(P+'/auth/registration/request',{method:'POST',body:{email:EMAIL},status:200})).data;
 const ticket=(await client(P+'/auth/registration/verify',{method:'POST',body:{challengeId:challenge.challengeId,code:await f.mailCode(challenge.challengeId)},status:200})).data;
 const password=NEXT_PASSWORD,start=opaque.client.startRegistration({password});
 const response=(await client(P+'/password/registration',{method:'POST',body:{...ticket,purpose:'register',registrationRequest:start.registrationRequest},status:200})).data;
 const record=opaque.client.finishRegistration({...start,...response,password,keyStretching:'memory-constrained'});
 await client(P+'/password/commit',{method:'POST',body:{...ticket,flowId:response.flowId,registrationRecord:record.registrationRecord,wrappedKey:null},status:200});
 assert.ok(await logged(f,d,password));
 assert.equal(f.db.prepare("SELECT count(*) AS n FROM email_challenges WHERE purpose='device'").get().n,0);
});
