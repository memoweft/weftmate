import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, P, EMAIL, generateKeyPair, exportJWK, jwtVerify, createLocalJWKSet } from './identity-helpers.mjs';
import { registration, proof } from './app-helpers.mjs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';

test('real cloud child serves passwordless verified-device login with file mail and closes its isolated data cleanly',async t=>{
  const f=await fixture(t,{realProcess:true}); const {account}=await registration(f);
  const key=await generateKeyPair('ES256'), publicJwk=await exportJWK(key.publicKey), client=f.browser();
  const verifier=randomBytes(32).toString('base64url'), state=randomUUID(), deviceId='synthetic-process-device';
  const interaction=(await client(`${P}/auth/authorization`,{method:'POST',status:200,body:{
    clientId:'test-native',redirectUri:'com.example.weftmate:/callback',deviceId,publicJwk,
    codeChallenge:createHash('sha256').update(verifier).digest('base64url'),state,nonce:randomUUID(),
  }})).data;
  const challenge=(await client(`${P}/auth/login/code/request`,{method:'POST',status:202,body:{
    ...interaction,email:EMAIL,deviceId,publicJwk,deviceName:'Synthetic process phone',deviceType:'web',
  }})).data;
  const completed=(await client(`${P}/auth/login/code/confirm`,{method:'POST',status:200,body:{
    interactionUid:interaction.interactionUid,csrfToken:interaction.csrfToken,challengeId:challenge.challengeId,
    code:await f.mailCode(challenge.challengeId),
  }})).data;
  const resumed=(await client(`${P}/auth/authorization/resume`,{method:'POST',status:200,body:{resumeUrl:completed.resumeUrl}})).data;
  const callback=new URL(resumed.callbackUrl); assert.equal(callback.searchParams.get('state'),state);
  const device={key,publicJwk};
  const tokens=(await client(`${P}/oidc/token`,{method:'POST',status:200,
    headers:{dpop:await proof(device,f.origin+P+'/oidc/token')},form:{
      grant_type:'authorization_code',client_id:'test-native',redirect_uri:'com.example.weftmate:/callback',
      code:callback.searchParams.get('code'),code_verifier:verifier,
    }})).data;
  const jwks=(await f.api(`${P}/oidc/jwks`,{status:200})).data;
  const {payload}=await jwtVerify(tokens.access_token,createLocalJWKSet(jwks),{
    issuer:f.config.issuer,audience:f.config.audience,algorithms:['RS256'],typ:'at+jwt',
  });
  assert.equal(payload.device_verified,true); assert.equal(payload.sub,account.cloudAccountId);
  assert.equal(payload.device_id,deviceId); assert.ok(payload.cnf.jkt);
  assert.doesNotMatch(f.logs(),/account@example|access_token|refresh_token|验证码/);
  await f.offline();
});
