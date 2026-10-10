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
    const width = menu.offsetWidth, naturalHeight = Math.max(menu.offsetHeight, menu.scrollHeight);
    if (side === 'right' || side === 'left') {
      const after = Math.max(0, right - anchor.right - 8), before = Math.max(0, anchor.left - left - 8);
      if (side === 'right' && width > after && before > after) side = 'left';
      if (side === 'left' && width > before && after > before) side = 'right';
      // On a narrow window, wrap the card in the available side space instead
      // of clamping a full-width card back over the row / pointer path.
      menu.style.maxWidth = `${side === 'right' ? after : before}px`;
      const sideWidth = menu.offsetWidth;
      menu.style.left = `${clamp(side === 'right' ? anchor.right + 8 : anchor.left - 8 - sideWidth, left, right - sideWidth)}px`;
      menu.style.top = `${clamp(anchor.top, top, bottom - menu.offsetHeight)}px`;
      menu.dataset.popoverSide = side;
    } else {
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
    }
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
    trigger.onkeydown = event => {
      if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); event.stopPropagation(); close(true); return; }
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); open(event.key === 'ArrowUp'); }
    };
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
  function openMenu(trigger, entries, { label = trigger.getAttribute('aria-label'), onClose, onSelect } = {}) {
    const menu = document.createElement('div'); menu.className = 'wm-menu';
    menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', label || '操作');
    let child, closed = false;
    const close = (focus = true) => {
      if (closed) return; closed = true; child?.close(false);
      active.get(menu)?.observer?.disconnect(); active.delete(menu);
      document.removeEventListener('pointerdown', outside); menu.remove();
      trigger.setAttribute('aria-expanded', 'false'); onClose?.();
      if (focus && trigger.isConnected) trigger.focus({preventScroll:true});
    };
    const outside = event => { if (!menu.contains(event.target) && !child?.menu.contains(event.target) && !trigger.contains(event.target)) close(false); };
    for (const entry of entries) {
      if (entry.separator) { const line = document.createElement('hr'); line.className='wm-menu-separator'; menu.append(line); continue; }
      const item = document.createElement('button'); item.type='button'; item.className='wm-menu-item'+(entry.danger?' danger':'');
      item.setAttribute('role', entry.checked === undefined ? 'menuitem' : 'menuitemradio');
      if (entry.checked !== undefined) item.setAttribute('aria-checked', String(entry.checked));
      item.disabled=!!entry.disabled; if (entry.mutationId) item.dataset.messageMutation=entry.mutationId;
      if (globalThis.WeftIcons) item.append(WeftIcons.create(entry.icon || 'right',16));
      const text=document.createElement('span');text.className='wm-menu-label';text.textContent=entry.name;item.append(text);
      if (entry.description) { item.title=entry.description; const note=document.createElement('small'); note.className='wm-menu-description'; note.textContent=entry.description; text.append(note); item.setAttribute('aria-label',entry.name); item.setAttribute('aria-description',entry.description); }
      if (entry.checked && globalThis.WeftIcons) item.append(WeftIcons.create('allow',16));
      if (entry.children) { item.setAttribute('aria-haspopup','menu'); item.setAttribute('aria-expanded','false'); item.append(WeftIcons.create('right',16)); }
      const activate = async () => {
        if (entry.children) {
          child?.close(false); const values=await entry.children(); if (closed || !item.isConnected) return;
          child=openMenu(item,values,{label:entry.name,onSelect:()=>{close();onSelect?.();}}); item.setAttribute('aria-expanded','true');
        } else { close(); onSelect?.(); await entry.action?.(item); }
      };
      item.addEventListener('click', () => void activate());
      item.addEventListener('keydown', event => {if (entry.children && event.key==='ArrowRight') {event.preventDefault();void activate();}});
      menu.append(item);
    }
    menu.addEventListener('keydown', event => {
      const items=[...menu.querySelectorAll(':scope > button:not(:disabled)')], index=items.indexOf(document.activeElement);
      if (['Escape','ArrowLeft','Tab'].includes(event.key)) {event.stopPropagation();if(event.key!=='Tab')event.preventDefault();close(event.key!=='Tab');}
      if (['ArrowUp','ArrowDown','Home','End'].includes(event.key)) {event.preventDefault();event.stopPropagation();items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}
    });
    (trigger.closest('dialog[open]') || document.body).append(menu);trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','true');position(menu,trigger,{side:'bottom',align:'end'});
    menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
    setTimeout(()=>{if(!closed)document.addEventListener('pointerdown',outside)},0);
    return {menu,close};
  }
  function autosize(field) {
    if (!field || !field.getClientRects().length) return;
    const style=getComputedStyle(field), line=parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.6;
    const padding=parseFloat(style.paddingTop)+parseFloat(style.paddingBottom);
    field.rows=1;field.style.height='auto';
    const maximum=line*8+padding;
    field.style.height=`${Math.min(maximum,Math.max(line+padding,field.scrollHeight))}px`;
    field.style.overflowY=field.scrollHeight>maximum?'auto':'hidden';
  }
  function modelGate({ missing, field, send, empty, content, composer, openSettings }) {
    let card=content.querySelector(':scope > .model-empty-card'), bar=composer.querySelector(':scope > .model-required-bar');
    function create(cls) {
      const box=document.createElement('section');box.className=cls;box.setAttribute('role','status');
      box.append(WeftIcons.create('model',cls==='model-empty-card'?32:20));
      const text=document.createElement('p');text.textContent='先添加一个模型，就能开始聊天';box.append(text);
      const action=document.createElement('button');action.type='button';action.className='model-setup-button';action.textContent='设置模型';action.onclick=openSettings;box.append(action);return box;
    }
    if (missing && !card) {card=create('model-empty-card');content.append(card);}
    if (missing && !bar) {bar=create('model-required-bar');composer.prepend(bar);}
    if (card) card.hidden=!missing||!empty;
    if (bar) bar.hidden=!missing||empty;
    if (missing) {field.disabled=true;field.placeholder='先添加一个模型';send.disabled=true;}
    content.classList.toggle('needs-model-empty',!!missing&&!!empty);
    autosize(field);
  }
  function memoryHealth(health, status, { text, count, onRetry, onSource }) {
    const issues=status?.formationIssues||[], corrections=issues.filter(issue=>issue.intent==='correction').length;
    const healthy=text==='记忆正常'&&!issues.length, recovering=status?.state==='recovering'&&!issues.length;
    const signature=JSON.stringify([status,text,count]);if(health.dataset.signature===signature)return;health.dataset.signature=signature;
    health.className='memory-health '+(healthy?'is-healthy':recovering?'is-progress':'is-warning');health.replaceChildren();
    const bar=document.createElement('div');bar.className='memory-issue-bar';
    bar.append(WeftIcons.create(healthy?'allow':recovering?'history':'warn',20));
    const label=document.createElement('span');label.textContent=issues.length?(corrections?`有 ${corrections} 条纠正没有生效`:`有 ${issues.length} 条记忆没有形成`):healthy?`记忆正常 · ${Number.isSafeInteger(count)?`已形成 ${count} 条`:'正在读取数量'} · 队列 0`:recovering?text:`${text} · 积压 ${(status?.pendingBoundaryCount||0)+(status?.pendingFormationCount||0)} 条`;bar.append(label);health.append(bar);
    if(healthy||recovering||!status)return;
    const panel=document.createElement('div');panel.className='memory-issue-cards';panel.hidden=true;
    const view=document.createElement('button');view.type='button';view.className='message-action';view.textContent='查看';view.setAttribute('aria-expanded','false');view.onclick=()=>{panel.hidden=!panel.hidden;view.textContent=panel.hidden?'查看':'收起';view.setAttribute('aria-expanded',String(!panel.hidden));};bar.append(view);
    if(!issues.length){const p=document.createElement('p');p.textContent='检查设置里的模型，恢复后会自动继续。已提交的回合继续整理。';panel.append(p);}
    for(const issue of issues){const card=document.createElement('article');card.className='memory-issue-card';
      const original=document.createElement('p');original.textContent=issue.text;card.append(original);
      const time=document.createElement('time');time.className='message-time';time.textContent=issue.updatedAt||issue.createdAt?new Date(issue.updatedAt||issue.createdAt).toLocaleString('zh-CN'):'时间未记录';card.append(time);
      const source=document.createElement('button');source.type='button';source.className='memory-source-link';source.append(WeftIcons.create('chat',16),document.createTextNode('来源对话'));source.disabled=!issue.sessionId;source.onclick=()=>onSource?.(issue.sessionId);card.append(source);
      const retry=document.createElement('button');retry.type='button';retry.className='model-setup-button';retry.textContent='重试';
      const requestId=crypto.randomUUID();retry.onclick=async()=>{retry.disabled=true;try{await onRetry(issue,requestId);retry.textContent='已提交';}catch{retry.disabled=false;retry.textContent='重试';const error=document.createElement('p');error.className='message-action-status';error.setAttribute('role','alert');error.textContent='重试未确认，请再次重试。';card.append(error);}};card.append(retry);panel.append(card);
    }
    health.append(panel);
  }
  let dismissMenu;
  function menu(trigger, entries, onError = () => {}) {
    dismissMenu?.(false);
    const popup=openMenu(trigger,entries.map(entry=>({...entry,action:async()=>{try{await entry.action()}catch(error){onError(error)}}})),{onClose:()=>{dismissMenu=null}});
    dismissMenu=popup.close;return popup.close;
  }
  globalThis.WeftPopover = { position, bindSelect, bindSettings, bindSettingsSelect, openMenu, autosize, modelGate, memoryHealth, menu, closeMenu:()=>dismissMenu?.() };

})();
