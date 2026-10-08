/* Account journeys, device actions, errors and deadlines shared by every presentation. */
globalThis.WeftUiCore.factories.cloudAccount = (core, effects, environment) => {
  const auth = { mode: 'login', step: 'email', email: '', error: '', busy: false, resendAt: 0, retryAt: 0, deviceName: '这台设备', devices: [], hosts: [] };
  core.state.cloudAuth = auth;
  let client, waitTimer, renewalTimer, journey = 0, exchangeInFlight;
  const now = () => environment.now?.() ?? Date.now();
  const paint = () => effects.paintCloudAuth?.(cloudAuthView());
  function cloudAuthView() {
    const retrySeconds = Math.max(0, Math.ceil((auth.retryAt - now()) / 1000));
    const error = auth.retryAt && auth.error.startsWith('尝试太多次')
      ? retrySeconds ? `尝试太多次，请等待 ${retrySeconds} 秒后重试。` : '等待已结束，可以重试。' : auth.error;
    return { ...auth, error, resendSeconds: Math.max(0, Math.ceil((auth.resendAt - now()) / 1000)), retrySeconds };
  }
  function cloudError(error) {
    const code = error?.code || error?.message;
    if (code === 'RATE_LIMITED' || code === 'LOGIN_RATE_LIMITED') { auth.retryAt = now() + Math.max(1, error.retryAfter || 60) * 1000; return `尝试太多次，请等待 ${Math.ceil((auth.retryAt - now()) / 1000)} 秒后重试。`; }
    return ({ INVALID_CREDENTIALS: '邮箱或密码不对，请重试。', INVALID_EMAIL: '请填写有效的邮箱地址。', EMAIL_IN_USE: '无法使用这个邮箱，请换一个邮箱或尝试登录。',
      CODE_INVALID: '验证码不对，请重新输入。', CHALLENGE_INVALID: '验证码已失效，请重新发送。', PASSWORD_TICKET_INVALID: '验证已失效，请重新发送验证码。',
      CLOUD_TOKEN_INVALID: '登录已失效，请重新登录。', UNAUTHORIZED: '登录已失效，请重新登录。', DEVICE_NOT_TRUSTED: '这台设备未获允许，请在已登录设备上重新批准。',
      NETWORK: '网络不通，请检查连接后重试。', STORAGE_UNAVAILABLE: '无法安全记住本设备，请检查设备存储后重试。',
      PAIRING_INVALID: '配对码已失效或不属于这台电脑，请获取新码。', PAIRING_REQUIRED: '请在目标电脑显示二维码，并输入配对码后连接。',
      HOST_TRUST_INVALID: '可信交付码已失效或不属于本设备，请在已登录设备上重新获取。',
      PASSWORD_MISMATCH: '两次输入的密码不一致。', EMERGENCY_PASSWORD_INVALID: '离线密码须为 15–128 个字符。',
      INVALID_PASSWORD: '密码须为 8–128 个字符。', MAIL_UNAVAILABLE: '验证码暂时无法发送，请稍后重试。' })[code] || '操作未完成，请重试。';
  }
  function cloudPasswordHint(password) {
    if (Array.from(password).length < 8) return '至少 8 位';
    const variety = [/\p{L}/u, /\p{N}/u, /[^\p{L}\p{N}]/u].filter(re => re.test(password)).length;
    return password.length >= 14 && variety >= 2 ? '强度：较强' : variety >= 2 ? '强度：适中，建议再长一些' : '强度：较弱，建议混合文字、数字或符号';
  }
  function validPassword(password, confirmation) {
    if (Array.from(password).length < 8 || Array.from(password).length > 128) throw { code: 'INVALID_PASSWORD' };
    if (password !== confirmation) throw { code: 'PASSWORD_MISMATCH' };
  }
  async function run(action) {
    if (auth.busy) return;
    const ticket = journey; auth.busy = true; auth.error = ''; paint();
    try { return await action(); }
    catch (error) { if (ticket === journey) auth.error = error.code === 'PASSWORD_MISMATCH' ? '两次输入的密码不一致。' : cloudError(error); }
    finally { if (ticket === journey) { auth.busy = false; paint(); } }
  }
  function startCloudJourney(mode = 'login') {
    journey++; clearTimeout(waitTimer); client.generation++; client.pending = null;
    Object.assign(auth, { mode, step: 'email', error: '', busy: false, challengeId: null, passwordTicket: null, requestId: null, devices: [], hosts: [], resendAt: 0, retryAt: 0 });
    core.show('login'); paint();
  }
  async function cloudRequestCode(email = auth.email) {
    if (cloudAuthView().resendSeconds) return;
    return run(async () => {
      const ticket = journey;
      auth.email = email.trim().toLowerCase();
      if (auth.mode === 'registration' && !client.pending) await client.prepare(auth.deviceName);
      const result = await client.publicRequest(`/auth/${auth.mode === 'recovery' ? 'recovery' : 'registration'}/request`, { email: auth.email });
      if (ticket !== journey) return;
      auth.challengeId = result.challengeId; auth.resendAt = now() + 60000; auth.step = 'code';
    });
  }
  async function cloudVerifyCode(code) {
    return run(async () => {
      const ticket = journey;
      if (!/^\d{6}$/.test(code)) throw { code: 'CODE_INVALID' };
      if (auth.mode === 'confirm') { await client.confirm(code); await finishCloudLogin(); return; }
      const result = await client.publicRequest(`/auth/${auth.mode}/verify`, { challengeId: auth.challengeId, code });
      if (ticket !== journey) return;
      auth.passwordTicket = result.passwordTicket; auth.challengeId = null; auth.step = 'password';
    });
  }
  async function cloudComplete({ password, confirmation, deviceName }) {
    return run(async () => {
      const ticket = journey;
      validPassword(password, confirmation);
      const mode = auth.mode;
      await client.publicRequest(`/auth/${mode}/complete`, { passwordTicket: auth.passwordTicket, password });
      if (ticket !== journey) return;
      auth.passwordTicket = null;
      if (mode === 'recovery') { startCloudJourney(); effects.toast('密码已重设，请登录。'); return; }
      auth.deviceName = deviceName.trim() || auth.deviceName;
      await beginCloudLogin(auth.email, password);
    });
  }
  async function beginCloudLogin(email, password) {
    const ticket = journey;
    auth.email = email.trim().toLowerCase();
    const result = await client.begin({ email: auth.email, password, deviceName: auth.deviceName, deviceType: environment.desktop ? 'windows' : 'web' });
    if (ticket !== journey) return;
    if (result.confirmationRequired) { auth.mode = 'confirm'; auth.step = 'code'; auth.resendAt = 0; return; }
    await finishCloudLogin(ticket);
  }
  async function cloudLogin({ email, password }) {
    if (cloudAuthView().retrySeconds) return;
    return run(() => beginCloudLogin(email, password));
  }
  async function finishCloudLogin(ticket = journey) {
    if (exchangeInFlight) return exchangeInFlight;
    const current = applyCloudSession(ticket); exchangeInFlight = current;
    try { return await current; } finally { if (exchangeInFlight === current) exchangeInFlight = null; }
  }
  async function applyCloudSession(ticket) {
    const result = await client.exchange(environment.bindDesktop ?? environment.desktop);
    if (ticket !== journey) return;
    const saved = await client.saved();
    if (ticket !== journey) return;
    auth.sub = saved.sub; auth.email = saved.email || auth.email;
    // Offline account selection contains no credential and remains after cloud logout/deletion.
    await environment.cloudCredentials('offline-account', { sub: saved.sub, email: auth.email, deviceName: saved.deviceName }); auth.offlineKnown = true;
    if (ticket !== journey) return;
    if (result.status === 'pending_approval') {
      auth.mode = 'waiting'; auth.requestId = result.requestId;
      try { const directory = await client.authorized('/devices'); auth.devices = directory.devices; auth.hosts = directory.hosts; } catch { /* waiting remains usable offline */ }
      if (ticket !== journey) return;
      core.show('cloud-wait'); paint();
      clearTimeout(waitTimer); waitTimer = setTimeout(() => void retryCloudApproval(ticket), 3000); return;
    }
    clearTimeout(waitTimer); waitTimer = null;
    auth.mode = 'authenticated'; paint(); core.acceptSession(result); await core.enterAssistant();
    await core.refreshPendingDevices(); scheduleRenewal();
    const draft = await environment.cloudCredentials('draft:' + saved.sub);
    if (draft) { effects.restoreCloudDraft?.(draft); await environment.cloudCredentials('draft:' + saved.sub, undefined, true); }
  }
  async function retryCloudApproval(ticket = journey) {
    if (ticket !== journey || auth.mode !== 'waiting') return;
    try { await finishCloudLogin(ticket); }
    catch (error) { if (ticket !== journey) return; auth.error = cloudError(error); paint();
      if (['CLOUD_TOKEN_INVALID', 'UNAUTHORIZED'].includes(error.code)) { await expireCloudSession(); return; }
      if (!['DEVICE_NOT_TRUSTED', 'CLOUD_TOKEN_INVALID'].includes(error.code)) waitTimer = setTimeout(() => void retryCloudApproval(ticket), 10000); }
  }
  function scheduleRenewal() {
    clearTimeout(renewalTimer);
    renewalTimer = setTimeout(() => void renewCloudSession(), 60000);
  }
  async function renewCloudSession() {
    try { await client.access(); if (auth.mode === 'authenticated') scheduleRenewal(); }
    catch (error) { if (error.code === 'NETWORK') { scheduleRenewal(); return; } await expireCloudSession(); }
  }
  async function expireCloudSession(email = auth.email) {
    const draft = effects.readMessageDraft?.() || core.state.desktopDraft;
    if (draft && auth.sub) await environment.cloudCredentials('draft:' + auth.sub, draft);
    clearTimeout(renewalTimer); clearTimeout(waitTimer); journey++;
    await client.forget();
    // Clear the host cookie as well as the in-memory projection.
    try { await core.api('/logout', { method: 'POST', protectedWrite: true, body: {} }); } catch { /* revoked cookies are already unusable */ }
    core.clearSession(); auth.email = email; startCloudJourney();
  }
  async function cancelCloudJourney() { await client.forget(); await client.resetKey(); startCloudJourney(); }
  async function cloudOfflineLogin({ password, cloudAccountId, username }) {
    return run(async () => {
      const remembered = await environment.cloudCredentials('offline-account');
      const sub = cloudAccountId || remembered?.sub;
      const result = sub ? await core.api('/cloud-offline', { method: 'POST', body: { cloudAccountId: sub, password, deviceName: auth.deviceName } })
        : await core.api('/login', { method: 'POST', body: { username, password, deviceName: auth.deviceName } });
      auth.mode = 'offline'; paint(); core.acceptSession(result); await core.enterAssistant();
    });
  }
  async function cloudDirectory() {
    const generation = client.generation;
    let result;
    try { result = await client.authorized('/devices'); }
    catch (error) {
      if (generation === client.generation && ['CLOUD_TOKEN_INVALID', 'UNAUTHORIZED'].includes(error.code)) await expireCloudSession();
      throw error;
    }
    if (generation !== client.generation) throw { code: 'CLOUD_TOKEN_INVALID' };
    auth.devices = result.devices; auth.hosts = result.hosts; return result;
  }
  async function cloudRename(id, name) {
    name = name.trim(); if (!name || Array.from(name).length > 128) throw { code: 'INVALID_DEVICE' };
    const current = auth.devices.some(device => device.id === id && device.isCurrent);
    await client.authorized('/devices/rename', { method: 'POST', body: { deviceId: id, name } });
    if (current) {
      auth.deviceName = name; await client.name(name);
      const saved = await client.saved(); await environment.cloudCredentials('offline-account', { sub: saved.sub, email: saved.email, deviceName: name });
    }
    return cloudDirectory();
  }
  async function cloudRemove(id) {
    const current = auth.devices.some(device => device.id === id && device.isCurrent);
    await client.authorized('/auth/devices/revoke', { method: 'POST', body: { deviceId: id } });
    if (current) { await expireCloudSession(); return { devices: [], hosts: [] }; }
    return cloudDirectory();
  }
  async function cloudConnect(hostId) { return client.authorized('/hosts/connect', { method: 'POST', body: { hostId } }); }
  async function cloudTrust(requestId) { return core.accessApi(`/cloud/devices/${encodeURIComponent(requestId)}/trust`, { method: 'POST', protectedWrite: true, body: {} }); }
  function cloudTrustMaterial(trust) {
    // This key comes from the already authenticated sender's host connection,
    // then travels separately from the signed token through the user's QR/code.
    return 'wmt1.' + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ token: trust.trustToken, anchor: trust.publicJwk, hostId: trust.hostId })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function cloudImportTrust(input) {
    try {
      const value = input.trim(); if (!value.startsWith('wmt1.')) throw new Error();
      const material = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.slice(5).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))));
      const key = await client.key(), jwk = key.publicJwk;
      const jkt = await client.hash(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }));
      const saved = await client.saved();
      const { payload } = await environment.cloudVendor.jwtVerify(material.token, await environment.cloudVendor.importJWK(material.anchor, 'ES256'), {
        algorithms: ['ES256'], typ: 'wm-host-trust+jwt', issuer: material.hostId, audience: jkt, requiredClaims: ['iat', 'exp', 'jti', 'sub', 'hostId', 'deviceId', 'jkt', 'tlsSpki', 'publicJwk'], maxTokenAge: '120s', currentDate: new Date(now()) });
      if (payload.sub !== saved.sub || ![client.config.hostId, ...auth.hosts.map(host => host.hostId)].includes(payload.hostId) || payload.deviceId !== key.deviceId || payload.jkt !== jkt ||
        payload.exp - payload.iat > 120 || payload.iat * 1000 > now() + 30000 || !/^[A-Za-z0-9_-]{43}$/.test(payload.tlsSpki) ||
        await environment.cloudVendor.calculateJwkThumbprint(payload.publicJwk) !== await environment.cloudVendor.calculateJwkThumbprint(material.anchor)) throw new Error();
      await environment.cloudCredentials('trusted-host:' + payload.hostId, { tlsSpki: payload.tlsSpki, publicJwk: material.anchor, origin: payload.origin, relay: payload.relay });
      return finishCloudLogin();
    } catch { throw { code: 'HOST_TRUST_INVALID' }; }
  }
  async function cloudEmailRequest(email) { const result = await client.authorized('/auth/email/change/request', { method: 'POST', body: { email } }); auth.emailChange = { email, challengeId: result.challengeId, resendAt: now() + 60000 }; return result; }
  async function cloudEmailConfirm(code) { const result = await client.authorized('/auth/email/change/confirm', { method: 'POST', body: { challengeId: auth.emailChange.challengeId, code } }); auth.emailChange = null; await expireCloudSession(result.account.email); return result; }
  async function cloudChangePassword(currentPassword, password, confirmation) { validPassword(password, confirmation); const result = await client.authorized('/auth/password/change', { method: 'POST', body: { currentPassword, password } }); await expireCloudSession(); return result; }
  async function cloudLogout() {
    if (auth.mode !== 'offline') { await client.authorized('/auth/logout', { method: 'POST', body: {} }); await client.resetKey(); }
    await expireCloudSession();
  }
  async function cloudLogoutOthers() { return client.authorized('/auth/logout/others', { method: 'POST', body: {} }); }
  async function cloudDeleteAccount(password) { const result = await client.authorized('/auth/account/delete', { method: 'POST', body: { password } }); await expireCloudSession(''); return result; }
  async function cloudEmergencyPassword(password, confirmation) {
    if (Array.from(password).length < 15 || Array.from(password).length > 128) throw { code: 'EMERGENCY_PASSWORD_INVALID' };
    if (password !== confirmation) throw { code: 'PASSWORD_MISMATCH' };
    return core.accessApi('/cloud/emergency-password', { method: 'POST', protectedWrite: true, body: { password } });
  }
  async function cloudPairing() { const result = await core.accessApi('/cloud/pairings', { method: 'POST', protectedWrite: true, body: {} }); return result; }
  async function cloudRedeemPairing(input) {
    let value = input.trim(); if (value.includes('#pair=')) value = new URL(value).hash.slice(6); if (value.startsWith('wm1.')) value = value.slice(4);
    let pairing;
    try { pairing = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))); }
    catch { throw { code: 'PAIRING_INVALID' }; }
    if (pairing.hostId !== client.config.hostId || !/^[A-Za-z0-9_-]{43}$/.test(pairing.challenge) || !/^[A-Za-z0-9_-]{43}$/.test(pairing.tlsSpki)) throw { code: 'PAIRING_INVALID' };
    const result = await client.exchange(false, pairing); core.acceptSession(result); return result;
  }
  async function cloudConnectTrusted(connection) {
    if (connection.hostId !== client.config.hostId) {
      const trusted = await environment.cloudCredentials('trusted-host:' + connection.hostId);
      if (!trusted || !connection.baseUrl) throw { code: 'PAIRING_REQUIRED' };
      await effects.openCloudHost?.({ hostId: connection.hostId, baseUrl: connection.baseUrl }); return connection;
    }
    const result = await client.exchange(false); if (result.status === 'pending_approval') { await finishCloudLogin(); return; }
    core.acceptSession(result); return result;
  }
  async function cloudApproveOffline(password) {
    if (!environment.desktop || environment.bindDesktop === false || !auth.requestId) throw { code: 'FORBIDDEN' };
    const saved = await client.saved();
    core.acceptSession(await core.api('/cloud-offline', { method: 'POST', body: { cloudAccountId: saved.sub, password, deviceName: auth.deviceName } }));
    await core.decideDevice(auth.requestId, 'allow');
    return finishCloudLogin();
  }
  function initializeCloudAccount() {
    client = new globalThis.WeftUiCore.CloudAuthClient({ fetch: environment.fetch, crypto: environment.crypto,
      credentials: environment.cloudCredentials, vendor: environment.cloudVendor, host: environment.hostOrigin, nativeKey: environment.nativeCloudKey, now });
    const localLoad = core.load, localExpired = core.sessionExpired, localClear = core.clearSession;
    core.clearSession = () => { localClear(); if (auth.mode === 'offline') startCloudJourney(); };
    core.load = async () => {
      if (core.state.setupGrant) return localLoad();
      if (environment.nativeIdentity) {
        const identity = await environment.nativeIdentity(); auth.deviceName = identity.deviceName;
        if (identity.clientId) client.clientId = identity.clientId;
        if (identity.redirectUri) client.redirectUri = identity.redirectUri;
        environment.bindDesktop = identity.localOrigin === environment.hostOrigin;
        auth.localDesktop = environment.bindDesktop;
      }
      try { await client.configure(); } catch (error) {
        if (error.status === 404 || error.status === 401) {
          auth.localOnly = true;
          try { core.acceptSession(await core.api('/me')); await core.enterAssistant(); return; } catch { /* no remembered legacy session */ }
          auth.error = '云服务尚未配置，请稍后重试。';
        } else auth.error = cloudError(error);
        core.show('login'); paint(); return;
      }
      if (auth.deviceName === '这台设备') auth.deviceName = environment.deviceName || (environment.desktop ? '这台电脑' : '这个浏览器');
      try { const remembered = await environment.cloudCredentials('offline-account'); auth.offlineKnown = !!remembered?.sub;
        if (remembered?.deviceName) auth.deviceName = remembered.deviceName;
        const saved = await client.saved();
        if (saved) { auth.email = saved.email || ''; await finishCloudLogin(); }
        else { core.show('login'); paint(); }
      } catch (error) { if (error.code !== 'NETWORK') await client.forget(); auth.error = cloudError(error); core.show('login'); paint(); }
    };
    core.sessionExpired = () => { if (auth.mode === 'authenticated') void (async () => { try { await finishCloudLogin(); } catch { await expireCloudSession(); } })(); else localExpired(); };
    return client;
  }
  return { initializeCloudAccount, cloudAuthView, cloudError, cloudPasswordHint, startCloudJourney, cloudRequestCode, cloudVerifyCode, cloudComplete, cloudLogin,
    retryCloudApproval, cancelCloudJourney, renewCloudSession, cloudOfflineLogin, cloudDirectory, cloudRename, cloudRemove, cloudConnect, cloudTrust,
    cloudEmailRequest, cloudEmailConfirm, cloudChangePassword, cloudLogout, cloudLogoutOthers, cloudDeleteAccount, cloudEmergencyPassword, cloudPairing, cloudRedeemPairing, cloudConnectTrusted,
    cloudTrustMaterial, cloudImportTrust, cloudApproveOffline };
};
