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
    constructor({ fetch, crypto, credentials, vendor, host, redirectUri, nativeKey, localCsrf, now = Date.now }) {
      Object.assign(this, { fetch, crypto, credentials, vendor, nativeKey, localCsrf, now });
      this.host = origin(host); this.redirectUri = redirectUri || this.host + '/personal/v1/ui/';
      this.generation = 0;
    }
    async hash(value) { return encode(await this.crypto.subtle.digest('SHA-256', utf8(value))); }
    random() { return encode(this.crypto.getRandomValues(new Uint8Array(32))); }
    async pairingDigest(values) {
      return this.nativeKey?.pairingDigest ? this.nativeKey.pairingDigest(values) : this.hash(JSON.stringify(values));
    }
    async pairingCode(transcript, hostNonce, deviceId, phoneJkt, phoneNonce) {
      const digest = await this.pairingDigest(['wm-pair-sas-v2', ...transcript, hostNonce, deviceId, phoneJkt, phoneNonce]);
      const bytes = Uint8Array.from(atob(digest.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      return String(new DataView(bytes.buffer).getUint32(0, false) % 1000000).padStart(6, '0');
    }
    parsePairing(input) {
      try {
        let value = input.trim();
        if (value.includes('#pair=')) value = new URL(value).hash.slice(6);
        if (!value.startsWith('wm1.') && !input.includes('#pair=')) fail('PAIRING_INVALID');
        if (value.startsWith('wm1.')) value = value.slice(4);
        if (value.length > 16384) fail('PAIRING_INVALID');
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))));
      } catch { fail('PAIRING_INVALID'); }
    }
    async checkPairing(pairing, hostId = this.config.hostId) {
      const saved = await this.saved();
      const field = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
      try {
        if (pairing.version !== 2 || pairing.issuer !== this.config.issuer || pairing.sub !== saved?.sub ||
            typeof pairing.hostId !== 'string' || !pairing.hostId || pairing.hostId !== hostId ||
            !field(pairing.challenge) || !field(pairing.tlsSpki) || !field(pairing.hostCommitment) ||
            !Number.isSafeInteger(pairing.expiresAt) || pairing.expiresAt > this.now() + 120000) fail('PAIRING_INVALID');
        for (const value of [pairing.origin, ...(pairing.relay?.baseUrl ? [pairing.relay.baseUrl] : [])]) {
          if (typeof value !== 'string' || origin(value) !== value) fail('PAIRING_INVALID');
        }
        const jwk = pairing.publicJwk;
        if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !field(jwk.x) || !field(jwk.y) || jwk.d) fail('PAIRING_INVALID');
        await this.crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
        const prior = await this.credentials('trusted-host:' + hostId);
        if (prior && (prior.tlsSpki !== pairing.tlsSpki || await this.jkt(prior.publicJwk) !== await this.jkt(jwk))) fail('PAIRING_INVALID');
      } catch { fail('PAIRING_INVALID'); }
      if (pairing.expiresAt <= this.now()) fail('PAIRING_EXPIRED');
      return [2, pairing.issuer, pairing.sub, pairing.hostId, pairing.tlsSpki, await this.jkt(pairing.publicJwk),
        pairing.challenge, pairing.expiresAt, pairing.origin, pairing.relay?.baseUrl || ''];
    }
    async jkt(jwk) { return this.hash(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })); }
    async pair(pairing, { onComparison = () => {}, current = () => true, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
      const generation = this.generation, host = this.host, transcript = await this.checkPairing(pairing);
      const check = () => {
        if (generation !== this.generation || this.host !== host || !current()) fail('PAIRING_STOPPED');
        if (this.now() >= pairing.expiresAt) fail('PAIRING_EXPIRED');
      };
      check();
      const resource = this.base + '/hosts/' + pairing.hostId, saved = await this.saved(), key = await this.key();
      const token = await this.access(resource);
      const access = await this.verify({ token_type: 'DPoP', access_token: token }, { audience: resource, sub: saved.sub });
      if (access.device_id !== key.deviceId || access.host_id !== pairing.hostId || !access.scope?.split(' ').includes('host:session')) fail('CLOUD_TOKEN_INVALID');
      const deviceId = access.device_id, phoneJkt = access.cnf.jkt, phoneNonce = this.random();
      const phoneCommitment = await this.pairingDigest(['wm-pair-phone-v2', pairing.challenge, deviceId, phoneJkt, phoneNonce]);
      const request = async (action, extra = {}) => {
        check();
        const nonce = await this.request(host + '/personal/v1/auth/cloud-nonce', { method: 'POST', body: {} });
        check();
        const url = host + '/personal/v1/cloud/pairings/' + action;
        const proof = await this.proof(url, { token, nonce: nonce.nonce });
        check();
        const result = await this.request(url, { method: 'POST', headers: { DPoP: proof },
          body: { accessToken: token, deviceName: saved.deviceName || '这台手机', challenge: pairing.challenge, ...extra } });
        check(); return result;
      };
      const joined = await request('join', { phoneCommitment });
      if (joined.state !== 'committed' || joined.expiresAt !== pairing.expiresAt || !/^[A-Za-z0-9_-]{43}$/.test(joined.hostNonce) ||
          await this.pairingDigest(['wm-pair-host-v2', ...transcript, joined.hostNonce]) !== pairing.hostCommitment) fail('PAIRING_HOST_MISMATCH');
      const revealed = await request('reveal', { phoneNonce });
      if (revealed.state !== 'comparing' || revealed.hostNonce !== joined.hostNonce || revealed.expiresAt !== pairing.expiresAt) fail('PAIRING_HOST_MISMATCH');
      const verificationCode = await this.pairingCode(transcript, joined.hostNonce, deviceId, phoneJkt, phoneNonce);
      check(); await onComparison({ verificationCode, expiresAt: pairing.expiresAt });
      for (;;) {
        try {
          const result = await request('redeem');
          if (!result.hostTrust) fail('HOST_TRUST_INVALID');
          await this.acceptHostTrust(result, saved, pairing, check);
          check(); return result;
        } catch (error) {
          if (error.status !== 403 || error.code !== 'PAIRING_CONFIRMATION_REQUIRED') throw error;
          check(); await wait(Math.min(1000, pairing.expiresAt - this.now()));
        }
      }
    }
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
      let config;
      try {
        config = await this.request(this.host + '/personal/v1/cloud/config');
        await this.credentials('offline-config:' + this.host, config);
      } catch (error) {
        if (error.code !== 'NETWORK' && !(error.status >= 500)) throw error;
        config = await this.credentials('offline-config:' + this.host);
        if (!config) throw error;
      }
      if (this.clientId) config.clientId = this.clientId;
      const cloudOrigin = origin(config.issuer);
      if (config.issuer !== cloudOrigin + '/personal/v1/cloud/oidc' || !config.clientId || !config.hostId) fail('INVALID_CONFIGURATION');
      // Random desktop ports must not create a new login/key on each launch.
      const storageId = config.issuer + ':' + config.clientId + (this.nativeKey ? '' : ':' + config.hostId);
      // Publish only a complete configuration. Failed cache writes must not make
      // saved()/key() skip initialization with an unknown credential identity.
      Object.assign(this, { config, base: cloudOrigin + '/personal/v1/cloud', storageId, tokenId: 'app-tokens:' + storageId });
      return config;
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
    async beginCode({ email, deviceName, deviceType = 'web' }) {
      const pending = await this.prepare(deviceName), key = await this.key();
      const result = await this.publicRequest('/auth/login/code/request', { interactionUid: pending.interactionUid,
        csrfToken: pending.csrfToken, email, deviceId: key.deviceId, publicJwk: key.publicJwk, deviceName, deviceType });
      if (pending.generation !== this.generation) fail('CLOUD_TOKEN_INVALID');
      this.pending.challengeId = result.challengeId;
      return result;
    }
    async confirmCode(code) {
      if (!/^\d{6}$/.test(code) || !this.pending?.challengeId) fail('INVALID_LOGIN_CODE');
      return this.finish(await this.publicRequest('/auth/login/code/confirm', { interactionUid: this.pending.interactionUid,
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
      if (access.device_verified !== true) fail('CLOUD_DEVICE_VERIFICATION_REQUIRED');
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
      const generation = this.generation;
      const previous = this.refreshing;
      const current = (async () => { if (previous) await previous; const saved = await this.saved();
        if (generation !== this.generation) fail('CLOUD_TOKEN_INVALID');
        if (saved) await this.credentials(this.tokenId, { ...saved, deviceName }); })();
      this.refreshing = current;
      try { await current; } finally { if (this.refreshing === current) this.refreshing = null; }
    }
    async authorized(path, { method = 'GET', body, current } = {}) {
      const check = () => { if (current && !current()) fail('CLOUD_TOKEN_INVALID'); };
      check();
      const token = await this.access(), url = this.base + path;
      check();
      const proof = await this.proof(url, { method, token });
      check(); // In particular, native signing may finish after a newer login.
      return this.request(url, { method, body, headers: { Authorization: 'DPoP ' + token, DPoP: proof } });
    }
    async channel(connection, request) {
      const generation = this.generation, saved = await this.saved();
      await this.authorized('/hosts/connect', {method:'POST',body:{hostId:connection.hostId}});
      const token = await this.access(this.base + '/hosts/' + connection.hostId);
      const nonce = await request('/personal/v1/auth/cloud-nonce', {method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      const url = connection.baseUrl + '/personal/v1/auth/cloud-channel';
      const proof = await this.proof(url, {token,nonce:nonce.nonce});
      const session = await request('/personal/v1/auth/cloud-channel', {method:'POST',headers:{'content-type':'application/json',DPoP:proof},
        body:JSON.stringify({accessToken:token,deviceName:saved.deviceName || '这台设备'})});
      if (generation !== this.generation) fail('CLOUD_TOKEN_INVALID');
      const trust = session.hostTrust, key = await this.key();
      if (!trust?.publicJwk || !session.token) fail('HOST_TRUST_INVALID');
      const jkt = await this.hash(JSON.stringify({crv:key.publicJwk.crv,kty:key.publicJwk.kty,x:key.publicJwk.x,y:key.publicJwk.y}));
      const {payload} = await this.vendor.jwtVerify(trust.trustToken,this.vendor.createLocalJWKSet({keys:[trust.publicJwk]}),{
        algorithms:['ES256'],typ:'wm-host-trust+jwt',issuer:connection.hostId,audience:jkt,maxTokenAge:'120s',clockTolerance:30,currentDate:new Date(this.now())});
      if(payload.sub!==saved.sub || payload.deviceId!==key.deviceId || payload.hostId!==connection.hostId || payload.jkt!==jkt) fail('HOST_TRUST_INVALID');
      const prior = await this.credentials('trusted-host:'+connection.hostId);
      if(prior?.publicJwk && await this.hash(JSON.stringify({crv:prior.publicJwk.crv,kty:prior.publicJwk.kty,x:prior.publicJwk.x,y:prior.publicJwk.y})) !==
        await this.hash(JSON.stringify({crv:trust.publicJwk.crv,kty:trust.publicJwk.kty,x:trust.publicJwk.x,y:trust.publicJwk.y}))) fail('HOST_TRUST_INVALID');
      await this.credentials('trusted-host:'+connection.hostId,{tlsSpki:payload.tlsSpki,publicJwk:trust.publicJwk,origin:connection.baseUrl});
      return session;
    }
    async exchange(desktop = false) {
      const generation = this.generation, csrf = desktop ? this.localCsrf?.() : undefined;
      const saved = await this.saved();
      if (generation !== this.generation) fail('CLOUD_TOKEN_INVALID');
      const resource = this.base + '/hosts/' + this.config.hostId;
      if (!desktop) await this.authorized('/hosts/connect', { method: 'POST', body: { hostId: this.config.hostId } });
      const token = await this.access(desktop ? this.base : resource);
      const nonce = await this.request(this.host + '/personal/v1/auth/cloud-nonce', { method: 'POST', body: {} });
      if (generation !== this.generation) fail('CLOUD_TOKEN_INVALID');
      const path = desktop ? '/auth/cloud-desktop' : '/auth/cloud-session';
      const url = this.host + '/personal/v1' + path;
      const proof = await this.proof(url, { token, nonce: nonce.nonce });
      if (generation !== this.generation) fail('CLOUD_TOKEN_INVALID');
      const result = await this.request(url, { method: 'POST', headers: { DPoP: proof,
        ...(csrf ? { 'X-WeftMate-CSRF': csrf } : {}) },
        body: { accessToken: token, deviceName: saved.deviceName || '这台设备' } });
      if (generation !== this.generation) fail('CLOUD_TOKEN_INVALID');
      await this.acceptHostTrust(result, saved);
      return result;
    }
    async acceptHostTrust(result, saved, pairing, current = () => {}) {
      if (result.hostTrust) {
        const trust = result.hostTrust, key = await this.key();
        const jkt = await this.hash(JSON.stringify({ crv: key.publicJwk.crv, kty: key.publicJwk.kty, x: key.publicJwk.x, y: key.publicJwk.y }));
        const { payload } = await this.vendor.jwtVerify(trust.trustToken, this.vendor.createLocalJWKSet({ keys: [trust.publicJwk] }), {
          algorithms: ['ES256'], typ: 'wm-host-trust+jwt', issuer: this.config.hostId, audience: jkt,
          requiredClaims: ['iat','exp','jti','sub','hostId','deviceId','jkt','tlsSpki','publicJwk'],
          maxTokenAge: '120s', clockTolerance:30, currentDate: new Date(this.now()) });
        if (payload.sub !== saved.sub || payload.deviceId !== key.deviceId || payload.hostId !== this.config.hostId ||
            payload.jkt !== jkt || payload.exp - payload.iat > 120 || payload.iat * 1000 > this.now() + 30000 || payload.exp * 1000 <= this.now() ||
            !/^[A-Za-z0-9_-]{43}$/.test(payload.tlsSpki) ||
            await this.hash(JSON.stringify({ crv: payload.publicJwk.crv, kty: payload.publicJwk.kty, x: payload.publicJwk.x, y: payload.publicJwk.y })) !== await this.hash(JSON.stringify({ crv: trust.publicJwk.crv, kty: trust.publicJwk.kty, x: trust.publicJwk.x, y: trust.publicJwk.y }))) fail('HOST_TRUST_INVALID');
        // The initial anchor comes from the authenticated host TLS connection
        // under the existing D24 browser boundary; native pins retain this key.
        const prior = await this.credentials('trusted-host:' + this.config.hostId);
        if (prior?.publicJwk && await this.hash(JSON.stringify({ crv: prior.publicJwk.crv, kty: prior.publicJwk.kty, x: prior.publicJwk.x, y: prior.publicJwk.y })) !==
            await this.hash(JSON.stringify({ crv: trust.publicJwk.crv, kty: trust.publicJwk.kty, x: trust.publicJwk.x, y: trust.publicJwk.y }))) fail('HOST_TRUST_INVALID');
        if (pairing && (payload.tlsSpki !== pairing.tlsSpki || await this.jkt(trust.publicJwk) !== await this.jkt(pairing.publicJwk) ||
            payload.origin !== pairing.origin || (payload.relay?.baseUrl || '') !== (pairing.relay?.baseUrl || ''))) fail('HOST_TRUST_INVALID');
        current();
        await this.credentials('trusted-host:' + this.config.hostId, { tlsSpki: payload.tlsSpki, publicJwk: trust.publicJwk,
          origin: payload.origin, relay: payload.relay, connectionOrigin: this.host });
      }
      return result;
    }
    async forget() { this.generation++; this.pending = null; if (this.tokenId) await this.credentials(this.tokenId, undefined, true); }
    async resetKey() { if (this.nativeKey) await this.nativeKey.clear(this.storageId); else await this.credentials('app-key:' + this.storageId, undefined, true); }
  }
  globalThis.WeftUiCore.CloudAuthClient = CloudAuthClient;
})();
