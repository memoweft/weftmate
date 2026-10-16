/* Account journeys, device actions, errors and deadlines shared by every presentation. */
globalThis.WeftUiCore.factories.cloudAccount = (core, effects, environment) => {
  const auth = { mode: 'login', step: 'email', email: '', error: '', busy: false, resendAt: 0, retryAt: 0, deviceName: '这台设备', devices: [], hosts: [] };
  core.state.cloudAuth = auth;
  let client, waitTimer, renewalTimer, journey = 0, exchangeInFlight, exchangeTicket, desktopRestore = 0, ownHost, bindingClaim, returnView;
  let desktopCloudObserved = false;
  const now = () => environment.now?.() ?? Date.now();
  const paint = () => effects.paintCloudAuth?.(cloudAuthView());
  function cloudAuthView() {
    const retrySeconds = Math.max(0, Math.ceil((auth.retryAt - now()) / 1000));
    const error = auth.retryAt && auth.error.startsWith('尝试太多次')
      ? retrySeconds ? `尝试太多次，请等待 ${retrySeconds} 秒后重试。` : '等待已结束，可以重试。' : auth.error;
    return { ...auth, error, recoveryHelp: '如果这个邮箱注册过，几分钟内会收到验证码；没收到请检查邮箱是否填对，或直接注册。', codeLoginSupported: environment.deviceType !== 'android' || environment.nativeEmailCodeLogin === true || client?.config?.nativeEmailCodeLogin === true,
      resendSeconds: Math.max(0, Math.ceil((auth.resendAt - now()) / 1000)), retrySeconds };
  }
  function cloudError(error) {
    if (error?.code === 'BACKUP_PAUSE_TIMEOUT') return '本机备份未完成，程序已继续运行。请稍后重试注销。';
    const code = error?.code || error?.message;
    if (code === 'RATE_LIMITED' || code === 'LOGIN_RATE_LIMITED') { auth.retryAt = now() + Math.max(1, error.retryAfter || 60) * 1000; return `尝试太多次，请等待 ${Math.ceil((auth.retryAt - now()) / 1000)} 秒后重试。`; }
    return ({ INVALID_CREDENTIALS: '邮箱或密码不对，请重试。', INVALID_EMAIL: '请填写有效的邮箱地址。', EMAIL_IN_USE: '无法使用这个邮箱，请换一个邮箱或尝试登录。',
      CODE_INVALID: '验证码不对，请重新输入。', INVALID_LOGIN_CODE: '验证码不对或已失效，请重发后再试。', CHALLENGE_INVALID: '验证码已失效，请重新发送。', PASSWORD_TICKET_INVALID: '验证已失效，请重新发送验证码。',
      CLOUD_DEVICE_VERIFICATION_REQUIRED: '请重新登录并确认邮箱。', CLOUD_TOKEN_INVALID: '需要重新登录，电脑上的内容仍可继续使用。', UNAUTHORIZED: '登录已失效，请重新登录。', DEVICE_NOT_TRUSTED: '这台设备已下线，请联系账户所有者。',
      CLOUD_BINDING_CONFLICT: '这个云账号已绑定其他本地账户，请使用原账号或先解绑。',
      CLOUD_CREDENTIAL_CLEANUP_REQUIRED: '暂时无法清理保存的登录信息，请恢复云服务后重试退出或切换。当前账户仍可使用。',
      NATIVE_CREDENTIAL_CHECK_REQUIRED: '请更新电脑上的 WeftMate 后再退出或切换账户。当前账户仍可使用。',
      NETWORK: '网络不通，请检查连接后重试。', STORAGE_UNAVAILABLE: '无法安全记住本设备，请检查设备存储后重试。',
      CLOUD_RESPONSE_INVALID: '电脑连接暂时没有返回有效结果，请稍后重试。',
      CLOUD_REQUEST_INVALID: '连接电脑时未能完成请求，请稍后重试。',
      CLOUD_TLS_UNAVAILABLE: '暂时无法确认电脑的安全连接，请稍后重试。',
      CLOUD_TIMEOUT: '电脑连接超时，账号仍已登录，请稍后重试。',
      CLOUD_TRANSPORT_UNAVAILABLE: '电脑暂时连不上，账号仍已登录，请稍后重试。',
      PAIRING_INVALID: '配对码已失效或不属于这台电脑，请获取新码。', PAIRING_REQUIRED: '请在目标电脑显示二维码，并输入配对码后连接。',
      HOST_TRUST_INVALID: '无法确认电脑身份，请检查连接后重试。',
      INVALID_DEVICE: '设备名称须为 1–128 个字符。',
      UPDATE_REQUIRED: '请更新电脑上的 WeftMate 后重新登录。',
      COMPUTER_UPDATE_REQUIRED: '这台电脑的 WeftMate 需要更新，连接后仍可继续聊天。',
      NATIVE_LOGIN_UPGRADE_REQUIRED: '请更新手机程序后使用这个登录入口。现在可以使用密码登录并确认邮箱。',
      CLOUD_LOGIN_REQUIRED: '请更新客户端并使用邮箱登录，远程访问需要云账号。',
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
    if (mode === 'offline-login' || mode === 'local-login') bindingClaim = null;
    journey++; clearTimeout(waitTimer); client.generation++; client.pending = null;
    Object.assign(auth, { mode, step: 'email', error: '', busy: false, challengeId: null, passwordTicket: null, requestId: null, devices: [], hosts: [], resendAt: 0, retryAt: 0 });
    auth.modal = !!(auth.localSession || auth.cachedSession);
    if (auth.modal) returnView ??= core.state.currentView;
    else core.show('login');
    paint();
  }
  function cloudDeviceTime(value) {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) return '未记录';
    const today = new Date(now()), yesterday = new Date(now()); yesterday.setDate(yesterday.getDate() - 1);
    const day = date.toDateString();
    if (day === today.toDateString() || day === yesterday.toDateString()) {
      const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
      return `${day === today.toDateString() ? '今天' : '昨天'} ${time}`;
    }
    return core.dateText ? core.dateText(value, { year: date.getFullYear() !== today.getFullYear() }) : core.formatDate(value);
  }
  function dismissCloudLogin() {
    if (!auth.localSession && !auth.cachedSession) return;
    journey++; client.generation++; client.pending = null; bindingClaim = null;
    auth.modal = false; auth.busy = false; auth.mode = 'offline'; auth.error = ''; paint();
    if (returnView && core.state.currentView !== returnView) core.show(returnView);
    returnView = null;
  }
  async function localAccounts() { return core.api('/desktop'); }
  async function prepareDesktopCredentialCleanup() {
    if (!auth.localDesktop || client.tokenId) return;
    if (!desktopCloudObserved) {
      try { await core.accessApi('/cloud/binding'); desktopCloudObserved = true; }
      catch (error) {
        if (error.status === 404) {
          // A missing cloud module cannot tell us whether an earlier run left
          // native credentials. Only a trusted, read-only native check can.
          if (!client.nativeKey?.credentialsPresent) throw { code: 'NATIVE_CREDENTIAL_CHECK_REQUIRED' };
          if (await client.nativeKey.credentialsPresent() === false) return;
          throw { code: 'CLOUD_CREDENTIAL_CLEANUP_REQUIRED' };
        }
        throw error;
      }
    }
    // Once a cloud scope has been observed, failed configuration is not proof
    // that saved credentials are absent: resolve their identity or reject.
    await client.configure();
  }
  async function switchLocalAccount(ownerId) {
    const ticket = ++journey; clearTimeout(renewalTimer); bindingClaim = null;
    // A cloud credential belongs to one local owner; switching requires a new
    // explicit cloud journey rather than carrying that authority to another.
    await prepareDesktopCredentialCleanup();
    if (ticket !== journey) return;
    await client.forget();
    if (ticket !== journey) return;
    core.clearSession();
    const session = await core.api('/desktop', { method: 'POST', body: { ownerId, deviceName: auth.deviceName } });
    if (ticket !== journey) return;
    core.acceptSession(session); auth.localSession = true; auth.mode = 'offline'; auth.modal = false;
    await core.enterAssistant(); paint();
  }
  async function localDeviceDirectory() {
    const result = await core.api('/devices');
    return { devices: result.devices.filter(d => !d.revoked).map(d => ({ ...d, isCurrent: d.current,
      lastUsedAt: d.lastSeenAt || d.createdAt, type: d.current ? 'windows' : 'web' })), hosts: [] };
  }
  async function logoutLocalDevice(id) {
    await core.api('/devices/' + encodeURIComponent(id), { method: 'DELETE', protectedWrite: true, body: {} });
    return localDeviceDirectory();
  }
  async function cloudBindDesktop() {
    const claim = await core.accessApi('/cloud/claims', { method: 'POST', protectedWrite: true, body: {} });
    startCloudJourney();
    bindingClaim = claim;
  }
  async function cloudRequestCode(email = auth.email) {
    if (cloudAuthView().resendSeconds) return;
    return run(async () => {
      const ticket = journey;
      auth.email = email.trim().toLowerCase();
      if (auth.mode === 'code-login') {
        if (!cloudAuthView().codeLoginSupported) throw { code: 'NATIVE_LOGIN_UPGRADE_REQUIRED' };
        const result = await client.beginCode({ email: auth.email, deviceName: auth.deviceName,
          deviceType: environment.deviceType || (environment.desktop ? 'windows' : 'web') });
        if (ticket !== journey) return;
        auth.challengeId = result.challengeId; auth.resendAt = now() + 60000; auth.step = 'code'; return;
      }
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
      if (auth.mode === 'code-login') { await client.confirmCode(code); await finishCloudLogin(); return; }
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
      const name = deviceName?.trim() || auth.deviceName;
      if (mode === 'registration' && (!name || name.length > 128)) throw { code: 'INVALID_DEVICE' };
      await client.publicRequest(`/auth/${mode}/complete`, { passwordTicket: auth.passwordTicket, password });
      if (ticket !== journey) return;
      auth.passwordTicket = null;
      if (mode === 'recovery') { startCloudJourney(); effects.toast('密码已重设，请登录。'); return; }
      auth.deviceName = name;
      await beginCloudLogin(auth.email, password);
    });
  }
  async function beginCloudLogin(email, password) {
    const ticket = journey;
    auth.email = email.trim().toLowerCase();
    const result = await client.begin({ email: auth.email, password, deviceName: auth.deviceName, deviceType: environment.deviceType || (environment.desktop ? 'windows' : 'web') });
    if (ticket !== journey) return;
    if (result.confirmationRequired) { auth.mode = 'confirm'; auth.step = 'code'; auth.resendAt = 0; return; }
    await finishCloudLogin(ticket);
  }
  async function cloudLogin({ email, password }) {
    if (cloudAuthView().retrySeconds) return;
    return run(() => beginCloudLogin(email, password));
  }
  async function finishCloudLogin(ticket = journey, restore = null) {
    if (exchangeInFlight && exchangeTicket === ticket) return exchangeInFlight;
    const current = applyCloudSession(ticket, restore); exchangeInFlight = current; exchangeTicket = ticket;
    try { return await current; } finally { if (exchangeInFlight === current) exchangeInFlight = null; }
  }
  async function applyCloudSession(ticket, restore) {
    const current = () => ticket === journey && (!restore || restore.current());
    if (!current()) return;
    if (bindingClaim) {
      const claim = bindingClaim, token = await client.access();
      if (!current()) return;
      await core.accessApi('/cloud/binding', { method: 'POST', protectedWrite: true,
        body: { claimId: claim.claimId, accessToken: token } });
      if (!current()) return;
      bindingClaim = null;
      await client.forget();
      auth.mode = 'offline'; paint();
      await core.enterAssistant(); core.openAccount();
      effects.toast('已绑定 WeftMate 账号。');
      return;
    }
    const pairing = environment.initialPairing ? parseCloudPairing(environment.initialPairing) : null;
    if (pairing && pairing.hostId !== client.config.hostId) throw { code: 'PAIRING_INVALID' };
    const result = await client.exchange(pairing ? false : environment.bindDesktop ?? environment.desktop, pairing);
    if (!current()) return;
    if (restore) {
      auth.restoreAccountMatched = result.account?.ownerId === restore.ownerId;
      if (!auth.restoreAccountMatched) throw { code: 'CLOUD_BINDING_CONFLICT' };
    }
    const saved = await client.saved();
    if (!current()) return;
    auth.sub = saved.sub; auth.email = saved.email || auth.email;
    // Offline account selection contains no credential and remains after cloud logout/deletion.
    await environment.cloudCredentials('offline-account', { sub: saved.sub, email: auth.email, deviceName: saved.deviceName }); auth.offlineKnown = true;
    if (!current()) return;
    if (result.status === 'pending_approval') throw { code: environment.deviceType === 'android' && !result.requestId ? 'NATIVE_LOGIN_UPGRADE_REQUIRED' : 'UPDATE_REQUIRED' };
    if (result.status === 'cloud_only') {
      auth.mode = 'authenticated'; auth.modal = false; auth.cloudOnly = true; paint();
      await effects.enterCloudOnly?.({ accountId: saved.sub, email: auth.email, deviceId: (await client.key()).deviceId, origin: new URL(client.config.issuer).origin });
      scheduleRenewal(); return;
    }
    auth.cloudOnly = false;
    await effects.preparePhoneAccount?.({ accountId: saved.sub, email: auth.email, deviceId: (await client.key()).deviceId, origin: new URL(client.config.issuer).origin });
    if (!current()) return;
    clearTimeout(waitTimer); waitTimer = null;
    if (pairing) { await saveCloudPairingPin(pairing); environment.initialPairing = null; }
    if (!current()) return;
    auth.mode = 'authenticated'; auth.modal = false; paint();
    if (!auth.localSession) { core.acceptSession(result); await core.enterAssistant(); }
    returnView = null;
    await core.refreshPendingDevices();
    if (!current()) return;
    scheduleRenewal();
    await cloudDirectory().catch(() => {});
    if (!current()) return;
    const draft = await environment.cloudCredentials('draft:' + saved.sub);
    if (!current()) return;
    if (draft) { effects.restoreCloudDraft?.(draft); await environment.cloudCredentials('draft:' + saved.sub, undefined, true); }
  }
  async function resumeCloudComputer() { return finishCloudLogin(); }
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
  async function expireCloudSession(email = auth.email, { retainCached = true } = {}) {
    const ticket = ++journey, generation = core.state.identityGeneration;
    const current = () => ticket === journey && generation === core.state.identityGeneration;
    if (retainCached && environment.retainNativeCache && auth.cachedSession) {
      clearTimeout(renewalTimer); clearTimeout(waitTimer); await client.forget();
      if (!current()) return;
      Object.assign(auth, { mode: 'offline', modal: false, busy: false, email, error: '', cloudExpired: true });
      effects.nativeSessionExpired?.(); paint(); return;
    }
    if (auth.localSession) {
      core.updateComputerDirectory?.({hosts:[]});
      clearTimeout(renewalTimer); clearTimeout(waitTimer); await client.forget();
      if (!current()) return;
      Object.assign(auth, { mode: 'offline', modal: false, busy: false, email, error: '需要重新登录', cloudExpired: true });
      paint(); effects.toast('需要重新登录，电脑上的内容仍可继续使用。'); return;
    }
    const draft = effects.readMessageDraft?.() || core.state.desktopDraft;
    if (draft && auth.sub) await environment.cloudCredentials('draft:' + auth.sub, draft);
    if (!current()) return;
    clearTimeout(renewalTimer); clearTimeout(waitTimer);
    await client.forget();
    if (!current()) return;
    // Clear the host cookie as well as the in-memory projection.
    try { await core.api('/logout', { method: 'POST', protectedWrite: true, body: {} }); } catch { /* revoked cookies are already unusable */ }
    if (!current()) return;
    await effects.clearNativeHostSessions?.();
    if (!current()) return;
    auth.cachedSession = false; core.clearSession(); auth.email = email; startCloudJourney();
  }
  async function cancelCloudJourney() { if (auth.localSession) { dismissCloudLogin(); return; } bindingClaim = null; await client.forget(); await client.resetKey(); startCloudJourney(); }
  async function cloudOfflineLogin({ password, cloudAccountId, username }) {
    return run(async () => {
      const remembered = await environment.cloudCredentials('offline-account');
      const sub = username ? null : cloudAccountId || remembered?.sub;
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
    auth.devices = result.devices; auth.hosts = result.hosts;
    auth.multiHostSupported=result.capabilities?.multiHost===1;
    core.updateComputerDirectory?.(result); return result;
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
    // Revoke content on the connected host as part of this explicit action;
    // other hosts retain the existing signed-revocation polling boundary.
    if (core.state.csrfToken) {
      const local = await core.api('/devices');
      const device = local.devices.find(device => !device.revoked && device.cloudDeviceId === id);
      if (device) await core.api('/devices/' + encodeURIComponent(device.id), { method: 'DELETE', protectedWrite: true, body: {} });
    }
    if (current) { await expireCloudSession(); return { devices: [], hosts: [] }; }
    return cloudDirectory();
  }
  async function cloudConnect(hostId) { return client.authorized('/hosts/connect', { method: 'POST', body: { hostId } }); }
  core.cloudCurrentComputer = () => client?.config?.hostId;
  core.cloudComputerChannel = (connection,request) => client.channel(connection,request);
  core.cloudComputerCapabilities = async connection => {
    const config = await client.request(connection.baseUrl + '/personal/v1/cloud/config');
    if (config.hostId !== connection.hostId || config.issuer !== client.config.issuer) throw {code:'HOST_TRUST_INVALID'};
    return config.capabilities || {};
  };
  core.cloudRenameComputer = async (hostId,name) => {
    if(!core.state.computers?.length)throw {code:'FORBIDDEN'};
    await client.authorized('/hosts/rename',{method:'POST',body:{hostId,name:name.trim()}});return cloudDirectory();
  };
  core.cloudRemoveComputer = async hostId => {
    if(!core.state.computers?.length)throw {code:'FORBIDDEN'};
    const current=auth.hosts.some(row=>row.hostId===hostId&&row.isCurrent);
    await client.authorized('/hosts/remove',{method:'POST',body:{hostId}});
    if(current){await expireCloudSession(auth.email,{retainCached:false});return {devices:[],hosts:[]};}
    return cloudDirectory();
  };
  core.probeCloudPresence = async () => {
    if (auth.cloudOnly) return null;
    if (!client?.config?.hostId || !await client.saved()) return null;
    return cloudConnect(client.config.hostId);
  };
  core.cloudOfflineStatus = hostId => client.authorized('/hosts/offline/status', { method: 'POST', body: { hostId } });
  core.cloudOfflineTasks = (action,body) => {
    switch(action) {
      case 'submit': return client.authorized('/hosts/offline/tasks/submit', { method:'POST', body });
      case 'list': return client.authorized('/hosts/offline/tasks/list', { method:'POST', body });
      case 'cancel': return client.authorized('/hosts/offline/tasks/cancel', { method:'POST', body });
      case 'clear': return client.authorized('/hosts/offline/tasks/clear', { method:'POST', body });
      default: throw Object.assign(new Error('INVALID_REQUEST'), { code:'INVALID_REQUEST' });
    }
  };
  core.cloudOfflineTaskDevice = async () => (await client.key()).deviceId;
  core.cloudOfflineIdentity = () => core.activeComputerIdentity?.() || (core.state.account && client?.config?.hostId ? {
    origin: client.host, ownerId: core.state.account.ownerId, deviceId: core.state.device?.id, hostId: client.config.hostId } : null);
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
        algorithms: ['ES256'], typ: 'wm-host-trust+jwt', issuer: material.hostId, audience: jkt, requiredClaims: ['iat', 'exp', 'jti', 'sub', 'hostId', 'deviceId', 'jkt', 'tlsSpki', 'publicJwk'], maxTokenAge: '120s', clockTolerance:30, currentDate: new Date(now()) });
      if (payload.sub !== saved.sub || ![client.config.hostId, ...auth.hosts.map(host => host.hostId)].includes(payload.hostId) || payload.deviceId !== key.deviceId || payload.jkt !== jkt ||
        payload.exp - payload.iat > 120 || payload.iat * 1000 > now() + 30000 || payload.exp * 1000 <= now() || !/^[A-Za-z0-9_-]{43}$/.test(payload.tlsSpki) ||
        await environment.cloudVendor.calculateJwkThumbprint(payload.publicJwk) !== await environment.cloudVendor.calculateJwkThumbprint(material.anchor)) throw new Error();
      await environment.cloudCredentials('trusted-host:' + payload.hostId, { tlsSpki: payload.tlsSpki, publicJwk: material.anchor, origin: payload.origin, relay: payload.relay });
      return finishCloudLogin();
    } catch { throw { code: 'HOST_TRUST_INVALID' }; }
  }
  async function cloudEmailRequest(email) { const result = await client.authorized('/auth/email/change/request', { method: 'POST', body: { email } }); auth.emailChange = { email, challengeId: result.challengeId, resendAt: now() + 60000 }; return result; }
  async function cloudEmailConfirm(code) { const result = await client.authorized('/auth/email/change/confirm', { method: 'POST', body: { challengeId: auth.emailChange.challengeId, code } }); auth.emailChange = null; await expireCloudSession(result.account.email, {retainCached:false}); return result; }
  async function cloudChangePassword(currentPassword, password, confirmation) { validPassword(password, confirmation); const result = await client.authorized('/auth/password/change', { method: 'POST', body: { currentPassword, password } }); await expireCloudSession(auth.email, {retainCached:false}); return result; }
  async function cloudLogout() {
    const ticket = ++journey, generation = core.state.identityGeneration;
    const current = () => ticket === journey && generation === core.state.identityGeneration;
    if (auth.localDesktop && !client.tokenId) {
      await prepareDesktopCredentialCleanup();
      if (!current()) return;
    }
    if(auth.localSession&&auth.multiHostSupported&&auth.mode==='authenticated') {
      await core.accessApi('/cloud/binding',{method:'DELETE',protectedWrite:true,body:{}});
      if (!current()) return;
    }
    if (auth.mode !== 'offline') {
      try { await client.authorized('/auth/logout', { method: 'POST', body: {}, current }); }
      catch (error) { if (!current()) return; throw error; }
      if (!current()) return;
      await client.resetKey();
      if (!current()) return;
    }
    await expireCloudSession(auth.email, {retainCached:false});
  }
  async function cloudLogoutOthers() { return client.authorized('/auth/logout/others', { method: 'POST', body: {} }); }
  async function cloudDeleteAccount(password, { prepareBackup = true } = {}) { if (auth.localDesktop && prepareBackup) await core.prepareAccountDeletionBackup(); const result = await client.authorized('/auth/account/delete', { method: 'POST', body: { password } }); await expireCloudSession('', {retainCached:false}); return result; }
  async function cloudEmergencyPassword(password, confirmation) {
    if (Array.from(password).length < 15 || Array.from(password).length > 128) throw { code: 'EMERGENCY_PASSWORD_INVALID' };
    if (password !== confirmation) throw { code: 'PASSWORD_MISMATCH' };
    return core.accessApi('/cloud/emergency-password', { method: 'POST', protectedWrite: true, body: { password } });
  }
  async function cloudPairing() { const result = await core.accessApi('/cloud/pairings', { method: 'POST', protectedWrite: true, body: {} }); return result; }
  function parseCloudPairing(input) {
    let value = input.trim(); if (value.includes('#pair=')) value = new URL(value).hash.slice(6); if (value.startsWith('wm1.')) value = value.slice(4);
    let pairing;
    try { pairing = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))); }
    catch { throw { code: 'PAIRING_INVALID' }; }
    if (typeof pairing.hostId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(pairing.challenge) || !/^[A-Za-z0-9_-]{43}$/.test(pairing.tlsSpki)) throw { code: 'PAIRING_INVALID' };
    for (const value of [pairing.origin, pairing.relay?.baseUrl].filter(Boolean)) {
      const url = new URL(value);
      if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw { code: 'PAIRING_INVALID' };
    }
    return pairing;
  }
  async function saveCloudPairingPin(pairing) {
    await environment.cloudCredentials('trusted-host:' + pairing.hostId, { tlsSpki: pairing.tlsSpki, publicJwk: pairing.publicJwk, origin: pairing.origin, relay: pairing.relay });
  }
  async function cloudRedeemPairing(input) {
    const pairing = parseCloudPairing(input);
    if (pairing.hostId !== client.config.hostId) {
      const connection = await cloudConnect(pairing.hostId); await saveCloudPairingPin(pairing);
      return cloudConnectTrusted({ ...connection, baseUrl: connection.baseUrl || pairing.relay?.baseUrl || pairing.origin }, pairing);
    }
    const result = await client.exchange(false, pairing); await saveCloudPairingPin(pairing); core.acceptSession(result); return result;
  }
  async function cloudConnectTrusted(connection, pairing = null) {
    if (exchangeInFlight) await exchangeInFlight;
    const current = applyCloudConnection(connection, pairing); exchangeInFlight = current;
    try { return await current; } finally { if (exchangeInFlight === current) exchangeInFlight = null; }
  }
  async function applyCloudConnection(connection, pairing) {
    if (connection.hostId !== client.config.hostId) {
      const self = ownHost?.hostId === connection.hostId;
      const trusted = self || await environment.cloudCredentials('trusted-host:' + connection.hostId);
      if (!trusted && !environment.automaticHostTrust || !self && !connection.baseUrl) throw { code: environment.automaticHostTrust ? 'HOST_UNAVAILABLE' : 'PAIRING_REQUIRED' };
      const target = self ? ownHost : await effects.openCloudHost?.({ hostId: connection.hostId, baseUrl: connection.baseUrl });
      if (!target) return connection;
      const previous = { host: client.host, hostId: client.config.hostId }, generation = client.generation;
      try {
        client.host = target.baseUrl; client.config.hostId = target.hostId;
        const session = await client.exchange(pairing ? false : self, pairing);
        if (generation !== client.generation) throw { code: 'CLOUD_TOKEN_INVALID' };
        if (session.status === 'pending_approval') throw { code: 'PAIRING_REQUIRED' };
        await effects.activateCloudHost?.(target);
        environment.bindDesktop = !!self; auth.localDesktop = !!self;
        core.accessBase = target.baseUrl + '/personal/v1'; core.authBase = core.accessBase + '/auth';
        core.acceptSession(session); return connection;
      } catch (error) { client.host = previous.host; client.config.hostId = previous.hostId; throw error; }
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
  async function restoreLocalDesktopCloud() {
    const attempt = ++desktopRestore, ticket = journey;
    const ownerId = core.state.account?.ownerId, generation = core.state.identityGeneration;
    const current = () => attempt === desktopRestore && ticket === journey && auth.localSession &&
      core.state.account?.ownerId === ownerId && core.state.identityGeneration === generation;
    Object.assign(auth, { restoreState: 'checking', restoreAttempted: false, restoreAccountMatched: null });
    try {
      // Restore only an already bound owner. The desktop exchange retains the
      // host's existing issuer/sub-to-owner check; it cannot claim another owner.
      const binding = await core.accessApi('/cloud/binding');
      if (!current()) return;
      desktopCloudObserved = true;
      if (binding.status !== 'active') { auth.restoreState = 'unbound'; return; }
      await client.configure();
      if (!current()) return;
      ownHost = { hostId: client.config.hostId, baseUrl: environment.hostOrigin };
      const saved = await client.saved();
      if (!current()) return;
      if (!saved) { auth.restoreState = 'none'; return; }
      auth.restoreAttempted = true;
      await finishCloudLogin(ticket, { ownerId, current });
      if (current()) auth.restoreState = auth.mode === 'authenticated' ? 'restored' : 'unavailable';
    } catch (error) {
      if (!current()) return;
      if (auth.mode === 'authenticated') { auth.restoreState = 'restored'; return; }
      if (error.status === 404 && !auth.restoreAttempted) { auth.restoreState = 'unbound'; return; }
      const rejected = [401, 403, 409].includes(error.status) ||
        ['CLOUD_TOKEN_INVALID', 'CLOUD_BINDING_CONFLICT', 'HOST_TRUST_INVALID', 'DEVICE_NOT_TRUSTED', 'CLOUD_DEVICE_VERIFICATION_REQUIRED'].includes(error.code);
      let unavailable = !auth.restoreAttempted || error.code === 'NETWORK' || error.status >= 500 || !rejected;
      if (!unavailable) {
        try { await client.forget(); }
        catch (failure) { error = failure; unavailable = true; }
      }
      if (!current()) return;
      auth.restoreState = unavailable ? 'unavailable' : error.code === 'CLOUD_BINDING_CONFLICT' ? 'conflict' : 'expired';
      auth.error = cloudError(error);
    } finally {
      if (attempt === desktopRestore && auth.restoreState === 'checking' && !current()) auth.restoreState = 'cancelled';
      paint();
    }
  }
  function initializeCloudAccount() {
    client = new globalThis.WeftUiCore.CloudAuthClient({ fetch: environment.fetch, crypto: environment.crypto,
      credentials: environment.cloudCredentials, vendor: environment.cloudVendor, host: environment.hostOrigin, nativeKey: environment.nativeCloudKey,
      localCsrf: () => core.state.csrfToken, now });
    const localLoad = core.load, localExpired = core.sessionExpired, localClear = core.clearSession, localLogout = core.logout;
    core.clearSession = () => { bindingClaim = null; localClear(); if (auth.mode === 'offline' && !auth.localSession) startCloudJourney(); };
    if (localLogout) core.logout = async () => {
      if (auth.localSession) { if (auth.mode === 'authenticated') await cloudLogout(); else effects.toast('本机内容可以继续使用。'); return; }
      return localLogout();
    };
    core.load = async () => {

      if (environment.nativeIdentity) {
        const identity = await environment.nativeIdentity(); auth.deviceName = identity.deviceName;
        if (identity.clientId) client.clientId = identity.clientId;
        if (identity.redirectUri) client.redirectUri = identity.redirectUri;
        environment.bindDesktop = identity.localOrigin === environment.hostOrigin;
        auth.localDesktop = environment.bindDesktop;
      }
      if (auth.localDesktop) {
        try {
          const before = await core.api('/state');
          const session = await core.api('/desktop', { method: 'POST', body: { deviceName: auth.deviceName } });
          core.state.setupGrant = null; core.acceptSession(session);
          Object.assign(auth, { localSession: true, mode: 'offline', modal: false, error: '' }); paint();
          if (await effects.startOnboarding?.(before)) { void restoreLocalDesktopCloud(); return; }
          await core.enterAssistant();
          void restoreLocalDesktopCloud(); return;
        } catch (error) { auth.error = cloudError(error); core.show('owner'); paint(); return; }
      }
      try { await client.configure(); } catch (error) {
        if (error.status === 404 || error.status === 401) {
          auth.localOnly = true;
          if (environment.desktop && await effects.startOnboarding?.(await core.api('/state'))) return;
          if (core.state.setupGrant) return localLoad();
          try { core.acceptSession(await core.api('/me')); await core.enterAssistant(); return; } catch { /* no remembered legacy session */ }
          auth.error = '云服务尚未配置，请稍后重试。';
        } else auth.error = cloudError(error);
        core.show('login'); paint(); return;
      }
      if (environment.desktop && await effects.startOnboarding?.(await core.api('/state'))) return;
      if (core.state.setupGrant) return localLoad();
      if (environment.nativeIdentity) {
        ownHost = { hostId: client.config.hostId, baseUrl: environment.hostOrigin };
        await effects.activateCloudHost?.(ownHost);
      }
      if (auth.deviceName === '这台设备') auth.deviceName = environment.deviceName || (environment.desktop ? '这台电脑' : '这个浏览器');
      try { const remembered = await environment.cloudCredentials('offline-account'); auth.offlineKnown = !!remembered?.sub;
        if (remembered?.deviceName) auth.deviceName = remembered.deviceName;
        const saved = await client.saved();
        if (saved) { auth.email = saved.email || ''; await finishCloudLogin(); }
        else { core.show('login'); paint(); }
      } catch (error) { if (error.code !== 'NETWORK') await client.forget(); auth.error = cloudError(error); core.show('login'); paint(); }
    };
    core.sessionExpired = () => { if (auth.localSession) void (async () => {
      try { core.acceptSession(await core.api('/desktop', { method: 'POST', body: { ownerId: core.state.account?.ownerId, deviceName: auth.deviceName } })); await core.enterAssistant(); }
      catch { effects.toast('暂时无法连接这台电脑，请重试。'); }
    })(); else if (auth.mode === 'authenticated') void (async () => { try { await finishCloudLogin(); } catch { await expireCloudSession(); } })(); else localExpired(); };
    return client;
  }
  async function cloudSendFeedback(payload) {
    if (!client || auth.mode !== 'authenticated') throw Object.assign(new Error('FEEDBACK_LOGIN_REQUIRED'), { code: 'FEEDBACK_LOGIN_REQUIRED' });
    return client.authorized('/feedback', { method: 'POST', body: payload });
  }
  return { cloudSendFeedback, initializeCloudAccount, cloudAuthView, cloudDeviceTime, cloudError, cloudPasswordHint, startCloudJourney, dismissCloudLogin, localAccounts, switchLocalAccount, localDeviceDirectory, logoutLocalDevice, cloudBindDesktop, cloudRequestCode, cloudVerifyCode, cloudComplete, cloudLogin,
    resumeCloudComputer, retryCloudApproval, cancelCloudJourney, renewCloudSession, cloudOfflineLogin, cloudDirectory, cloudRename, cloudRemove, cloudConnect, cloudTrust,
    cloudEmailRequest, cloudEmailConfirm, cloudChangePassword, cloudLogout, cloudLogoutOthers, cloudDeleteAccount, cloudEmergencyPassword, cloudPairing, cloudRedeemPairing, cloudConnectTrusted,
    cloudTrustMaterial, cloudImportTrust, cloudApproveOffline };
};
