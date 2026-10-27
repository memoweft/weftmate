WeftPanels.register('browser', {
  title: '浏览器', icon: 'web',
  create(ctx) {
    const el = document.createElement('section'); el.className = 'panel-pending';
    const title = document.createElement('h2'); title.textContent = '这项正在做';
    const help = document.createElement('p'); help.textContent = '把网页地址发到对话里，请助手阅读。';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary'; button.textContent = '回到对话';
    button.onclick = () => { WeftPanels.hide(false); document.getElementById('message-text').focus(); };
    el.append(title, help, button);
    return { el, show() {}, hide() {}, update(ctx) {}, dispose() { el.replaceChildren(); } };
  },
});
