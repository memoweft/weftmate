process.env.WEFTMATE_TEST_HOST_NAME = 'synthetic-host';
// Reuse the existing Windows cloud durability adaptation, without model calls.
import './and-2-fixture.mjs';
import assert from 'node:assert/strict';
import { fixture, EMAIL, PASSWORD } from '../../services/cloud/test/identity-helpers.mjs';
import { registration, appDevice, proof, control, refresh } from '../../services/cloud/test/app-helpers.mjs';
import { startTimelineCandidate } from './timeline-ui-candidate.mjs';
import { rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostDiagnostics } from '../../src/host-diagnostics.mjs';
import { createSystemStatusManager } from '../../src/system-status-runtime.mjs';

export async function startAnd3Fixture() {
  const cleanups = [];
  const cloud = await fixture({ after: fn => cleanups.push(fn) }, { env: { CLOUD_OIDC_CLIENTS: JSON.stringify([
    { client_id: 'test-native', redirect_uris: ['com.example.weftmate:/callback'] },
    { client_id: 'weftmate-android', redirect_uris: ['com.memoweft.weftmate:/oauth'] },
  ]) } });
  const clock = setInterval(() => cloud.advance(Math.max(0, Date.now() - cloud.now)), 100);
  let candidate, desktop;
  let hostClockOffset = 0;
  const diagnosticsRoot = await mkdtemp(join(tmpdir(), 'wm-and3-diagnostics-'));
  const diagnostics = createHostDiagnostics(diagnosticsRoot, {version:'synthetic'}); diagnostics.begin({mode:'personal-host'});
  const systemManager = createSystemStatusManager({ readHost:()=>({state:'ready',version:'synthetic'}), readMemory:()=>({state:'disabled'}),
    readModel:()=>({configured:true,state:'ready',currentModelId:'synthetic'}), readRelay:()=>({state:'online'}), repairs:{}, diagnostics,
    metrics:()=>({startupMs:800,firstTokenMs:[900],rssBytes:100*1024**2}), versions:()=>({appVersion:'synthetic'}) });
  try {
    await registration(cloud); desktop = await appDevice(cloud, 'synthetic-desktop');
    candidate = await startTimelineCandidate({ logicalMobile: true, daily: true, interactive: true, goals: true, clock:()=>Date.now()+hostClockOffset, baseTime:Date.now(), historyCount: 0, riskApproval: true, secondOpinion: true,
      systemManager,
      verifyModelProfile:async()=>({configured:true,reachable:true,modelListed:true,inferenceVerified:false}),
      digestModel: async input => { assert.equal(input.purpose, 'second-opinion'); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ alignment:'对得上', externalInfluence:'没有', reason:'这一步用于保存本人要的进度报告。' }) } }] }), { headers: { 'content-type':'application/json' } }); },
      cloudIdentity: { issuer: cloud.config.issuer, allowInsecureLoopback: true, clientId: 'weftmate-android' },
      authenticate: async ({ service, origin, hostId }) => {
        const api = async (path, body, headers = {}) => {
          const response = await fetch(origin + '/personal/v1' + path, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
          const auth = await response.json(); assert.equal(response.status, 200, JSON.stringify(auth));
          return { auth, cookie: response.headers.get('set-cookie')?.split(';')[0] };
        };
        const native = await api('/auth/desktop', { deviceName: 'synthetic-host' }, { 'x-weftmate-desktop': service.libraryDesktopToken });
        const nonce = await api('/auth/cloud-nonce', {});
        const linked = await api('/auth/cloud-desktop', { accessToken: desktop.tokens.access_token, deviceName: 'synthetic-host' }, {
          cookie: native.cookie, 'x-weftmate-csrf': native.auth.csrfToken, 'x-weftmate-desktop': service.libraryDesktopToken,
          dpop: await proof(desktop, origin + '/personal/v1/auth/cloud-desktop', desktop.tokens.access_token, { nonce: nonce.auth.nonce }) });
        const phone = await appDevice(cloud, 'synthetic-seed-phone');
        const connection = (await control(phone, '/hosts/connect', { hostId })).data;
        await refresh(phone, connection.resource);
        const phoneNonce = await api('/auth/cloud-nonce', {});
        return api('/auth/cloud-session', { accessToken: phone.tokens.access_token, deviceName: 'synthetic-seed-phone' }, {
          dpop: await proof(phone, origin + '/personal/v1/auth/cloud-session', phone.tokens.access_token, { nonce: phoneNonce.auth.nonce }) });
      } });
    const ownerId = (await candidate.request('/auth/me')).account.ownerId;
    await candidate.digestService().recordActivity(ownerId, { key: 'and3-synthetic-weekly', type: 'memory.report', title: '这周回顾',
      summary: '这周整理了项目资料，也保存了一份进度报告。',
      weeklyInsight: { from: '2026-10-05', to: '2026-10-11', timeZone: 'Asia/Shanghai', mode: 'statistics',
        text: '这周整理了项目资料，也保存了一份进度报告。', sources: [] } });
    return { cloud, candidate, email: EMAIL, password: PASSWORD, origin: candidate.origin,
      expire: async () => { hostClockOffset = 60*24*60*60*1000; },
      restoreClock: () => { hostClockOffset = 0; },
      close: async () => { await candidate.close(); await rm(candidate.root, { recursive: true, force: true }); await rm(diagnosticsRoot,{recursive:true,force:true}); clearInterval(clock); for (const fn of cleanups.reverse()) await fn(); } };
  } catch (error) { clearInterval(clock); await candidate?.close(); await rm(diagnosticsRoot,{recursive:true,force:true}); for (const fn of cleanups.reverse()) await fn(); throw error; }
}
