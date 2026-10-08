import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import { fixture, P, EMAIL, PASSWORD, NEXT_PASSWORD } from './identity-helpers.mjs';
import { registration, appDevice, control, refresh, hostFixture } from './app-helpers.mjs';
import { pruneEphemeral } from '../src/maintenance.mjs';

async function change(f, device, email) {
  const challenge = (await control(device, '/auth/email/change/request', { email })).data;
  return { challengeId: challenge.challengeId, code: await f.mailCode(challenge.challengeId) };
}

test('email change requires DPoP, verifies once within ten minutes, rejects occupied addresses and notifies old email', async t => {
  const f = await fixture(t); const { account } = await registration(f);
  await registration(f, 'taken@example.com');
  const desktop = await appDevice(f, 'desktop'), stranger = await appDevice(f, 'stranger', 'taken@example.com');
  await desktop.client(`${P}/auth/email/change/request`, { method: 'POST', body: { email: 'new@example.com' },
    headers: { authorization: `Bearer ${desktop.tokens.access_token}` }, status: 401 });
  await control(desktop, '/auth/email/change/request', { email: 'taken@example.com' }, 409);
  const expired = await change(f, desktop, 'expired@example.com');
  f.advance(600000);
  await control(desktop, '/auth/email/change/confirm', expired, 400);
  const next = await change(f, desktop, 'new@example.com');
  await control(stranger, '/auth/email/change/confirm', next, 403);
  await control(desktop, '/auth/email/change/confirm', { ...next, code: 'bad' }, 400);
  const changed = (await control(desktop, '/auth/email/change/confirm', next)).data;
  assert.equal(changed.account.cloudAccountId, account.cloudAccountId);
  assert.equal(changed.account.email, 'new@example.com'); assert.equal(changed.notificationAccepted, true);
  await control(desktop, '/devices', undefined, 401); await refresh(desktop, undefined, 400);
  f.advance(3600001);
  const again = await appDevice(f, 'again', 'new@example.com');
  await control(again, '/auth/email/change/confirm', next, 400);
  const mails = await Promise.all((await readdir(f.config.mailDir)).map(n => readFile(join(f.config.mailDir,n),'utf8').then(JSON.parse)));
  assert.equal(mails.filter(m => m.to === EMAIL && m.subject === 'WeftMate 邮箱已更改').length, 1);
});

test('email availability is checked again on confirmation and mail failure preserves committed change', async t => {
  const f = await fixture(t); await registration(f);
  const desktop = await appDevice(f, 'desktop');
  const pending = await change(f, desktop, 'race@example.com');
  await registration(f, 'race@example.com');
  await control(desktop, '/auth/email/change/confirm', pending, 409);
  const next = await change(f, desktop, 'new@example.com');
  f.identity.accounts.mailer = { send: async () => { throw new Error('mail unavailable'); } };
  const result = (await control(desktop, '/auth/email/change/confirm', next)).data;
  assert.equal(result.notificationAccepted, false); assert.equal(result.account.email, 'new@example.com');
});

test('rename is account scoped; logout others revokes every other key while current cloud and host sessions stay valid', async t => {
  const f = await fixture(t); await registration(f); await registration(f, 'other@example.com');
  const a = await appDevice(f,'desktop'), b = await appDevice(f,'phone'), other = await appDevice(f,'stranger','other@example.com');
  const { host, hostApi, exchange } = await hostFixture(f,t);
  const local = await exchange(a,'/auth/cloud-desktop'); assert.equal(local.status,200);
  await host.syncCloudRevocations();
  const phone = await exchange(b,'/auth/cloud-desktop'); assert.equal(phone.status,202);
  await hostApi(`/cloud/devices/${phone.requestId}/decision`,{decision:'allow'},local);
  const remote = await exchange(b,'/auth/cloud-desktop'); assert.equal(remote.status,200);
  await host.syncCloudRevocations();
  await control(other,'/devices/rename',{deviceId:'desktop',name:'Stolen'},404);
  await control(a,'/devices/rename',{deviceId:'desktop',name:' Work computer '});
  assert.equal((await control(a,'/devices')).data.devices.find(d=>d.isCurrent).name,'Work computer');
  await control(a,'/devices/rename',{deviceId:'phone',name:''},400);
  assert.equal((await control(a,'/auth/logout/others',{})).data.revokedDevices,1);
  await refresh(b,undefined,400); await control(b,'/devices',undefined,401);
  await refresh(a); await refresh(other);
  await host.syncCloudRevocations();
  assert.equal((await control(a,'/devices')).data.hosts[0].name,'Work computer');
  assert.equal((await hostApi('/sessions',undefined,remote)).status,401);
  assert.equal((await hostApi('/sessions',undefined,local)).status,200);
  assert.equal((await control(a,'/auth/logout/others',{})).data.revokedDevices,0);
});

test('account deletion wipes every account table, closes live relay pipes, invalidates tokens, preserves other accounts and permits re-registration', {timeout:90000}, async t => {
  const pipes=new Set();
  const echo = createServer(s=>{pipes.add(s); s.on('close',()=>pipes.delete(s)); s.pipe(s);}); echo.listen(0,'127.0.0.1'); await once(echo,'listening');
  t.after(()=>{for(const s of pipes)s.destroy(); return new Promise(resolve=>echo.close(resolve));});
  const f = await fixture(t,{env:{CLOUD_RELAY_DOMAIN:'hosts.example.com',CLOUD_RELAY_FRPS_PORT:String(echo.address().port)},
    relayDns:db=>({cleanup:async({name,value})=>db.prepare('DELETE FROM relay_dns_records WHERE name=? AND value=?').run(name,value)})});
  const { account } = await registration(f); await registration(f,'other@example.com');
  const desktop = await appDevice(f,'desktop'), phone = await appDevice(f,'phone'), other = await appDevice(f,'stranger','other@example.com');
  const { host, started, exchange } = await hostFixture(f,t);
  assert.equal((await exchange(desktop,'/auth/cloud-desktop')).status,200); await host.syncCloudRevocations();
  const row = f.db.prepare('SELECT * FROM cloud_hosts WHERE host_id=?').get(started.hostId); assert.ok(row);
  const relay = f.identity.relay;
  const credential = await relay.hostRequest('/hosts/relay/credentials',started.hostId,{});
  f.db.prepare('INSERT INTO relay_dns_records VALUES(?,?,?)').run(`_acme-challenge.${new URL(credential.baseUrl).hostname}`,'challenge-value','fixture-record');
  const ownerClaim=f.db.prepare('SELECT * FROM host_claims WHERE host_id=?').get(started.hostId);
  const member=f.db.prepare('SELECT id FROM cloud_accounts WHERE email=?').get('other@example.com').id;
  f.db.prepare('INSERT INTO host_claims VALUES(?,?,?,?,?,?,?,?,?)').run('shared-claim',started.hostId,ownerClaim.public_jwk,ownerClaim.jkt,ownerClaim.tls_spki,'challenge',Date.now()+600000,member,'active');
  f.db.prepare('INSERT INTO host_memberships VALUES(?,?,?,?)').run(started.hostId,member,'member','shared-claim');
  const addresses=[]; echo.on('connection',s=>addresses.push(`${s.remoteAddress}:${s.remotePort}`));
  relay.control.server.listen(0,'127.0.0.1'); await once(relay.control.server,'listening');
  const socket = connect(relay.control.server.address().port,'127.0.0.1'); socket.on('error',()=>{});
  await once(socket,'connect'); socket.write('opaque'); await once(socket,'data');
  relay.plugin('Login',{user:started.hostId,metas:{credential:credential.credential},client_address:addresses[0]});
  // Seed an account-bound pending provider interaction and a password ticket.
  const uid='pending-deletion';
  f.db.prepare('INSERT INTO interaction_forms VALUES(?,?,?)').run(uid,'digest',Date.now()+600000);
  f.db.prepare('INSERT INTO email_challenges(id,account_id,purpose,email,code_hash,expires_at,auth_epoch,context) VALUES(?,?,?,?,?,?,?,?)')
    .run('pending-challenge',account.cloudAccountId,'device',EMAIL,'digest',Date.now()+600000,account.auth_epoch,JSON.stringify({uid}));
  f.db.prepare('INSERT INTO oidc_records VALUES(?,?,?,?,?,?,?,?,?)').run('Interaction',uid,JSON.stringify({uid}),Date.now()+600000,null,null,null,uid,null);
  f.db.prepare('INSERT INTO password_tickets VALUES(?,?,?,?,?)').run('ticket-digest',account.cloudAccountId,'reset',account.auth_epoch,Date.now()+600000);
  await control(desktop,'/auth/account/delete',{password:NEXT_PASSWORD},401);
  const closed = once(socket,'close');
  assert.equal((await control(desktop,'/auth/account/delete',{password:PASSWORD})).data.deleted,true); await closed;
  for(const table of ['cloud_accounts','cloud_devices','email_challenges','password_tickets','grant_bindings','oidc_records','host_claims','host_memberships','host_device_status','device_host_links','cloud_revocations']) {
    const rows=f.db.prepare(`SELECT * FROM ${table}`).all();
    assert.ok(rows.every(r=>!JSON.stringify(r).includes(account.cloudAccountId)),table);
  }
  for(const table of ['cloud_hosts','host_relays']) assert.equal(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0,table);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM relay_dns_records').get().n,0);
  assert.equal(f.db.prepare('SELECT * FROM interaction_forms WHERE uid=?').get(uid),undefined);
  assert.equal(f.db.prepare('SELECT * FROM oidc_records WHERE id=?').get(uid),undefined);
  await refresh(desktop,undefined,400); await refresh(phone,undefined,400); await control(desktop,'/devices',undefined,401);
  await refresh(other);
  assert.throws(()=>relay.plugin('Ping',{user:{user:started.hostId,metas:{credential:credential.credential}}}));
  const mails=await Promise.all((await readdir(f.config.mailDir)).map(n=>readFile(join(f.config.mailDir,n),'utf8')));
  assert.ok(mails.every(m=>!m.includes(EMAIL)&&!m.includes(account.cloudAccountId)));
  f.advance(3600001);
  const replacement=await registration(f); assert.notEqual(replacement.account.cloudAccountId,account.cloudAccountId);
  assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('real cloud process + isolated host: email change revokes sessions; deletion preserves local files and emergency login', {timeout:90000}, async t=>{
  const f=await fixture(t,{realProcess:true}); const {account}=await registration(f);
  let desktop=await appDevice(f,'desktop'); const {host,root,hostApi,exchange}=await hostFixture(f,t);
  const local=await exchange(desktop,'/auth/cloud-desktop'); assert.equal(local.status,200);
  await hostApi('/cloud/emergency-password',{password:NEXT_PASSWORD},local);
  const marker=join(root,'local-preservation.txt'); await writeFile(marker,'local conversation and memory remain');
  await host.syncCloudRevocations();
  await control(desktop,'/auth/email/change/confirm',await change(f,desktop,'new@example.com'));
  await host.syncCloudRevocations(); assert.equal((await hostApi('/sessions',undefined,local)).status,401);
  desktop=await appDevice(f,'desktop-new','new@example.com');
  const offline=await hostApi('/auth/cloud-offline',{cloudAccountId:account.cloudAccountId,password:NEXT_PASSWORD,deviceName:'Offline'});
  assert.equal(offline.status,200);
  const pending=await exchange(desktop,'/auth/cloud-desktop'); assert.equal(pending.status,202);
  assert.equal((await hostApi(`/cloud/devices/${pending.requestId}/decision`,{decision:'allow'},offline)).status,200);
  const reconnected=await exchange(desktop,'/auth/cloud-desktop'); assert.equal(reconnected.status,200);
  await control(desktop,'/auth/account/delete',{password:PASSWORD});
  await host.syncCloudRevocations();
  assert.equal((await hostApi('/sessions',undefined,reconnected)).status,401);
  assert.equal((await hostApi('/cloud/binding',undefined,offline)).data.status,'unbound');
  assert.equal(await readFile(marker,'utf8'),'local conversation and memory remain');
  const emergency=await hostApi('/auth/cloud-offline',{cloudAccountId:account.cloudAccountId,password:NEXT_PASSWORD,deviceName:'Emergency'});
  assert.equal(emergency.status,200); assert.equal(emergency.account.ownerId,local.account.ownerId);
  assert.equal((await hostApi('/sessions',undefined,emergency)).status,200);
  await refresh(desktop,undefined,400);
  const mails=await Promise.all((await readdir(f.config.mailDir)).map(n=>readFile(join(f.config.mailDir,n),'utf8')));
  assert.equal(mails.length,0,'including original mailbox notifications after email change');
  assert.doesNotMatch(f.logs(),/account@example|new@example|access_token|refresh_token/);
});

test('logout others cancels unconfirmed logins and handles multiple keys with the same device id',async t=>{
  const f=await fixture(t); await registration(f);
  const a=await appDevice(f,'desktop'), b=await appDevice(f,'desktop');
  const account=f.db.prepare('SELECT * FROM cloud_accounts').get();
  const legacy=await f.identity.accounts.device({deviceId:'desktop'});
  f.db.prepare('INSERT INTO cloud_devices(account_id,fingerprint,device_id,confirmed_at) VALUES(?,?,?,?)').run(account.id,legacy.fingerprint,'desktop',Date.now());
  const pending=await f.begin(); const request=await f.login(pending,{deviceId:'unconfirmed'});
  assert.equal(request.status,202); const code=await f.mailCode(request.data.challengeId);
  assert.equal((await control(a,'/auth/logout/others',{})).data.revokedDevices,2);
  assert.ok(f.db.prepare('SELECT jkt FROM cloud_revocations WHERE kind=\'device\'').all().every(r=>r.jkt));
  await refresh(b,undefined,400); await refresh(a);
  assert.notEqual((await f.confirm(pending,request.data.challengeId,code)).status,200);
  assert.equal(f.db.prepare('SELECT * FROM email_challenges WHERE id=?').get(request.data.challengeId),undefined);
});

test('ephemeral security metadata and file mail expire automatically at the one-hour boundary',async t=>{
  const f=await fixture(t); await registration(f);
  const cutoff=Date.now();
  f.db.prepare('INSERT INTO host_proof_replays VALUES(?,?)').run('expired',cutoff);
  f.db.prepare('INSERT INTO interaction_forms VALUES(?,?,?)').run('expired','digest',cutoff);
  await pruneEphemeral(f.db,f.identity.accounts.mailer,cutoff+3600001);
  for(const table of ['failure_limits','host_proof_replays','interaction_forms','email_challenges'])
    assert.equal(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0,table);
  assert.equal((await readdir(f.config.mailDir)).length,0);
});

test('deleting a member preserves the other owner installation and its active sessions',async t=>{
  const f=await fixture(t); await registration(f); await registration(f,'other@example.com');
  const a=await appDevice(f,'desktop'), b=await appDevice(f,'other','other@example.com');
  const {host,hostApi,exchange}=await hostFixture(f,t);
  const owner=await exchange(a,'/auth/cloud-desktop'); const member=await exchange(b,'/auth/cloud-desktop');
  assert.equal(owner.status,200); assert.equal(member.status,200); await host.syncCloudRevocations();
  await control(b,'/auth/account/delete',{password:PASSWORD}); await host.syncCloudRevocations();
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM cloud_hosts').get().n,1);
  assert.equal((await hostApi('/sessions',undefined,owner)).status,200);
  assert.equal((await hostApi('/sessions',undefined,member)).status,401);
  await refresh(a);
});

test('an email delivery already in flight cannot recreate deleted account mail or challenges',async t=>{
  const f=await fixture(t); await registration(f); const a=await appDevice(f,'desktop');
  const mailer=f.identity.accounts.mailer; let release, entered;
  const held=new Promise(resolve=>{release=resolve;}); const ready=new Promise(resolve=>{entered=resolve;});
  f.identity.accounts.mailer={...mailer,send:async message=>{entered(); await held; return mailer.send(message);}};
  const request=control(a,'/auth/email/change/request',{email:'new@example.com'},503);
  await ready; await control(a,'/auth/account/delete',{password:PASSWORD}); release(); await request;
  assert.equal((await readdir(f.config.mailDir)).length,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM email_challenges').get().n,0);
});
