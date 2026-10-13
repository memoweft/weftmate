import { fixture as httpCloudFixture, PASSWORD, EMAIL, P } from '../../services/cloud/test/identity-helpers.mjs';
import { createServer as createHttpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { mkdtemp, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, createHash, X509Certificate } from 'node:crypto';
import assert from 'node:assert/strict';

const exec = promisify(execFile);

// Production Cookie semantics on a real local TLS transport. The HTTPS proxy
// overwrites forwarding headers before reaching the real cloud HTTP server;
// provider/appAuthorization calls still use its internal loopback HTTP port.
// All certificates, accounts, mail and database files belong to this fixture.
export async function httpsCloudFixture(t, { env = {}, relayDns, realProcess = true, serve, transformReply } = {}) {
  const certificateRoot = await mkdtemp(join(tmpdir(), 'wm-auth1-cloud-tls-'));
  const keyFile = join(certificateRoot, 'synthetic-cloud-key.pem');
  const certFile = join(certificateRoot, 'synthetic-cloud-cert.pem');
  const previousCAs = getCACertificates('default');
  let front, cloud, cloudCleanup, closed = false;
  const sockets = new Set();
  async function close() {
    if (closed) return;
    closed = true;
    if (front) {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => { front.close(resolve); front.closeAllConnections(); });
    }
    await cloudCleanup?.();
    setDefaultCACertificates(previousCAs);
    await rm(certificateRoot, { recursive: true, force: true });
  }
  t.after(close);
  try {
    await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
      '-keyout', keyFile, '-out', certFile, '-subj', '/CN=synthetic-auth1-cloud',
      '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
      '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'extendedKeyUsage=serverAuth'],
    { windowsHide: true, timeout: 15000 });
    await chmod(keyFile, 0o600); await chmod(certFile, 0o600);
    const certificatePem = await readFile(certFile, 'utf8');
    setDefaultCACertificates([...previousCAs, certificatePem]);
    const certificate = new X509Certificate(certificatePem);
    const cloudTlsSpki = createHash('sha256').update(certificate.publicKey.export({ format: 'der', type: 'spki' })).digest('base64');
    front = createHttpsServer({ key: await readFile(keyFile), cert: certificatePem }, (request, response) => {
      if (serve?.(request, response)) return;
      if (!cloud) { response.writeHead(503); response.end(); return; }
      const target = new URL(cloud.origin);
      const upstream = httpRequest({ hostname: '127.0.0.1', port: target.port, path: request.url,
        method: request.method, headers: { ...request.headers, host: new URL(origin).host,
          'x-forwarded-host': new URL(origin).host, 'x-forwarded-proto': 'https', 'x-forwarded-for': '127.0.0.1' } }, reply => {
        if (transformReply && reply.statusCode === 200 && ['/personal/v1/cloud/hosts/connect', '/personal/v1/cloud/devices'].includes(request.url)) {
          const chunks = []; reply.on('data', data => chunks.push(data)); reply.on('end', () => {
            const body = transformReply(request.url, JSON.parse(Buffer.concat(chunks).toString()));
            const headers = { ...reply.headers }; delete headers['content-length'];
            response.writeHead(reply.statusCode, headers); response.end(JSON.stringify(body));
          }); return;
        }
        response.writeHead(reply.statusCode, reply.headers); reply.pipe(response);
      });
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      request.on('aborted', () => upstream.destroy()); request.pipe(upstream);
    });
    front.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    front.listen(0, '127.0.0.1'); await once(front, 'listening');
    const origin = `https://127.0.0.1:${front.address().port}`;
    cloud = await httpCloudFixture({ after: cleanup => { cloudCleanup = cleanup; } }, { realProcess, relayDns, env: { ...(typeof env === 'function' ? env(origin) : env),
      CLOUD_ISSUER: origin + P + '/oidc', CLOUD_TRUST_PROXY: 'true', CLOUD_MAIL_TRANSPORT: 'file' } });
    function browser() {
      const cookies = new Map();
      return async (route, { method = 'GET', body, form, headers = {}, status } = {}) => {
        const response = await fetch(route.startsWith('http') ? route : origin + route, { method, redirect: 'manual',
          headers: { accept: 'application/json', cookie: [...cookies].map(([k,v])=>`${k}=${v}`).join('; '),
            ...(method === 'POST' ? { origin, 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' } : {}), ...headers },
          body: form ? new URLSearchParams(form) : body ? JSON.stringify(body) : undefined });
        for (const value of response.headers.getSetCookie()) {
          const first=value.split(';')[0], at=first.indexOf('='); cookies.set(first.slice(0,at),first.slice(at+1));
        }
        const text=await response.text(); let data;
        try { data=JSON.parse(text); } catch { data=text; }
        if (status !== undefined) assert.equal(response.status,status,`${method} ${route}: ${text}`);
        return { status: response.status, data, headers: response.headers };
      };
    }
    const api=browser();
    async function register(email=EMAIL) {
      return (await api(P+'/auth/register',{method:'POST',status:201,body:{email,password:PASSWORD}})).data;
    }
    async function verified(email=EMAIL) {
      const challenge=await register(email);
      return (await api(P+'/auth/register/verify',{method:'POST',status:200,
        body:{challengeId:challenge.challengeId,code:await cloud.mailCode(challenge.challengeId)}})).data.account;
    }
    async function begin(client=browser(),extra={}) {
      const verifier=randomBytes(32).toString('base64url'),state=randomBytes(16).toString('hex'),nonce=randomBytes(16).toString('hex');
      const query=new URLSearchParams({client_id:'test-native',redirect_uri:'com.example.weftmate:/callback',response_type:'code',
        scope:'openid offline_access cloud:account',prompt:'consent',code_challenge:createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method:'S256',state,nonce,...extra});
      const started=await client(P+'/oidc/auth?'+query,{status:303});
      const interaction=await client(started.headers.get('location'),{status:200});
      return {client,verifier,state,nonce,...interaction.data};
    }
    async function login(interaction,{email=EMAIL,password=PASSWORD,deviceId='test-device',publicJwk}={}) {
      return interaction.client(P+'/auth/login',{method:'POST',body:{interactionUid:interaction.interactionUid,
        csrfToken:interaction.csrfToken,email,password,deviceId,...(publicJwk?{publicJwk}:{})}});
    }
    async function confirm(interaction,challengeId,code) {
      return interaction.client(P+'/auth/device/confirm',{method:'POST',body:{interactionUid:interaction.interactionUid,
        csrfToken:interaction.csrfToken,challengeId,code:code??await cloud.mailCode(challengeId)}});
    }
    async function tokens(interaction,completed) {
      const resumed=await interaction.client(completed.data.resumeUrl,{status:303});
      const callback=new URL(resumed.headers.get('location')); assert.equal(callback.searchParams.get('state'),interaction.state);
      assert.equal(callback.searchParams.get('error'),null); const code=callback.searchParams.get('code'); assert.ok(code);
      return {...(await api(P+'/oidc/token',{method:'POST',status:200,form:{grant_type:'authorization_code',client_id:'test-native',
        redirect_uri:'com.example.weftmate:/callback',code,code_verifier:interaction.verifier}})).data,code};
    }
    async function signedIn(options={}) {
      const interaction=await begin(); let result=await login(interaction,options);
      if(result.status===202) result=await confirm(interaction,result.data.challengeId);
      assert.equal(result.status,200,JSON.stringify(result.data));
      return {interaction,...await tokens(interaction,result)};
    }
    async function refresh(token,status=200) {
      return api(P+'/oidc/token',{method:'POST',...(status===null?{}:{status}),
        form:{grant_type:'refresh_token',client_id:'test-native',refresh_token:token}});
    }
    return {root:cloud.root,origin,config:cloud.config,api,browser,mailCode:cloud.mailCode,
      get db(){return cloud.db;},get identity(){return cloud.identity;},get now(){return cloud.now;},
      register,verified,begin,login,confirm,tokens,signedIn,refresh,logs:cloud.logs,advance:cloud.advance,
      offline:close,cloudTlsSpki,certificatePem};
  } catch(error) {
    await close();
    error.message = error.message.replaceAll(certificateRoot, '%TEMP%/wm-auth1-cloud-tls');
    if (cloud?.root) error.message = error.message.replaceAll(cloud.root, '%TEMP%/weftmate-cloud-identity');
    throw error;
  }
}

export { httpsCloudFixture as fixture };
