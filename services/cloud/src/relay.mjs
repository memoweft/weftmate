import { createServer as tcpServer, connect } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { CloudError } from './security.mjs';

const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const listen = (server, port) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
});

// frps reports the upstream socket address in Login / NewUserConn. These
// mandatory ingress listeners retain socket ownership without parsing TLS or
// implementing a tunnel protocol. Closing a pipe also closes active SSE/downloads.
export function createRelayIngress(targetPort, onClose = () => {}) {
  const connections = new Map(), pending = new Set();
  const server = tcpServer(client => {
    const upstream = connect({ host: '127.0.0.1', port: targetPort });
    const entry = { client, upstream, hostId: null };
    pending.add(entry);
    let closed = false, upstreamPort;
    const close = () => {
      if (closed) return; closed = true;
      connections.delete(upstreamPort); pending.delete(entry);
      if (entry.hostId && ![...connections.values()].some(c => c.hostId === entry.hostId)) onClose(entry.hostId);
      client.destroy(); upstream.destroy();
    };
    client.on('error', close); upstream.on('error', close);
    client.once('close', close); upstream.once('close', close);
    client.pause();
    upstream.once('connect', () => {
      upstreamPort = upstream.localPort;
      pending.delete(entry); connections.set(upstreamPort, entry);
      client.pipe(upstream); upstream.pipe(client); client.resume();
    });
  });
  return { server,
    associate(address, hostId) {
      const match = /^127\.0\.0\.1:(\d+)$/.exec(address ?? '');
      const entry = match && connections.get(Number(match[1]));
      if (!entry || entry.hostId && entry.hostId !== hostId) return false;
      entry.hostId = hostId;
      return true;
    },
    disconnect(hostId) {
      let count = 0;
      for (const entry of connections.values()) if (entry.hostId === hostId) {
        count++; entry.client.destroy(); entry.upstream.destroy();
      }
      return count;
    },
    async close() {
      for (const entry of [...pending, ...connections.values()]) {
        entry.client.destroy(); entry.upstream.destroy();
      }
      if (server.listening) await new Promise(resolve => server.close(resolve));
    },
  };
}

export function createRelay({ database: db, config, secret, now = Date.now, dns = null }) {
  const options = config.relay;
  const control = options && createRelayIngress(options.frpsPort, hostId => db.prepare('UPDATE host_relays SET last_seen=NULL WHERE host_id=?').run(hostId));
  const content = options && createRelayIngress(options.frpsHttpsPort);
  const tokenFor = row => createHmac('sha256', secret)
    .update(`weftmate-relay\0${row.host_id}\0${row.generation}`).digest('base64url');
  function enabled() { if (!options) throw new CloudError(503, 'RELAY_NOT_CONFIGURED'); }
  function member(hostId) {
    if (!db.prepare('SELECT 1 FROM host_memberships WHERE host_id=?').get(hostId))
      throw new CloudError(403, 'HOST_NOT_CLAIMED');
  }
  function rowFor(hostId) { return db.prepare('SELECT * FROM host_relays WHERE host_id=?').get(hostId); }
  function active(hostId) {
    enabled(); member(hostId);
    const row = rowFor(hostId);
    if (!row || row.status !== 'active') throw new CloudError(403, 'RELAY_REVOKED');
    return row;
  }
  function disconnect(hostId) {
    return (control?.disconnect(hostId) ?? 0) + (content?.disconnect(hostId) ?? 0);
  }
  function revoke(hostId) {
    db.prepare("UPDATE host_relays SET status='revoked',last_seen=NULL WHERE host_id=?").run(hostId);
    return { revoked: true, closedConnections: disconnect(hostId) };
  }
  function view(row) {
    const online = row.status === 'active' && row.last_seen !== null && now() - row.last_seen < 15_000;
    return { hostId: row.host_id, baseUrl: `https://${row.domain}`, status: row.status === 'revoked' ? 'revoked' : online ? 'online' : 'offline' };
  }
  function credential(row) {
    return { ...view(row), credential: tokenFor(row), generation: row.generation,
      serverAddr: options.serverName, serverPort: 443, serverName: options.serverName,
      proxyName: `${row.host_id}.content` };
  }
  async function hostRequest(route, hostId, payload) {
    enabled(); member(hostId);
    if (route === '/hosts/relay/credentials') {
      let row = rowFor(hostId);
      if (!row) {
        db.prepare('INSERT INTO host_relays VALUES(?,?,1,?,?,NULL)').run(hostId,
          `h-${randomBytes(16).toString('hex')}.${options.domain}`, 'active', 'initial');
        row = rowFor(hostId);
      }
      return credential(active(hostId));
    }
    if (route === '/hosts/relay/rotate') {
      const row = active(hostId);
      if (typeof payload.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.requestId))
        throw new CloudError(400, 'INVALID_REQUEST');
      if (row.rotation_id !== payload.requestId) {
        db.prepare('UPDATE host_relays SET generation=generation+1,rotation_id=?,last_seen=NULL WHERE host_id=?')
          .run(payload.requestId, hostId);
        disconnect(hostId);
      }
      return credential(rowFor(hostId));
    }
    if (route === '/hosts/relay/revoke') return revoke(hostId);
    if (['/hosts/relay/dns/present', '/hosts/relay/dns/cleanup'].includes(route)) {
      const row = active(hostId);
      // Caller cannot supply a zone, name, record type, TTL, or another host ID.
      if (Object.keys(payload).some(k => !['action','iat','exp','iss','aud','jti','value'].includes(k)) ||
          typeof payload.value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.value))
        throw new CloudError(400, 'INVALID_DNS_CHALLENGE');
      if (!dns) throw new CloudError(503, 'DNS_NOT_CONFIGURED');
      const name = `_acme-challenge.${row.domain}`;
      await dns[route.endsWith('/present') ? 'present' : 'cleanup']({ name, value: payload.value, ttl: 60 });
      return { name, updated: true };
    }
    throw new CloudError(404, 'NOT_FOUND');
  }
  function plugin(op, c) {
    enabled();
    const user = op === 'Login' ? c : c.user;
    const row = active(user?.user);
    const supplied = user?.metas?.credential;
    const expected = tokenFor(row);
    if (typeof supplied !== 'string' || supplied.length !== expected.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new CloudError(401, 'RELAY_UNAUTHORIZED');
    if (op === 'Login') {
      if (!control.associate(c.client_address, row.host_id)) throw new CloudError(403, 'RELAY_INGRESS_REQUIRED');
    } else if (op === 'NewProxy') {
      if (c.proxy_type !== 'https' || c.proxy_name !== `${row.host_id}.content` ||
          !Array.isArray(c.custom_domains) || c.custom_domains.length !== 1 || c.custom_domains[0] !== row.domain ||
          c.subdomain || c.group || c.group_key || c.remote_port || c.locations?.length || c.host_header_rewrite)
        throw new CloudError(403, 'RELAY_PROXY_FORBIDDEN');
    } else if (op === 'NewUserConn') {
      if (c.proxy_type !== 'https' || c.proxy_name !== `${row.host_id}.content` ||
          !content.associate(c.remote_addr, row.host_id)) throw new CloudError(403, 'RELAY_INGRESS_REQUIRED');
    } else if (!['Ping','NewWorkConn'].includes(op)) throw new CloudError(400, 'INVALID_REQUEST');
    db.prepare('UPDATE host_relays SET last_seen=? WHERE host_id=?').run(now(), row.host_id);
    return { reject: false, unchange: true };
  }
  const server = httpServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    try {
      if (!loopback(req.socket.remoteAddress) || req.method !== 'POST') throw new Error('private plugin');
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/frp/plugin' || url.searchParams.get('version') !== '0.1.0') throw new Error('invalid plugin');
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 16 * 1024) throw new Error('body size'); chunks.push(chunk); }
      const result = plugin(url.searchParams.get('op'), JSON.parse(Buffer.concat(chunks)).content);
      res.end(JSON.stringify(result));
    } catch {
      // No payload/credential/address logging, even for malformed plugin calls.
      res.end(JSON.stringify({ reject: true, reject_reason: 'relay authorization denied' }));
    }
  });
  return { hostRequest, revoke, plugin, control, content,
    discover(hostId, accountId) {
      enabled();
      if (!db.prepare('SELECT 1 FROM host_memberships WHERE host_id=? AND account_id=?').get(hostId, accountId))
        throw new CloudError(404, 'NOT_FOUND');
      const row = rowFor(hostId);
      if (!row) return { hostId, status: 'offline', baseUrl: null };
      return view(row);
    },
    async start() {
      if (!options) return;
      db.prepare('UPDATE host_relays SET last_seen=NULL').run();
      try {
        await listen(control.server, options.controlPort);
        await listen(content.server, options.contentPort);
        await listen(server, options.pluginPort);
      } catch (error) { await this.close(); throw error; }
    },
    async close() {
      await Promise.all([control?.close(), content?.close()]);
      if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    },
  };
}
