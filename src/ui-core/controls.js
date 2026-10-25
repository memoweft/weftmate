/* Shared presentation primitives. Feature owners keep requests and persistence. */
(() => {
  const node = (tag, className = '', text) => {
    const element = document.createElement(tag); element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  function button(label, { variant = 'secondary', icon, action, disabled = false } = {}) {
    const element = node('button', `wm-button wm-button--${variant}`, label); element.type = 'button'; element.disabled = disabled;
    if (icon) { element.prepend(icon); if (variant === 'icon') { element.setAttribute('aria-label', label); element.title = label; [...element.childNodes].filter(n => n.nodeType === 3).forEach(n => n.remove()); } }
    if (action) element.addEventListener('click', action);
    return element;
  }
  function input({ label, multiline = false, value = '', placeholder = '', type = 'text' } = {}) {
    const element = node(multiline ? 'textarea' : 'input', 'wm-input');
    if (!multiline) element.type = type;
    element.value = value; element.placeholder = placeholder;
    if (label) element.setAttribute('aria-label', label);
    return element;
  }
  function toggle(source) {
    source.classList.add('wm-switch', 'settings-switch'); source.setAttribute('role', 'switch'); return source;
  }
  function segmented(source) {
    const group = node('div', 'wm-segmented settings-segmented');
    group.setAttribute('role', 'group'); group.setAttribute('aria-label', source.getAttribute('aria-label') || '选择');
    source.classList.add('settings-control-source'); source.tabIndex = -1;
    const update = () => { for (const item of group.children) { item.setAttribute('aria-pressed', String(item.dataset.value === source.value)); item.disabled = source.disabled || source.querySelector(`option[value="${CSS.escape(item.dataset.value)}"]`)?.disabled; } };
    for (const option of source.options) {
      const item = button(option.textContent, { variant: 'text', action: () => {
        if (source.value === option.value) return;
        source.value = option.value; source.dispatchEvent(new Event('change', { bubbles: true })); update();
      } });
      item.dataset.value = option.value; group.append(item);
    }
    source.after(group); source.addEventListener('change', update); source.addEventListener('weft:sync', update); update(); return group;
  }
  function row(title, description, control) {
    const line = node('div', 'wm-row settings-row'), copy = node('div', 'wm-row-copy'), label = node('label', 'wm-row-title', title);
    if (control.id) label.htmlFor = control.id;
    else if (!control.hasAttribute('aria-label') && !control.hasAttribute('aria-labelledby')) control.setAttribute('aria-label', title);
    copy.append(label); if (description) copy.append(node('p', 'wm-description muted', description));
    line.append(copy, control); return line;
  }
  function group(title, children = []) {
    const section = node('section', 'wm-group settings-group'), card = node('div', 'wm-card settings-group-card');
    if (title) section.append(node('h2', 'wm-group-title settings-group-title', title));
    card.append(...children); section.append(card); return section;
  }
  function skeleton({ rows = 3, compact = false, tag = 'div' } = {}) {
    const block = node(tag, `wm-skeleton${compact ? ' wm-skeleton--compact' : ''}`);
    block.setAttribute('role', 'status'); block.setAttribute('aria-label', '内容加载中');
    for (let index = 0; index < rows; index++) { const line = node('span', 'wm-skeleton-row'); line.setAttribute('aria-hidden', 'true'); line.append(node('span'), node('span')); block.append(line); }
    return block;
  }
  // Own only the loading placeholder. Completion never overwrites a newer load.
  const loads = new WeakMap();
  function loading(target, options) {
    const placeholder = skeleton(options); loads.set(target, placeholder);
    target.setAttribute('aria-busy', 'true'); target.replaceChildren(placeholder);
    return () => {
      if (loads.get(target) !== placeholder) return false;
      loads.delete(target); placeholder.remove(); target.removeAttribute('aria-busy');
      globalThis.WeftMotion?.reveal(target, 'base'); return true;
    };
  }
  function dialog({ title, content, actions = [], drawer = false } = {}) {
    const element = node('dialog', `wm-dialog${drawer ? ' wm-drawer' : ''}`), head = node('header', 'wm-dialog-head');
    element.setAttribute('aria-label', title); head.append(node('h2', '', title));
    const close = button('关闭', { variant: 'text', action: () => element.close() }); head.append(close);
    const body = node('div', 'wm-dialog-body'); if (content) body.append(content);
    element.append(head, body);
    if (actions.length) { const footer = node('footer', 'wm-dialog-footer'); footer.append(...actions); element.append(footer); }
    let previous;
    element.openPanel = () => { if (element.open) return; previous = document.activeElement; if (!element.isConnected) document.body.append(element); element.showModal(); };
    element.addEventListener('close', () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); });
    return element;
  }
  globalThis.WeftControls = { node, button, input, toggle, segmented, row, group, skeleton, loading, dialog,
    drawer: options => dialog({ ...options, drawer: true }),
    tag: text => node('span', 'wm-tag', text),
    select: source => globalThis.WeftPopover.bindSettingsSelect(source),
    menu: (...args) => globalThis.WeftPopover.menu(...args),
  };
})();
