(() => {
  'use strict';
  let client, status, onLogin, timer, active = 0;
  const callbackUri = 'com.memoweft.weftmate:/oauth';
  const message = error => ({ PAIRING_INVALID: '配对码已失效，请获取新码。', DEVICE_NOT_TRUSTED: '这台设备未获允许，请重新配对。',
    CLOUD_TOKEN_INVALID: '登录已失效，请重新登录。', CLOUD_NOT_BOUND: '请先在电脑设置中绑定账号。',
    HOST_PIN_MISMATCH: '电脑身份不符，请重新配对。' }[error.message] || '连接不可用，请重试。');
  async function create(host, call) {
    return new WeftCloud.Client({ host, redirectUri: callbackUri, clientId: 'weftmate-android',
      request: (url, options = {}) => call('cloud.request', { url, method: options.method || 'GET',
        headers: options.headers || {}, ...(options.body ? { body: options.body } : {}) }),
      launch: url => call('cloud.authorize', { url }),
      credentialStorage: async (_key, value, remove) => {
        const result = await call('cloud.tokens', { ...(remove ? { value: '' } : value === undefined ? {} : { value: JSON.stringify(value) }) });
        return result.value ? JSON.parse(result.value) : undefined;
      } });
  }
  async function finish(result, call, ticket) {
    if (ticket !== active) return;
    if (result.status === 'pending_approval') {
      if (status) status.textContent = '等待已有设备允许。';
      timer = setTimeout(async () => { try { await finish(await client.exchange(), call, ticket); }
        catch (error) { if (status) status.textContent = message(error); } }, 3000); return;
    }
    await onLogin(await call('cloud.adopt'));
    client = null;
  }
  let deviceTimer;
  globalThis.WeftCloudMobile = {
    observe(refresh) { clearInterval(deviceTimer); deviceTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15000); },
    mount(target, { call, loggedIn }) {
      if (loggedIn) return;
      const section = document.createElement('section'); section.className = 'group';
      const body = document.createElement('div'); body.className = 'group-body';
      const title = document.createElement('h2'); title.textContent = 'WeftMate 账号';
      const label = document.createElement('label'); label.textContent = '输入电脑上的配对码';
      const input = document.createElement('textarea'); input.rows = 3; label.append(input);
      const info = document.createElement('p'); info.className = 'muted'; info.setAttribute('role', 'status'); status = info;
      const login = document.createElement('button'); login.className = 'button'; login.type = 'button'; login.textContent = '用 WeftMate 账号登录';
      login.addEventListener('click', async () => {
        login.disabled = true; const ticket = ++active;
        try {
          const pairing = WeftCloud.parsePairing(input.value);
          const host = pairing.relay?.baseUrl || pairing.origin;
          await call('cloud.configure', { origin: host, pin: pairing.tlsSpki });
          client = await create(host, call);
          await WeftCloud.storage('android-cloud-host', host);
          info.textContent = '在浏览器中登录，完成后返回应用。';
          if (ticket === active) await client.start({ pairing, deviceName: 'Android' });
        } catch (error) { info.textContent = message(error); }
        finally { login.disabled = false; }
      });
      const cancel = document.createElement('button'); cancel.className = 'button quiet'; cancel.type = 'button'; cancel.textContent = '取消';
      cancel.addEventListener('click', () => { active++; clearTimeout(timer); void client?.forget(); client = null; void call('cloud.cancel'); info.textContent = ''; });
      body.append(title, label, login, cancel, info); section.append(body); target.append(section);
    },
    async resume({ call, adopt }) {
      onLogin = adopt;
      const result = await call('cloud.callback');
      if (!result.url) return;
      const host = await WeftCloud.storage('android-cloud-host');
      if (!host) return;
      client = await create(host, call); const ticket = ++active;
      try { await finish(await client.complete(result.url), call, ticket); }
      catch (error) { if (status) status.textContent = message(error); }
    },
    async pending({ call, loggedIn, owner, current }) {
      const banner = document.getElementById('cloud-device-banner');
      if (!banner) return;
      if (!loggedIn) { banner.hidden = true; banner.replaceChildren(); return; }
      try {
        const result = await call('cloud.pending');
        if (!current(owner)) return;
        banner.replaceChildren(); banner.hidden = !result.devices?.length;
        for (const device of result.devices || []) {
          const row = document.createElement('div');
          const label = document.createElement('span'); label.textContent = `${device.name || '新设备'} 等待允许`; row.append(label);
          for (const [decision, text] of [['allow', '允许'], ['deny', '拒绝']]) {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
            button.addEventListener('click', async () => { if (!current(owner)) return;
              button.disabled = true;
              try { await call('cloud.decision', { id: device.id, decision }); if (current(owner)) row.remove(); }
              catch { if (current(owner)) { button.disabled = false; label.textContent = '处理未完成，请重试。'; } } });
            row.append(button);
          }
          banner.append(row);
        }
      } catch { if (current(owner)) banner.hidden = true; }
    }
  };
})();
