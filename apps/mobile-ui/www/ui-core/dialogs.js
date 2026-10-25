/* Program-drawn confirmations shared by desktop, remote/mobile UI and the DSH client. */
(() => {
  let queue = Promise.resolve();
  let sequence = 0;
  function open({ title, message, confirmLabel = '确认', danger = false, cancelLabel = '取消', information = false }) {
    return new Promise(resolve => {
      const previous = document.activeElement;
      const node = (tag, className, text) => { const el = document.createElement(tag); el.className = className; if (text !== undefined) el.textContent = text; return el; };
      const id = `weft-confirm-${++sequence}`;
      const controls = globalThis.WeftControls;
      const description = node('p', '', message); description.id = `${id}-message`;
      const cancel = controls ? controls.button(cancelLabel) : node('button', 'button secondary', cancelLabel);
      const accept = controls ? controls.button(confirmLabel, {variant:danger?'danger':'primary'}) : node('button', `button ${danger ? 'danger' : 'primary'}`, confirmLabel);
      cancel.classList.add('button','secondary'); accept.classList.add('button',danger?'danger':'primary');
      cancel.type = accept.type = 'button';
      const actions = information ? [accept] : [cancel,accept];
      const dialog = controls ? controls.dialog({title,content:description,actions}) : node('dialog');
      dialog.classList.add('dialog','confirm-dialog','weft-confirm');
      if(!controls){const head=node('div','dialog-head');head.append(node('h2','',title));const body=node('div','dialog-body');body.append(description);const foot=node('div','dialog-footer');foot.append(...actions);dialog.append(head,body,foot);}
      const head=dialog.firstElementChild,heading=head.querySelector('h2'),body=description.parentElement,footer=dialog.lastElementChild;
      head.querySelector('button')?.remove();head.classList.add('dialog-head');body.classList.add('dialog-body');footer.classList.add('dialog-footer');
      heading.id = `${id}-title`;dialog.setAttribute('aria-labelledby',heading.id);dialog.setAttribute('aria-describedby',description.id);
      cancel.onclick = () => dialog.close('cancel'); accept.onclick = () => dialog.close('confirm');
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
      document.body.append(dialog); if(controls)dialog.openPanel();else dialog.showModal();
      (information ? accept : cancel).focus({ preventScroll: true });
    });
  }
  function request(options) { const result = queue.then(() => open(options)); queue = result.catch(() => {}); return result; }
  const allowAllOptions = () => ({ title: '启用全部允许？', message: '删除或覆盖文件、修改系统、安装软件、对外发送或发布、付款等操作都会直接执行，不再询问你，有些操作无法撤销。', confirmLabel: '启用全部允许', danger: true });
  globalThis.WeftDialogs = { request, allowAll: () => request(allowAllOptions()), allowAllOptions, inform: (title, message) => request({ title, message, confirmLabel: '知道了', information: true }) };
})();
