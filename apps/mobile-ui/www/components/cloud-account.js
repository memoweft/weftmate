/* Compose shared auth actions with phone presentation and platform transport. */
(() => {
  let core, forms, settings, native, initialized = false;
  const noop = () => {};
  const byId = id => document.getElementById(id);
  const element = (tag, className = '', text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
  function showAuth(waiting = false) {
    closeDrawer();
    document.body.classList.add('cloud-auth-active');
    for (const id of ['chat-page', 'home-page', 'generic-page', 'cloud-settings-page']) byId(id).classList.remove('active');
    byId('cloud-auth-page').classList.add('active');
    byId('login-view').hidden = waiting; byId('cloud-wait-view').hidden = !waiting;
    state.page = waiting ? 'cloud-wait' : 'login';
  }
  function clearIdentity() {
    state.authEpoch++; state.loggedIn = false; state.owner = ''; state.username = ''; state.deviceId = '';
    state.sharedSessions = []; state.sharedEvents = []; state.conversations = []; state.conversationId = null;
    state.sharedSessionId = null; state.profile = null; state.connection = 'local';
    stopSharedPoll(); clearTimeout(state.homePollTimer); clearTimeout(state.linkedPollTimer);
    state.handoffViews.clear(); state.linkedEvents.clear(); state.handoffSelections.clear();
    resetMemoryForAuthBoundary('已退出账户；请登录后重新读取记忆。');
    byId('draft').value = ''; byId('home-conversations').replaceChildren(); byId('conversation-list').replaceChildren();
    byId('cloud-access-banner').hidden = true;
  }
  async function enterAssistant() {
    core.state.cloudAuth.mode = 'authenticated';
    const account = native ? await call('cloud.adopt') : { ...core.state.account, owner: core.state.account.ownerId, deviceId: core.state.device.id, connectionVerified: true };
    state.authEpoch++; state.loggedIn = true; state.username = account.username; state.owner = account.owner || account.ownerId || '';
    state.deviceId = account.deviceId || account.device?.id || ''; state.profile = account; state.connection = account.connectionVerified === false ? 'checking' : 'connected';
    resetMemoryForAuthBoundary('请重新读取当前账户的记忆。'); showProfile(account);
    document.body.classList.remove('cloud-auth-active'); byId('cloud-auth-page').classList.remove('active');
    if (native) { await listConversations(); loadDraft(); await call('app.ready', { owner: state.owner, hasDraft: hasAnyDraft() }); }
    else {
      const result = await core.accessApi('/sessions').catch(() => ({ sessions: [] }));
      state.sharedSessions = result.sessions || []; state.sharedHostAvailable = true;
    }
    page('home');
  }
  async function scanPairing() {
    const dialog = element('dialog', 'cloud-camera'); dialog.setAttribute('aria-label', '扫描电脑二维码');
    const title = element('h2', '', '扫描电脑二维码'), info = element('p', 'muted', '把电脑上的二维码放入画面。没有相机时，请关闭并输入配对码。');
    const video = document.createElement('video'); video.autoplay = true; video.playsInline = true;
    const close = element('button', 'button secondary', '关闭'); close.type = 'button'; close.addEventListener('click', () => dialog.close());
    dialog.append(title, info, video, close); document.body.append(dialog); dialog.showModal();
    let stream, timer;
    dialog.addEventListener('close', () => { clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); dialog.remove(); });
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error();
      const detector = globalThis.BarcodeDetector ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
      const canvas = document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (!dialog.open) { stream.getTracks().forEach(track => track.stop()); return; }
      video.srcObject = stream; await video.play();
      const scan = async () => {
        if (!dialog.open) return;
        try {
          let value;
          if (detector) value = (await detector.detect(video))[0]?.rawValue;
          else if (video.videoWidth && video.videoHeight) {
            canvas.width = video.videoWidth; canvas.height = video.videoHeight; context.drawImage(video, 0, 0);
            value = WeftFormat.decodeQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data;
          }
          if (value) {
          byId('cloud-pairing-input').value = value; dialog.close(); byId('cloud-pairing-connect').focus(); return;
        } } catch { info.textContent = '暂时无法识别，请调整画面或输入配对码。'; }
        timer = setTimeout(scan, 300);
      }; void scan();
    } catch { video.hidden = true; info.textContent = '相机暂不可用，请关闭并输入电脑的配对码。'; stream?.getTracks().forEach(track => track.stop()); }
  }
  async function init() {
    if (initialized) return; initialized = true; native = !!window.weftNative;
    showAuth();
    const identity = native ? await call('cloud.app.identity') : { hostOrigin: location.origin, deviceName: '这个浏览器', deviceType: 'web' };
    const hostOrigin = identity.hostOrigin || location.origin;
    const initialPairing = location.hash.startsWith('#pair=') ? 'wm1.' + location.hash.slice(6) : null;
    if (initialPairing) history.replaceState(null, '', location.pathname + location.search);
    const transport = WeftUiCore.createMobileCloudTransport({ bridge: androidBridge, native, hostOrigin });
    const ui = { byId, element, toast, updateAvailability: updateComposer,
      errorAt: (id, message) => { const node = byId(id); node.textContent = message || ''; node.hidden = !message; },
      setBusy: (form, busy) => { for (const node of form.querySelectorAll('input,button')) node.disabled = busy; },
      scanPairing };
    const effects = new Proxy({
      paintScreen: view => { if (view === 'login' || view === 'cloud-wait') showAuth(view === 'cloud-wait'); },
      paintCloudAuth: value => forms?.paint(value),
      readMessageDraft: () => byId('draft').value,
      restoreCloudDraft: value => { byId('draft').value = value; updateComposer(); },
      paintIdentity: noop, toast,
      paintPendingDevices: payload => settings?.pending(payload),
      clearNativeHostSessions: async () => { if (native) await call('auth.logout'); },
      openCloudHost: async connection => { if (native) await call('cloud.app.configure', { origin: connection.baseUrl }); return connection; },
      activateCloudHost: noop,
    }, { get: (target, key) => target[key] || noop });
    core = WeftUiCore.create({ effects, ...transport, hostOrigin, initialPairing, crypto: globalThis.crypto, storage: localStorage,
      cloudVendor: WeftCloudVendor, desktop: false, bindDesktop: false, deviceType: native ? 'android' : 'web', deviceName: identity.deviceName });
    const accept = core.acceptSession; core.acceptSession = payload => { accept(payload); };
    const clear = core.clearSession; core.clearSession = () => { clear(); clearIdentity(); };
    core.enterAssistant = enterAssistant;
    core.authBase = hostOrigin + '/personal/v1/auth'; core.accessBase = hostOrigin + '/personal/v1';
    const client = WeftUiCore.adaptMobileCloudClient(core.initializeCloudAccount());
    const connect = core.cloudConnect; core.cloudConnect = async hostId => WeftUiCore.resolveMobileCloudConnection(client, await connect(hostId));
    if (identity.clientId) client.clientId = identity.clientId;
    if (identity.redirectUri) client.redirectUri = identity.redirectUri;
    forms = WeftMobileCloudForms(core, ui); settings = WeftMobileCloudSettings(core, ui);
    forms.mount(); settings.mount();
    const choose = element('button', 'button secondary', '连接电脑'); choose.type = 'button';
    choose.addEventListener('click', () => { page('devices'); }); byId('cloud-wait-view').append(choose);
    const redeem = core.cloudRedeemPairing; core.cloudRedeemPairing = async input => { const result = await redeem(input); core.state.cloudAuth.mode = 'authenticated'; return result; };
    globalThis.WeftMobileCloud.core = core;
    globalThis.WeftOfflineView?.mount({ core, nativeCall: native ? call : null,
      openConversation: () => page('chat'),
      identity: async () => native ? call('offline.identity') : core.cloudOfflineIdentity(),
      host: (path, body) => core.accessApi(path, { method: 'POST', body, protectedWrite: true }) });
    await core.load();
  }
  function route(name) {
    if (!core) return false;
    if (['connect', 'login'].includes(name) && core.state.cloudAuth.mode !== 'authenticated') { core.startCloudJourney(); return true; }
    if (!['account', 'devices'].includes(name) || !['authenticated', 'waiting'].includes(core.state.cloudAuth.mode)) return false;
    document.body.classList.remove('cloud-auth-active');
    for (const id of ['chat-page', 'home-page', 'generic-page', 'cloud-auth-page']) byId(id).classList.remove('active');
    byId('cloud-settings-page').classList.add('active');
    settings.open(name); return true;
  }
  globalThis.WeftMobileCloud = { init, route, get active() { return !!core; } };
})();
