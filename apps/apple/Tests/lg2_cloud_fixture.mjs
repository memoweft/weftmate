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
const child = spawn(process.execPath, ['services/cloud/src/main.mjs'], { cwd: resolve('.'), env: { ...process.env,
    CLOUD_PORT: new URL(cloudOrigin).port, CLOUD_DATA_DIR: cloudDir, CLOUD_ISSUER: cloudOrigin+P+'/oidc', CLOUD_MAIL_TRANSPORT:'file',
    CLOUD_OIDC_CLIENTS: JSON.stringify([{client_id:'weftmate-apple',redirect_uris:['com.weftmate.apple:/oauth/callback']}]) }, stdio:['ignore','ignore','pipe'] });
child.stderr.on('data', () => {});
for(let i=0;i<100;i++){try{if((await fetch(cloudOrigin+'/healthz')).ok)break;}catch{} await new Promise(r=>setTimeout(r,100));}
const { DatabaseSync } = await import('node:sqlite');
const { digest } = await import('../../../services/cloud/src/security.mjs');
const db = new DatabaseSync(join(cloudDir,'cloud.sqlite'));
async function mailCode(id) {
    const challenge = db.prepare('SELECT * FROM email_challenges WHERE id=?').get(id);
    const keys = JSON.parse(await readFile(join(cloudDir,'identity-keys','keys.json'),'utf8'));
    for(const f of await readdir(join(cloudDir,'mail-outbox'))) {
        const mail = JSON.parse(await readFile(join(cloudDir,'mail-outbox',f),'utf8'));
        const otp = /验证码：(\d{6})/.exec(mail.text)?.[1];
        if(otp && digest(keys.cookieSecret,`${id}:${otp}`)===challenge.code_hash)return otp;
    }
    throw new Error('Synthetic mail not found');
}
const host = await createPersonalAccessService({root:join(root,'host'),port:0,cloudIdentity:{issuer:cloudOrigin+P+'/oidc',allowInsecureLoopback:true},backend:{
    getStatus:async()=>({runtime:'ready'}),listModels:async()=>[],preflight:async()=>({ok:true}),createSession:async()=>({}),sendMessage:async()=>({}),cancelSession:async()=>({}),
    describeSession:async()=>null, readEvents:async()=>({events:[],nextSeq:-1,hasMore:false})}});
const started = await host.start();
const key = await generateKeyPair('ES256'), publicJwk = await exportJWK(key.publicKey);
const sha = v => createHash('sha256').update(v).digest('base64url');
async function proof(url, accessToken, nonce) { return new SignJWT({htu:url,htm:'POST',...(accessToken?{ath:sha(accessToken)}:{}),...(nonce?{nonce}:{})})
    .setProtectedHeader({typ:'dpop+jwt',alg:'ES256',jwk:publicJwk}).setIssuedAt().setJti(randomUUID()).sign(key.privateKey); }
let local, desktopTokens;
async function desktopLogin() {
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
    const started=await api('/auth/authorization',{clientId:'weftmate-apple',redirectUri:'com.weftmate.apple:/oauth/callback',deviceId:'lg2-computer',publicJwk,codeChallenge:sha(verifier),state,nonce});
    const fields={interactionUid:started.data.interactionUid,csrfToken:started.data.csrfToken};
    let login=await api('/auth/login',{...fields,email,password,deviceId:'lg2-computer',publicJwk,deviceName:'LG2 测试电脑',deviceType:'macos'});
    if(login.status===202)login=await api('/auth/device/confirm',{...fields,challengeId:login.data.challengeId,code:await mailCode(login.data.challengeId)});
    const resumed=await api('/auth/authorization/resume',{resumeUrl:login.data.resumeUrl});
    desktopTokens=(await api('/oidc/token',{grant_type:'authorization_code',client_id:'weftmate-apple',redirect_uri:'com.weftmate.apple:/oauth/callback',code:new URL(resumed.data.callbackUrl).searchParams.get('code'),code_verifier:verifier},{dpop:await proof(cloudOrigin+P+'/oidc/token')},true)).data;
}
async function direct(path,body,auth=local,headers={}) {
    const response = await fetch(started.origin+'/personal/v1'+path,{method:body===undefined?'GET':'POST',headers:{origin:started.origin,
        ...(body===undefined?{}:{'content-type':'application/json'}),...(auth?{cookie:auth.cookie,'x-weftmate-csrf':auth.csrfToken}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data=await response.json();return {...data,status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
const qrBinary=join(root,'qr'); await run('swiftc',['apps/apple/Tests/s1c_qr_image.swift','-o',qrBinary]);
const driver = createServer(async(req,res)=>{
    try {
        const path=new URL(req.url,'http://127.0.0.1').pathname;
        let result;
        if(path==='/credentials')result={email,password,nextPassword};
        else if(path==='/ready')result={cloud:cloudOrigin,host:started.origin,hostId:started.hostId,computerDeviceId:'lg2-computer'};
        else if(path==='/code'){
            const challenge=db.prepare("SELECT id FROM email_challenges WHERE consumed=0 ORDER BY rowid DESC LIMIT 1").get();
            result={code:await mailCode(challenge.id)};
        } else if(path==='/bootstrap'){
            await desktopLogin();
            const nonce=await direct('/auth/cloud-nonce',{},null);
            local=await direct('/auth/cloud-desktop',{accessToken:desktopTokens.access_token,deviceName:'LG2 测试电脑'},null,
                {dpop:await proof(started.origin+'/personal/v1/auth/cloud-desktop',desktopTokens.access_token,nonce.nonce)});
            if(local.status!==200)throw new Error('desktop binding failed');
            await host.syncCloudRevocations(); result={ok:true};
        } else if(path==='/pairing.png'){
            const pair=await direct('/cloud/pairings',{}); const png=join(root,'pair.png');
            await new Promise((resolve,reject)=>{const proc=spawn(qrBinary,[png]);proc.stdin.end('wm1.'+Buffer.from(JSON.stringify(pair)).toString('base64url'));proc.once('exit',c=>c===0?resolve():reject(new Error('QR failed')));});
            res.writeHead(200,{'content-type':'image/png'});res.end(await readFile(png));return;
        } else if(path==='/approve'){
            const pending=await direct('/cloud/devices/pending');const device=pending.devices.at(-1);
            if(!device)throw new Error('No pending device');
            const decision=await direct(`/cloud/devices/${device.id}/decision`,{decision:'allow'});
            if(decision.status!==200)throw new Error('Decision failed');
            await host.syncCloudRevocations();result={ok:true};
        } else if(path==='/pending'){result=await direct('/cloud/devices/pending');}
        else throw new Error('Unknown driver route');
        res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));
    } catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'FIXTURE_FAILED'}));process.stderr.write(error.message+'\n');}
});
driver.listen(0,'127.0.0.1');await once(driver,'listening');
console.log(JSON.stringify({root,driver:`http://127.0.0.1:${driver.address().port}`}));
async function close(){await host.close();await new Promise(r=>driver.close(r));db.close();child.kill('SIGTERM');await once(child,'exit');await rm(root,{recursive:true,force:true});}
process.once('SIGTERM',()=>close().then(()=>process.exit()));process.once('SIGINT',()=>close().then(()=>process.exit()));
