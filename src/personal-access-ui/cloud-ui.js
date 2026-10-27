(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const messages = { DEVICE_NOT_TRUSTED: '这台设备未获允许。请在电脑上重新配对。',
    PAIRING_INVALID: '配对码已失效。请在电脑上获取新码。', CLOUD_NOT_BOUND: '请先在电脑设置中绑定账号。',
    LOCAL_SESSION_REQUIRED: '请在电脑上用本地账号登录后操作。', ORIGIN_NOT_ALLOWED: '请在电脑的直接地址操作。',
    CLOUD_BINDING_CONFLICT: '这个账号已绑定其他本地账户。', CLOUD_TOKEN_INVALID: '登录已失效，请重新登录。',
    PAIRING_CONFLICT: '配对信息已变化，请重新添加设备。', PAIRING_CONFIRMATION_REQUIRED: '请核对两边的数字，并在电脑上确认。',
    STORAGE_UNAVAILABLE: '无法保存设备密钥。请允许此页面使用浏览器存储。' };
  const message = error => messages[error.message || error.code] || '连接不可用，请重试。';
  globalThis.WeftCloudUi = {
    create({ acceptSession, enterAssistant, openAccount, show, accessApi, toast, bindDesktop }) {
      let client, waitTimer, pairingTimer, pairingClock, activePairing, pairingState, closingPairing, generation = 0, pairingGeneration = 0, enabled = false;
      const newClient = () => new WeftCloud.Client();
      const dialog = document.createElement('dialog'); dialog.id = 'pairing-dialog'; dialog.className = 'dialog pairing-dialog';
      dialog.setAttribute('aria-labelledby', 'pairing-title'); dialog.setAttribute('aria-describedby', 'pairing-status');
      // The dialog owns its nodes; the devices page only supplies the entry button.
      dialog.innerHTML = '<div class="dialog-head"><h2 id="pairing-title">添加设备</h2><button type="button" class="button quiet" id="pairing-dismiss">关闭</button></div><div class="dialog-body"><p id="pairing-status" role="status" aria-live="polite"></p><div id="pairing-scan"><img id="pairing-qr" alt="一次性设备配对二维码" width="280" height="280" hidden><details><summary>使用配对码</summary><label for="pairing-code" class="sr-only">一次性配对码</label><textarea id="pairing-code" rows="3" readonly></textarea><button type="button" class="button secondary small" id="pairing-copy">复制配对码</button></details></div><div class="pairing-comparison"><p id="pairing-number-label">核对数字</p><output id="pairing-number" aria-labelledby="pairing-number-label">扫码后显示</output><p id="pairing-device" class="muted"></p></div><p id="pairing-countdown" class="muted"></p><p id="pairing-error" class="form-error" role="alert"></p></div><div class="dialog-footer"><button type="button" class="button secondary" id="pairing-cancel">取消配对</button><button type="button" class="button primary" id="pairing-confirm" disabled>数字一致，确认配对</button><button type="button" class="button primary" id="pairing-restart" hidden>重新添加</button></div>';
      $('pairing-panel').remove(); document.body.append(dialog);
      const pairingRequest = (action, body, challenge = activePairing?.challenge) => accessApi('/cloud/pairings/' + action,
        { method: 'POST', protectedWrite: true, body: { challenge, ...body } });
      function clearPairing() { pairingGeneration++; clearTimeout(pairingTimer); clearInterval(pairingClock); activePairing = null; $('pairing-code').value = ''; $('pairing-qr').removeAttribute('src'); }
      async function stopPairing() {
        if (closingPairing) return closingPairing;
        const challenge = activePairing?.challenge;
        const ticket = ++pairingGeneration; clearTimeout(pairingTimer); clearInterval(pairingClock); $('pairing-confirm').disabled = true;
        closingPairing = (async () => {
          // Keep the cancellation visible and retryable if the server cannot receive it.
          if (challenge && !['completed','cancelled','expired'].includes(pairingState)) {
            try { await pairingRequest('decision', { decision: 'cancel' }, challenge); }
            catch (error) { $('pairing-error').textContent = message(error); void pollPairing(ticket); return false; }
          }
          clearPairing(); dialog.close(); return true;
        })();
        try { return await closingPairing; } finally { closingPairing = null; }
      }
      function cancel() { generation++; clearTimeout(waitTimer); stopPairing(); if (client) void client.forget().catch(() => {}); client = null; }
      function failure(error) {
        const code = error.message || error.code;
        const terminal = ['DEVICE_NOT_TRUSTED', 'CLOUD_TOKEN_INVALID', 'PAIRING_INVALID', 'CLOUD_NOT_BOUND'].includes(code);
        $('cloud-wait-title').textContent = code === 'DEVICE_NOT_TRUSTED' ? '未获允许' : terminal ? '请重新登录' : '连接不可用';
        $('cloud-wait-status').textContent = message(error);
        $('cloud-wait-retry').hidden = terminal;
        if (terminal) void client?.forget().catch(() => {});
        return terminal;
      }
      async function session(result, ticket) {
        if (ticket !== generation) return;
        if (result.status === 'pending_approval') {
          show('cloud-wait'); $('cloud-wait-title').textContent = '等待已有设备允许';
          $('cloud-wait-retry').hidden = false; $('cloud-wait-status').textContent = '在已登录的电脑或手机上点“允许”。';
          waitTimer = setTimeout(() => retry(ticket), 3000); return;
        }
        acceptSession(result); await enterAssistant();
      }
      async function retry(ticket = generation) {
        clearTimeout(waitTimer);
        try { await session(await client.exchange(), ticket); }
        catch (error) {
          if (ticket !== generation) return;
          // Denied and expired logins require an explicit new attempt.
          if (!failure(error))
            waitTimer = setTimeout(() => retry(ticket), 10000);
        }
      }
      async function start(mode) {
        const ticket = ++generation;
        const button = mode === 'bind' ? $('cloud-bind') : $('cloud-login'); button.disabled = true;
        try {
          if (mode === 'bind' && bindDesktop) { await bindDesktop(); return; }
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
        if (dialog.open && activePairing && !['completed','cancelled','expired'].includes(pairingState)) return;
        clearPairing();
        const ticket = ++pairingGeneration;
        if (!dialog.open) dialog.showModal();
        pairingState = 'waiting'; $('pairing-title').textContent = '添加设备'; $('pairing-error').textContent = '';
        $('pairing-scan').hidden = false; $('pairing-number').textContent = '扫码后显示'; $('pairing-device').textContent = '';
        $('pairing-countdown').textContent = ''; $('pairing-confirm').hidden = false; $('pairing-confirm').disabled = true;
        $('pairing-cancel').hidden = false; $('pairing-restart').hidden = true;
        $('pairing-status').textContent = '正在生成…'; $('pairing-qr').hidden = true; $('pairing-qr').removeAttribute('src'); $('pairing-code').value = '';
        try {
          const result = await accessApi('/cloud/pairings', { method: 'POST', protectedWrite: true, body: {} });
          if (ticket !== pairingGeneration) { await pairingRequest('decision', {decision:'cancel'}, result.challenge); return; }
          activePairing = result;
          const code = WeftCloud.pairingCode(result);
          const url = (result.relay?.baseUrl || result.origin) + '/personal/v1/ui/#pair=' + code.slice(4);
          const qr = await WeftCloudVendor.QRCode.toDataURL(url, { width: 280, margin: 4, errorCorrectionLevel: 'M' });
          if (ticket !== pairingGeneration) return;
          $('pairing-qr').src = qr; $('pairing-qr').hidden = false; $('pairing-code').value = code;
          $('pairing-status').textContent = '用手机扫描二维码。扫码后，请核对电脑和手机显示的六位数字。';
          const deadline = Date.now() + result.expiresIn * 1000;
          const tick = () => { const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            $('pairing-countdown').textContent = seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} 后过期` : '本次配对已过期';
            if (!seconds) paintPairing({state:'expired'}); };
          tick(); pairingClock = setInterval(tick, 1000); void pollPairing(ticket);
        } catch (error) { if (ticket === pairingGeneration) { $('pairing-error').textContent = message(error); $('pairing-restart').hidden = false; } }
      }
      function paintPairing(result) {
        pairingState = result.state; $('pairing-confirm').disabled = result.state !== 'comparing';
        $('pairing-device').textContent = result.deviceName ? `正在配对：${result.deviceName}` : '';
        if (result.verificationCode) $('pairing-number').textContent = result.verificationCode.slice(0,3) + ' ' + result.verificationCode.slice(3);
        const copy = {committed:'手机已扫码，正在准备核对数字…',comparing:'请核对两边的六位数字。只有完全一致时，才确认配对。',confirmed:'已确认，正在等待手机完成连接…',completed:'配对成功，手机现在可以连接这台电脑。',cancelled:'已取消，本次二维码和配对码已作废。',expired:'配对已过期，请重新添加设备。'};
        if (copy[result.state]) $('pairing-status').textContent = copy[result.state];
        $('pairing-scan').hidden = result.state !== 'waiting';
        if (['completed','cancelled','expired'].includes(result.state)) {
          clearTimeout(pairingTimer); clearInterval(pairingClock);
          $('pairing-title').textContent = {completed:'配对成功',cancelled:'已取消配对',expired:'配对已过期'}[result.state];
          $('pairing-confirm').hidden = true; $('pairing-cancel').hidden = true; $('pairing-restart').hidden = false;
          $('pairing-countdown').textContent = ''; $('pairing-code').value = ''; $('pairing-qr').removeAttribute('src');
          if(result.state !== 'completed') $('pairing-number').textContent = '—';
        }
      }
      async function pollPairing(ticket) {
        try { const result = await pairingRequest('status', {}); if (ticket !== pairingGeneration) return; $('pairing-error').textContent = ''; paintPairing(result); }
        catch (error) { if (ticket !== pairingGeneration) return; $('pairing-confirm').disabled = true; $('pairing-error').textContent = message(error); }
        if (ticket === pairingGeneration && !['completed','cancelled','expired'].includes(pairingState)) pairingTimer = setTimeout(() => pollPairing(ticket), 1000);
      }
      async function decidePairing(decision) {
        const ticket = ++pairingGeneration; clearTimeout(pairingTimer); $('pairing-confirm').disabled = true; $('pairing-cancel').disabled = true;
        try { const result = await pairingRequest('decision', {decision, ...(decision === 'confirm' ? {verificationCode:$('pairing-number').textContent.replace(/ /g,'')} : {})});
          if (ticket === pairingGeneration) { $('pairing-error').textContent = ''; paintPairing(result); } }
        catch (error) { if (ticket === pairingGeneration) $('pairing-error').textContent = message(error); }
        finally { $('pairing-cancel').disabled = false;
          if (ticket === pairingGeneration && !['completed','cancelled','expired'].includes(pairingState)) void pollPairing(ticket); }
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
      $('pairing-dismiss').addEventListener('click', () => void stopPairing());
      dialog.addEventListener('cancel', event => { event.preventDefault(); void stopPairing(); });
      $('pairing-confirm').addEventListener('click', () => void decidePairing('confirm'));
      $('pairing-cancel').addEventListener('click', () => void decidePairing('cancel'));
      $('pairing-restart').addEventListener('click', () => { clearPairing(); void pairing(); });
      $('pairing-copy').addEventListener('click', () => navigator.clipboard.writeText($('pairing-code').value)
        .then(() => toast('配对码已复制。'), () => toast('请选中配对码复制。')));
      $('cloud-wait-cancel').addEventListener('click', () => { cancel(); show('login'); });
      $('cloud-wait-retry').addEventListener('click', () => { if (client) void retry(); });
      return { cancel, refreshBinding, stopPairing, openPairing: pairing, async boot() {
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
          catch (error) { failure(error); }
          return true;
        }
        const callback = location.href; history.replaceState(null, '', location.pathname);
        client = newClient(); const ticket = ++generation;
        show('cloud-wait'); $('cloud-wait-title').textContent = '正在登录'; $('cloud-wait-status').textContent = '正在完成登录…';
        try {
          const result = await client.complete(callback);
          if (result.binding) { acceptSession(await client.json('/auth/me')); openAccount(); toast('已绑定 WeftMate 账号。'); }
          else await session(result, ticket);
        } catch (error) { failure(error); }
        return true;
      } };
    }
  };
})();
