WeftPanels.register('review', {
  title: '审查', icon: 'approval',
  create(ctx) {
    const el = document.createElement('section'); el.className = 'panel-pending';
    const title = document.createElement('h2'); title.textContent = '这项正在做';
    const help = document.createElement('p'); help.textContent = '在对话里请助手查看项目改动。';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary'; button.textContent = '回到对话';
    button.onclick = () => { WeftPanels.hide(false); document.getElementById('message-text').focus(); };
    el.append(title, help, button);
    return { el, show() {}, hide() {}, update(ctx) {}, dispose() { el.replaceChildren(); } };
  },
});
