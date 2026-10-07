// certbot manual DNS-01 hook; run ONLY on the host. No global DNS credentials.
import { readFile } from 'node:fs/promises';
import { importJWK, SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const root = process.env.WEFTMATE_ACCESS_ROOT;
const issuer = process.env.WEFTMATE_CLOUD_ISSUER;
const domain = process.env.CERTBOT_DOMAIN;
const value = process.env.CERTBOT_VALIDATION;
if (!root || !path.isAbsolute(root) || !issuer?.startsWith('https://') || !domain || !value)
  throw new Error('ACME hook requires host root, HTTPS issuer and certbot DNS challenge');
const state = JSON.parse(await readFile(path.join(root, 'cloud-identity', 'identity.json'), 'utf8'));
const action = process.argv.includes('--cleanup') ? '/hosts/relay/dns/cleanup' : '/hosts/relay/dns/present';
async function signed(route, data) {
  const proof = await new SignJWT({ action: route, ...data }).setProtectedHeader({ alg: 'ES256', typ: 'wm-host-request+jwt' })
    .setIssuer(state.hostId).setAudience(issuer).setIssuedAt().setExpirationTime('60s').setJti(randomUUID())
    .sign(await importJWK(state.installation.privateJwk, 'ES256'));
  const result = await fetch(`${issuer.slice(0, -5)}${route}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/json', origin: new URL(issuer).origin }, body: JSON.stringify({ hostId: state.hostId, proof }) });
  if (!result.ok) throw new Error(`ACME cloud operation failed: ${result.status}`);
  return result.json();
}
const claimed = await signed('/hosts/relay/credentials', {});
if (new URL(claimed.baseUrl).hostname !== domain) throw new Error('ACME challenge is not the claimed host');
await signed(action, { value });
// Deployment DNS adapter must return only after authoritative TXT publication;
// certbot's own propagation wait may also be configured by the deployment.
