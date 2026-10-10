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
  // Keep the source select for feature handlers and forms; expose a single
  // accessible combobox instead of invoking a platform-native desktop popup.
  const settingsSelects = new WeakMap();
  function bindSettingsSelect(select) {
    if (settingsSelects.has(select) || select.classList.contains('settings-control-source')) return;
    // Selects hidden in markup are legacy / reserved sources (for example the
    // composer's model and execution-target fallbacks); never surface a proxy.
    if (select.hidden) return;
    const trigger = document.createElement('button'), text = document.createElement('span');
    trigger.type = 'button'; trigger.className = `settings-select ${select.className}`;
    trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const label = select.getAttribute('aria-label') || select.labels?.[0]?.textContent.trim() || '选择';
    trigger.setAttribute('aria-label', label);
    const icon = globalThis.WeftIcons?.create('chevron', 16) || document.createElement('span');
    if (!globalThis.WeftIcons) icon.className = 'icon icon-chevron';
    trigger.append(text, icon);
    const menu = document.createElement('div'); menu.className = 'settings-select-menu'; menu.hidden = true;
    const goalsControl = !!select.closest('.goals-page'); if (goalsControl) menu.classList.add('goals-select-menu');
    menu.id = `settings-options-${select.id || crypto.randomUUID()}`;
    const list = document.createElement('div'); list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', label);
    list.id = menu.id + '-list'; trigger.setAttribute('aria-controls', list.id);
    select.after(trigger, menu); select.hidden = true; select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    settingsSelects.set(select, trigger);
    const sync = () => { menu.dataset.presentation = innerWidth <= 600 ? 'sheet' : 'popover'; text.textContent = select.selectedOptions[0]?.textContent || label; trigger.disabled = select.disabled; trigger.hidden = select.dataset.controlHidden === 'true' || select.classList.contains('settings-category-picker') && innerWidth >= 720; };
    const close = (focus = false) => { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (popoverOpen()) menu.hidePopover(); if (focus) trigger.focus({ preventScroll: true }); };
    // Android WebView may not support the Popover API selector; treat it as closed.
    const popoverOpen = () => { try { return menu.matches(':popover-open'); } catch { return false; } };
    let search;
    const options = () => [...list.querySelectorAll('[role=option]')];
    function render(query = '') {
      // Keep arbitrary ISO calendar years available without a native date picker.
      if (goalsControl && select.dataset.customYear === 'true' && /^\d{4}年?$/.test(query.trim())) {
        const value = query.trim().replace('年','');
        if (![...select.options].some(option => option.value === value)) {
          const option = document.createElement('option');option.value=value;option.textContent=`${Number(value)}年`;select.append(option);
        }
      }
      list.replaceChildren();
      for (const option of select.options) {
        if (option.hidden || !option.textContent.toLocaleLowerCase().includes(query.toLocaleLowerCase())) continue;
        const button = document.createElement('button'); button.type = 'button'; button.textContent = option.textContent;
        button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(option.selected));
        if (goalsControl && option.selected && globalThis.WeftIcons) button.append(WeftIcons.create('allow',16));
        button.disabled = option.disabled || option.parentElement?.disabled;
        button.onclick = () => { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); sync(); close(true); };
        list.append(button);
      }
      if (!list.children.length) { const empty = document.createElement('p'); empty.className = 'settings-select-empty'; empty.textContent = '没有匹配的选项'; empty.setAttribute('role', 'status'); list.append(empty); }
      position(menu, trigger, { side: 'bottom' });
    }
    function open(last = false) {
      if (trigger.disabled) return;
      menu.replaceChildren(); search = null;
      if (select.options.length > 8) {
        search = document.createElement('input'); search.type = 'search'; search.placeholder = select.dataset.customYear === 'true' ? '输入或搜索年份' : '搜索选项'; search.setAttribute('aria-label', `搜索${label}`);
        search.oninput = () => render(search.value); menu.append(search);
      }
      menu.append(list); menu.hidden = false; trigger.setAttribute('aria-expanded', 'true'); render();
      const buttons = options().filter(button => !button.disabled);
      const selected = buttons.find(button => button.getAttribute('aria-selected') === 'true');
      (search || selected || buttons[last ? buttons.length - 1 : 0])?.focus({ preventScroll: true });
      if (goalsControl) selected?.scrollIntoView({block:'nearest'});
    }
    trigger.onclick = () => menu.hidden ? open() : close(true);
    trigger.onkeydown = event => { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); open(event.key === 'ArrowUp'); } };
    menu.onkeydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
      if (event.key === 'Tab') { close(); trigger.focus(); }
      const buttons = options().filter(button => !button.disabled), index = buttons.indexOf(document.activeElement);
      if (event.key === 'Enter' && document.activeElement === search) { event.preventDefault(); buttons[0]?.click(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (document.activeElement !== search || event.key.startsWith('Arrow'))) {
        event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    };
    document.addEventListener('click', event => { if (!trigger.contains(event.target) && !menu.contains(event.target)) close(); });
    select.addEventListener('change', () => { sync(); close(); });
    select.addEventListener('weft:sync', sync);
    select.form?.addEventListener('reset', () => queueMicrotask(sync));
    new MutationObserver(() => { sync(); if (!menu.hidden) render(search?.value || ''); }).observe(select, { subtree: true, childList: true, attributes: true, characterData: true });
    select.closest('dialog')?.addEventListener('close', () => close());
    window.addEventListener('resize', sync); sync();
  }
  function bindSettings(dialog) {
    const bind = () => dialog.querySelectorAll('select').forEach(bindSettingsSelect);
    bind(); new MutationObserver(bind).observe(dialog, { childList: true, subtree: true });
  }
  if (typeof MutationObserver === 'function') document.addEventListener('DOMContentLoaded', () => {
    const bind = () => document.querySelectorAll('select').forEach(bindSettingsSelect);
    bind(); new MutationObserver(records => { if (records.some(record => [...record.addedNodes].some(node => node.matches?.('select') || node.querySelector?.('select')))) bind(); }).observe(document.body, { childList: true, subtree: true });
  });
  // Shared action menu, with the same surface as conversation menus.
  let dismissMenu;
  function menu(trigger, entries, onError = () => {}) {
    dismissMenu?.(false);
    const box = document.createElement('div'); box.className = 'session-menu';
    box.setAttribute('role', 'menu'); box.setAttribute('aria-label', trigger.getAttribute('aria-label'));
    const close = (focus = true) => {
      active.get(box)?.observer?.disconnect(); active.delete(box);box.remove(); document.removeEventListener('pointerdown', outside);
      trigger.setAttribute('aria-expanded', 'false'); dismissMenu = null;
      if (focus && trigger.isConnected) trigger.focus({preventScroll:true});
    };
    const outside = event => { if (!box.contains(event.target) && !trigger.contains(event.target)) close(false); };
    for (const entry of entries) {
      const item = document.createElement('button'); item.type = 'button';
      item.className = `session-menu-item${entry.danger ? ' danger' : ''}`;
      if (entry.icon) { item.append(globalThis.WeftIcons.create(entry.icon,16)); item.classList.add('session-menu-item-with-icon'); }
      const label = document.createElement('span'); label.textContent = entry.name; item.append(label);
      if (entry.description) { item.title = entry.description; const description = document.createElement('small'); description.className = 'session-menu-description'; description.textContent = entry.description; label.append(description); }
      item.setAttribute('aria-label',entry.name); if(entry.description)item.setAttribute('aria-description',entry.description); item.setAttribute('role', 'menuitem'); item.disabled = !!entry.disabled;
      item.onclick = () => { close(); Promise.resolve().then(entry.action).catch(onError); }; box.append(item);
    }
    box.onkeydown = event => {
      const items = [...box.querySelectorAll('button:not(:disabled)')], index = items.indexOf(document.activeElement);
      if (event.key === 'Escape' || event.key === 'Tab') { event.stopPropagation(); if (event.key === 'Escape') event.preventDefault(); close(); }
      if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
        event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    document.body.append(box); trigger.setAttribute('aria-haspopup','menu'); trigger.setAttribute('aria-expanded','true');
    position(box, trigger, {side:'bottom',align:'end'}); box.querySelector('button:not(:disabled)')?.focus();
    document.addEventListener('pointerdown', outside); dismissMenu = close;
    return close;
  }
  globalThis.WeftPopover = { position, bindSelect, bindSettings, bindSettingsSelect, menu, closeMenu: () => dismissMenu?.() };
})();
