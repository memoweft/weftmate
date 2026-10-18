import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

// The launcher issues the setup grant. Secrets stay in this process, never in its receipt.
const evidence = process.argv[2];
const folder = join(evidence, process.argv[3] || 'host-profile', 'personal-access', 'setup');
const names = (await readdir(folder)).filter(name => name.endsWith('.json'));
const records = await Promise.all(names.map(async name => JSON.parse(await readFile(join(folder, name), 'utf8'))));
const record = records.sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))[0];
const url = new URL(record.url);
if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw Error('Not the issued isolated host');
const endpoint = path => new URL('/personal/v1' + path, url.origin);
const response = await fetch(endpoint('/auth/setup'), { method: 'POST', headers: { Origin: url.origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant: new URLSearchParams(url.hash.slice(1)).get('setup'), username: 'b2-source-test', password: randomBytes(32).toString('base64url'), deviceName: 'B2 synthetic desktop' }), signal: AbortSignal.timeout(30000) });
if (!response.ok) throw Error(`Setup HTTP ${response.status}`);
const identity = await response.json();
const cookie = response.headers.get('set-cookie').split(';')[0];
const headers = { Origin: url.origin, Cookie: cookie, 'X-WeftMate-CSRF': identity.csrfToken, 'Content-Type': 'application/json' };
const key = process.env.MIMO_API_KEY;
if (!key) throw Error('Approved model key unavailable');
const configured = await fetch(endpoint('/model-services'), { method: 'POST', headers,
  body: JSON.stringify({ requestId: randomUUID(), name: 'B2 MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', apiKey: key, interfaceType: 'openai-compatible', modelId: 'mimo-v2.6-flash', selectedModelId: 'mimo-v2.6-flash' }), signal: AbortSignal.timeout(60000) });
const status = await fetch(endpoint('/status'), { headers, signal: AbortSignal.timeout(10000) });
const receipt = { sourceDesktop: true, installedPackage: false, accountConfigured: true, modelServiceHttpStatus: configured.status, statusHttpStatus: status.status, accessPort: Number(url.port), date: new Date().toISOString() };
await writeFile(join(evidence, 'host-ready.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
if (!configured.ok || !status.ok) process.exitCode = 1;
