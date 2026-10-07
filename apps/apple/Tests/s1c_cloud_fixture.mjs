// Actual cloud main + actual isolated personal host. Only browser UI/mail and QR injection are automated.
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { createServer as tcpServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, createHash, createPrivateKey } from 'node:crypto';
import { promisify } from 'node:util';
import { createPersonalAccessService } from '../../../src/personal-access/index.mjs';
const run = promisify(execFile);
process.umask(0o077);
const root = await realpath(await mkdtemp(join(tmpdir(), 'wm-s1c-apple-')));
const cloudDir = join(root, 'cloud'); await mkdir(cloudDir);
async function port() { const s = tcpServer(); s.listen(0,'127.0.0.1'); await once(s,'listening'); const p=s.address().port; await new Promise(r=>s.close(r)); return p; }
const cloudPort = await port();
const cloudOrigin = `http://127.0.0.1:${cloudPort}`, P='/personal/v1/cloud';
const email = 's1c-synthetic@example.com', password = 'synthetic cloud password only';
const child = spawn(process.execPath,['services/cloud/src/main.mjs'],{cwd:resolve('.'), env:{...process.env,
  CLOUD_PORT:String(cloudPort),CLOUD_DATA_DIR:cloudDir,CLOUD_ISSUER:cloudOrigin+P+'/oidc',CLOUD_MAIL_TRANSPORT:'file',
  CLOUD_OIDC_CLIENTS:JSON.stringify([{client_id:'weftmate-apple',redirect_uris:['com.weftmate.apple:/oauth/callback']}])},stdio:['ignore','pipe','pipe']});
process.once('exit',()=>child.kill('SIGTERM'));
child.stdout.on('data',c=>process.stderr.write(c)); child.stderr.on('data',c=>process.stderr.write(c));
async function api(path,body,extra={},form=false) {
  const response = await fetch(cloudOrigin+path,{method:body===undefined?'GET':'POST',redirect:'manual',headers:{
    accept:'application/json',...(body===undefined?{}:{origin:cloudOrigin,'content-type':form?'application/x-www-form-urlencoded':'application/json'}),...extra},
    ...(body===undefined?{}:{body:form?new URLSearchParams(body):JSON.stringify(body)})});
  return {status:response.status,headers:response.headers,data:await response.json().catch(()=>({}))};
}
for(let i=0;i<100;i++){ try{if((await fetch(cloudOrigin+'/healthz')).ok)break;}catch{} await new Promise(r=>setTimeout(r,100)); }
async function code() {
  const files = await readdir(join(cloudDir,'mail-outbox'));
  const mails = await Promise.all(files.map(async f=>JSON.parse(await readFile(join(cloudDir,'mail-outbox',f),'utf8'))));
  // Filter by current challenge using its private test DB hash; avoids selecting an earlier OTP.
  return mails;
}
const { DatabaseSync } = await import('node:sqlite');
const { digest } = await import('../../../services/cloud/src/security.mjs');
const db = new DatabaseSync(join(cloudDir,'cloud.sqlite'));
async function challengeCode(id) {
  const challenge=db.prepare('SELECT * FROM email_challenges WHERE id=?').get(id);
  const keys=JSON.parse(await readFile(join(cloudDir,'identity-keys','keys.json'),'utf8'));
  for(const mail of await code()) {
    const otp=/验证码：(\d{6})/.exec(mail.text)?.[1];
    if(otp && digest(keys.cookieSecret,`${id}:${otp}`)===challenge.code_hash)return otp;
  }
  throw new Error('Synthetic mail missing');
}
const registration=await api(P+'/auth/register',{email,password});
if(registration.status!==201)throw new Error('Registration failed');
if((await api(P+'/auth/register/verify',{challengeId:registration.data.challengeId,code:await challengeCode(registration.data.challengeId)})).status!==200)throw new Error('Verification failed');
const stats={registered:true,emailVerified:true,cloudDeviceConfirmed:0,browserCallbacks:0,decisions:0};
async function authorize(url,publicJwk,deviceId) {
  const cookies=new Map();
  async function browser(url,body) {
    const target=new URL(url,cloudOrigin);
    if(target.origin!==cloudOrigin)throw new Error('Foreign browser origin');
    const response=await fetch(target,{method:body?'POST':'GET',redirect:'manual',headers:{accept:'application/json',cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),
      ...(body?{origin:cloudOrigin,'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    for(const raw of response.headers.getSetCookie()){const [kv]=raw.split(';'),i=kv.indexOf('=');cookies.set(kv.slice(0,i),kv.slice(i+1));}
    return {status:response.status,headers:response.headers,data:await response.json().catch(()=>({}))};
  }
  const initial=await browser(url); if(initial.status!==303)throw new Error('OIDC begin failed');
  const interaction=await browser(initial.headers.get('location'));
  const fields={interactionUid:interaction.data.interactionUid,csrfToken:interaction.data.csrfToken};
  let logged=await browser(P+'/auth/login',{...fields,email,password,deviceId,...(publicJwk?{publicJwk}:{})});
  if(logged.status===202){stats.cloudDeviceConfirmed++;logged=await browser(P+'/auth/device/confirm',{...fields,challengeId:logged.data.challengeId,code:await challengeCode(logged.data.challengeId)});}
  if(logged.status!==200)throw new Error('Cloud interaction failed');
  const resumed=await browser(logged.data.resumeUrl); if(resumed.status!==303)throw new Error('OIDC resume failed');
  const callback=resumed.headers.get('location'); if(new URL(callback).searchParams.has('error'))throw new Error('OIDC grant failed');
  stats.browserCallbacks++; return callback;
}
const verifier=randomBytes(32).toString('base64url');
const query=new URLSearchParams({client_id:'weftmate-apple',redirect_uri:'com.weftmate.apple:/oauth/callback',response_type:'code',scope:'openid offline_access cloud:account',
  prompt:'consent',state:'synthetic-bootstrap',nonce:'synthetic-bootstrap',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
const callback=await authorize(cloudOrigin+P+'/oidc/auth?'+query,undefined,'bootstrap-device');
const tokens=await api(P+'/oidc/token',{grant_type:'authorization_code',client_id:'weftmate-apple',redirect_uri:'com.weftmate.apple:/oauth/callback',code:new URL(callback).searchParams.get('code'),code_verifier:verifier},{},true);
if(tokens.status!==200)throw new Error('Bootstrap token failed');
const host=await createPersonalAccessService({root:join(root,'host'),port:0,cloudIdentity:{issuer:cloudOrigin+P+'/oidc',allowInsecureLoopback:true},backend:{
  getStatus:async()=>({runtime:'ready'}),listModels:async()=>[],preflight:async()=>({ok:true}),createSession:async()=>({}),sendMessage:async()=>({}),cancelSession:async()=>({}),
  describeSession:async id=>({sessionId:id,title:'Synthetic cloud conversation',running:false}),
  readEvents:async({afterSeq,beforeSeq})=>({events:afterSeq!==undefined&&afterSeq>=0||beforeSeq===0?[]:[{seq:0,type:'assistant.message',data:{text:'Synthetic cloud conversation ready'}}],
    nextSeq:afterSeq??0,hasMore:false,nextBeforeSeq:0,hasOlder:false,latestSeq:0})}});
const started=await host.start();
async function direct(path,body,auth) {
  const response=await fetch(started.origin+'/personal/v1'+path,{method:body===undefined?'GET':'POST',headers:{
    ...(body===undefined?{}:{origin:started.origin,'content-type':'application/json'}),...(auth?{cookie:auth.cookie,'x-weftmate-csrf':auth.csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
const setup=await direct('/auth/setup',{grant:(await host.issueSetupGrant()).grant,username:'synthetic-local',password:'synthetic local password only',deviceName:'Mac · bootstrap'});
const local={cookie:setup.cookie,csrfToken:setup.data.csrfToken};
const claim=await direct('/cloud/claims',{},local);
const binding=await direct('/cloud/binding',{claimId:claim.data.claimId,accessToken:tokens.data.access_token},local);
if(binding.status!==200)throw new Error('Binding failed');
await host.attachSession('session-synthetic-cloud');
const qrBinary=join(root,'qr-image'); await run('swiftc',['apps/apple/Tests/s1c_qr_image.swift','-o',qrBinary]);
// Real S2 P-256 content key with an isolated CA; private files never enter Git/system trust.
const identity=JSON.parse(await readFile(join(root,'host','cloud-identity','identity.json'),'utf8'));
const tlsDir=join(root,'tls');await mkdir(tlsDir);
const caKey=join(tlsDir,'ca-key.pem'),ca=join(tlsDir,'ca.pem');
await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',caKey,'-out',ca,'-days','2','-subj','/CN=S1c synthetic CA']);
await run('openssl',['x509','-in',ca,'-outform','der','-out',join(tlsDir,'ca.der')]);
const tlsServers=[];
async function tlsListener(privateJwk, listenerPort) {
  const stem=join(tlsDir,String(listenerPort));
  const key=createPrivateKey({key:privateJwk,format:'jwk'}).export({type:'pkcs8',format:'pem'});
  await writeFile(stem+'.key',key);
  await writeFile(stem+'.cnf','[req]\nprompt=no\ndistinguished_name=dn\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n');
  await run('openssl',['req','-new','-key',stem+'.key','-out',stem+'.csr','-config',stem+'.cnf']);
  await run('openssl',['x509','-req','-in',stem+'.csr','-CA',ca,'-CAkey',caKey,'-CAcreateserial','-out',stem+'.pem','-days','2','-extfile',stem+'.cnf','-extensions','ext']);
  const s=httpsServer({cert:await readFile(stem+'.pem'),key},(req,res)=>{res.writeHead(200);res.end('synthetic pinned content');});
  s.listen(listenerPort,'127.0.0.1');await once(s,'listening');tlsServers.push(s);
}
await tlsListener(identity.tls.privateJwk,18766);
const {generateKeyPair,exportJWK}=await import('../../../services/cloud/node_modules/jose/dist/webapi/index.js');
const foreign=await generateKeyPair('ES256',{extractable:true});await tlsListener(await exportJWK(foreign.privateKey),18767);
const driver=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    let data={}; if(req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c); data=JSON.parse(Buffer.concat(chunks));}
    let result;
    if(url.pathname==='/browser'){
      const publicJwk=data.publicJwk;
      const id='apple-'+createHash('sha256').update(JSON.stringify(publicJwk)).digest('hex').slice(0,20);
      result={callback:await authorize(data.authorizationURL,publicJwk,id)};
    } else if(url.pathname==='/pairing.png'){
      const pair=await direct('/cloud/pairings',{},local);
      const png=join(root,'pairing.png');
      await new Promise((resolve,reject)=>{const c=spawn(qrBinary,[png]);c.stdin.end(JSON.stringify(pair.data));c.once('exit',n=>n===0?resolve():reject(new Error('QR failed')));});
      res.writeHead(200,{'content-type':'image/png'});res.end(await readFile(png));return;
    } else if(url.pathname==='/pending'){result=(await direct('/cloud/devices/pending',undefined,local)).data;}
    else if(url.pathname==='/decision'){
      const pending=await direct('/cloud/devices/pending',undefined,local);
      const device=pending.data.devices.at(-1);if(!device)throw new Error('No pending device');
      result=(await direct(`/cloud/devices/${device.id}/decision`,{decision:data.decision??'allow'},local)).data;stats.decisions++;
    } else if(url.pathname==='/tls-fixture'){result={pin:identity.tls.spki,ca:(await readFile(join(tlsDir,'ca.der'))).toString('base64')};}
    else if(url.pathname==='/report'){result={...stats,pending:(await direct('/cloud/devices/pending',undefined,local)).data.devices.length};}
    else if(url.pathname==='/ready'){result={cloud:cloudOrigin,host:started.origin,hostId:started.hostId};}
    else throw new Error('Unknown fixture route');
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));
  } catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'FIXTURE_FAILED'}));process.stderr.write(error.message+'\n');}
});
driver.listen(Number(process.env.S1C_DRIVER_PORT??18765),'127.0.0.1');await once(driver,'listening');
const driverOrigin=`http://127.0.0.1:${driver.address().port}`;
await writeFile(resolve(process.argv[2]??'apps/apple/Build/s1c-ready.json'),JSON.stringify({root,cloud:cloudOrigin,host:started.origin,driver:driverOrigin}));
console.log('S1c isolated fixture ready');
async function close(){await host.close();driver.close();for(const s of tlsServers)s.close();db.close();child.kill('SIGTERM');}
process.once('SIGTERM',()=>{close().then(()=>process.exit());});process.once('SIGINT',()=>{close().then(()=>process.exit());});
