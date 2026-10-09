/* Shared presentation geometry for desktop and phone anchored menus. */
(() => {
  const active = new Map();
  const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
  function position(menu, trigger, { side = 'top', align = 'start' } = {}) {
    if (!menu || !trigger || menu.hidden) return;
    const viewport = window.visualViewport;
    const left = (viewport?.offsetLeft || 0) + 8;
    const viewportTop = viewport?.offsetTop || 0;
    const captionBottom = document.documentElement.dataset.nativePlatform === 'win32'
      ? document.querySelector('.desktop-titlebar')?.getBoundingClientRect().bottom || 0 : 0;
    const top = Math.max(viewportTop, captionBottom) + 8;
    const right = left + (viewport?.width || window.innerWidth) - 16;
    const bottom = viewportTop + (viewport?.height || window.innerHeight) - 8;
    // The top layer escapes overflow and transformed ancestors without reparenting
    // controls (outside-click containment and keyboard handlers keep working).
    if (menu.showPopover) {
      menu.setAttribute('popover', 'manual');
      if (!menu.matches(':popover-open')) menu.showPopover();
    }
    Object.assign(menu.style, { position: 'fixed', inset: 'auto', margin: '0',
      boxSizing: 'border-box', minWidth: '0', minHeight: '0',
      maxWidth: `${Math.max(0, right - left)}px`, maxHeight: `${Math.max(0, bottom - top)}px`,
      overflow: 'auto', overscrollBehavior: 'contain' });
    const anchor = trigger.getBoundingClientRect();
    const width = menu.offsetWidth, naturalHeight = menu.offsetHeight;
    const above = Math.max(0, anchor.top - top - 8), below = Math.max(0, bottom - anchor.bottom - 8);
    const preferred = side === 'top' ? above : below, opposite = side === 'top' ? below : above;
    if (naturalHeight > preferred && opposite > preferred) side = side === 'top' ? 'bottom' : 'top';
    const space = side === 'top' ? above : below;
    menu.style.maxHeight = `${Math.min(bottom - top, space)}px`;
    const height = menu.offsetHeight;
    let x = align === 'end' ? anchor.right - width : anchor.left;
    if (x < left || x + width > right) x = align === 'end' ? anchor.left : anchor.right - width;
    menu.style.left = `${clamp(x, left, right - width)}px`;
    menu.style.top = `${clamp(side === 'top' ? anchor.top - 8 - height : anchor.bottom + 8, top, bottom - height)}px`;
    menu.dataset.popoverSide = side;
    if (!active.has(menu)) {
      const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => refresh()) : null;
      active.set(menu, { trigger, options: { side, align }, observer });
      observer?.observe(menu); observer?.observe(trigger);
    } else Object.assign(active.get(menu), { trigger, options: { side, align } });
  }
  let frame;
  function refresh() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      for (const [menu, entry] of active) {
        if (!menu.isConnected || menu.hidden || !entry.trigger.isConnected) {
          entry.observer?.disconnect(); active.delete(menu); continue;
        }
        position(menu, entry.trigger, entry.options);
      }
    });
  }
  globalThis.window?.addEventListener?.('resize', refresh);
  globalThis.window?.addEventListener?.('scroll', refresh, true);
  globalThis.window?.visualViewport?.addEventListener('resize', refresh);
  globalThis.window?.visualViewport?.addEventListener('scroll', refresh);
  function bindSelect(select, className) {
    if (!select?.parentNode) return;
    const menu = document.createElement('div');
    menu.className = className; menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', select.getAttribute('aria-label'));
    select.parentNode.append(menu);
    select.setAttribute('aria-haspopup', 'menu');
    const close = (focus = false) => {
      menu.hidden = true; select.setAttribute('aria-expanded', 'false');
      if (focus) select.focus({ preventScroll: true });
    };
    const open = () => {
      if (select.disabled) return;
      if (!menu.hidden) { close(true); return; }
      menu.replaceChildren();
      for (const option of select.options) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'model-option'; button.textContent = option.textContent;
        button.setAttribute('role', 'menuitemradio');
        button.setAttribute('aria-checked', String(option.value === select.value));
        button.addEventListener('click', () => {
          select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); close(true);
        });
        menu.append(button);
      }
      menu.hidden = false; position(menu, select);
      select.setAttribute('aria-expanded', 'true');
      menu.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
    };
    select.addEventListener('mousedown', event => event.preventDefault());
    select.addEventListener('click', open);
    select.addEventListener('change', () => close());
    select.addEventListener('keydown', event => {
      if (['ArrowUp', 'ArrowDown', ' ', 'Enter'].includes(event.key)) { event.preventDefault(); open(); }
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
      const buttons = [...menu.children], index = buttons.indexOf(document.activeElement);
      if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    });
    document.addEventListener('click', event => { if (event.target !== select && !menu.contains(event.target)) close(); });
  }
  globalThis.WeftPopover = { position, bindSelect };
})();
