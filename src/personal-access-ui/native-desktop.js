/* Progressive native integration; this file is inert in remote browsers. */
// Both native caption colors use the same alpha compositing as the CSS scrim.
function blendDesktopColor(base, scrim) {
  const channels = value => value.match(/[\d.]+/g).map(Number);
  const background = channels(base), overlay = channels(scrim);
  const alpha = overlay[3] ?? 1;
  return `rgb(${background.slice(0, 3).map((value, index) => Math.round(value * (1 - alpha) + overlay[index] * alpha)).join(', ')})`;
}
(() => {
  const native = window.weftmateDesktop;
  if (!native) return;
  native.onVisibility?.(hidden => globalThis.WeftReplyMotion?.setVisibility(hidden));
  document.documentElement.classList.add('weftmate-desktop');
  document.documentElement.dataset.nativePlatform = native.platform;
  const bar = document.createElement('div');
  bar.className = 'desktop-titlebar'; bar.textContent = 'WeftMate'; bar.setAttribute('aria-hidden', 'true');
  const mark = document.createElement('span'); mark.className = 'wm-brand'; bar.prepend(mark);
  document.body.prepend(bar);
  let modals = [], lastPalette = '';
  const updateTheme = () => {
    // UI-1 hides the site header in its full-height workspace. Reserve only the native bar there.
    const header = document.querySelector('.site-header');
    const workspace = header && getComputedStyle(header).display === 'none' ? 'full' : 'classic';
    if (document.documentElement.dataset.nativeWorkspace !== workspace) document.documentElement.dataset.nativeWorkspace = workspace;
    const style = getComputedStyle(bar);
    modals = modals.filter(dialog => dialog.isConnected && dialog.matches(':modal'));
    const top = modals.at(-1);
    // Read the actual token-backed backdrop, so theme/token changes and special
    // dialogs stay in sync. A fullscreen image paints over the titlebar itself.
    const scrim = top && getComputedStyle(top, top.classList.contains('phone-image-preview') ? null : '::backdrop').backgroundColor;
    const palette = { color: style.backgroundColor, symbolColor: style.color };
    if (native.platform === 'win32' && scrim) {
      palette.color = blendDesktopColor(palette.color, scrim);
      palette.symbolColor = blendDesktopColor(palette.symbolColor, scrim);
    }
    const key = JSON.stringify(palette);
    if (key !== lastPalette) { lastPalette = key; void native.setTheme(palette).catch(() => { lastPalette = ''; }); }
  };
  new MutationObserver(updateTheme).observe(document.documentElement, { attributes: true });
  new MutationObserver(updateTheme).observe(document.body, { attributes: true });
  if (native.platform === 'win32') {
    // Track modal opening order rather than DOM order, including dynamically
    // created confirmations, Esc/form closes, removal and close/reopen cycles.
    new MutationObserver(records => {
      const affectsModal = record => record.type === 'attributes'
        ? record.target.matches('dialog') || modals.some(dialog => record.target.contains(dialog))
        : [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && (node.matches('dialog') || node.querySelector('dialog')));
      // Message fragments and streaming indicators do not alter the native scrim.
      // Reading titlebar/backdrop styles for them would flush every streamed frame.
      if (!records.some(affectsModal)) return;
      for (const record of records) {
        if (record.type === 'attributes' && record.attributeName === 'open' && record.oldValue === null) {
          modals = modals.filter(dialog => dialog !== record.target);
          if (record.target.matches(':modal')) modals.push(record.target);
        }
      }
      for (const dialog of document.querySelectorAll('dialog:modal')) if (!modals.includes(dialog)) modals.push(dialog);
      updateTheme();
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['open', 'class', 'style', 'hidden'] });
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateTheme);
  updateTheme();
  globalThis.WeftDesktopUI = {
    init({ openConversation, error }) {
      const modelLabel = document.getElementById('model-label');
      const updateModel = () => { void native.setModelName(modelLabel.textContent).catch(() => {}); };
      new MutationObserver(updateModel).observe(modelLabel, { childList: true, subtree: true, characterData: true });
      updateModel();
      native.onConversation(target => {
        if (target?.activityId) document.dispatchEvent(new CustomEvent('weftmate:activity', { detail: target.activityId }));
        else void openConversation(target).catch(() => error('无法打开对话，请重新登录后重试。'));
      });
      const account = document.getElementById('account-view');
      const section = document.createElement('section'); section.className = 'card group';
      const heading = document.createElement('h2'); heading.textContent = '桌面程序';
      const label = document.createElement('label'); label.className = 'desktop-startup';
      const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.id = 'desktop-auto-start';
      label.append(toggle, document.createTextNode(' 开机自启（启动到托盘）'));
      section.append(heading, label); account.append(section);
      void native.settings().then(settings => { toggle.checked = settings.autoStart; toggle.disabled = !settings.autoStartSupported; });
      toggle.addEventListener('change', async () => {
        const enabled = toggle.checked; toggle.disabled = true;
        try { toggle.checked = (await native.setAutoStart(enabled)).autoStart; }
        catch { toggle.checked = !enabled; error('无法修改开机自启，请重试。'); }
        finally { toggle.disabled = false; }
      });
    },
    appendArtifactActions(parent, artifact, error) {
      for (const [action, text] of [['open', '用默认程序打开'], ['show', '在文件夹中显示']]) {
        const button = document.createElement('button'); button.type = 'button';
        button.className = 'artifact-action'; button.textContent = text;
        button.addEventListener('click', async () => {
          button.disabled = true;
          try { await native.artifact(artifact.artifactId, action); }
          catch { error('无法打开成果，请检查登录状态和默认程序后重试。'); }
          finally { button.disabled = false; }
        });
        parent.append(button);
      }
    },
  };
})();
