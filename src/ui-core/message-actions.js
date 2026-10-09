/* Shared message actions. Native DSH remains the only conversation executor. */
(() => {
  const plain = text => {
    const code = [], keep = value => `\u0000weft-code-${code.push(value) - 1}\u0000`;
    return String(text ?? '').replace(/(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\1/g, (_match, _fence, content) => keep(content))
      .replace(/`([^`\n]+)`/g, (_match, content) => keep(content))
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?)/gm, '').replace(/(\*\*|__|~~)([\s\S]+?)\1/g, '$2')
      .replace(/(^|\s)(\*|_)([^*_\n]+)\2(?=\s|$)/g, '$1$3')
      .replace(/\u0000weft-code-(\d+)\u0000/g, (_match, index) => code[Number(index)]);
  };
  const redact = text => String(text ?? '')
    .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|password|secret|密钥|密码)\s*["']?\s*[:=：]\s*)["'][^"'\n]*["']/gi, '$1[凭据已隐藏]')
    .replace(/-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?-----END [^-]+-----/g, '[凭据已隐藏]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi, '[凭据已隐藏]')
    .replace(/\b(?:sk|key|api)[-_][A-Za-z0-9_-]{12,}\b/g, '[密钥已隐藏]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[凭据已隐藏]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|password|secret|密钥|密码)\s*["']?\s*[:=：]\s*["']?)[^\s,"'&}\]\[]+/gi, '$1[凭据已隐藏]')
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, 'https://[凭据已隐藏]@')
    .replace(/(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\)[^\n<>"'`|]+/g, '[本机路径已隐藏]')
    .replace(/(^|[\s(`"'=])(?:~\/|\/(?:[A-Za-z0-9_.-]+\/)+)[^\s)`"'<>]+/gm, '$1[本机路径已隐藏]');
  globalThis.WeftUiCore.messagePlainText = plain;
  globalThis.WeftUiCore.redactExport = redact;
  globalThis.WeftUiCore.factories.messageActions = (core, effects, environment) => {
    const scope = sessionId => ({ owner: core.state.ownerId, identity: core.state.identityGeneration, sessionId });
    const current = value => value.owner === core.state.ownerId && value.identity === core.state.identityGeneration;
    const storageKey = kind => `weftmate-${kind}:${core.state.ownerId}`;
    const feedbackCache = new Map();
    const feedbackScope = () => `${core.state.ownerId}:${core.state.identityGeneration}`;
    const parseFeedback = value => { try { const rows = JSON.parse(value || '[]'); return Array.isArray(rows) ? rows : []; } catch { return []; } };
    function loadMessageFeedback() {
      if (!core.state.ownerId) return Promise.resolve([]);
      const key = feedbackScope();
      if (feedbackCache.has(key)) return feedbackCache.get(key).promise;
      const captured = scope(null), record = { rows: parseFeedback(environment.storage.getItem(storageKey('message-feedback'))) };
      feedbackCache.set(key, record);
      record.promise = (async () => {
        if (environment.feedbackStorage) try {
          const saved = await environment.feedbackStorage(`weftmate:message-feedback:${captured.owner}`);
          if (saved !== undefined) record.rows = parseFeedback(saved);
        } catch { /* A failed read is retried by a future login; saving still requires a durable native receipt. */ }
        if (current(captured)) effects.updateAvailability?.();
        return record.rows;
      })();
      return record.promise;
    }
    function readFeedback() {
      if (environment.feedbackStorage) { void loadMessageFeedback(); return feedbackCache.get(feedbackScope())?.rows || []; }
      try { return parseFeedback(environment.storage.getItem(storageKey('message-feedback'))); } catch { return []; }
    }
    async function saveMessageFeedback(sessionId, seq, rating, reason = '', note = '') {
      if (!core.state.ownerId) throw new Error('请先登录');
      const captured = scope(null);
      const prior = environment.feedbackStorage ? await loadMessageFeedback() : readFeedback();
      if (!current(captured)) throw new Error('账户已切换');
      const rows = prior.filter(row => (row.sessionId ?? row.conversationId) !== sessionId || (row.seq ?? row.messageId) !== seq);
      rows.push({ version: 1, ...(typeof seq === 'number' ? { sessionId, seq } : { source: 'phone', conversationId: sessionId, messageId: seq }),
        rating, reason, note: String(note).slice(0, 500), at: new Date().toISOString() });
      const encoded = JSON.stringify(rows);
      if (environment.feedbackStorage) await environment.feedbackStorage(`weftmate:message-feedback:${captured.owner}`, encoded);
      if (!current(captured)) throw new Error('账户已切换');
      if (feedbackCache.has(feedbackScope())) feedbackCache.get(feedbackScope()).rows = rows;
      environment.storage.setItem(storageKey('message-feedback'), encoded);
      return rows.at(-1);
    }
    async function allMessageEvents(sessionId) {
      const captured = scope(sessionId), events = []; let afterSeq = -1;
      do {
        const page = await core.accessApi(`/sessions/${encodeURIComponent(sessionId)}/events?afterSeq=${afterSeq}&limit=200`);
        if (!current(captured)) throw new Error('账户已切换');
        events.push(...page.events);
        if (!page.hasMore) return completeMessageEvents(sessionId, events, captured);
        if (page.nextSeq <= afterSeq) throw new Error('历史未完整读取，请重试');
        afterSeq = page.nextSeq;
      } while (true);
    }
    async function messageSource(sessionId, event) {
      const chat = await core.accessApi(`/sessions/${encodeURIComponent(sessionId)}/chat`);
      return { ...chat, sessionId, seq: event.sourceRef?.seq ?? event.seq };
    }
    async function completeMessageEvent(sessionId, event) {
      if (!event.data?.truncated || !['user.message', 'assistant.message'].includes(event.type)) return event;
      const captured = scope(sessionId), sourceId = event.sourceRef?.sessionId || sessionId, seq = event.sourceRef?.seq ?? event.seq;
      const detail = await core.readTimelineDetail(sourceId, seq);
      if (!current(captured)) throw new Error('账户已切换');
      if (detail.type !== event.type || typeof detail.text !== 'string' || detail.truncated) throw new Error('全文暂时无法读取，请更新电脑程序或稍后重试');
      return { ...event, data: { ...event.data, text: detail.text, truncated: false } };
    }
    async function completeMessageEvents(sessionId, events, captured) {
      const result = [];
      for (const event of events) {
        result.push(await completeMessageEvent(sessionId, event));
        if (!current(captured)) throw new Error('账户已切换');
      }
      return result;
    }
    async function readMessageInput(sessionId, seq) {
      const page = await core.accessApi(`/sessions/${encodeURIComponent(sessionId)}/events?afterSeq=${seq - 1}&limit=1`);
      const input = page.events.find(event => event.seq === seq && event.type === 'user.message');
      if (!input) throw new Error('原消息已不可读取，请刷新对话');
      return completeMessageEvent(sessionId, input);
    }
    function messageBusy(sessionId) {
      const session = core.state.sessions.find(row => row.sessionId === sessionId);
      return core.inMainChat?.() && core.state.mainChat?.running || core.conversationRunning?.(sessionId) || core.state.sessions.find(row => row.sessionId === sessionId)?.running ||
        session?.archived || session?.unavailable || core.state.submitting || core.state.unresolvedSubmission || !core.state.online;
    }
    async function waitMessageCommand(command) {
      while (command && ['pending', 'dispatching', 'preflight'].includes(command.state)) {
        await new Promise(resolve => setTimeout(resolve, 200));
        command = (await core.readCommand(command.commandId)).command;
      }
      if (command?.state !== 'accepted_by_dsh') throw new Error('发送尚未确认，请核对后重试');
      return command;
    }
    async function branchMessage(sessionId, event, action, text, modelProfileId, requestId) {
      const captured = scope(sessionId);
      if (messageBusy(sessionId)) throw new Error('回复进行中、对话只读或连接不可用，暂时不能编辑或重新生成');
      core.state.submitting = true; effects.updateAvailability?.();
      try {
        if (!core.state.hostId) core.state.hostId = (await core.accessApi('/status')).hostId;
        const source = await messageSource(sessionId, event);
        if (!current(captured)) return;
        let branch;
        if (source.kind === 'main') {
          let originEvent = event.eventId;
          if (!originEvent) {
            const bytes = new TextEncoder().encode(`${core.state.hostId}/${sessionId}/${source.seq}`);
            originEvent = 'event-' + Array.from(new Uint8Array(await environment.crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
          }
          let page = await core.readChatEvents(source.chatId, { around: originEvent, limit: 200 });
          const anchor = page.items.findIndex(row => row.eventId === originEvent);
          let user = page.items.slice(0, anchor + 1).findLast(row => row.type === 'user.message');
          while (!user && page.hasOlder) {
            page = await core.readChatEvents(source.chatId, { before: page.olderCursor, limit: 200 });
            if (!current(captured)) return;
            user = page.items.findLast(row => row.type === 'user.message');
          }
          if (!user) throw new Error('这条回复没有可重发的用户消息');
          const main = (await core.readMainChat()).chat;
          const chat = (await core.readChat(source.chatId)).chat;
          if (chat.running) throw new Error('主对话正在回复，结束后可开旁聊并重发');
          const input = await readMessageInput(user.sourceRef.sessionId, user.sourceRef.seq);
          if (!current(captured)) return;
          const created = await core.createSideChat({ requestId, targetDeviceId: core.state.hostId,
            parent: { kind: 'main', id: main.chatId }, modelProfileId: modelProfileId || chat.modelProfileId,
            originChatId: source.chatId, originEventId: originEvent, entry: 'message', title: '重新讨论' });
          const accepted = await waitMessageCommand(created.command);
          branch = { sessionId: accepted.sessionId, sendRequestId: requestId + '.send', text: input.data.text };
        } else branch = await core.accessApi(`/sessions/${encodeURIComponent(sessionId)}/message-branches`, {
          method: 'POST', protectedWrite: true, body: { requestId, seq: source.seq, action,
            ...(modelProfileId ? { modelProfileId } : {}) }, timeoutMs: 120000 });
        if (!current(captured)) return;
        const payload = { requestId: branch.sendRequestId, kind: 'session.message', targetDeviceId: core.state.hostId,
          sessionId: branch.sessionId, text: action === 'edit' ? text : branch.text, mode: 'queue',
          ...(branch.attachments ? { attachments: branch.attachments } : {}),
          ...(branch.originalAttachments ? { originalAttachments: branch.originalAttachments,
            attachmentMessageId: branch.attachmentMessageId } : {}) };
        // Persist the original delivery ID/body before sending; a network retry
        // queries and replays this receipt instead of creating another branch.
        environment.storage.setItem(storageKey('message-action-pending'), JSON.stringify(payload));
        await deliverMessageBranch(payload, captured);
        return branch;
      } finally {
        if (current(captured)) { core.state.submitting = false; effects.updateAvailability?.(); }
      }
    }
    async function deliverMessageBranch(payload, captured = scope(payload.sessionId)) {
      let command;
      try { command = (await core.accessApi(`/commands/by-request/${encodeURIComponent(payload.requestId)}`)).command; }
      catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
      if (!current(captured)) return;
      if (!command) command = (await core.accessApi('/commands', { method: 'POST', protectedWrite: true, body: payload })).command;
      await waitMessageCommand(command);
      if (!current(captured)) return;
      environment.storage.removeItem(storageKey('message-action-pending'));
      if (environment.mobileState) { await effects.listSharedSessions(); await effects.selectSharedSession(payload.sessionId); }
      else { await core.refreshSessions(); await core.selectSession(payload.sessionId); }
    }
    async function retryMessageBranch() {
      const pending = JSON.parse(environment.storage.getItem(storageKey('message-action-pending')) || 'null');
      if (pending) return deliverMessageBranch(pending);
    }
    async function conversationExportEvents(sessionId) {
      const captured = scope(sessionId), source = await core.accessApi(`/sessions/${encodeURIComponent(sessionId)}/chat`);
      if (source.kind !== 'main') return allMessageEvents(sessionId);
      let page = await core.readChatEvents(source.chatId, { limit: 200 }), items = [...page.items];
      while (page.hasOlder) {
        page = await core.readChatEvents(source.chatId, { before: page.olderCursor, limit: 200 });
        if (!current(captured)) throw new Error('账户已切换');
        items.unshift(...page.items);
      }
      return completeMessageEvents(sessionId, [...new Map(items.map(item => [item.eventId, item])).values()], captured);
    }
    function messageExport(events, title, includeTools = false) {
      const parts = [`# ${redact(title || 'WeftMate 对话')}`, '导出自 WeftMate · 已隐藏凭据与本机路径'];
      for (const event of events) {
        if (['user.message', 'assistant.message'].includes(event.type)) {
          parts.push(`## ${event.type === 'user.message' ? '你' : 'WeftMate'}`, redact(event.data?.text || '（附件消息）'));
          const names = event.data?.originalAttachments?.map(item => redact(item.name));
          if (names?.length) parts.push(`附件：${names.join('、')}`);
        } else if (includeTools && ['step.started', 'step.completed', 'artifact.created', 'approval.resolved', 'question.answered'].includes(event.type)) {
          const data = event.data || {};
          parts.push(`> ${redact(core.interfaceText?.(data.summary || data.fileName || core.toolLabel?.(data.toolName) || '执行步骤') || '执行步骤')}`);
        }
      }
      return parts.join('\n\n') + '\n';
    }
    return { readMessageFeedback: readFeedback, loadMessageFeedback, saveMessageFeedback, allMessageEvents, messageSource, readMessageInput, completeMessageEvent,
      messageBusy, branchMessage, retryMessageBranch, messageExport, conversationExportEvents };
  };
})();
