/* App authorization and rotating credentials. No presentation or native dependencies. */
(() => {
  const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const utf8 = value => new TextEncoder().encode(value);
  const fail = code => { throw { code }; };
  function origin(value) {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) fail('INVALID_CONFIGURATION');
    return url.origin;
  }
  class CloudAuthClient {
    constructor({ fetch, crypto, credentials, vendor, host, redirectUri, nativeKey, now = Date.now }) {
      Object.assign(this, { fetch, crypto, credentials, vendor, nativeKey, now });
      this.host = origin(host); this.redirectUri = redirectUri || this.host + '/personal/v1/ui/';
      this.generation = 0;
    }
    async hash(value) { return encode(await this.crypto.subtle.digest('SHA-256', utf8(value))); }
    random() { return encode(this.crypto.getRandomValues(new Uint8Array(32))); }
    async request(url, { method = 'GET', body, form, headers = {} } = {}) {
      let response;
      try { response = await this.fetch(url, { method, credentials: 'include', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(15000), headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : form ? { body: new URLSearchParams(form).toString() } : {}) }); }
      catch { fail('NETWORK'); }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw { code: data?.error?.code || (data.error === 'invalid_grant' ? 'CLOUD_TOKEN_INVALID' : 'REQUEST_FAILED'), status: response.status,
        retryAfter: Number(response.headers?.get('Retry-After') || 60) };
      return data;
    }
    async configure() {
      try {
        this.config = await this.request(this.host + '/personal/v1/cloud/config');
        await this.credentials('offline-config:' + this.host, this.config);
      } catch (error) {
        if (error.code !== 'NETWORK' && !(error.status >= 500)) throw error;
        this.config = await this.credentials('offline-config:' + this.host);
        if (!this.config) throw error;
      }
      if (this.clientId) this.config.clientId = this.clientId;
      const cloudOrigin = origin(this.config.issuer);
      if (this.config.issuer !== cloudOrigin + '/personal/v1/cloud/oidc' || !this.config.clientId || !this.config.hostId) fail('INVALID_CONFIGURATION');
      this.base = cloudOrigin + '/personal/v1/cloud';
      // Random desktop ports must not create a new login/key on each launch.
      this.storageId = this.config.issuer + ':' + this.config.clientId + (this.nativeKey ? '' : ':' + this.config.hostId);
      this.tokenId = 'app-tokens:' + this.storageId;
      return this.config;
    }
    async key() {
      if (!this.config) await this.configure();
      if (this.nativeKey) return this.nativeKey.get(this.storageId);
      let saved = await this.credentials('app-key:' + this.storageId);
      if (!saved) {
        const pair = await this.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
        saved = { privateKey: pair.privateKey, publicJwk: await this.crypto.subtle.exportKey('jwk', pair.publicKey), deviceId: 'web-' + this.crypto.randomUUID() };
        await this.credentials('app-key:' + this.storageId, saved);
      }
      return saved;
    }
    async proof(url, { method = 'POST', token, nonce } = {}) {
      const key = await this.key();
      const header = encode(utf8(JSON.stringify({ alg: 'ES256', typ: 'dpop+jwt', jwk: key.publicJwk })));
      const payload = encode(utf8(JSON.stringify({ htm: method, htu: url, iat: Math.floor(this.now() / 1000), jti: this.crypto.randomUUID(),
        ...(token ? { ath: await this.hash(token) } : {}), ...(nonce ? { nonce } : {}) })));
      const input = header + '.' + payload;
      const signature = this.nativeKey ? await this.nativeKey.sign(this.storageId, input)
        : encode(await this.crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, utf8(input)));
      return input + '.' + signature;
    }
    async publicRequest(path, body) {
      if (!this.config) await this.configure();
      return this.request(this.base + path, { method: 'POST', body });
    }
    async prepare(deviceName) {
      if (!this.config) await this.configure();
      const key = await this.key();
      const pending = { state: this.random(), nonce: this.random(), verifier: this.random(), createdAt: this.now(), deviceName, generation: ++this.generation };
      const interaction = await this.publicRequest('/auth/authorization', { clientId: this.config.clientId, redirectUri: this.redirectUri,
        deviceId: key.deviceId, publicJwk: key.publicJwk, codeChallenge: await this.hash(pending.verifier), state: pending.state, nonce: pending.nonce });
      if (pending.generation !== this.generation) fail('CLOUD_TOKEN_INVALID');
      this.pending = { ...pending, interactionUid: interaction.interactionUid, csrfToken: interaction.csrfToken };
      return this.pending;
    }
    async begin({ email, password, deviceName, deviceType = 'web' }) {
      const pending = await this.prepare(deviceName), key = await this.key();
      const result = await this.publicRequest('/auth/login', { interactionUid: pending.interactionUid, csrfToken: pending.csrfToken,
        email, password, deviceId: key.deviceId, publicJwk: key.publicJwk, deviceName, deviceType });
      if (pending.generation !== this.generation) fail('CLOUD_TOKEN_INVALID');
      if (result.confirmationRequired) { this.pending.challengeId = result.challengeId; return result; }
      return this.finish(result);
    }
    async confirm(code) {
      if (!/^\d{6}$/.test(code) || !this.pending?.challengeId) fail('CODE_INVALID');
      return this.finish(await this.publicRequest('/auth/device/confirm', { interactionUid: this.pending.interactionUid,
        csrfToken: this.pending.csrfToken, challengeId: this.pending.challengeId, code }));
    }
    async verify(tokens, { pending, audience = this.base, sub } = {}) {
      if (tokens.token_type !== 'DPoP') fail('CLOUD_TOKEN_INVALID');
      const keys = this.vendor.createLocalJWKSet(await this.request(this.config.issuer + '/jwks'));
      if (pending) {
        const identity = (await this.vendor.jwtVerify(tokens.id_token, keys, { issuer: this.config.issuer, audience: this.config.clientId,
          algorithms: ['RS256'], currentDate: new Date(this.now()), requiredClaims: ['sub', 'nonce', 'iat', 'exp'] })).payload;
        if (identity.nonce !== pending.nonce || typeof identity.sub !== 'string' || !identity.sub ||
          Array.isArray(identity.aud) && identity.aud.length > 1 && identity.azp !== this.config.clientId ||
          identity.azp && identity.azp !== this.config.clientId) fail('CLOUD_TOKEN_INVALID');
        sub = identity.sub;
      }
      const access = (await this.vendor.jwtVerify(tokens.access_token, keys, { issuer: this.config.issuer, audience,
        algorithms: ['RS256'], typ: 'at+jwt', currentDate: new Date(this.now()), requiredClaims: ['sub', 'iat', 'exp', 'cnf'] })).payload;
      const key = await this.key(), jwk = key.publicJwk;
      const jkt = await this.hash(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }));
      if (typeof access.sub !== 'string' || !access.sub || (sub && access.sub !== sub) || access.cnf?.jkt !== jkt) fail('CLOUD_TOKEN_INVALID');
      return access;
    }
    async token(form) {
      const url = this.config.issuer + '/token';
      return this.request(url, { method: 'POST', form, headers: { DPoP: await this.proof(url) } });
    }
    async finish(result) {
      const pending = this.pending;
      if (!pending || pending.generation !== this.generation || this.now() - pending.createdAt > 600000) fail('CLOUD_TOKEN_INVALID');
      const resumed = await this.publicRequest('/auth/authorization/resume', { resumeUrl: result.resumeUrl });
      const callback = new URL(resumed.callbackUrl), expected = new URL(this.redirectUri);
      const params = new URLSearchParams(callback.hash ? callback.hash.slice(1) : callback.search);
      if (callback.protocol !== expected.protocol || callback.host !== expected.host || callback.username !== expected.username || callback.password !== expected.password ||
        callback.pathname !== expected.pathname || params.getAll('state').length !== 1 ||
        params.get('state') !== pending.state || params.getAll('code').length !== 1 || params.has('error') ||
        params.getAll('iss').length > 1 || params.has('iss') && params.get('iss') !== this.config.issuer) fail('CLOUD_TOKEN_INVALID');
      const tokens = await this.token({ grant_type: 'authorization_code', client_id: this.config.clientId, redirect_uri: this.redirectUri,
        code: params.get('code'), code_verifier: pending.verifier });
      const access = await this.verify(tokens, { pending });
      if (pending.generation !== this.generation) fail('CLOUD_TOKEN_INVALID');
      this.pending = null;
      await this.credentials(this.tokenId, { refreshToken: tokens.refresh_token, cloud: { token: tokens.access_token, expiresAt: this.now() + tokens.expires_in * 1000 },
        sub: access.sub, email: result.account?.email, deviceName: pending.deviceName });
      return { authenticated: true };
    }
    async saved() { if (!this.config) await this.configure(); return this.credentials(this.tokenId); }
    async access(audience = this.base) {
      // Include the credential read in the existing rotation queue. A slow
      // IndexedDB/native read can otherwise return a consumed refresh token
      // after a previous refresh has finished and cleared the queue.
      if (this.refreshing) { await this.refreshing; return this.access(audience); }
      const generation = this.generation;
      this.refreshing = (async () => {
        const saved = await this.saved();
        if (!saved) fail('CLOUD_TOKEN_INVALID');
        const field = audience === this.base ? 'cloud' : 'host';
        if ((saved[field]?.audience === audience || field === 'cloud') && saved[field]?.expiresAt > this.now() + 30000) return saved[field].token;
        const fresh = await this.token({ grant_type: 'refresh_token', client_id: this.config.clientId, refresh_token: saved.refreshToken, resource: audience });
        await this.verify(fresh, { audience, sub: saved.sub });
        if (generation !== this.generation) fail('CLOUD_TOKEN_INVALID');
        if (!fresh.refresh_token) fail('CLOUD_TOKEN_INVALID');
        await this.credentials(this.tokenId, { ...saved, refreshToken: fresh.refresh_token,
          [field]: { token: fresh.access_token, audience, expiresAt: this.now() + fresh.expires_in * 1000 } });
        return fresh.access_token;
      })();
      const current = this.refreshing;
      try { return await current; } finally { if (this.refreshing === current) this.refreshing = null; }
    }
    async name(deviceName) {
      const previous = this.refreshing;
      const current = (async () => { if (previous) await previous; const saved = await this.saved();
        if (saved) await this.credentials(this.tokenId, { ...saved, deviceName }); })();
      this.refreshing = current;
      try { await current; } finally { if (this.refreshing === current) this.refreshing = null; }
    }
    async authorized(path, { method = 'GET', body } = {}) {
      const token = await this.access(), url = this.base + path;
      return this.request(url, { method, body, headers: { Authorization: 'DPoP ' + token, DPoP: await this.proof(url, { method, token }) } });
    }
    async exchange(desktop = false, pairing = null) {
      const saved = await this.saved();
      const resource = this.base + '/hosts/' + this.config.hostId;
      if (!desktop) await this.authorized('/hosts/connect', { method: 'POST', body: { hostId: this.config.hostId } });
      const token = await this.access(desktop ? this.base : resource);
      const nonce = await this.request(this.host + '/personal/v1/auth/cloud-nonce', { method: 'POST', body: {} });
      const path = desktop ? '/auth/cloud-desktop' : pairing ? '/cloud/pairings/redeem' : '/auth/cloud-session';
      const url = this.host + '/personal/v1' + path;
      return this.request(url, { method: 'POST', headers: { DPoP: await this.proof(url, { token, nonce: nonce.nonce }) },
        body: { accessToken: token, deviceName: saved.deviceName || '这台设备', ...(pairing ? { challenge: pairing.challenge } : {}) } });
    }
    async forget() { this.generation++; this.pending = null; if (this.tokenId) await this.credentials(this.tokenId, undefined, true); }
    async resetKey() { if (this.nativeKey) await this.nativeKey.clear(this.storageId); else await this.credentials('app-key:' + this.storageId, undefined, true); }
  }
  globalThis.WeftUiCore.CloudAuthClient = CloudAuthClient;
})();
