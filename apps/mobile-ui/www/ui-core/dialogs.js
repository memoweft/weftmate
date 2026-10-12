/* Program-drawn confirmations shared by desktop, remote/mobile UI and the DSH client. */
(() => {
  let queue = Promise.resolve();
  let sequence = 0;
  function open({ title, message, confirmLabel = '确认', danger = false, cancelLabel = '取消', information = false }) {
    return new Promise(resolve => {
      const previous = document.activeElement;
      const node = (tag, className, text) => { const el = document.createElement(tag); el.className = className; if (text !== undefined) el.textContent = text; return el; };
      const dialog = node('dialog', 'dialog confirm-dialog weft-confirm');
      const id = `weft-confirm-${++sequence}`;
      dialog.setAttribute('aria-labelledby', `${id}-title`);
      dialog.setAttribute('aria-describedby', `${id}-message`);
      const head = node('div', 'dialog-head'), heading = node('h2', '', title);
      heading.id = `${id}-title`; head.append(heading);
      const body = node('div', 'dialog-body'), description = node('p', '', message);
      description.id = `${id}-message`; body.append(description);
      const footer = node('div', 'dialog-footer');
      const cancel = node('button', 'button secondary', cancelLabel), accept = node('button', `button ${danger ? 'danger' : 'primary'}`, confirmLabel);
      cancel.type = accept.type = 'button';
      cancel.onclick = () => dialog.close('cancel'); accept.onclick = () => dialog.close('confirm');
      if (!information) footer.append(cancel);
      footer.append(accept); dialog.append(head, body, footer);
      // showModal makes the rest of the page inert; Tab stays on the dialog's actions.
      dialog.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Tab') {
          event.preventDefault(); event.stopPropagation();
          const actions = [...footer.querySelectorAll('button:not(:disabled)')];
          const at = actions.indexOf(document.activeElement);
          actions[(at + (event.shiftKey ? -1 : 1) + actions.length) % actions.length].focus();
        }
        if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); dialog.close('confirm'); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dialog.close('cancel'); }
      });
      dialog.addEventListener('close', () => { const accepted = dialog.returnValue === 'confirm'; dialog.remove(); if (previous?.isConnected) previous.focus({ preventScroll: true }); resolve(accepted); }, { once: true });
      document.body.append(dialog); dialog.showModal();
      (information ? accept : cancel).focus({ preventScroll: true });
    });
  }
  function request(options) { const result = queue.then(() => open(options)); queue = result.catch(() => {}); return result; }
  const allowAllOptions = () => ({ title: '启用全部允许？', message: '删除或覆盖文件、修改系统、安装软件、对外发送或发布、付款等操作都会直接执行，不再询问你，有些操作无法撤销。', confirmLabel: '启用全部允许', danger: true });
  globalThis.WeftDialogs = { request, allowAll: () => request(allowAllOptions()), allowAllOptions, inform: (title, message) => request({ title, message, confirmLabel: '知道了', information: true }) };
})();
