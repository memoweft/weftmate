/* Shared presentation for desktop, remote web and Android's interface bundle. */
(() => {
  const el = (tag, cls = '', text = '') => { const node = document.createElement(tag); node.className = cls; node.textContent = text; return node; };
  const button = (name, icon, action) => {
    const node = el('button', 'message-action'); node.type = 'button'; node.title = name; node.setAttribute('aria-label', name);
    if (globalThis.WeftIcons && icon) node.append(WeftIcons.create(icon, 16)); else node.textContent = name;
    node.addEventListener('click', action); return node;
  };
  function create({ core, draft, selectSession, copy, save, notice, events, sessionId, title, localEvents }) {
    const versions = new Map(), sources = new Map();
    let selection = '', selectionRow = null, lastIdentity, openMenuClose;
    const selectionChanged = () => {
      const value = window.getSelection(), row = value?.anchorNode?.parentElement?.closest('.message.assistant');
      selection = row && row.contains(value.focusNode) ? value.toString().trim() : ''; selectionRow = selection ? row : null;
      for (const node of document.querySelectorAll('[data-message-quote]')) node.hidden = node.closest('.message') !== selectionRow;
    };
    document.addEventListener('mouseup', selectionChanged); document.addEventListener('keyup', selectionChanged);
    async function guarded(action) {
      try { await action(); } catch (error) { notice(error.code ? core.sessionLifecycleMessage?.(error) : error.message || '操作未完成，请重试'); }
    }
    function modal(name, trigger) {
      const dialog = el('dialog', 'message-action-dialog'); dialog.setAttribute('aria-label', name);
      const heading = el('h2', '', name), close = button('关闭', null, () => dialog.close());
      close.classList.add('message-dialog-close'); dialog.append(heading, close); document.body.append(dialog);
      dialog.addEventListener('close', () => { dialog.remove(); (trigger?.isConnected ? trigger : draft())?.focus({ preventScroll: true }); }, { once: true });
      dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
      dialog.showModal(); return dialog;
    }
    function menu(trigger, entries) {
      const box = el('div', 'message-action-menu'); box.setAttribute('role', 'menu'); box.setAttribute('aria-label', trigger.title);
      const close = (focus = true) => { try { if (box.matches(':popover-open')) box.hidePopover(); } catch {} box.remove(); openMenuClose = null; trigger.setAttribute('aria-expanded', 'false'); if (focus) trigger.focus(); };
      openMenuClose = close;
      for (const entry of entries) {
        const item = el('button', '', entry.name); item.type = 'button'; item.setAttribute('role', 'menuitem'); item.disabled = !!entry.disabled;
        if (entry.mutationId) item.dataset.messageMutation = entry.mutationId;
        item.addEventListener('click', () => { close(false); void guarded(() => entry.action(item)); }); box.append(item);
      }
      const outside = event => { if (!box.contains(event.target) && event.target !== trigger) close(false); };
      box.addEventListener('keydown', event => {
        const items = [...box.querySelectorAll('button:not(:disabled)')], index = items.indexOf(document.activeElement);
        if (['ArrowDown','ArrowUp','Home','End','Escape','Tab'].includes(event.key)) {
          event.stopPropagation();
          if (event.key === 'Tab') { close(false); return; }
          event.preventDefault();
          if (event.key === 'Escape') { close(); return; }
          items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        }
      });
      document.body.append(box); trigger.setAttribute('aria-expanded', 'true'); trigger.setAttribute('aria-haspopup', 'menu');
      WeftPopover.position(box, trigger, { side: 'bottom' });
      box.querySelector('button:not(:disabled)')?.focus();
      setTimeout(() => { if (box.isConnected) document.addEventListener('pointerdown', outside); }, 0);
      const observer = new MutationObserver(() => { if (!box.isConnected) { document.removeEventListener('pointerdown', outside); observer.disconnect(); } });
      observer.observe(document.body, { childList: true });
    }
    const writeCopy = async text => {
      if (copy) await copy(text); else await navigator.clipboard.writeText(text);
      notice('已复制');
    };
    const identity = () => `${core.state.ownerId}:${core.state.identityGeneration}`;
    async function resolveSource(id, event) {
      const key = `${identity()}:${id}`;
      if (!sources.has(key)) sources.set(key, core.messageSource(id, event).catch(() => ({ kind: 'side', sessionId: id })));
      return sources.get(key);
    }
    async function edit(id, event, trigger) {
      const source = await resolveSource(id, event);
      const original = await core.readMessageInput(id, event.seq);
      const name = source.kind === 'main' ? '从这里开旁聊并重发' : '编辑并重发';
      const dialog = modal(name, trigger), field = el('textarea', 'message-edit-text');
      field.setAttribute('aria-label', '修改消息'); field.value = original.data.text;
      dialog.append(el('p', 'muted', source.kind === 'main' ? '主对话原文保留。修改后的消息在新旁聊发送，带入此处的来源引用。' : '修改后的消息会从这里创建新版本。原版本和后续消息保留，可左右切换。'), field);
      const status = el('p', 'message-action-status'); status.setAttribute('role', 'status');
      const cancel = button('取消', null, () => dialog.close()), submit = button(name, null, () => {});
      submit.classList.add('message-action-primary');
      const requestId = crypto.randomUUID();
      submit.addEventListener('click', () => void guarded(async () => {
        if (!field.value.trim()) { status.textContent = '请输入消息'; field.focus(); return; }
        submit.disabled = true; status.textContent = '正在创建并发送…';
        try { await core.branchMessage(id, event, 'edit', field.value, undefined, requestId); versions.clear(); dialog.close(); }
        catch (error) { retry.hidden = false; status.textContent = error.code === 'NETWORK' ? '送达待核对。可点「核对并重试发送」使用原请求继续。' : error.code ? core.sessionLifecycleMessage(error) : error.message; throw error; }
        finally { submit.disabled = false; }
      }));
      const retry = button('核对并重试发送', null, () => void guarded(async () => { await core.retryMessageBranch(); versions.clear(); dialog.close(); }));
      retry.hidden = true;
      const actions = el('div', 'message-dialog-actions'); actions.append(cancel, retry, submit); dialog.append(status, actions); field.focus();
    }
    async function regenerate(id, event, model, trigger) {
      await core.branchMessage(id, event, 'regenerate', null, model, crypto.randomUUID()); versions.clear();
      notice('已创建新版本并重新生成');
    }
    function feedback(id, event, trigger) {
      const dialog = modal('这条回复哪里需要改进？', trigger);
      dialog.append(el('p', 'muted', '原因和备注仅保存在这台设备，不会上传。'));
      const reasons = el('fieldset', 'message-feedback-reasons'); reasons.append(el('legend', '', '原因（可选）'));
      for (const value of ['不准确', '没有遵循要求', '不够有帮助', '格式或表达问题', '其他']) {
        const label = el('label'), input = el('input'); input.type = 'radio'; input.name = 'message-feedback-reason'; input.value = value;
        label.append(input, document.createTextNode(value)); reasons.append(label);
      }
      const note = el('textarea', 'message-edit-text'); note.setAttribute('aria-label', '备注（可选）'); note.maxLength = 500; note.placeholder = '补充一句你的期望';
      const submit = button('保存本机反馈', null, () => void guarded(async () => {
        await core.saveMessageFeedback(id, event.seq, 'unhelpful', reasons.querySelector('input:checked')?.value || '', note.value);
        dialog.close(); refresh(); notice('已保存本机反馈');
      })); submit.classList.add('message-action-primary'); dialog.append(reasons, note, submit);
    }
    function quote(row) {
      if (!selection || selectionRow !== row) { notice('先选中一段回复文字'); return; }
      const field = draft(); field.value = `${selection.split('\n').map(line => '> ' + line).join('\n')}\n\n${field.value}`;
      field.dispatchEvent(new Event('input', { bubbles: true })); field.focus();
      let block = document.querySelector('.composer-message-quote');
      if (!block) { block = el('blockquote', 'composer-message-quote'); block.setAttribute('aria-label', '已引用回复'); field.parentElement.prepend(block); }
      block.textContent = selection; window.getSelection()?.removeAllRanges(); selectionChanged();
    }
    async function download(blob, name) {
      if (save) { try { return await save(blob, name); } catch { throw new Error('文件未保存，请重新登录或重试。'); } }
      const link = el('a'); const url = URL.createObjectURL(blob); link.href = url; link.download = name;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function exportCanvas(markdown, theme) {
      const styles = getComputedStyle(document.documentElement), canvas = el('canvas');
      const font = styles.getPropertyValue('--wm-font-family-body').trim() || 'sans-serif';
      const size = parseInt(styles.getPropertyValue('--wm-font-size-16')) || 16;
      const padding = parseInt(styles.getPropertyValue('--wm-space-32')) || 32;
      canvas.width = 780; const ctx = canvas.getContext('2d'); ctx.font = `${size}px ${font}`;
      const lines = [];
      for (const paragraph of WeftUiCore.messagePlainText(markdown).split('\n')) {
        let line = ''; for (const char of paragraph) { if (ctx.measureText(line + char).width > canvas.width - padding * 2) { lines.push(line); line = ''; } line += char; }
        lines.push(line);
      }
      const height = Math.ceil(size * 1.8), max = 30000;
      if (lines.length * height + padding * 2 > max) throw new Error('这段对话超过单张长图尺寸，请导出完整文字文件');
      canvas.height = lines.length * height + padding * 2;
      const light = theme === 'light', color = name => styles.getPropertyValue(name).trim();
      ctx.fillStyle = color(light ? '--wm-color-white' : '--wm-color-code-canvas'); ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = color(light ? '--wm-color-fallback-ink' : '--wm-color-code-ink'); ctx.font = `${size}px ${font}`;
      lines.forEach((line, index) => ctx.fillText(line, padding, padding + size + index * height));
      canvas.setAttribute('aria-label', `${light ? '浅色' : '深色'}长图预览`); return canvas;
    }
    async function exportConversation(id, trigger, local = false) {
      const captured = identity(), dialog = modal('分享 / 导出对话', trigger);
      const status = el('p', 'message-action-status', '正在读取完整对话…'); status.setAttribute('role', 'status'); dialog.append(status);
      const loaded = local ? await localEvents(id) : await core.conversationExportEvents(id);
      if (!dialog.isConnected || identity() !== captured) { dialog.close(); return; }
      const options = el('div', 'message-export-options'), format = el('select'); format.setAttribute('aria-label', '导出格式');
      for (const [value, text] of [['markdown','Markdown 文件'],['light','PNG 长图 · 浅色'],['dark','PNG 长图 · 深色']]) { const option = el('option', '', text); option.value = value; format.append(option); }
      const tools = el('input'); tools.type = 'checkbox'; const label = el('label'); label.append(tools, document.createTextNode('包含工具步骤'));
      const preview = el('div', 'message-export-preview'); preview.setAttribute('role', 'region'); preview.setAttribute('aria-label', '导出预览');
      const submit = button('导出文件', null, () => {}); let markdown, canvas;
      submit.classList.add('message-action-primary');
      const render = () => {
        markdown = core.messageExport(loaded, title?.() || 'WeftMate 对话', tools.checked); preview.replaceChildren(); canvas = null;
        try { if (format.value === 'markdown') preview.append(el('pre', '', markdown)); else { canvas = exportCanvas(markdown, format.value); preview.append(canvas); }
          submit.disabled = false; status.textContent = '已隐藏凭据与本机路径。请核对预览；附件只列名称，不嵌入原件。';
        } catch (error) { submit.disabled = true; status.textContent = error.message; }
      };
      format.addEventListener('change', render); tools.addEventListener('change', render);
      submit.addEventListener('click', () => void guarded(async () => {
        if (identity() !== captured) { dialog.close(); return; }
        const blob = canvas ? await new Promise(resolve => canvas.toBlob(resolve, 'image/png')) : new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
        if (!blob) throw new Error('长图无法生成，请选择文字文件');
        if (identity() !== captured) { dialog.close(); return; }
        const result = await download(blob, `WeftMate-对话.${canvas ? 'png' : 'md'}`);
        status.textContent = result?.canceled ? '已取消导出' : result?.exported ? '导出文件已保存' : result?.pending ? '请在系统窗口选择保存位置' : '导出文件已准备';
      }));
      options.append(format, label); dialog.append(options, preview, submit); render(); WeftPopover.bindSettingsSelect?.(format);
    }
    async function versionBar(row, id, event) {
      const key = `${identity()}:${id}`;
      if (!versions.has(key)) versions.set(key, core.accessApi(`/sessions/${encodeURIComponent(id)}/message-branches`).catch(() => ({ groups: [] })));
      const payload = await versions.get(key); if (!row.isConnected || row.querySelector('.message-versions') || !Array.isArray(payload.groups)) return;
      for (const group of payload.groups) {
        const version = group.versions.find(item => item.sessionId === id);
        const role = group.action === 'edit' ? 'user.message' : 'assistant.message';
        if (event.type !== role || (version.anchorSeq !== undefined ? event.seq !== version.anchorSeq :
            [...events()].filter(item => item.type === role && item.seq > version.afterSeq).sort((a,b) => a.seq-b.seq)[0]?.seq !== event.seq)) continue;
        const current = group.versions.indexOf(version), bar = el('div', 'message-versions'); bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', group.action === 'edit' ? '消息版本' : '回复版本');
        const previous = button('上一版', 'back', () => void guarded(() => selectSession(group.versions[current - 1].sessionId)));
        const next = button('下一版', 'right', () => void guarded(() => selectSession(group.versions[current + 1].sessionId)));
        previous.disabled = current === 0; next.disabled = current === group.versions.length - 1;
        bar.append(previous, el('span', '', `第 ${current + 1} / ${group.versions.length} 版`), next); row.append(bar);
      }
    }
    function bind(row, event, id = event.sourceRef?.sessionId || sessionId(), { local = false } = {}) {
      if (event.sourceRef?.kind === 'native') event = { ...event, seq: event.sourceRef.seq };
      if (!id || !['user.message', 'assistant.message'].includes(event.type) || !event.data?.text || row.querySelector('.message-actions')) return;
      const bar = el('div', 'message-actions'); bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', event.type === 'user.message' ? '自己的消息操作' : '回复操作');
      const copyMessage = async format => { const value = local ? event : await core.completeMessageEvent(id, event);
        return writeCopy(format === 'plain' ? WeftUiCore.messagePlainText(value.data.text) : value.data.text); };
      const copyButton = button(event.type === 'user.message' ? '复制消息' : '复制回复', 'copy', () => menu(copyButton, [
        { name: '复制 Markdown', action: () => copyMessage('markdown') }, { name: '复制纯文本', action: () => copyMessage('plain') }]));
      copyButton.setAttribute('aria-haspopup', 'menu'); copyButton.setAttribute('aria-expanded', 'false');
      copyButton.setAttribute('aria-label', event.type === 'user.message' ? '复制消息' : '复制回复'); bar.append(copyButton);
      if (event.type === 'user.message') {
        const editButton = button(local ? '编辑并重发（需由电脑接续）' : '编辑并重发', 'edit', () => void guarded(() => edit(id, event, editButton)));
        if (local) editButton.disabled = true; else editButton.dataset.messageMutation = id; bar.append(editButton);
        if (!local) void resolveSource(id, event).then(source => { if (source.kind === 'main') { editButton.setAttribute('aria-label', '从这里开旁聊并重发'); editButton.title = '从这里开旁聊并重发'; } });
      } else {
        const useful = button('有用', 'thumb-up', () => void guarded(async () => { await core.saveMessageFeedback(id, event.seq, 'helpful'); refresh(); notice('已保存本机反馈'); })); useful.dataset.feedback = `${id}:${event.seq}:helpful`;
        const bad = button('没用', 'thumb-down', () => feedback(id, event, bad)); bad.dataset.feedback = `${id}:${event.seq}:unhelpful`;
        const share = button('分享 / 导出对话', 'share', () => void guarded(() => exportConversation(id, share, local)));
        const more = button('更多回复操作', 'more', () => void guarded(async () => {
          const source = local ? null : await resolveSource(id, event);
          if (!more.isConnected) return;
          menu(more, [
          { name: local ? '重新生成（需由电脑接续）' : source?.kind === 'main' ? '开旁聊重新生成' : '重新生成', disabled: local || core.messageBusy(id) || event.data.reminder, ...(!local && !event.data.reminder ? { mutationId: id } : {}), action: () => regenerate(id, event, null, more) },
          { name: '换模型重新生成', disabled: local || core.messageBusy(id) || event.data.reminder, ...(!local && !event.data.reminder ? { mutationId: id } : {}), action: async () => {
            const models = (await core.accessApi('/models')).models;
            menu(more, models.filter(model => model.configured !== false && model.available !== false).map(model => ({ name: model.name || model.id, action: () => regenerate(id, event, model.id, more) })));
          } }, { name: '核对并重试发送', action: () => core.retryMessageBranch() }]);
        }));
        more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
        const quoteButton = button('引用选中文字', 'quote', () => quote(quoteButton.closest('.message'))); quoteButton.dataset.messageQuote = 'true'; quoteButton.hidden = true;
        quoteButton.addEventListener('mousedown', event => event.preventDefault()); bar.append(useful, bad, share, more, quoteButton);
      }
      row.append(bar); if (!local) void versionBar(row, id, event); refresh();
    }
    function refresh() {
      if (lastIdentity && lastIdentity !== identity()) {
        document.querySelectorAll('.message-action-dialog').forEach(dialog => dialog.close());
        document.querySelectorAll('.message-action-menu').forEach(menu => menu.remove());
        document.querySelector('.composer-message-quote')?.remove(); sources.clear(); versions.clear(); selection = '';
      }
      lastIdentity = identity();
      for (const node of document.querySelectorAll('[data-message-mutation]')) node.disabled = !!core.messageBusy(node.dataset.messageMutation);
      const records = core.readMessageFeedback();
      for (const node of document.querySelectorAll('[data-feedback]')) node.setAttribute('aria-pressed', String(records.some(row => `${row.sessionId ?? row.conversationId}:${row.seq ?? row.messageId}:${row.rating}` === node.dataset.feedback)));
      if (!draft()?.value.startsWith('> ')) document.querySelector('.composer-message-quote')?.remove();
    }
    function dismiss() {
      const dialog = [...document.querySelectorAll('.message-action-dialog[open]')].at(-1);
      if (dialog) { dialog.close(); return true; }
      if (openMenuClose) { openMenuClose(); return true; }
      return false;
    }
    return { bind, refresh, exportConversation, dismiss, clearVersions: () => versions.clear() };
  }
  globalThis.WeftMessageActions = { create };
})();
