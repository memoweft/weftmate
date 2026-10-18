import { fileURLToPath } from 'node:url';
/** An inert first paint, adopted by the authenticated desktop after startup. */
export function createDesktopStartup(window, { startInTray = false, isQuitting }) {
  let hidden = startInTray;
  const close = event => {
    if (!isQuitting()) { event.preventDefault(); hidden = true; window.hide(); }
  };
  window.on('close', close);
  const ready = window.loadFile(fileURLToPath(new URL('./desktop-startup.html', import.meta.url))).then(() => {
    if (!hidden && !isQuitting() && !window.isDestroyed()) window.show();
  });
  return {
    ready,
    adopt() { window.removeListener('close', close); },
    async fail() {
      await ready;
      if (!window.isDestroyed() && !isQuitting()) await window.webContents.executeJavaScript("document.getElementById('preparing').hidden = true; document.getElementById('failed').hidden = false;");
    },
  };
}
