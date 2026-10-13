// Android presentation adapter. Business calls remain in the original native bridge.
(() => {
  const setting = () => {
    if (typeof call !== 'function' || typeof state === 'undefined' || !state.booted) return;
    const target = document.getElementById('generic-page');
    if (!target || state.page !== 'general' || document.getElementById('native-ui-setting')) return;
    const row = document.createElement('label');
    row.id = 'native-ui-setting'; row.className = 'settings-row';
    const text = document.createElement('span'); text.textContent = '使用原生聊天界面';
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.className = 'settings-switch';
    toggle.setAttribute('aria-label', '使用原生聊天界面');
    call('native.preference').then(value => { toggle.checked = value.enabled; }).catch(() => {});
    toggle.addEventListener('change', () => call('native.presentation', {enabled: toggle.checked}));
    row.append(text, toggle); target.prepend(row);
  };
  new MutationObserver(setting).observe(document.body, {childList:true, subtree:true});
  setting();
})();
