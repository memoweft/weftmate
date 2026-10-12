// Real cloud main and isolated personal host. Credentials live only in this process and test memory.
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { syntheticBackend } from './a5_synthetic_backend.mjs';
import { createPersonalAccessService } from '../../../src/personal-access/index.mjs';
import { generateKeyPair, exportJWK, SignJWT } from '../../../services/cloud/node_modules/jose/dist/webapi/index.js';
process.umask(0o077);
const run = promisify(execFile), P = '/personal/v1/cloud';
const root = await realpath(await mkdtemp(join(tmpdir(), 'wm-lg2-')));
const cloudDir = join(root, 'cloud'); await mkdir(cloudDir);
const password = randomBytes(24).toString('base64url'), nextPassword = randomBytes(24).toString('base64url');
const email = 'lg2-synthetic@example.com';
async function port() { const s = tcpServer(); s.listen(0,'127.0.0.1'); await once(s,'listening'); const p=s.address().port; await new Promise(r=>s.close(r)); return p; }
const cloudOrigin = `http://127.0.0.1:${await port()}`;
const internalPort = await port();
let hostOrigin, computerOffline = false;
// Synthetic routing replaces only the relay address. Cloud login, provider, DPoP,
// file mail and host exchange remain real. No production relay is contacted.
const cloudProxy = createServer(async (req, res) => {
    try {
    const body = []; for await (const part of req) body.push(part);
    const reply = await fetch(`http://127.0.0.1:${internalPort}${req.url}`, {method:req.method,redirect:'manual',
        headers:{...req.headers,'x-forwarded-host':new URL(cloudOrigin).host,'x-forwarded-proto':'http'}, ...(body.length ? {body:Buffer.concat(body)} : {})});
    let bytes = Buffer.from(await reply.arrayBuffer());
    if (req.url === P + '/hosts/connect' && reply.ok) {
        const value = JSON.parse(bytes); value.baseUrl = computerOffline ? null : hostOrigin;
        value.status = computerOffline ? 'offline' : 'online'; bytes = Buffer.from(JSON.stringify(value));
    }
    const headers = Object.fromEntries([...reply.headers].filter(([k])=>!['content-length','content-encoding','transfer-encoding','set-cookie'].includes(k)));
    const cookies = reply.headers.getSetCookie(); if(cookies.length)headers['set-cookie']=cookies;
    res.writeHead(reply.status,headers);res.end(bytes);
    } catch { res.writeHead(503);res.end(); }
});
cloudProxy.listen(Number(new URL(cloudOrigin).port),'127.0.0.1');await once(cloudProxy,'listening');
const child = spawn(process.execPath, ['services/cloud/src/main.mjs'], { cwd: resolve('.'), env: { ...process.env,
    CLOUD_TRUST_PROXY:'true', CLOUD_PORT: String(internalPort), CLOUD_DATA_DIR: cloudDir, CLOUD_ISSUER: cloudOrigin+P+'/oidc', CLOUD_MAIL_TRANSPORT:'file',
    CLOUD_OIDC_CLIENTS: JSON.stringify([{client_id:'weftmate-apple',redirect_uris:['com.weftmate.apple:/oauth/callback']}]) }, stdio:['ignore','ignore','pipe'] });
child.stderr.on('data', () => {});
for(let i=0;i<100;i++){try{if((await fetch(cloudOrigin+'/healthz')).ok)break;}catch{} await new Promise(r=>setTimeout(r,100));}
const { DatabaseSync } = await import('node:sqlite');
const { digest } = await import('../../../services/cloud/src/security.mjs');
const db = new DatabaseSync(join(cloudDir,'cloud.sqlite'));
async function mailCode(id) {
    for (let attempt=0;attempt<100;attempt++) {
        const challenge = db.prepare('SELECT * FROM email_challenges WHERE id=?').get(id);
        const keys = JSON.parse(await readFile(join(cloudDir,'identity-keys','keys.json'),'utf8'));
        for(const f of await readdir(join(cloudDir,'mail-outbox'))) {
            const mail = JSON.parse(await readFile(join(cloudDir,'mail-outbox',f),'utf8'));
            const otp = /验证码：(\d{6})/.exec(mail.text)?.[1];
            if(otp && digest(keys.cookieSecret,`${id}:${otp}`)===challenge.code_hash)return otp;
        }
        await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error('Synthetic mail not found');
}

const synthetic = syntheticBackend(root);
const host = await createPersonalAccessService({root:join(root,'host'),port:0,cloudIdentity:{issuer:cloudOrigin+P+'/oidc',allowInsecureLoopback:true},backend:synthetic.backend});
synthetic.attach(host);
const started = await host.start(); hostOrigin = started.origin;
const key = await generateKeyPair('ES256'), publicJwk = await exportJWK(key.publicKey);
const sha = v => createHash('sha256').update(v).digest('base64url');
async function proof(url, accessToken, nonce, signingKey=key.privateKey, jwk=publicJwk) { return new SignJWT({htu:url,htm:'POST',...(accessToken?{ath:sha(accessToken)}:{}),...(nonce?{nonce}:{})})
    .setProtectedHeader({typ:'dpop+jwt',alg:'ES256',jwk}).setIssuedAt().setJti(randomUUID()).sign(signingKey); }
let local, desktopTokens;
async function desktopLogin(deviceId='lg2-computer', signingKey=key.privateKey, deviceJwk=publicJwk) {
    const jar = new Map();
    async function api(path,body,headers={},form=false) {
        const response = await fetch(cloudOrigin+P+path,{method:'POST',redirect:'manual',headers:{origin:cloudOrigin,
            'content-type':form?'application/x-www-form-urlencoded':'application/json',cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...headers},
            body:form?new URLSearchParams(body):JSON.stringify(body)});
        for(const raw of response.headers.getSetCookie()){const kv=raw.split(';')[0],i=kv.indexOf('=');jar.set(kv.slice(0,i),kv.slice(i+1));}
        const data = await response.json(); if(response.status>=400)throw new Error(`desktop ${path} ${data.error?.code??data.error}`);
        return {status:response.status,data};
    }
    const verifier=randomBytes(32).toString('base64url'),state=randomUUID(),nonce=randomUUID();
    const started=await api('/auth/authorization',{clientId:'weftmate-apple',redirectUri:'com.weftmate.apple:/oauth/callback',deviceId,publicJwk:deviceJwk,codeChallenge:sha(verifier),state,nonce});
    const fields={interactionUid:started.data.interactionUid,csrfToken:started.data.csrfToken};
    let login=await api('/auth/login',{...fields,email,password,deviceId,publicJwk:deviceJwk,deviceName:deviceId==='lg2-computer'?'合成测试电脑':'合成新手机',deviceType:deviceId==='lg2-computer'?'macos':'ios'});
    if(login.status===202)login=await api('/auth/device/confirm',{...fields,challengeId:login.data.challengeId,code:await mailCode(login.data.challengeId)});
    const resumed=await api('/auth/authorization/resume',{resumeUrl:login.data.resumeUrl});
    desktopTokens=(await api('/oidc/token',{grant_type:'authorization_code',client_id:'weftmate-apple',redirect_uri:'com.weftmate.apple:/oauth/callback',code:new URL(resumed.data.callbackUrl).searchParams.get('code'),code_verifier:verifier},{dpop:await proof(cloudOrigin+P+'/oidc/token',undefined,undefined,signingKey,deviceJwk)},true)).data;
}
async function direct(path,body,auth=local,headers={}) {
    const response = await fetch(started.origin+'/personal/v1'+path,{method:body===undefined?'GET':'POST',headers:{origin:started.origin,
        ...(body===undefined?{}:{'content-type':'application/json'}),...(auth?{cookie:auth.cookie,'x-weftmate-csrf':auth.csrfToken,'x-weftmate-desktop':host.libraryDesktopToken}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data=await response.json();return {...data,status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0] ?? auth?.cookie};
}
async function cloudJSON(path, body) {
    const response = await fetch(cloudOrigin+P+path,{method:'POST',headers:{origin:cloudOrigin,'content-type':'application/json'},body:JSON.stringify(body)});
    const value=await response.json();if(!response.ok)throw new Error('Synthetic account setup failed: '+response.status+' '+JSON.stringify(value));return value;
}
const registration=await cloudJSON('/auth/registration/request',{email});
const verified=await cloudJSON('/auth/registration/verify',{challengeId:registration.challengeId,code:await mailCode(registration.challengeId)});
await cloudJSON('/auth/registration/complete',{passwordTicket:verified.passwordTicket,password});
await desktopLogin();
local=await direct('/auth/desktop',{deviceName:'合成测试电脑'},null,{'x-weftmate-desktop':host.libraryDesktopToken});
const bindingNonce=await direct('/auth/cloud-nonce',{},null);
local=await direct('/auth/cloud-desktop',{accessToken:desktopTokens.access_token,deviceName:'合成测试电脑'},local,
    {'x-weftmate-desktop':host.libraryDesktopToken,dpop:await proof(started.origin+'/personal/v1/auth/cloud-desktop',desktopTokens.access_token,bindingNonce.nonce)});
if(local.status!==200)throw new Error('Synthetic desktop binding failed');
const localCheck=await direct('/auth/devices');
if(localCheck.status!==200)throw new Error('Synthetic retained desktop session invalid '+localCheck.status+' '+(localCheck.error?.code??''));
await host.syncCloudRevocations();
await synthetic.backend.createSession({sessionId:'session-apple2-cache',ownerId:started.ownerId});
await host.attachSession('session-apple2-cache');
await synthetic.backend.sendMessage({sessionId:'session-apple2-cache',text:'这是一条已保存在手机上的合成内容。',mode:'queue'});

const driver = createServer(async(req,res)=>{
    try {
        const path=new URL(req.url,'http://127.0.0.1').pathname;
        let result;
        if(path==='/credentials')result={email,password,nextPassword};
        else if(path==='/ready')result={cloud:cloudOrigin,host:started.origin,hostId:started.hostId,computerDeviceId:'lg2-computer'};
        else if(path==='/code'){
            let challenge;
            for(let attempt=0;attempt<100;attempt++) {
                challenge=db.prepare("SELECT id FROM email_challenges WHERE consumed=0 ORDER BY rowid DESC LIMIT 1").get();
                if(challenge)break;
                await new Promise(resolve=>setTimeout(resolve,50));
            }
            if(!challenge)throw new Error('No pending synthetic mail challenge');
            result={code:await mailCode(challenge.id)};
        } else if(path==='/offline'){computerOffline=true;result={ok:true};}
        else if(path==='/online'){computerOffline=false;result={ok:true};}
        else if(path==='/expire-code'){
            db.prepare('UPDATE email_challenges SET expires_at=0 WHERE consumed=0').run();result={ok:true};
        } else if(path==='/new-device'){
            // A second verified cloud device, same synthetic mailbox and fresh key.
            const other=await generateKeyPair('ES256');
            await desktopLogin('synthetic-new-phone',other.privateKey,await exportJWK(other.publicKey));
            result={ok:true};
        } else if(path==='/expire-session'){
            const list=await direct('/auth/devices');
            if(list.status!==200)throw new Error('Synthetic device listing failed '+list.status+' '+(list.error?.code??''));
            const target=list.devices.filter(d=>d.cloudDeviceId?.startsWith('apple-')).at(-1);
            if(!target)throw new Error('No synthetic phone session');
            const r=await fetch(started.origin+'/personal/v1/auth/devices/'+target.id,{method:'DELETE',headers:{origin:started.origin,cookie:local.cookie,'x-weftmate-csrf':local.csrfToken,'x-weftmate-desktop':host.libraryDesktopToken,'content-type':'application/json'},body:'{}'});
            if(!r.ok)throw new Error('Synthetic session revoke failed');result={ok:true};
        } else if(path==='/report'){result={realCloud:true,fileMail:true,realHost:true,syntheticRelayRoute:true};}
        else throw new Error('Unknown driver route');
        res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));
    } catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'FIXTURE_FAILED'}));process.stderr.write(error.message+'\n');}
});
driver.listen(0,'127.0.0.1');await once(driver,'listening');
console.log(JSON.stringify({root,driver:`http://127.0.0.1:${driver.address().port}`}));
async function close(){await host.close();await new Promise(r=>driver.close(r));await new Promise(r=>cloudProxy.close(r));db.close();child.kill('SIGTERM');await once(child,'exit');await rm(root,{recursive:true,force:true});}
process.once('SIGTERM',()=>close().then(()=>process.exit()));process.once('SIGINT',()=>close().then(()=>process.exit()));
