/** Synthetic account directory; launched in WSL. The private IPC stream is never evidence. */
import { createInterface } from 'node:readline';
import { fixture, P } from '../../services/cloud/test/identity-helpers.mjs';
import { registration, appDevice, control, refresh, proof } from '../../services/cloud/test/app-helpers.mjs';
const cleanup = [], f = await fixture({ after: fn => cleanup.push(fn) }, { listenHost: '0.0.0.0' });
await registration(f);
const devices = { desktop: await appDevice(f, 'desktop'), phone: await appDevice(f, 'phone') };
process.stdout.write(JSON.stringify({ ready: true, origin: f.origin, issuer: f.config.issuer }) + '\n');
const input = createInterface({ input: process.stdin });
let queue = Promise.resolve();
input.on('line', line => { queue = queue.then(async () => {
  const request = JSON.parse(line); const device = devices[request.device || 'phone'];
  try {
    f.advance(Math.max(0, Date.now() - f.now));
    let value;
    if (request.action === 'control') {
      if (device.tokens.resource !== f.config.audience) await refresh(device, f.config.audience);
      value = (await control(device, request.route, request.body, request.status ?? 200)).data;
    } else if (request.action === 'exchange') {
      if (request.resource) await refresh(device, request.resource);
      value = { accessToken: device.tokens.access_token,
        dpop: await proof(device, request.url, device.tokens.access_token, { nonce: request.nonce }), deviceName: device.deviceId };
    } else throw Error('Unknown fixture command');
    process.stdout.write(JSON.stringify({ id: request.id, value }) + '\n');
  } catch (error) { process.stdout.write(JSON.stringify({ id: request.id, error: error.message }) + '\n'); }
}); });
input.on('close', async () => { await queue; for (const fn of cleanup.reverse()) await fn(); });
