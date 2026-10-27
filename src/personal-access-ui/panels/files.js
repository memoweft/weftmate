/* Navigation, disk snapshots and drafts have separate lifetimes. */
WeftPanels.register('files', {
  title: '文件', icon: 'folder',
  create(ctx) {
    const { node, button, key, ready, contextHelp, message, empty, request, preview } = WeftWorkspacePanel;
    const el = node('section', 'workspace-panel panel-files'), toolbar = node('div', 'workspace-toolbar');
    const search = node('input', 'workspace-search'); search.type = 'search'; search.placeholder = '按文件名搜索'; search.setAttribute('aria-label', '按文件名搜索'); search.maxLength = 200;
    const refresh = button('刷新文件', () => void refreshAll()), toggleNav = button('收起导航', () => { const hidden = navigation.hidden = !navigation.hidden; toggleNav.textContent = hidden ? '展开导航' : '收起导航'; toggleNav.setAttribute('aria-expanded', String(!hidden)); layout.classList.toggle('navigation-hidden', hidden); }), notice = node('p', 'workspace-notice'); notice.setAttribute('role', 'status');
    toggleNav.setAttribute('aria-expanded', 'true');
    const layout = node('div', 'files-layout');
    const navigation = node('div', 'files-navigation'), tree = node('div', 'files-tree'), resources = node('div', 'files-resources');
    const content = node('div', 'files-content'), header = node('div', 'workspace-toolbar'), title = node('h3', 'workspace-file-title', '选择一个文件');
    const edit = button('编辑文本', () => startEdit()), save = button('保存', () => void saveDraft(), 'button primary small'), cancel = button('放弃草稿', () => discardDraft());
    const latest = button('查看新版本', () => showLatest()), adopt = button('采用新版本', () => adoptLatest()), keep = button('保留草稿继续编辑', () => keepDraft());
    const feedback = node('p', 'workspace-notice'), display = node('div', 'files-preview files-current-preview'), diskPreview = node('details', 'files-disk-version'), diskBody = node('div', 'files-preview');
    feedback.setAttribute('role', 'status'); diskPreview.append(node('summary', '', '磁盘上的新版本'), diskBody);
    const editor = node('textarea', 'files-editor'); editor.spellcheck = false; editor.setAttribute('aria-label', '文件文本');
    toolbar.append(toggleNav, refresh); navigation.append(search, tree, resources); header.append(title, edit, save, cancel, latest, adopt);
    header.append(keep); content.append(header, feedback, diskPreview, display, editor); layout.append(navigation, content); el.append(toolbar, notice, layout);
    let current = ctx, contextKey = key(ctx), generation = 0, readSeq = 0, searchSeq = 0, resourceSeq = 0, disposed = false, timer, debounce, saving = false;
    const states = new Map(); let state = { selected: null, drafts: new Map(), expanded: new Set() };
    states.set(contextKey, state); const cache = new Map();
    const active = (token, seq) => !disposed && token === generation && (seq === undefined || seq === readSeq);
    function currentDraft() { return state.drafts.get(state.selected); }
    function fitPanel() { const width = el.clientWidth; if (state.selected && width > 0 && width < 360 && !navigation.hidden) toggleNav.click(); }
    function controls() {
      const draft = currentDraft(), editing = !!draft?.editing, changed = editing && draft.text !== draft.baseText;
      editor.hidden = !editing; display.hidden = editing; edit.hidden = !draft || draft.data.kind !== 'text' || editing;
      edit.disabled = !draft?.data.writable; edit.title = draft?.data.writable ? '' : '目录只读，请在目录设置里开启读写。';
      save.hidden = cancel.hidden = !editing; save.disabled = saving || !changed || !!draft?.stale; cancel.disabled = saving;
      latest.hidden = !draft?.stale; adopt.hidden = !draft?.latest; adopt.disabled = saving;
      keep.hidden = !draft?.latest; keep.disabled = saving || draft?.latest?.kind !== 'text';
      search.disabled = !ready(current); refresh.disabled = saving;
    }
    function paint() {
      const draft = currentDraft(); title.textContent = state.selected || '选择一个文件';
      diskPreview.hidden = true; diskBody.replaceChildren();
      if (!draft) { empty(display, '从文件树或搜索结果中选择一个文件。'); feedback.textContent = ''; controls(); return; }
      preview(display, draft.data, state.selected); editor.value = draft.text ?? '';
      feedback.textContent = draft.stale ? '文件已有新版本，编辑稿已保留。先查看新版本，再决定采用哪一份。' : draft.editing ? '编辑稿尚未保存。' : '';
      controls();
    }
    function startEdit() { const draft = currentDraft(); if (!draft?.data.writable) return; draft.editing = true; paint(); editor.focus(); }
    editor.oninput = () => { const draft = currentDraft(); if (!draft) return; draft.text = editor.value; feedback.textContent = draft.stale ? '文件已有新版本，编辑稿已保留。' : '编辑稿尚未保存。'; controls(); };
    function discardDraft() {
      const draft = currentDraft(); if (!draft || saving) return;
      const data = draft.latest || draft.data; state.drafts.set(state.selected, { data, text: data.text, baseText: data.text, version: data.version, editing: false }); paint();
    }
    function showLatest() { const draft = currentDraft(); if (!draft?.latest) return; preview(diskBody, draft.latest, state.selected); diskPreview.hidden = false; diskPreview.open = true; diskBody.scrollIntoView({ block: 'nearest' }); }
    function adoptLatest() { if (!currentDraft()?.latest || saving) return; discardDraft(); }
    function keepDraft() {
      const draft = currentDraft(); if (!draft?.latest || draft.latest.kind !== 'text' || saving) return;
      draft.data = draft.latest; draft.baseText = draft.latest.text; draft.version = draft.latest.version; draft.stale = false; delete draft.latest;
      paint(); feedback.textContent = '已保留草稿，请核对后保存。';
    }
    async function readFile(file, quiet = false) {
      const token = generation, seq = ++readSeq, scope = current;
      if (!quiet) { state.selected = file; paint(); fitPanel(); if (!currentDraft()) feedback.textContent = '正在读取文件…'; }
      try {
        const data = await request(scope, 'files/read', { path: file });
        if (!active(token, seq) || state.selected !== file) return;
        const draft = currentDraft();
        if (draft?.editing) {
          if (data.version !== draft.version) { draft.latest = data; draft.stale = true; feedback.textContent = '文件已有新版本，编辑稿已保留。先查看新版本，再决定采用哪一份。'; controls(); }
        } else if (quiet && draft && data.version && data.version === draft.version) { draft.data = data; controls(); }
        else { state.drafts.set(file, { data, text: data.text, baseText: data.text, version: data.version, editing: false }); paint(); }
      } catch (error) { if (active(token, seq) && state.selected === file) { feedback.textContent = message(error); controls(); } }
    }
    async function saveDraft() {
      const draft = currentDraft(); if (!draft?.editing || saving || draft.stale) return;
      const token = generation, scope = current, file = state.selected, sent = draft.text; saving = true; controls(); feedback.textContent = '正在保存…';
      try {
        const result = await request(scope, 'files/save', { path: file, text: sent, version: draft.version });
        if (!active(token)) return;
        draft.version = result.version; draft.baseText = sent; draft.data = { ...draft.data, text: sent, version: result.version };
        if (state.selected === file) feedback.textContent = draft.text === sent ? '已保存。' : '已保存，后续编辑尚未保存。';
      } catch (error) {
        if (!active(token) || state.selected !== file) return;
        feedback.textContent = message(error);
        if (error.code === 'WORKSPACE_FILE_CHANGED') { draft.stale = true; void readFile(file, true); }
      } finally { if (active(token)) { saving = false; controls(); } }
    }
    async function directory(rel, host) {
      const token = generation, queryAtStart = searchSeq; if (!host.childNodes.length) host.replaceChildren(node('p', 'muted', '正在读取…'));
      try {
        const data = cache.get(rel) || await request(current, 'files/list', { path: rel });
        if (!active(token) || queryAtStart !== searchSeq || !host.isConnected) return;
        cache.set(rel, data); const signature = JSON.stringify(data); if (host._workspaceSignature === signature) return; host._workspaceSignature = signature; host.replaceChildren();
        if (!data.entries.length) host.append(node('p', 'muted', '这个文件夹是空的。'));
        for (const entry of data.entries) {
          if (entry.type === 'directory') {
            const branch = node('details', 'files-branch'), summary = node('summary', '', entry.name), children = node('div', 'files-children');
            branch.append(summary, children); branch.ontoggle = () => { if (branch.open) { state.expanded.add(entry.path); if (!children.childNodes.length) void directory(entry.path, children); } else state.expanded.delete(entry.path); };
            host.append(branch); branch.open = state.expanded.has(entry.path);
          } else {
            const item = button(entry.name, () => void readFile(entry.path), 'files-entry'); item.title = entry.path; item.disabled = entry.type !== 'file'; host.append(item);
          }
        }
        if (data.truncated) host.append(node('p', 'muted', '仅显示前一部分文件，请按名称搜索。'));
      } catch (error) { if (active(token) && queryAtStart === searchSeq) host.replaceChildren(node('p', 'muted', message(error)), button('重试目录', () => void directory(rel, host))); }
    }
    async function find(query, seq) {
      const token = generation; delete tree._workspaceSignature; tree.replaceChildren(node('p', 'muted', '正在搜索…'));
      try {
        const data = await request(current, 'files/search', { query });
        if (!active(token) || seq !== searchSeq) return;
        tree.replaceChildren(); for (const entry of data.entries) tree.append(button(entry.path, () => void readFile(entry.path), 'files-entry'));
        if (!data.entries.length) tree.append(node('p', 'workspace-empty', '没有找到同名文件。'));
        if (data.truncated) tree.append(node('p', 'muted', '仅显示前一部分结果，请缩小搜索范围。'));
      } catch (error) { if (active(token) && seq === searchSeq) tree.replaceChildren(node('p', 'workspace-empty', message(error)), button('重试搜索', () => void find(query, seq))); }
    }
    search.oninput = () => { const seq = ++searchSeq; clearTimeout(debounce); const query = search.value.trim();
      if (!query) void directory('', tree); else debounce = setTimeout(() => void find(query, seq), 200); };
    async function loadResources() {
      const token = generation, seq = ++resourceSeq;
      try {
        const data = await WeftPanels.services.resources();
        if (!active(token) || seq !== resourceSeq) return;
        resources.replaceChildren();
        for (const [name, rows] of [['成果', data.outputs], ['来源', data.sources]]) {
          const section = node('details', 'files-resource-group'); section.open = true; section.append(node('summary', '', `${name} · ${rows?.length || 0}`));
          for (const item of rows || []) section.append(button(item.name, () => void openResource(item), 'files-entry'));
          if (!rows?.length) section.append(node('p', 'muted', `这段对话还没有${name}。`)); resources.append(section);
        }
      } catch (error) { if (active(token) && seq === resourceSeq) resources.replaceChildren(node('p', 'muted', '成果和来源暂时无法读取。'), button('重试成果与来源', () => void loadResources())); }
    }
    async function openResource(item) {
      readSeq++; state.selected = null; paint(); title.textContent = item.name; const token = generation, seq = readSeq;
      const view = node('div', 'files-resource-preview'); display.replaceChildren(view);
      try { await WeftPanels.services.previewResource(item, view); }
      catch { if (active(token, seq)) feedback.textContent = '暂时无法读取，请重新打开。'; }
    }
    async function refreshAll() {
      cache.clear(); searchSeq++; const seq = searchSeq, query = search.value.trim();
      if (ready(current)) { notice.textContent = ''; void (query ? find(query, seq) : directory('', tree)); if (state.selected && !saving) void readFile(state.selected, true); }
      else { notice.textContent = contextHelp(current); tree.replaceChildren(); }
      void loadResources();
    }
    function initialize() { notice.textContent = ''; search.value = ''; delete tree._workspaceSignature; tree.replaceChildren(); controls(); paint(); void refreshAll(); }
    let observedWidth = 0;
    const sizeObserver = new ResizeObserver(([entry]) => { const width = entry.contentRect.width; if (width === observedWidth) return; observedWidth = width; fitPanel(); }); sizeObserver.observe(el);
    initialize();
    return { el, show() { if (!timer) timer = setInterval(() => { if (state.selected && !saving && ready(current)) void readFile(state.selected, true); }, 4000); if (state.selected) void readFile(state.selected, true); },
      hide() { clearInterval(timer); timer = null; },
      update(next) {
        if (key(next) === contextKey) { const directoryResolved = current.workDir !== next.workDir; current = next; if (directoryResolved) void refreshAll(); return; }
        if (next.ownerId !== current.ownerId || next.identityGeneration !== current.identityGeneration) states.clear();
        generation++; readSeq++; searchSeq++; resourceSeq++; clearTimeout(debounce); cache.clear(); saving = false;
        current = next; contextKey = key(next); state = states.get(contextKey) || { selected: null, drafts: new Map(), expanded: new Set() }; states.set(contextKey, state); initialize();
      },
      dispose() { disposed = true; generation++; sizeObserver.disconnect(); clearInterval(timer); clearTimeout(debounce); states.clear(); cache.clear(); el.replaceChildren(); } };
  },
});
