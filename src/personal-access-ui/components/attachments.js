/* Desktop attachments component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.attachments = (core, ui) => {
    function paintAttachmentStatus(message) {
        const status = ui.byId('attachment-status');
        status.textContent = message;
        status.hidden = !message;
    }
    function renderAttachmentDrafts() {
        const drafts = core.state.activeChatSource === 'desktop' ? core.currentAttachmentDrafts() : [];
        const root = ui.byId('composer-attachments');
        const list = ui.byId('attachment-draft-list');
        list.replaceChildren();
        for (const item of drafts) {
            const row = ui.element('div', 'attachment-draft');
            const copy = ui.element('span', 'attachment-draft-copy');
            copy.append(ui.element('strong', '', item.file.name), ui.element('small', '', `${core.originalFileSize(item.file.size)} · ${core.attachmentHint(item)}`));
            const remove = ui.element('button', 'attachment-remove', '移除');
            remove.type = 'button';
            remove.disabled = !!core.state.attachmentUpload;
            remove.setAttribute('aria-label', `移除文件 ${item.file.name}`);
            remove.addEventListener('click', () => core.removeAttachmentDraft(item.attachmentId));
            row.append(copy, remove);
            list.append(row);
        }
        root.hidden = drafts.length === 0 && !core.state.attachmentStatus;
        ui.paintAttachmentStatus(core.state.attachmentStatus);
    }
    return { paintAttachmentStatus, renderAttachmentDrafts };
};
