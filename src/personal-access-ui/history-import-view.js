/* Desktop imports and read-only phone records share this view. */
globalThis.WeftImportSourceText = source => {
    let text = source.rawContent ?? '';
    if (!source.importSource) return text;
    text = text.replace(/^\[WeftMate 历史导入[^\n]*\]\n[^\n]*\n/, '');
    return text.replace(/\[(\d{4}-\d{2}-\d{2}T[^\s]+) · (用户|助手)\]/g, (all, stamp, speaker) => {
        if (!Number.isFinite(Date.parse(stamp))) return all;
        return `[${new Intl.DateTimeFormat('zh-CN', {year:'numeric',month:'long',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(stamp))} · ${speaker}]`;
    });
};
globalThis.WeftHistoryImportView = ({ target, request, owner, desktop = null, refreshMemory = () => { } }) => {
    const node = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text !== undefined)
        n.textContent = text; return n; };
    const button = (text, fn, cls = 'button secondary small') => { const b = node('button', cls, text); b.type = 'button'; b.onclick = () => void fn(b); return b; };
    const identity = owner(), current = () => target.isConnected && section.isConnected && owner() === identity, date = v => v ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(v)) : '日期不明';
    const section = node('section', 'history-import'), status = node('p', 'muted', '正在读取导入记录…'), list = node('div');
    let dialog, timer, renderedJobs;
    status.setAttribute('role', 'status');
    const loading = node('div', 'history-import-skeleton'); loading.setAttribute('aria-hidden', 'true'); list.append(loading);
    section.append(node('h2', '', '导入聊天记录'));
    const states = { receiving:'正在接收', awaiting_confirmation:'等你确认', running: '正在读', paused: '已暂停', cancelled: '已取消', completed: '已读完', forgetting: '正在忘掉', forgotten: '已忘掉' };
    const error = e => ({ IMPORT_SOURCE_UNAVAILABLE: '原文件无法读取，请放回原文件后继续，或重新选择。', IMPORT_SOURCE_CHANGED: '原文件已经改变，请重新选择并查看预览。', USAGE_LIMIT_REACHED: '已达到你设置的用量上限，请在设置 → 用量调整后再开始。', IMPORT_FORMAT_UNKNOWN: '这个文件的格式认不出，请使用官方导出或受支持的会话记录。', IMPORT_JOB_ACTIVE: '已有一次导入正在进行，请先完成或取消它。', IMPORT_MODEL_CHANGED: '后台模型已改变，请重新选择文件查看用量后开始。', IMPORT_PAUSE_REQUIRED: '请先暂停导入，再查看将忘掉的内容。', MEMORY_PREVIEW_REQUIRED: '请重新查看预览，再确认开始。' })[e.code ?? String(e.message).match(/\b(?:IMPORT_|MEMORY_|USAGE_)[A-Z_]+\b/)?.[0] ?? e.message] ?? '暂时无法读取，请重试。';
    async function run(body) { const v = await request('/memory/backfill', { method: 'POST', protectedWrite: true, body: { ...body, action: `import-${body.action}` } }); return current() ? v : null; }
    function modal(title, build) { dialog?.close(); const d = node('dialog', 'model-editor-dialog history-import-dialog'); dialog = d; d.setAttribute('aria-label', title); const head = node('header', 'dialog-head'), body = node('div', 'model-editor-body'), footer = node('footer', 'dialog-footer'); head.append(node('h2', '', title), button('关闭', () => d.close())); d.append(head, body, footer); (target.closest('dialog[open]') || document.body).append(d); build(body, footer, d); d.addEventListener('close', () => { d.remove(); if (dialog === d)
        dialog = null; }); d.showModal(); }
    async function act(job, action, b) { if (b)
        b.disabled = true; try {
        await run({ action, jobId: job.id });
        await refresh();
        refreshMemory();
    }
    catch (e) {
        if (current())
            status.textContent = error(e);
    }
    finally {
        if (b)
            b.disabled = false;
    } }
    async function forget(job) { try {
        const p = await run({ action: 'forget-preview', jobId: job.id });
        if (!p)
            return;
        modal('忘掉这次导入', (body, footer, d) => { body.append(node('p', '', `将忘掉这次 ${job.appName} 导入记住的内容，以及下面这些相关记忆。${job.app==='phone'?'手机上的原对话仍保留。':'原文件仍保留在你的电脑上。'}`)); const entries = node('ul', 'memory-sources'); for (const i of p.items)
            entries.append(node('li', '', i.text)); body.append(entries, node('p', 'muted', '忘掉后，可以再次选择同一文件重新导入。')); const message = node('p', 'error'); message.setAttribute('role', 'status'); body.append(message); footer.append(button('保留', () => d.close()), button('确认忘掉', async (b) => { b.disabled = true; try {
            await run({ action: 'forget', jobId: job.id, confirm: true, forgetToken: p.forgetToken });
            d.close();
            await refresh();
            refreshMemory();
        }
        catch (e) {
            message.textContent = error(e);
            b.disabled = false;
        } }, 'button danger')); });
    }
    catch (e) {
        status.textContent = error(e);
    } }
    function paint(jobs) { list.replaceChildren(); status.textContent = jobs.length ? '' : desktop ? '还没有导入过聊天记录。选择一份导出，先看看要读哪些内容。' : '还没有导入记录。在电脑的 WeftMate 设置 → 记忆里导入。'; for (const job of jobs) {
        const description = `${states[job.state]} · ${job.processed} / ${job.total} ${job.app==='phone'?'轮':'段'} · 已记住 ${job.memoryCount} 件事`, usage = `${job.usage.requests} 次请求 · ${WeftHumanFormat.formatTextUsage(job.usage.inputTokens + job.usage.outputTokens)} · ${job.usage.cost === null ? '费用未知' : WeftHumanFormat.formatMoney(job.usage.cost)}${job.usage.unknownRequests ? '（部分用量未知）' : ''}${job.waitingForChat ? ' · 等你聊完再继续' : ''}`, row = node('div', 'history-import-row'), main = button(`${job.appName} · ${date(job.createdAt)}`, () => modal('导入记录', (body, footer, d) => { body.append(node('p', '', `${job.appName} · ${description}`), node('p', 'muted', usage)); if (job.error)
            body.append(node('p', 'error', job.error)); footer.append(button('关闭', () => d.close())); }), 'history-import-main');
        main.append(node('span', 'muted', description), node('span', 'muted', usage));
        row.append(main);
        if(job.app==='phone')main.append(node('span','muted',`${job.deviceName||'手机'} · ${job.conversationCount} 段 · ${date(job.from)} 至 ${date(job.to)}`));
        if(desktop&&job.state==='awaiting_confirmation')row.append(button('查看预计用量',()=>modal('整理手机上的对话',(body,footer,d)=>{const e=job.estimate;body.append(node('p','',`${job.conversationCount} 段对话 · ${date(job.from)} 至 ${date(job.to)}`),node('p','muted',`${e.modelName} · 预计输入 ${e.inputTokens[0].toLocaleString()}–${e.inputTokens[1].toLocaleString()} 词元，输出 ${e.outputTokens[0].toLocaleString()}–${e.outputTokens[1].toLocaleString()} 词元 · ${e.local?'本机模型不花钱':e.cost?`约 ¥${e.cost[0].toFixed(3)}–¥${e.cost[1].toFixed(3)}`:'费用暂未知'}`));footer.append(button('稍后',()=>d.close()),button('开始整理',async b=>{b.disabled=true;try{await run({action:'confirm',jobId:job.id,confirm:true});d.close();await refresh();}catch(e){body.append(node('p','error',error(e)));b.disabled=false;}},'button primary'));})));
        if (desktop && ['running', 'paused'].includes(job.state))
            row.append(button(job.state === 'running' ? '暂停' : '继续', b => act(job, job.state === 'running' ? 'pause' : 'resume', b)));
        if (desktop && !['forgotten', 'forgetting'].includes(job.state)) {
            const more = button('…', () => WeftPopover.menu(more, [...(['running', 'paused'].includes(job.state) ? [{ name: '取消后续导入', icon: 'close', action: () => act(job, 'cancel') }] : []), ...(job.state !== 'running' ? [{ name: '忘掉这次导入', icon: 'trash', danger: true, action: () => forget(job) }] : [])]));
            more.setAttribute('aria-label', `${job.appName} 导入的更多操作`);
            row.append(more);
        }
        if (job.error)
            row.append(node('p', 'history-import-error', job.error));
        list.append(row);
    } }
    async function refresh() { if (!current()) {
        dialog?.close();
        clearTimeout(timer);
        return;
    } try {
        const v = await request('/memory/status');
        if (current() && v.ownerId === identity) {
            const jobs = v.imports ?? [], signature = JSON.stringify(jobs);
            if (signature !== renderedJobs) { renderedJobs = signature; paint(jobs); }
        }
    }
    catch (e) {
        if (current()) {
            list.querySelector('.history-import-skeleton')?.remove();
            status.textContent = error(e);
            status.append(button('重试', refresh));
        }
    } }
    function preview(p) { modal('导入聊天记录 · 开始前看看', (body, footer, d) => { body.append(node('p', '', `${p.appName} · ${p.conversationCount} 段对话 · ${date(p.from)} 至 ${date(p.to)}`), node('p', 'muted', `其中 ${p.duplicateCount} 段已经导过，${p.emptyCount} 段没有可导入的内容。原文件只读，不会复制到 WeftMate。`)); const selected = new Set(p.items.filter(i => !i.duplicate && i.chunks).map(i => i.key)), checks = new Map(), estimate = node('p', 'history-import-estimate'), filters = node('div', 'history-import-filters'), choices = node('div', 'history-import-choices'), message = node('p', 'error'); message.setAttribute('role', 'status'); const from = node('input'), to = node('input'); from.type = to.type = 'text'; from.placeholder = '2025-01-01'; to.placeholder = '2026-12-31'; from.setAttribute('aria-label', '开始日期，年月日'); to.setAttribute('aria-label', '结束日期，年月日'); const select = fn => { for (const i of p.items)
        if (!i.duplicate && i.chunks) {
            if (fn(i))
                selected.add(i.key);
            else
                selected.delete(i.key);
            checks.get(i.key).checked = selected.has(i.key);
        } update(); }; filters.append(button('全选', () => select(() => true)), button('只导最近一年', () => { const since = new Date(); since.setFullYear(since.getFullYear() - 1); select(i => i.at && Date.parse(i.at) >= since.getTime()); }), from, to, button('按日期选择', () => { if ([from.value, to.value].some(s => s && (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s))))) {
        message.textContent = '请按 2025-01-01 的格式填写日期。';
        return;
    } select(i => i.at && (!from.value || i.at.slice(0, 10) >= from.value) && (!to.value || i.at.slice(0, 10) <= to.value)); })); for (const i of p.items) {
        const label = node('label', 'history-import-choice'), check = node('input');
        check.type = 'checkbox';
        check.checked = selected.has(i.key);
        check.disabled = i.duplicate || !i.chunks;
        check.onchange = () => { if (check.checked)
            selected.add(i.key);
        else
            selected.delete(i.key); update(); };
        checks.set(i.key, check);
        label.append(check, node('span', '', `${i.title} · ${date(i.at)}${i.duplicate ? ' · 已导过' : !i.chunks ? ' · 无可导入内容' : ''}`));
        choices.append(label);
    } body.append(estimate, node('p', 'muted', p.estimate.local ? '本机 / 局域网模型不花钱；时间随设备和等待情况变化。' : '这些对话会分批发给你选的模型提供方。费用由你的模型账户支付。'), filters, choices, message); const start = button('开始导入', async (b) => { b.disabled = true; try {
        const bytes = new Uint8Array(Math.ceil(p.items.length / 8)); p.items.forEach((item, index) => { if (selected.has(item.key)) bytes[index >> 3] |= 1 << (index % 8); }); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); await run({ action: 'start', previewId: p.previewId, selected: btoa(binary), confirm: true });
        d.close();
        await refresh();
    }
    catch (e) {
        message.textContent = error(e);
        b.disabled = false;
    } }, 'button primary'); footer.append(button('暂不导入', () => d.close()), start); function update() { const items = p.items.filter(i => selected.has(i.key)), chars = items.reduce((n, i) => n + i.characters, 0), chunks = items.reduce((n, i) => n + i.chunks, 0), lo = Math.ceil(chars * .4) + chunks * 6000, hi = Math.ceil(chars * 1.5) + chunks * 18000, price = p.estimate.price, cost = price ? [((lo - chunks * 6000) * price.input + chunks * 6000 * Math.min(price.cachedInput, price.input) + chunks * 600 * price.output) / 1e6, (hi * price.input + chunks * 3000 * price.output) / 1e6] : null; estimate.textContent = `已选 ${selected.size} 段 · 约 ${chars.toLocaleString()} 字 · ${p.estimate.modelName} · 预计 ${((lo + chunks * 600) / 1000).toFixed(1)}–${((hi + chunks * 3000) / 1000).toFixed(1)} 千字 · ${p.estimate.local ? `不花钱，大约 ${Math.max(1, Math.ceil(chunks * 600 / 50 / 60))}–${Math.max(1, Math.ceil((hi + chunks * 3000) / 50 / 60))} 分钟` : cost ? `大致 ${WeftHumanFormat.formatMoney(cost[0])}–${WeftHumanFormat.formatMoney(cost[1])}` : '未设置单价，费用暂无法估算；可在设置 → 用量填写单价。'}`; start.disabled = !selected.size || !p.estimate.profileId; } update(); }); }
    if (desktop)
        section.append(button('选择聊天记录', b => WeftPopover.menu(b, Object.entries({ chatgpt: 'ChatGPT 导出', claude: 'Claude 导出', codex: '本机 Codex 会话', 'claude-code': '本机 Claude Code 会话' }).map(([app, name]) => ({ name, icon: 'upload', action: async () => { b.disabled = true; status.textContent = '正在本机读取，尚未发送给模型…'; try {
                const p = await desktop.previewHistoryImport(app);
                if (p && current() && p.ownerId === identity)
                    preview(p);
                else
                    await refresh();
            }
            catch (e) {
                if (current())
                    status.textContent = error(e);
            }
            finally {
                b.disabled = false;
            } } })))));
    section.append(status, list);
    target.append(section);
    void refresh();
    const poll = async () => { if (!current())
        return; if (!document.hidden)
        await refresh(); timer = setTimeout(poll, 2000); };
    timer = setTimeout(poll, 2000);
    return { element:section, refresh, preview, destroy() { clearTimeout(timer); dialog?.close(); section.remove(); } };
};
