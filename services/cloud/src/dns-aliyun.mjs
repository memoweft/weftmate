import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Resolver, resolveNs, resolve4, resolve6 } from 'node:dns/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { CloudError } from './security.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// AliDNS RPC parameters live in the query. Official OpenAPI V3 / ACS3 signing:
// https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature
export function aliyunRequest({ endpoint, accessKeyId, accessKeySecret, action, parameters, now = Date.now, nonce = randomUUID }) {
  const url = new URL(endpoint);
  const query = Object.entries(parameters).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${encode(key)}=${encode(String(value))}`).join('&');
  const headers = { host: url.host, 'x-acs-action': action, 'x-acs-version': '2015-01-09',
    'x-acs-date': new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    'x-acs-signature-nonce': nonce(), 'x-acs-content-sha256': hash('') };
  const names = Object.keys(headers).sort(), signed = names.join(';');
  const canonical = ['POST', '/', query, names.map(k => `${k}:${headers[k]}\n`).join(''), signed, hash('')].join('\n');
  const signature = createHmac('sha256', accessKeySecret).update(`ACS3-HMAC-SHA256\n${hash(canonical)}`).digest('hex');
  headers.authorization = `ACS3-HMAC-SHA256 Credential=${accessKeyId},SignedHeaders=${signed},Signature=${signature}`;
  url.search = query;
  return { url, headers, method: 'POST', body: '' };
}

// Query each authority directly, avoiding recursive resolver negative caches.
export async function waitForAuthoritativeTxt({ zone, name, value, timeoutMs = 90_000, intervalMs = 2000, resolvers: suppliedResolvers }) {
  const servers = suppliedResolvers ? [] : await resolveNs(zone);
  const resolvers = suppliedResolvers ?? await Promise.all(servers.map(async server => {
    const addresses = await resolve4(server).catch(() => resolve6(server));
    const resolver = new Resolver({ timeout: 3000, tries: 1 });
    resolver.setServers(addresses); return resolver;
  }));
  if (!resolvers.length) throw new CloudError(503, 'DNS_PROPAGATION_TIMEOUT');
  const deadline = Date.now() + timeoutMs;
  do {
    const visible = await Promise.all(resolvers.map(resolver => resolver.resolveTxt(name)
      .then(records => records.some(parts => parts.join('') === value)).catch(() => false)));
    if (visible.every(Boolean)) return;
    if (Date.now() >= deadline) break;
    await delay(intervalMs);
  } while (true);
  throw new CloudError(503, 'DNS_PROPAGATION_TIMEOUT');
}

export function createAliyunDns({ database: db, zone, accessKeyId, accessKeySecret,
  endpoint = 'https://alidns.aliyuncs.com/', fetcher = fetch, waitForTxt = waitForAuthoritativeTxt }) {
  // A free AliDNS zone has a 600s minimum TTL; this does not delay publication.
  const get = db.prepare('SELECT record_id FROM relay_dns_records WHERE name=? AND value=?');
  const save = db.prepare('INSERT INTO relay_dns_records VALUES(?,?,?)');
  const remove = db.prepare('DELETE FROM relay_dns_records WHERE name=? AND value=?');
  const pending = new Map();
  async function api(action, parameters) {
    try {
      const request = aliyunRequest({ endpoint, accessKeyId, accessKeySecret, action, parameters });
      const response = await fetcher(request.url, { ...request, redirect: 'error', signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (!response.ok || data.Code) {
        if (action === 'DeleteDomainRecord' && data.Code === 'InvalidRecordId.NotFound') return {};
        throw new Error('AliDNS rejected request');
      }
      return data;
    } catch { throw new CloudError(503, 'DNS_PROVIDER_ERROR'); }
  }
  // Serialize equal challenges so retries share exactly one owned RecordId.
  function serial(name, value, operation) {
    const key = `${name}\0${value}`;
    const work = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
    pending.set(key, work);
    return work.finally(() => { if (pending.get(key) === work) pending.delete(key); });
  }
  return {
    present({ name, value, ttl }) {
      return serial(name, value, async () => {
        if (!name.endsWith(`.${zone}`)) throw new CloudError(503, 'DNS_ZONE_MISMATCH');
        if (!get.get(name, value)) {
          const result = await api('AddDomainRecord', { DomainName: zone, RR: name.slice(0, -(zone.length + 1)),
            Type: 'TXT', Value: value, TTL: Math.max(600, ttl) });
          if (typeof result.RecordId !== 'string' || !result.RecordId) throw new CloudError(503, 'DNS_PROVIDER_ERROR');
          save.run(name, value, result.RecordId);
        }
        try { await waitForTxt({ zone, name, value }); }
        catch (error) { throw error instanceof CloudError ? error : new CloudError(503, 'DNS_PROPAGATION_TIMEOUT'); }
      });
    },
    cleanup({ name, value }) {
      return serial(name, value, async () => {
        const owned = get.get(name, value);
        if (!owned) return;
        await api('DeleteDomainRecord', { RecordId: owned.record_id });
        remove.run(name, value);
      });
    },
  };
}

export function dnsFromEnvironment({ database, env = process.env }) {
  if (env.CLOUD_DNS_PROVIDER !== 'aliyun' || !env.ALIYUN_DNS_ACCESS_KEY_ID?.trim() ||
      !env.ALIYUN_DNS_ACCESS_KEY_SECRET?.trim() || !env.ALIYUN_DNS_ZONE?.trim()) return null;
  return createAliyunDns({ database, zone: env.ALIYUN_DNS_ZONE,
    accessKeyId: env.ALIYUN_DNS_ACCESS_KEY_ID, accessKeySecret: env.ALIYUN_DNS_ACCESS_KEY_SECRET });
}
