/* A review is a projection of Git, independent of execution approvals. */
globalThis.WeftPanels?.register('review', {
  title: '审查', icon: 'approval',
  create(ctx) {
    const { node, button, key, ready, message, empty, request } = WeftWorkspacePanel;
    const el = node('section', 'workspace-panel panel-review'), toolbar = node('div', 'workspace-toolbar');
    const notice = node('p', 'workspace-notice'), list = node('div', 'review-files'), detail = node('div', 'review-diff');
    notice.setAttribute('role', 'status'); list.setAttribute('aria-label', '变更文件'); detail.setAttribute('aria-label', '逐行差异'); detail.tabIndex = 0;
    const refresh = button('刷新变更', () => void load()); toolbar.append(refresh);
    el.append(toolbar, notice, list, detail);
    let current = ctx, contextKey = key(ctx), listSeq = 0, diffSeq = 0, selected = null, disposed = false, timer, listSignature, diffSignature;
    const labels = { M: '修改', A: '新增', D: '删除', R: '重命名', C: '复制', U: '冲突', '?': '未跟踪', T: '类型改变' };
    const valid = (seq, kind) => !disposed && seq === (kind === 'list' ? listSeq : diffSeq);
    function paintSelection() { for (const row of list.children) row.setAttribute('aria-pressed', String(row.dataset.path === selected)); }
    async function select(file, quiet = false) {
      const changed = selected !== file; selected = file; paintSelection(); const seq = ++diffSeq, scope = current;
      if (!quiet && changed) detail.replaceChildren(node('p', 'workspace-empty', '正在读取差异…'));
      try {
        const data = await request(scope, 'review/diff', { path: file });
        if (!valid(seq, 'diff') || selected !== file || key(scope) !== contextKey) return;
        const signature = JSON.stringify([file, data]); if (signature === diffSignature) return; diffSignature = signature;
        const markers = WeftPanels.services.diffMarkers?.() || globalThis.WeftDesktop?.getAppearance?.().diffMarkers || 'color';
        detail.dataset.diffMarkers = markers;
        detail.replaceChildren(node('h3', 'workspace-file-title', file));
        if (data.binary) { detail.append(node('p', 'workspace-empty', '二进制文件，无法显示逐行差异。')); return; }
        if (!data.lines.length) { detail.append(node('p', 'workspace-empty', '文件状态有变化，内容没有逐行差异。')); return; }
        const lines = node('div', 'diff-lines');
        for (const line of data.lines) {
          const row = node('div', `diff-line diff-${line.type}`), old = node('span', 'diff-number', line.oldLine === undefined ? '' : String(line.oldLine)), next = node('span', 'diff-number', line.newLine === undefined ? '' : String(line.newLine));
          old.setAttribute('aria-hidden', 'true'); next.setAttribute('aria-hidden', 'true');
          const sign = node('span', 'diff-sign', line.type === 'add' ? '+' : line.type === 'del' ? '−' : ''); sign.setAttribute('aria-hidden', 'true');
          row.append(old, next, sign, node('code', '', line.text || ' '));
          if (line.type === 'add' || line.type === 'del') row.setAttribute('aria-label', `${line.type === 'add' ? '新增' : '删除'}第 ${line.newLine ?? line.oldLine} 行：${line.text}`);
          lines.append(row);
        }
        detail.append(lines);
      } catch (error) { if (valid(seq, 'diff') && selected === file) { diffSignature = null; detail.replaceChildren(node('p', 'workspace-empty', message(error)), button('重试差异', () => void select(file))); } }
    }
    async function load() {
      const seq = ++listSeq, scope = current;
      if (!ready(scope)) { diffSeq++; list.replaceChildren(); empty(detail); notice.textContent = ''; refresh.disabled = true; return; }
      refresh.disabled = true; notice.textContent = '正在读取变更…';
      try {
        const data = await request(scope, 'review/status');
        if (!valid(seq, 'list') || key(scope) !== contextKey) return;
        notice.textContent = data.files.length ? `${data.files.length} 个变更文件${data.truncated ? '，仅显示前一部分' : ''}` : '工作目录没有变更。';
        const signature = JSON.stringify(data); if (signature !== listSignature) { listSignature = signature; list.replaceChildren();
        for (const file of data.files) {
          const label = file.status.includes('U') || ['AA', 'DD'].includes(file.status) ? '冲突' : labels[file.status.trim()[0]] || '变更';
          const row = button('', () => void select(file.path), 'review-file'); row.dataset.path = file.path;
          row.title = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
          row.append(node('span', 'review-state', label), node('span', 'review-path', file.oldPath ? `${file.oldPath} → ${file.path}` : file.path));
          row.append(node('span', 'review-count', file.additions === null || file.deletions === null ? '二进制 / 未知' : `+${file.additions} −${file.deletions}`)); list.append(row);
        } }
        if (!data.files.length) { selected = null; diffSignature = null; diffSeq++; empty(detail, '修改文件后，可以在这里查看差异。'); }
        else await select(data.files.some(file => file.path === selected) ? selected : data.files[0].path, true);
      } catch (error) { if (valid(seq, 'list')) { listSignature = diffSignature = null; diffSeq++; list.replaceChildren(); detail.replaceChildren(); notice.textContent = message(error); } }
      finally { if (valid(seq, 'list')) refresh.disabled = false; }
    }
    void load();
    return { el, show() { if (!timer) timer = setInterval(() => { if (!refresh.disabled) void load(); }, 5000); void load(); },
      hide() { clearInterval(timer); timer = null; },
      update(next) { const changed = key(next) !== contextKey; current = next; if (!changed) return; contextKey = key(next); listSignature = diffSignature = null; selected = null; diffSeq++; list.replaceChildren(); detail.replaceChildren(); void load(); },
      dispose() { disposed = true; listSeq++; diffSeq++; clearInterval(timer); el.replaceChildren(); } };
  },
});
