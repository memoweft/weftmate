/* Shared presentation for desktop, remote web and Android's interface bundle. */
(() => {
  const el = (tag, cls = '', text = '') => { const node = document.createElement(tag); node.className = cls; node.textContent = text; return node; };
  const button = (name, icon, action) => {
    const node = el('button', 'message-action'); node.type = 'button'; node.title = name; node.setAttribute('aria-label', name);
    if (globalThis.WeftIcons && icon) node.append(WeftIcons.create(icon, 16)); else node.textContent = name;
    node.addEventListener('click', action); return node;
  };
  function create({ core, draft, selectSession, copy, save, notice, events, sessionId, title, localEvents }) {
    const versions = new Map(), sources = new Map(), timeZones = new Map();
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
      openMenuClose?.(false);
      const protect = values => values.map(entry => ({...entry,
        ...(entry.action ? {action:item => guarded(() => entry.action(item))} : {}),
        ...(entry.children ? {children:async () => protect(await entry.children())} : {})}));
      const popup=WeftPopover.openMenu(trigger,protect(entries),{onClose:()=>{openMenuClose=null}});
      popup.menu.classList.add('message-action-menu'); openMenuClose=popup.close;
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
    function exportCanvas(markdown, theme) { return WeftContent.exportCanvas(markdown, theme); }
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
      let exportRevision = 0;
      const render = async () => {
        const revision = ++exportRevision; submit.disabled = true;
        markdown = core.messageExport(loaded, title?.() || 'WeftMate 对话', tools.checked); preview.replaceChildren(); canvas = null;
        try { if (format.value === 'markdown') preview.append(el('pre', '', markdown)); else { const result = await exportCanvas(markdown, format.value); if(revision!==exportRevision || !dialog.isConnected)return; canvas = result; preview.append(canvas); }
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
      row.tabIndex=0;row.setAttribute('role','group');if(!row.hasAttribute('aria-label'))row.setAttribute('aria-label',`${event.type==='user.message'?'我的消息':'助手消息'}：${Array.from(event.data.text).slice(0,80).join('')}`);
      const bar = el('div', 'message-actions'); bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', event.type === 'user.message' ? '自己的消息操作' : '回复操作');
      const copyMessage = async format => { const value = local ? event : await core.completeMessageEvent(id, event);
        return writeCopy(format === 'plain' ? WeftUiCore.messagePlainText(value.data.text) : value.data.text); };
      const copyButton = button(event.type === 'user.message' ? '复制消息' : '复制回复', 'copy', () => menu(copyButton, [
        { name: '复制 Markdown', icon:'copy', action: () => copyMessage('markdown') }, { name: '复制纯文本', icon:'copy', action: () => copyMessage('plain') }]));
      copyButton.setAttribute('aria-haspopup', 'menu'); copyButton.setAttribute('aria-expanded', 'false');
      copyButton.setAttribute('aria-label', event.type === 'user.message' ? '复制消息' : '复制回复'); bar.append(copyButton);
      if (event.type === 'user.message') {
        copyButton.replaceWith(button('复制消息','copy',()=>void guarded(()=>copyMessage('plain'))));
        const time=el('time','message-time'), recorded=new Date(event.at || event.time || event.createdAt || NaN);
        if (Number.isFinite(recorded.getTime())) time.dateTime=recorded.toISOString();
        else time.textContent='时间未记录';
        bar.prepend(time);
        const captured=identity();
        const stamp = zone => {
          if (identity() !== captured || !time.dateTime) return;
          const date=new Date(time.dateTime), today=new Date();
          const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
          time.textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:zone,hour:'numeric',minute:'2-digit',hourCycle:'h23',...(day(date)===day(today)?{}:{year:'numeric',month:'numeric',day:'numeric'})}).format(date);
        };
        stamp(Intl.DateTimeFormat().resolvedOptions().timeZone);
        if (!local) {
          if (!timeZones.has(captured)) timeZones.set(captured,core.accessApi('/settings/usage').then(value=>value.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone).catch(()=>Intl.DateTimeFormat().resolvedOptions().timeZone));
          void timeZones.get(captured).then(stamp);
        }
        const bubble=el('div','message-user-bubble');bubble.append(...row.childNodes);row.append(bubble);
        const quoteMessage=async()=>{const value=local?event:await core.completeMessageEvent(id,event);const field=draft();field.value=value.data.text.split('\n').map(line=>'> '+line).join('\n')+'\n\n'+field.value;field.dispatchEvent(new Event('input',{bubbles:true}));field.focus();};
        let timer, start, held=false;
        row.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'||e.target.closest('button,a'))return;start={x:e.clientX,y:e.clientY};held=false;timer=setTimeout(()=>{held=true;menu(bubble,[{name:'复制',icon:'copy',action:()=>copyMessage('plain')},{name:'引用',icon:'quote',action:quoteMessage}]);},500);});
        row.addEventListener('pointermove',e=>{if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>10)clearTimeout(timer);});
        for(const name of ['pointerup','pointercancel'])row.addEventListener(name,()=>clearTimeout(timer));
        row.addEventListener('click',e=>{if(matchMedia('(pointer:coarse)').matches&&!e.target.closest('button,a')){if(held){held=false;return;}row.classList.toggle('time-visible');}});
        row.addEventListener('contextmenu',e=>{if(!matchMedia('(pointer:coarse)').matches)return;e.preventDefault();menu(bubble,[{name:'复制',icon:'copy',action:()=>copyMessage('plain')},{name:'引用',icon:'quote',action:quoteMessage}]);});
      } else {
        const useful = button('有用', 'thumb-up', () => void guarded(async () => { await core.saveMessageFeedback(id, event.seq, 'helpful'); refresh(); notice('已保存本机反馈'); })); useful.dataset.feedback = `${id}:${event.seq}:helpful`;
        const bad = button('没用', 'thumb-down', () => feedback(id, event, bad)); bad.dataset.feedback = `${id}:${event.seq}:unhelpful`;
        const share = button('分享 / 导出对话', 'share', () => void guarded(() => exportConversation(id, share, local)));
        const more = button('更多回复操作', 'more', () => void guarded(async () => {
          const source = local ? null : await resolveSource(id, event);
          if (!more.isConnected) return;
          menu(more, [
          ...((more.closest('.message') || row).weftOpenSideChat ? [{name:'从这里开旁聊', icon:'compose', action:(more.closest('.message') || row).weftOpenSideChat}] : []),
          { icon:'sync', name: local ? '重新生成（需由电脑接续）' : source?.kind === 'main' ? '开旁聊重新生成' : '重新生成', disabled: local || core.messageBusy(id) || event.data.reminder, ...(!local && !event.data.reminder ? { mutationId: id } : {}), action: () => regenerate(id, event, null, more) },
          { icon:'model', name: '换模型重新生成', disabled: local || core.messageBusy(id) || event.data.reminder, ...(!local && !event.data.reminder ? { mutationId: id } : {}), children: async () => {
            const models = (await core.accessApi('/models')).models;
            return models.filter(model => model.configured !== false && model.available !== false).map(model => ({ name: model.name || model.id, icon:'model', checked:model.id===(core.state.sessions.find(row=>row.sessionId===id)?.modelProfileId||core.state.modelProfileId), action: () => regenerate(id, event, model.id, more) }));
          } }, ...(core.hasPendingMessageBranch?.() ? [{ name: '上次发送未确认，重试', icon:'sync', action: () => core.retryMessageBranch() }] : [])]);
        }));
        more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
        const quoteButton = button('引用选中文字', 'quote', () => quote(quoteButton.closest('.message'))); quoteButton.dataset.messageQuote = 'true'; quoteButton.hidden = true;
        quoteButton.addEventListener('mousedown', event => event.preventDefault()); bar.append(useful, bad, share, more, quoteButton);
      }
      row.dataset.memorySession=id;row.append(bar); if (!local) void versionBar(row, id, event); refresh();
    }
    function refresh() {
      if (lastIdentity && lastIdentity !== identity()) {
        document.querySelectorAll('.message-action-dialog').forEach(dialog => dialog.close());
        openMenuClose?.(false); timeZones.clear();
        document.querySelector('.composer-message-quote')?.remove(); sources.clear(); versions.clear(); selection = '';
      }
      lastIdentity = identity();
      for (const node of document.querySelectorAll('[data-message-mutation]')) node.disabled = !!core.messageBusy(node.dataset.messageMutation);
      const replies=[...document.querySelectorAll('#chat-content .message.assistant:not(.main-chat-row)')];for(const row of replies)row.classList.toggle('is-last-assistant',row===replies.at(-1));
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
