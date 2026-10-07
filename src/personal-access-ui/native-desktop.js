/* Progressive native integration; this file is inert in remote browsers. */
(() => {
  const native = window.weftmateDesktop;
  if (!native) return;
  document.documentElement.classList.add('weftmate-desktop');
  const bar = document.createElement('div');
  bar.className = 'desktop-titlebar'; bar.textContent = 'WeftMate'; bar.setAttribute('aria-hidden', 'true');
  document.body.prepend(bar);
  const updateTheme = () => {
    // UI-1 hides the site header in its full-height workspace. Reserve only the native bar there.
    const header = document.querySelector('.site-header');
    const workspace = header && getComputedStyle(header).display === 'none' ? 'full' : 'classic';
    if (document.documentElement.dataset.nativeWorkspace !== workspace) document.documentElement.dataset.nativeWorkspace = workspace;
    const style = getComputedStyle(bar);
    void native.setTheme({ color: style.backgroundColor, symbolColor: style.color }).catch(() => {});
  };
  new MutationObserver(updateTheme).observe(document.documentElement, { attributes: true });
  new MutationObserver(updateTheme).observe(document.body, { attributes: true });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateTheme);
  updateTheme();
  globalThis.WeftDesktopUI = {
    init({ openConversation, error }) {
      const modelLabel = document.getElementById('model-label');
      const updateModel = () => { void native.setModelName(modelLabel.textContent).catch(() => {}); };
      new MutationObserver(updateModel).observe(modelLabel, { childList: true, subtree: true, characterData: true });
      updateModel();
      native.onConversation(sessionId => { void openConversation(sessionId).catch(() => error('无法打开对话，请重新登录后重试。')); });
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
        button.className = 'button quiet small'; button.textContent = text;
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
