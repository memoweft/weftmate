import path from 'node:path';

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const portText = env.CLOUD_PORT ?? '8787';
  if (
    !/^\d+$/.test(portText) ||
    !Number.isSafeInteger(Number(portText)) ||
    Number(portText) > 65535
  ) {
    throw new Error('CLOUD_PORT must be an integer from 0 to 65535');
  }
  const host = env.CLOUD_HOST ?? '127.0.0.1';
  if (!host.trim()) throw new Error('CLOUD_HOST must not be empty');
  const dataDirText = env.CLOUD_DATA_DIR ?? '.runtime';
  if (!dataDirText.trim()) throw new Error('CLOUD_DATA_DIR must not be empty');
  const dataDir = path.resolve(cwd, dataDirText);
  const mailTransport = env.CLOUD_MAIL_TRANSPORT ?? 'file';
  if (!['file', 'resend'].includes(mailTransport)) throw new Error('Unsupported mail transport');
  if (
    mailTransport === 'resend' &&
    (!env.CLOUD_RESEND_API_KEY?.trim() || !env.CLOUD_MAIL_FROM?.trim())
  ) {
    throw new Error('Resend requires CLOUD_RESEND_API_KEY and CLOUD_MAIL_FROM');
  }
  const mailFrom = env.CLOUD_MAIL_FROM ?? 'WeftMate <no-reply@example.com>';
  if (!mailFrom.trim() || /[\r\n]/.test(mailFrom))
    throw new Error('CLOUD_MAIL_FROM must be a single nonempty line');
  if (env.CLOUD_MAIL_DIR !== undefined && !env.CLOUD_MAIL_DIR.trim())
    throw new Error('CLOUD_MAIL_DIR must not be empty');
  const issuer = env.CLOUD_ISSUER ?? `http://localhost:${Number(portText)}/personal/v1/cloud/oidc`;
  const issuerUrl = new URL(issuer);
  if (
    issuerUrl.pathname !== '/personal/v1/cloud/oidc' ||
    issuerUrl.search ||
    issuerUrl.hash ||
    issuerUrl.username ||
    issuerUrl.password ||
    !(
      issuerUrl.protocol === 'https:' ||
      (issuerUrl.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(issuerUrl.hostname))
    )
  ) {
    throw new Error(
      'CLOUD_ISSUER must be HTTPS (loopback HTTP for development) at /personal/v1/cloud/oidc',
    );
  }
  if (env.CLOUD_TRUST_PROXY !== undefined && !['true', 'false'].includes(env.CLOUD_TRUST_PROXY))
    throw new Error('Invalid CLOUD_TRUST_PROXY');
  const clients = env.CLOUD_OIDC_CLIENTS ? JSON.parse(env.CLOUD_OIDC_CLIENTS) : [];
  if (
    !Array.isArray(clients) ||
    clients.some(
      (client) =>
        !client ||
        typeof client.client_id !== 'string' ||
        !Array.isArray(client.redirect_uris) ||
        !client.redirect_uris.length ||
        Object.keys(client).some((key) => !['client_id', 'redirect_uris', 'application_type'].includes(key)) ||
        (client.application_type !== undefined && !['web', 'native'].includes(client.application_type)) ||
        client.redirect_uris.some((uri) => {
          try {
            const url = new URL(uri);
            return (
              !!(url.hash || url.username || url.password) ||
              !(
                ['https:'].includes(url.protocol) ||
                (url.protocol === 'http:' &&
                  ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) ||
                (url.protocol !== 'http:' &&
                  url.protocol !== 'https:' &&
                  url.protocol.includes('.'))
              )
            );
          } catch {
            return true;
          }
        }),
    )
  )
    throw new Error('Invalid CLOUD_OIDC_CLIENTS');
  if (new Set(clients.map((client) => client.client_id)).size !== clients.length)
    throw new Error('Duplicate cloud client');
  let relay = null;
  if (env.CLOUD_RELAY_DOMAIN) {
    const domain = env.CLOUD_RELAY_DOMAIN;
    const serverName = env.CLOUD_RELAY_SERVER_NAME ?? 'relay.example.com';
    if (![domain, serverName].every(value => /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(value)))
      throw new Error('Relay requires lowercase DNS names');
    const ports = { frpsPort: 7000, frpsHttpsPort: 7443, controlPort: 7001, contentPort: 7444, pluginPort: 8788 };
    for (const key of Object.keys(ports)) {
      const value = env[`CLOUD_RELAY_${key.replace(/[A-Z]/g, c => `_${c}`).toUpperCase()}`] ?? String(ports[key]);
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error('Invalid relay port');
      ports[key] = Number(value);
    }
    if (new Set(Object.values(ports)).size !== 5) throw new Error('Relay ports must differ');
    relay = { domain, serverName, ...ports };
  }
  return Object.freeze({
    relay,
    host,
    port: Number(portText),
    dataDir,
    databasePath: path.join(dataDir, 'cloud.sqlite'),
    mailTransport,
    mailFrom,
    resendApiKey: env.CLOUD_RESEND_API_KEY,
    issuer,
    clients,
    trustProxy: env.CLOUD_TRUST_PROXY === 'true',
    audience: `${issuerUrl.origin}/personal/v1/cloud`,
    mailDir:
      env.CLOUD_MAIL_DIR === undefined
        ? path.join(dataDir, 'mail-outbox')
        : path.resolve(cwd, env.CLOUD_MAIL_DIR),
  });
}
