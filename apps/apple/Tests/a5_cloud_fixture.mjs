// Real cloud main and isolated personal host. Credentials live only in this process and test memory.
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { createPersonalAccessService } from '../../../src/personal-access/index.mjs';
import { generateKeyPair, exportJWK, SignJWT } from '../../../services/cloud/node_modules/jose/dist/webapi/index.js';
import { syntheticBackend } from './a5_synthetic_backend.mjs';
import { createBackupManager } from '../../../src/personal-backup/index.mjs';
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
const profile = join(root, 'profile');
const synthetic = syntheticBackend(profile);
const scheduleCalls = [], reminderRows = new Map();
// The runtime remains explicitly synthetic; the personal HTTP authorization and projection are real.
synthetic.backend.schedules = async ({sessionId, action, id}) => {
    scheduleCalls.push({sessionId, action, id});
    if (action === 'notifications') return {items:[]};
    const rows = reminderRows.get(sessionId) ?? [];
    if (action === 'list') return {items:rows};
    const row = rows.find(row => row.id === id);
    if (!row) throw Object.assign(new Error('Missing synthetic reminder'), {code:'NOT_FOUND'});
    if (action === 'pause') { row.state='paused';row.nextRunAt=null; }
    if (action === 'resume') { row.state='scheduled';row.nextRunAt='2050-10-08T20:00:00Z'; }
    if (action === 'delete') reminderRows.set(sessionId,rows.filter(row=>row.id!==id));
    return {ok:true};
};
const systemManager = {
    status:async()=>({model:{state:'ready',version:'合成夹具',lastError:null,canRestart:true},host:{state:'ready',version:'合成夹具',lastError:null,canRestart:true},memory:{state:'disabled',version:null,lastError:null,canRestart:false},queue:{backgroundPending:0},canRestart:true}),
    restart:async()=>{},
};
const backupManager = await createBackupManager({root:profile,isIdle:async()=>![...synthetic.sessions.values()].some(row=>row.running),requestRestart:()=>{},appVersion:'a6-synthetic'});
const host = await createPersonalAccessService({root:join(profile,'personal-access'),port:0,cloudIdentity:{issuer:cloudOrigin+P+'/oidc',allowInsecureLoopback:true},backend:synthetic.backend,memoryManager:synthetic.memoryManager,systemManager,backupManager});
synthetic.attach(host);
const started = await host.start();
await backupManager.started();
const key = await generateKeyPair('ES256'), publicJwk = await exportJWK(key.publicKey);
const sha = v => createHash('sha256').update(v).digest('base64url');
async function proof(url, accessToken, nonce) { return new SignJWT({htu:url,htm:'POST',...(accessToken?{ath:sha(accessToken)}:{}),...(nonce?{nonce}:{})})
    .setProtectedHeader({typ:'dpop+jwt',alg:'ES256',jwk:publicJwk}).setIssuedAt().setJti(randomUUID()).sign(key.privateKey); }
let local, desktopTokens, ids;
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
const ticker=setInterval(()=>synthetic.consumeApprovals().catch(error=>process.stderr.write(error.message+'\n')),200);
const driver = createServer(async(req,res)=>{
    try {
        const path=new URL(req.url,'http://127.0.0.1').pathname;
        let result;
        if(path==='/credentials')result={email,password,nextPassword};
        else if(path==='/a5/setup'){
            let registered=await fetch(cloudOrigin+P+'/auth/register',{method:'POST',headers:{origin:cloudOrigin,'content-type':'application/json'},body:JSON.stringify({email,password})});
            const data=await registered.json();
            const verified=await fetch(cloudOrigin+P+'/auth/register/verify',{method:'POST',headers:{origin:cloudOrigin,'content-type':'application/json'},body:JSON.stringify({challengeId:data.challengeId,code:await mailCode(data.challengeId)})});
            if(!verified.ok)throw Error('Synthetic registration failed');result={ok:true};
        }
        else if(path==='/ready')result={cloud:cloudOrigin,host:started.origin,hostId:started.hostId,computerDeviceId:'lg2-computer'};
        else if(path==='/code'){
            const challenge=db.prepare("SELECT id FROM email_challenges WHERE consumed=0 ORDER BY rowid DESC LIMIT 1").get();
            result={code:await mailCode(challenge.id)};
        } else if(path==='/bootstrap'){
            await desktopLogin();
            const grant=await host.issueSetupGrant();
            local=await direct('/auth/setup',{grant:grant.grant,username:'a5-tester',password:'synthetic-test-only',deviceName:'合成测试电脑'},null);
            if(local.status!==201)throw Error('Synthetic local setup failed');
            const claim=await direct('/cloud/claims',{});
            const binding=await direct('/cloud/binding',{claimId:claim.claimId,accessToken:desktopTokens.access_token});
            if(binding.status!==200)throw Error('Synthetic cloud binding failed');
            await host.syncCloudRevocations();
            ids=await synthetic.seed(direct,started.hostId);
            reminderRows.set(ids.review,[{id:'a6-reminder',nativeId:'synthetic-native',text:'合成提醒：检查本周计划',kind:'reminder',timeZone:'America/Los_Angeles',repeat:null,state:'scheduled',nextRunAt:'2050-10-08T20:00:00Z',lastRunAt:null,approvalMode:'auto'}]);
            result={ok:true};
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
        else if(path==='/a5/deny'){result=await synthetic.addApproval();}
        else if(path==='/a5/ids'){result=ids;}
        else if(path==='/a6/settings-report'){result={schedules:scheduleCalls,backups:await direct('/backups'),system:await direct('/system')};}
        else if(path==='/a5/report'){result={operations:synthetic.operations,memoryDeletes:synthetic.memoryDeletes,approvalState:await direct('/sessions/'+ids.review+'/approvals'),approvalReasons:Object.values(JSON.parse(await readFile(join(profile,'personal-access','store.json'),'utf8')).accounts).flatMap(account=>Object.values(account.commands).flatMap(command=>(command.toolApprovals??[]).map(row=>({status:row.status,reasonCode:row.invalidationReason,taskId:row.taskId})))),usage:await direct('/usage'),sessions:await direct('/sessions?archived=all'),ids,workspaceExists:Object.fromEntries(await Promise.all(Object.entries(ids??{}).map(async([name,id])=>[name,await access(join(profile,'workspaces',id)).then(()=>true,()=>false)])))};}
        else if(path==='/a5/complete'){const s=synthetic.sessions.get(ids.queue);synthetic.finish(s);result={ok:true};}
        else if(path==='/a5/review-login'){
            if(!local)throw Error('Bootstrap first');
            result={username:local.account.username};
        }
        else if(path==='/a5/usage-warning'){
            const cost=(await direct('/usage')).total.cost;
            const response=await fetch(started.origin+'/personal/v1/settings/usage',{method:'PATCH',headers:{origin:started.origin,'content-type':'application/json',cookie:local.cookie,'x-weftmate-csrf':local.csrfToken},body:JSON.stringify({monthlyLimit:cost/0.85})});result=await response.json();
        }
        else if(path==='/a5/usage-blocked'){
            const response=await fetch(started.origin+'/personal/v1/settings/usage',{method:'PATCH',headers:{origin:started.origin,'content-type':'application/json',cookie:local.cookie,'x-weftmate-csrf':local.csrfToken},body:JSON.stringify({monthlyLimit:0,temporaryLimit:null})});result=await response.json();
        }
        else if(path==='/a5/refused'){
            result=await direct('/commands',{requestId:'a5-block-'+randomUUID(),kind:'session.message',targetDeviceId:started.hostId,sessionId:ids.queue,text:'被上限拦截的合成请求'});
        }
        else throw new Error('Unknown driver route');
        res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));
    } catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'FIXTURE_FAILED'}));process.stderr.write(error.message+'\n');}
});
driver.listen(0,'127.0.0.1');await once(driver,'listening');
console.log(JSON.stringify({root,driver:`http://127.0.0.1:${driver.address().port}`}));
async function close(){clearInterval(ticker);await backupManager.stopOnline();await host.close();await new Promise(r=>driver.close(r));db.close();child.kill('SIGTERM');await once(child,'exit');await rm(root,{recursive:true,force:true});}
process.once('SIGTERM',()=>close().then(()=>process.exit()));process.once('SIGINT',()=>close().then(()=>process.exit()));
