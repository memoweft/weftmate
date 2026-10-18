import { fileURLToPath } from 'node:url';
/** An inert first paint, adopted by the authenticated desktop after startup. */
export function createDesktopStartup(window, { startInTray = false, maximized = false, isQuitting, restoreBounds = Promise.resolve(true),
  lifecycle = { stopped: false, maximizeOnShow: maximized } }) {
  let hidden = startInTray, activationReady = false, showRequested = false;
  const show = () => {
    if (lifecycle.stopped || isQuitting() || window.isDestroyed()) return;
    if (!activationReady) { showRequested = true; return; }
    hidden = false; showRequested = false;
    if (lifecycle.maximizeOnShow) { window.maximize(); lifecycle.maximizeOnShow = false; }
    if (window.isMinimized?.()) window.restore();
    window.show(); window.focus?.();
  };
  const close = event => {
    if (!isQuitting()) { event.preventDefault(); hidden = true; showRequested = false; window.hide(); }
  };
  window.on('close', close);
  const loading = window.loadFile(fileURLToPath(new URL('./desktop-startup.html', import.meta.url)));
  // Paint the file immediately; activation waits only for bounded geometry,
  // never for credentials, runtime or account-service startup.
  const ready = Promise.all([loading, restoreBounds]).then(([, confirmed]) => {
    activationReady = true;
    if (showRequested || !hidden || confirmed === false) show();
  });
  return {
    ready, show,
    adopt() { window.removeListener('close', close); },
    async fail() {
      await ready;
      if (!lifecycle.stopped && !window.isDestroyed() && !isQuitting()) await window.webContents.executeJavaScript("document.getElementById('preparing').hidden = true; document.getElementById('failed').hidden = false;");
    },
  };
}
