import { createPrivateKey, X509Certificate, createHash } from 'node:crypto';
import { createServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { readFile, writeFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { ensurePrivateDirectory, ensurePrivateFile } from '../private-host-storage.mjs';

const run = promisify(execFile);
export const tlsSpki = certificate => createHash('sha256').update(new X509Certificate(certificate)
  .publicKey.export({ type: 'spki', format: 'der' })).digest('base64url');

// CSR always uses S1b's existing content key, so issuance/renewal keeps the pin.
export async function createHostCsr({ root, domain, privateJwk }) {
  if (!/^h-[a-f0-9]{32}\.[a-z0-9.-]+$/.test(domain)) throw new Error('Invalid claimed domain');
  const dir = path.join(root, 'relay-tls');
  await ensurePrivateDirectory(dir);
  const keyFile = path.join(dir, 'key.pem'), csrFile = path.join(dir, 'host.csr');
  await writeFile(keyFile, createPrivateKey({ key: privateJwk, format: 'jwk' })
    .export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  await ensurePrivateFile(keyFile);
  const configFile = path.join(dir, 'csr.cnf');
  await writeFile(configFile, `[req]\nprompt=no\ndistinguished_name=dn\nreq_extensions=ext\n[dn]\nCN=${domain}\n[ext]\nsubjectAltName=DNS:${domain}\nextendedKeyUsage=serverAuth\n`, { mode: 0o600 });
  await run('openssl', ['req', '-new', '-key', keyFile, '-out', csrFile, '-config', configFile]);
  return { keyFile, csrFile, configFile, dir };
}
export async function developmentCertificate(options) {
  const files = await createHostCsr(options);
  const caKey = path.join(files.dir, 'development-ca-key.pem'), ca = path.join(files.dir, 'development-ca.pem');
  try { await access(ca); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKey, '-out', ca,
      '-days', '7', '-subj', '/CN=WeftMate isolated development CA']);
    await ensurePrivateFile(caKey);
  }
  const certFile = path.join(files.dir, 'development-host.pem');
  await run('openssl', ['x509', '-req', '-in', files.csrFile, '-CA', ca, '-CAkey', caKey, '-CAcreateserial',
    '-out', certFile, '-days', '7', '-extfile', files.configFile, '-extensions', 'ext']);
  return { ...files, certFile, caFile: ca };
}

export async function createHostTlsAdapter({ origin, publicOrigin, privateJwk, spki, certFile, port = 0 }) {
  const backend = new URL(origin), publicUrl = new URL(publicOrigin);
  if (backend.protocol !== 'http:' || backend.hostname !== '127.0.0.1' || publicUrl.protocol !== 'https:' ||
      publicUrl.origin !== publicOrigin) throw new Error('Invalid TLS adapter configuration');
  const cert = await readFile(certFile);
  if (tlsSpki(cert) !== spki || !new X509Certificate(cert).checkHost(publicUrl.hostname))
    throw new Error('TLS certificate does not match host key/domain');
  const sockets = new Set();
  const server = createServer({ cert, key: createPrivateKey({ key: privateJwk, format: 'jwk' })
    .export({ type: 'pkcs8', format: 'pem' }), minVersion: 'TLSv1.2',
    maxHeaderSize: 8192, requestTimeout: 0 }, (req, res) => {
    const forbidden = Object.keys(req.headers).some(k => k === 'forwarded' || k.startsWith('x-forwarded-'));
    if (forbidden || req.headers.host !== publicUrl.host || req.socket.servername !== publicUrl.hostname ||
        req.url.startsWith('//') || !req.url.startsWith('/')) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'ORIGIN_NOT_ALLOWED' } })); return;
    }
    // Strip hop-by-hop headers, including names nominated by Connection.
    const headers = { ...req.headers };
    const hop = ['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade',
      ...(req.headers.connection ?? '').split(',').map(s => s.trim().toLowerCase())];
    for (const key of hop) delete headers[key];
    headers.host = publicUrl.host;
    headers['x-forwarded-host'] = publicUrl.host; headers['x-forwarded-proto'] = 'https';
    const upstream = httpRequest({ hostname: '127.0.0.1', port: backend.port, method: req.method, path: req.url, headers }, remote => {
      const responseHeaders = { ...remote.headers };
      for (const key of ['connection','keep-alive','transfer-encoding','upgrade']) delete responseHeaders[key];
      res.writeHead(remote.statusCode, responseHeaders); remote.pipe(res);
      remote.on('error', () => res.destroy());
    });
    upstream.on('error', () => {
      if (res.headersSent) res.destroy();
      else { res.writeHead(502); res.end(); }
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('tlsClientError', () => {});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { port: server.address().port,
    reload: async () => {
      const next = await readFile(certFile);
      if (tlsSpki(next) !== spki || !new X509Certificate(next).checkHost(publicUrl.hostname)) throw new Error('TLS renewal changed key/domain');
      server.setSecureContext({ cert: next, key: createPrivateKey({ key: privateJwk, format: 'jwk' }).export({ type: 'pkcs8', format: 'pem' }) });
    },
    close: () => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve); }),
  };
}
