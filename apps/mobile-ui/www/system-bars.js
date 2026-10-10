/* Browser chrome follows the rendered surface, including system and account changes. */
(() => {
  function sync(document = globalThis.document, readStyle = globalThis.getComputedStyle) {
    if (!document?.documentElement || !readStyle) return;
    const root = document.documentElement;
    const surface = readStyle(root).getPropertyValue('--surface').trim();
    if (!surface) return;
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name', 'theme-color'); document.head.append(meta); }
    const color = /^#[a-f\d]{3}$/i.test(surface) ? '#' + [...surface.slice(1)].map(c => c + c).join('') : surface;
    meta.setAttribute('content', color);
    globalThis.weftSyncSystemBars?.(root.dataset.theme === 'dark');
    return color;
  }
  globalThis.WeftSystemBars = { sync };
  if (globalThis.MutationObserver && globalThis.document?.documentElement) {
    new MutationObserver(() => sync()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });
    document.addEventListener('DOMContentLoaded', () => sync());
    globalThis.addEventListener?.('pageshow', () => sync());
  }
})();
