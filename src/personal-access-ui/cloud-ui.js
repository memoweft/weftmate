(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const messages = { DEVICE_NOT_TRUSTED: '这台设备未获允许。请在电脑上重新配对。',
    PAIRING_INVALID: '配对码已失效。请在电脑上获取新码。', CLOUD_NOT_BOUND: '请先在电脑设置中绑定账号。',
    LOCAL_SESSION_REQUIRED: '请在电脑上用本地账号登录后操作。', ORIGIN_NOT_ALLOWED: '请在电脑的直接地址操作。',
    CLOUD_BINDING_CONFLICT: '这个账号已绑定其他本地账户。', CLOUD_TOKEN_INVALID: '登录已失效，请重新登录。',
    STORAGE_UNAVAILABLE: '无法保存设备密钥。请允许此页面使用浏览器存储。' };
  const message = error => messages[error.message || error.code] || '连接不可用，请重试。';
  globalThis.WeftCloudUi = {
    create({ acceptSession, enterAssistant, openAccount, show, accessApi, toast }) {
      let client, waitTimer, pairingTimer, generation = 0, pairingGeneration = 0, enabled = false;
      const newClient = () => new WeftCloud.Client();
      function stopPairing() { pairingGeneration++; clearTimeout(pairingTimer); $('pairing-panel').hidden = true; $('pairing-code').value = ''; $('pairing-qr').removeAttribute('src'); }
      function cancel() { generation++; clearTimeout(waitTimer); stopPairing(); if (client) void client.forget().catch(() => {}); client = null; }
      async function session(result, ticket) {
        if (ticket !== generation) return;
        if (result.status === 'pending_approval') {
          show('cloud-wait'); $('cloud-wait-status').textContent = '在已登录的电脑或手机上点“允许”。';
          waitTimer = setTimeout(() => retry(ticket), 3000); return;
        }
        acceptSession(result); await enterAssistant();
      }
      async function retry(ticket = generation) {
        clearTimeout(waitTimer);
        try { await session(await client.exchange(), ticket); }
        catch (error) {
          if (ticket !== generation) return;
          $('cloud-wait-status').textContent = message(error);
          // Denied and expired logins require an explicit new attempt.
          if (!['DEVICE_NOT_TRUSTED', 'CLOUD_TOKEN_INVALID', 'PAIRING_INVALID', 'CLOUD_NOT_BOUND'].includes(error.message))
            waitTimer = setTimeout(() => retry(ticket), 10000);
        }
      }
      async function start(mode) {
        const ticket = ++generation;
        const button = mode === 'bind' ? $('cloud-bind') : $('cloud-login'); button.disabled = true;
        try {
          client = newClient();
          const claim = mode === 'bind' ? await accessApi('/cloud/claims', { method: 'POST', protectedWrite: true, body: {} }) : null;
          const input = $('cloud-pairing-input').value.trim();
          const pairing = mode !== 'bind' && input ? WeftCloud.parsePairing(input) : null;
          if (pairing && pairing.hostId !== (await client.configure()).hostId) throw new Error('PAIRING_INVALID');
          if (ticket === generation) await client.start({ mode, claimId: claim?.claimId, pairing,
            deviceName: $('login-device').value.trim() || '这台设备' });
        } catch (error) { if (ticket === generation) toast(message(error)); }
        finally { button.disabled = false; }
      }
      async function refreshBinding() {
        const ticket = generation;
        try {
          const result = await accessApi('/cloud/binding');
          if (ticket !== generation) return;
          $('cloud-account').hidden = false;
          $('cloud-binding-status').textContent = result.status === 'active' ? '已绑定 WeftMate 账号' : result.status === 'pending' ? '绑定未完成，请继续' : '未绑定';
          $('cloud-bind').hidden = !result.canManage || result.status === 'active';
          $('cloud-unbind').hidden = !result.canManage || result.status === 'unbound';
          $('pairing-open').hidden = !result.canManage || result.status !== 'active';
        } catch { $('cloud-account').hidden = true; $('pairing-open').hidden = true; }
      }
      async function pairing() {
        const ticket = ++pairingGeneration;
        clearTimeout(pairingTimer); $('pairing-panel').hidden = false;
        $('pairing-status').textContent = '正在生成…'; $('pairing-qr').removeAttribute('src'); $('pairing-code').value = '';
        try {
          const result = await accessApi('/cloud/pairings', { method: 'POST', protectedWrite: true, body: {} });
          const code = WeftCloud.pairingCode(result);
          const url = (result.relay?.baseUrl || result.origin) + '/personal/v1/ui/#pair=' + code.slice(4);
          const qr = await WeftCloudVendor.QRCode.toDataURL(url, { width: 280, margin: 4, errorCorrectionLevel: 'M' });
          if (ticket !== pairingGeneration) return;
          $('pairing-qr').src = qr; $('pairing-code').value = code;
          $('pairing-status').textContent = '用新设备扫码，或复制配对码。两分钟有效。';
          pairingTimer = setTimeout(pairing, result.expiresIn * 1000);
        } catch (error) { if (ticket === pairingGeneration) $('pairing-status').textContent = message(error); }
      }
      $('cloud-login').addEventListener('click', () => start('login'));
      $('cloud-bind').addEventListener('click', () => start('bind'));
      $('cloud-unbind').addEventListener('click', async () => {
        $('cloud-unbind').disabled = true;
        try { await accessApi('/cloud/binding', { method: 'DELETE', protectedWrite: true, body: {} }); stopPairing(); await refreshBinding(); toast('已解绑。本地资料保留。'); }
        catch (error) { toast(message(error)); }
        finally { $('cloud-unbind').disabled = false; }
      });
      $('pairing-open').addEventListener('click', pairing);
      $('pairing-close').addEventListener('click', stopPairing);
      $('pairing-copy').addEventListener('click', () => navigator.clipboard.writeText($('pairing-code').value)
        .then(() => toast('配对码已复制。'), () => toast('请选中配对码复制。')));
      $('cloud-wait-cancel').addEventListener('click', () => { cancel(); show('login'); });
      $('cloud-wait-retry').addEventListener('click', () => { if (client) void retry(); });
      return { cancel, refreshBinding, stopPairing, async boot() {
        try { await newClient().configure(); enabled = true; } catch { enabled = false; }
        $('cloud-login-section').hidden = !enabled;
        if (!enabled) return false;
        const hash = location.hash;
        if (hash.startsWith('#pair=')) { $('cloud-pairing-input').value = 'wm1.' + hash.slice(6); history.replaceState(null, '', location.pathname); return false; }
        if (!/^#(?:code|state|error)=/.test(hash)) {
          client = newClient(); await client.configure();
          const tokens = await WeftCloud.storage(client.tokenId);
          if (!tokens) { client = null; return false; }
          try { await client.json('/auth/me'); await client.forget(); client = null; return false; }
          catch (error) { if (error.message !== 'UNAUTHORIZED') { client = null; return false; } }
          const ticket = ++generation; show('cloud-wait');
          try { await session(await client.exchange(), ticket); }
          catch (error) { $('cloud-wait-status').textContent = message(error); }
          return true;
        }
        const callback = location.href; history.replaceState(null, '', location.pathname);
        client = newClient(); const ticket = ++generation;
        show('cloud-wait'); $('cloud-wait-status').textContent = '正在完成登录…';
        try {
          const result = await client.complete(callback);
          if (result.binding) { acceptSession(await client.json('/auth/me')); openAccount(); toast('已绑定 WeftMate 账号。'); }
          else await session(result, ticket);
        } catch (error) { $('cloud-wait-status').textContent = message(error); }
        return true;
      } };
    }
  };
})();
