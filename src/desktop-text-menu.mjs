import { Menu } from 'electron';

export function attachWindowsTextMenu(window) {
  if (process.platform !== 'win32') return;
  window.webContents.on('context-menu', (event, { isEditable, selectionText, editFlags }) => {
    const items = isEditable ? [
      { role: 'undo', label: '撤销', enabled: editFlags.canUndo },
      { role: 'redo', label: '重做', enabled: editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', label: '剪切', enabled: editFlags.canCut },
      { role: 'copy', label: '复制', enabled: editFlags.canCopy },
      { role: 'paste', label: '粘贴', enabled: editFlags.canPaste },
      { role: 'delete', label: '删除', enabled: editFlags.canDelete },
      { type: 'separator' },
      { role: 'selectAll', label: '全选', enabled: editFlags.canSelectAll },
    ] : selectionText && editFlags.canCopy ? [{ role: 'copy', label: '复制' }] : [];
    if (!items.length) return;
    event.preventDefault();
    Menu.buildFromTemplate(items).popup({ window });
  });
}
