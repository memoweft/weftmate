WeftPanels.register('subtasks', {
  title: '子任务', icon: 'tool',
  create(ctx) {
    const el = document.createElement('section'); el.className = 'panel-subtasks';
    const heading = document.createElement('h2'); heading.textContent = '当前回合子任务';
    const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = '当前没有子任务。让助手拆分处理工作后，进度会显示在这里。';
    el.append(heading, empty);
    const buttons = new Map(); let current = ctx;
    function paint() {
      const snapshot = WeftComposerSubtasks.snapshot;
      const rows = snapshot?.scope === `${current.ownerId}/${current.identityGeneration}/${current.sessionId}` ? snapshot.rows : [];
      empty.hidden = rows.length > 0;
      for (const [key, button] of buttons) if (!rows.some(row => row.key === key)) { button.remove(); buttons.delete(key); }
      for (const row of rows) {
        const button = buttons.get(row.key) || document.createElement('button'); button.className = 'panel-subtask'; button.type = 'button'; button.dataset.subtask = row.key;
        const title = document.createElement('strong'); title.textContent = row.name;
        const status = document.createElement('span'); status.textContent = `${row.status} · ${row.duration}`;
        button.replaceChildren(title, status); button.setAttribute('aria-label', `${row.name}，${row.status}，查看步骤`);
        button.onclick = () => { if (innerWidth <= 720) WeftPanels.hide(false); WeftComposerSubtasks.openStep(row, snapshot.root); }; if (!buttons.has(row.key)) { buttons.set(row.key, button); el.append(button); }
      }
    }
    document.addEventListener('weftmate:subtasks', paint); paint();
    return { el, show: paint, hide() {}, update(next) { current = next; paint(); }, dispose() { document.removeEventListener('weftmate:subtasks', paint); el.replaceChildren(); } };
  },
});
