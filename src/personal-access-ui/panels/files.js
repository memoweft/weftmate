/* Conversation resources use the existing readers, downloads and previews. */
WeftPanels.register('files', {
  title: '文件', icon: 'folder',
  create(ctx) {
    const el = document.createElement('section'); el.className = 'panel-files';
    let generation = 0, disposed = false, current = ctx;
    const scope = value => JSON.stringify([value.ownerId,value.identityGeneration,value.conversationId,value.sessionId,value.projectId]);
    async function load() {
      const request = ++generation;
      el.replaceChildren(WeftControls.skeleton({ rows: 3 }));
      try {
        const items = await WeftPanels.services.resources();
        if (disposed || request !== generation) return;
        el.replaceChildren();
        for (const [name, rows] of [['成果', items.outputs], ['来源', items.sources]]) {
          const heading = document.createElement('h2'); heading.textContent = name; el.append(heading);
          if (!rows.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = `这段对话还没有${name}。`; el.append(empty); }
          for (const item of rows) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'resource-item'; button.dataset.resourceKey = item.key;
            const title = document.createElement('span'); title.textContent = item.name;
            button.append(WeftDesktop.icon(item.kind), title); button.title = item.location || item.url || item.name;
            button.onclick = () => WeftPanels.services.openResource(item, button); el.append(button);
          }
        }
        const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'button quiet small'; refresh.textContent = '刷新文件'; refresh.onclick = load; el.append(refresh);
      } catch {
        if (disposed || request !== generation) return;
        const message = document.createElement('p'); message.textContent = '文件暂时无法读取。';
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'button secondary'; retry.textContent = '重试'; retry.onclick = load; el.replaceChildren(message, retry);
      }
    }
    void load();
    return { el, show() {}, hide() {}, update(next) { const changed=scope(current)!==scope(next);current=next;if(changed)void load(); }, dispose() { disposed = true; generation++; el.replaceChildren(); } };
  },
});
