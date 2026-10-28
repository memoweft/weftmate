/* Desktop attachments component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.attachments = (core, ui) => {
    const thumbnails = new Map();
    const phone = () => globalThis.WeftPhoneUnify?.isPhone() === true;
    function clearThumbnails(keep = new Set()) {
        for (const [id, value] of thumbnails) if (!keep.has(id)) { URL.revokeObjectURL(value.url); thumbnails.delete(id); }
    }
    const releaseThumbnails = () => clearThumbnails();
    globalThis.addEventListener?.('pagehide', releaseThumbnails);
    function paintPhoneAttachmentState(message) {
        if (!phone()) return;
        const uploading = !!core.state.attachmentUpload;
        const failed = !uploading && /未完成|不足|超过|未通过|失败/.test(message || '');
        for (const row of ui.byId('attachment-draft-list').children) {
            row.classList.toggle('is-uploading', uploading); row.classList.toggle('is-failed', failed);
            const state = row.querySelector('small');
            if (state) state.textContent = uploading ? '正在上传…' : failed ? '发送未完成 · 可重试' : row.dataset.fileSize;
        }
    }
    function paintAttachmentStatus(message) {
        const status = ui.byId('attachment-status');
        status.textContent = message;
        status.hidden = !message;
        paintPhoneAttachmentState(message);
    }
    function renderAttachmentDrafts() {
        const drafts = core.state.activeChatSource === 'desktop' ? core.currentAttachmentDrafts() : [];
        const root = ui.byId('composer-attachments');
        const list = ui.byId('attachment-draft-list');
        clearThumbnails(phone() ? new Set(drafts.map(item => item.attachmentId)) : new Set());
        list.replaceChildren();
        for (const item of drafts) {
            const row = ui.element('div', 'attachment-draft');
            const copy = ui.element('span', 'attachment-draft-copy');
            copy.append(ui.element('strong', '', item.file.name), ui.element('small', '', `${core.originalFileSize(item.file.size)} · ${core.attachmentHint(item)}`));
            if (phone()) {
                row.dataset.fileSize = core.originalFileSize(item.file.size);
                row.title = `${item.file.name} · ${core.attachmentHint(item)}`;
                if (/^image\//.test(item.contentType)) {
                    let value = thumbnails.get(item.attachmentId);
                    if (value && value.file !== item.file) { URL.revokeObjectURL(value.url); thumbnails.delete(item.attachmentId); value = null; }
                    if (!value) { value = {file:item.file, url:URL.createObjectURL(item.file)}; thumbnails.set(item.attachmentId, value); }
                    const image = ui.element('img', 'attachment-draft-image'); image.src = value.url; image.alt = item.file.name;
                    row.classList.add('has-image'); row.append(image);
                    image.addEventListener('error', () => { image.remove(); row.classList.remove('has-image'); row.prepend(WeftIcons.create('file', 24)); });
                } else {
                    const icon = WeftIcons.create('file', 24); icon.classList.add('attachment-draft-icon'); row.append(icon);
                }
            }
            const remove = ui.element('button', 'attachment-remove icon-button');
            remove.append(WeftIcons.create('deny', 16));
            remove.type = 'button';
            remove.disabled = !!core.state.attachmentUpload;
            remove.setAttribute('aria-label', `移除文件 ${item.file.name}`);
            remove.title = `移除文件 ${item.file.name}`;
            remove.addEventListener('click', () => core.removeAttachmentDraft(item.attachmentId));
            if(phone()){
                const preview=ui.element('button','attachment-preview-trigger');preview.type='button';preview.setAttribute('aria-label',`预览待发送${/^image\//.test(item.contentType)?'图片':'文件'} ${item.file.name}`);
                preview.append(...row.children,copy);
                preview.onclick=()=>/^image\//.test(item.contentType)?WeftContent.openGallery([{url:thumbnails.get(item.attachmentId).url,name:item.file.name}],0,preview,{phone:true}):WeftPhoneFiles.open({name:item.file.name,trigger:preview,getBlob:async()=>item.file});
                row.append(preview,remove);
            }else row.append(copy, remove);
            list.append(row);
        }
        root.hidden = drafts.length === 0 && !core.state.attachmentStatus;
        ui.paintAttachmentStatus(core.state.attachmentStatus);
        ui.syncPhoneComposer?.();
    }
    return { paintAttachmentStatus, renderAttachmentDrafts, disposeAttachmentDraftView() { clearThumbnails(); globalThis.removeEventListener?.('pagehide', releaseThumbnails); } };
};
