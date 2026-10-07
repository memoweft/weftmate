/* Code + PKCE and DPoP for the host Web UI and the Android presentation shell.
 * Keys and rotating refresh credentials live in IndexedDB, never localStorage.
 * Network and browser launch can be supplied by the native shell. */
(() => {
  'use strict';
  const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
  const sha = async value => encode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  let database;
  async function db() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('weftmate-cloud-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('credentials');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('STORAGE_UNAVAILABLE'));
    });
    return database;
  }
  async function storage(key, value, remove = false) {
    const opened = await db();
    return new Promise((resolve, reject) => {
      const tx = opened.transaction('credentials', value === undefined && !remove ? 'readonly' : 'readwrite');
      const store = tx.objectStore('credentials');
      const request = remove ? store.delete(key) : value === undefined ? store.get(key) : store.put(value, key);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(new Error('STORAGE_UNAVAILABLE'));
    });
  }
  function secureOrigin(value) {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' ||
        url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('INVALID_CONFIGURATION');
    return url.origin;
  }
  function parsePairing(input) {
    let value = input.trim();
    if (value.includes('#pair=')) value = new URL(value).hash.slice(6);
    if (value.startsWith('wm1.')) value = value.slice(4);
    const pairing = JSON.parse(new TextDecoder().decode(decode(value)));
    if (typeof pairing.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(pairing.challenge) ||
        typeof pairing.hostId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(pairing.tlsSpki)) throw new Error('PAIRING_INVALID');
    secureOrigin(pairing.origin);
    if (pairing.relay?.baseUrl) secureOrigin(pairing.relay.baseUrl);
    return pairing;
  }
  function pairingCode(pairing) { return 'wm1.' + encode(new TextEncoder().encode(JSON.stringify(pairing))); }
  class Client {
    constructor({ host = location.origin, request, launch, redirectUri, clientId, credentialStorage } = {}) {
      this.host = secureOrigin(host);
      this.clientId = clientId;
      this.credentialStorage = credentialStorage || storage;
      this.request = request || (async (url, options = {}) => {
        const response = await fetch(url, { ...options, credentials: new URL(url).origin === this.host ? 'same-origin' : 'omit',
          cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
        const body = await response.json().catch(() => ({}));
        return { status: response.status, body, nonce: response.headers.get('DPoP-Nonce') };
      });
      this.launch = launch || (url => location.assign(url));
      this.redirectUri = redirectUri || this.host + '/personal/v1/ui/';
      this.cancelled = false;
    }
    async json(path, { method = 'GET', body, headers = {} } = {}) {
      const reply = await this.request(this.host + '/personal/v1' + path, { method, headers: {
        ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      if (reply.status >= 400) throw new Error(reply.body?.error?.code || 'NETWORK');
      return reply.body;
    }
    async configure() {
      this.config = await this.json('/cloud/config');
      if (this.clientId) this.config.clientId = this.clientId;
      const origin = secureOrigin(this.config.issuer);
      if (this.config.issuer !== origin + '/personal/v1/cloud/oidc' || !this.config.clientId || !this.config.hostId) throw new Error('INVALID_CONFIGURATION');
      this.base = origin + '/personal/v1/cloud';
      this.keyId = this.config.issuer;
      this.tokenId = 'tokens:' + this.config.issuer + ':' + this.config.clientId + ':' + this.host;
      return this.config;
    }
    async key() {
      if (!this.config) await this.configure();
      let saved = await storage('key:' + this.keyId);
      if (!saved) {
        const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
        saved = { privateKey: pair.privateKey, publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey), deviceId: 'web-' + crypto.randomUUID() };
        await storage('key:' + this.keyId, saved);
      }
      return saved;
    }
    async proof(url, { token, nonce } = {}) {
      const key = await this.key();
      const payload = { htm: 'POST', htu: url, ...(nonce ? { nonce } : {}), ...(token ? { ath: await sha(token) } : {}) };
      return new WeftCloudVendor.SignJWT(payload).setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: key.publicJwk })
        .setIssuedAt().setJti(crypto.randomUUID()).sign(key.privateKey);
    }
    async start({ mode = 'login', claimId, pairing, deviceName = '这台设备' } = {}) {
      await this.configure();
      if (pairing && pairing.hostId !== this.config.hostId) throw new Error('PAIRING_INVALID');
      const key = await this.key();
      const pending = { host: this.host, issuer: this.config.issuer, clientId: this.config.clientId,
        state: random(), nonce: random(), verifier: random(), redirectUri: this.redirectUri,
        mode, claimId, pairing, deviceName, createdAt: Date.now() };
      await storage('pending:' + this.host, pending);
      const url = new URL(this.config.issuer + '/auth');
      const params = { client_id: pending.clientId, redirect_uri: pending.redirectUri, response_type: 'code',
        response_mode: this.redirectUri.startsWith('http') ? 'fragment' : 'query',
        scope: mode === 'bind' ? 'openid offline_access cloud:account' : 'openid offline_access host:session',
        resource: mode === 'bind' ? this.base : this.base + '/hosts/' + this.config.hostId,
        prompt: 'consent', state: pending.state, nonce: pending.nonce,
        code_challenge: await sha(pending.verifier), code_challenge_method: 'S256',
        wm_device_id: key.deviceId, wm_public_jwk: JSON.stringify(key.publicJwk) };
      for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
      await this.launch(url.href);
    }
    async token(form) {
      const url = this.config.issuer + '/token';
      let nonce;
      for (let attempt = 0; attempt < 2; attempt++) {
        const reply = await this.request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded',
          DPoP: await this.proof(url, { nonce }) }, body: new URLSearchParams(form).toString() });
        if (reply.status < 400) return reply.body;
        if (!attempt && reply.body?.error === 'use_dpop_nonce' && reply.nonce) { nonce = reply.nonce; continue; }
        throw new Error(reply.body?.error === 'invalid_grant' ? 'CLOUD_TOKEN_INVALID' : 'CLOUD_UNAVAILABLE');
      }
    }
    async verify(tokens, pending) {
      const jwksReply = await this.request(this.config.issuer + '/jwks');
      if (jwksReply.status !== 200) throw new Error('CLOUD_UNAVAILABLE');
      const keys = WeftCloudVendor.createLocalJWKSet(jwksReply.body);
      if (pending) {
        const identity = (await WeftCloudVendor.jwtVerify(tokens.id_token, keys,
          { issuer: this.config.issuer, audience: this.config.clientId, algorithms: ['RS256'], requiredClaims: ['sub', 'nonce', 'iat', 'exp'] })).payload;
        if (identity.nonce !== pending.nonce) throw new Error('CLOUD_TOKEN_INVALID');
        this.sub = identity.sub;
      }
      const audience = pending?.mode === 'bind' ? this.base : this.base + '/hosts/' + this.config.hostId;
      const access = (await WeftCloudVendor.jwtVerify(tokens.access_token, keys,
        { issuer: this.config.issuer, audience, algorithms: ['RS256'], typ: 'at+jwt', requiredClaims: ['sub', 'iat', 'exp'] })).payload;
      if (this.sub && access.sub !== this.sub) throw new Error('CLOUD_TOKEN_INVALID');
      if (pending?.mode !== 'bind' && tokens.token_type !== 'DPoP') throw new Error('CLOUD_TOKEN_INVALID');
      return access;
    }
    async complete(callback) {
      await this.configure();
      const pending = await storage('pending:' + this.host);
      const url = new URL(callback);
      const params = new URLSearchParams(url.hash.startsWith('#code=') || url.hash.startsWith('#state=') || url.hash.startsWith('#error=') ? url.hash.slice(1) : url.search);
      if (!pending || pending.issuer !== this.config.issuer || pending.clientId !== this.config.clientId ||
          url.protocol + '//' + url.host + url.pathname !== new URL(pending.redirectUri).protocol + '//' + new URL(pending.redirectUri).host + new URL(pending.redirectUri).pathname ||
          params.has('iss') && params.get('iss') !== this.config.issuer ||
          params.getAll('state').length !== 1 || params.get('state') !== pending.state || Date.now() - pending.createdAt > 600000) throw new Error('CLOUD_TOKEN_INVALID');
      await storage('pending:' + this.host, undefined, true);
      if (params.has('error') || params.getAll('code').length !== 1) throw new Error('CLOUD_TOKEN_INVALID');
      const tokens = await this.token({ grant_type: 'authorization_code', client_id: pending.clientId,
        redirect_uri: pending.redirectUri, code: params.get('code'), code_verifier: pending.verifier });
      await this.verify(tokens, pending);
      if (pending.mode === 'bind') {
        // Control-plane credentials are only needed for this local binding transaction.
        return { binding: await this.json('/cloud/binding', { method: 'POST', headers: { 'X-WeftMate-CSRF': (await this.json('/auth/me')).csrfToken },
          body: { claimId: pending.claimId, accessToken: tokens.access_token } }) };
      }
      await this.credentialStorage(this.tokenId, { ...tokens, sub: this.sub, expiresAt: Date.now() + tokens.expires_in * 1000 });
      this.pairing = pending.pairing;
      this.deviceName = pending.deviceName;
      return this.exchange();
    }
    async exchange() {
      if (!this.config) await this.configure();
      let tokens = await this.credentialStorage(this.tokenId);
      if (!tokens) throw new Error('CLOUD_TOKEN_INVALID');
      this.sub = tokens.sub;
      if (tokens.expiresAt < Date.now() + 10000) {
        tokens = { ...await this.token({ grant_type: 'refresh_token', client_id: this.config.clientId,
          refresh_token: tokens.refresh_token, resource: this.base + '/hosts/' + this.config.hostId }), sub: tokens.sub };
        await this.verify(tokens);
        tokens.expiresAt = Date.now() + tokens.expires_in * 1000;
        await this.credentialStorage(this.tokenId, tokens);
      }
      const nonce = await this.json('/auth/cloud-nonce', { method: 'POST', body: {} });
      const path = this.pairing ? '/cloud/pairings/redeem' : '/auth/cloud-session';
      const result = await this.json(path, { method: 'POST', headers: {
        DPoP: await this.proof(this.host + '/personal/v1' + path, { token: tokens.access_token, nonce: nonce.nonce }) },
        body: { accessToken: tokens.access_token, deviceName: this.deviceName || '这台设备', ...(this.pairing ? { challenge: this.pairing.challenge } : {}) } });
      if (result.status !== 'pending_approval') { this.pairing = null; await this.forget(); }
      return result;
    }
    async forget() { if (!this.config) await this.configure(); await this.credentialStorage(this.tokenId, undefined, true); await storage('pending:' + this.host, undefined, true); }
  }
  globalThis.WeftCloud = { Client, parsePairing, pairingCode, storage };
})();
