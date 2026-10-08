/* Desktop composer component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.composer = (core, ui) => {
    function paintModels() {
        const select = ui.byId('model-select');
        select.replaceChildren();
        if (core.state.models.length === 0) {
            select.append(ui.element('option', '', '没有可用模型'));
        }
        else {
            for (const model of core.state.models) {
                const option = ui.element('option', '', model.name);
                option.value = model.id;
                select.append(option);
            }
            select.value = core.state.modelProfileId;
        }
    }
    function readMessageDraft() {
        return ui.byId('message-text').value;
    }
    function clearMessageDraft() {
        ui.byId('message-text').value = '';
    }
    function paintDesktopComposer(fromPhone) {
        ui.byId('conversation-pane').classList.remove('is-phone');
        if (fromPhone)
            ui.byId('message-text').value = core.state.desktopDraft;
        ui.byId('message-text').placeholder = '向 WeftMate 说说你的目标';
    }
    function mountComposer() {
        globalThis.WeftPopover?.bindSelect(ui.byId('message-mode'), 'model-popover message-mode-popover');
        ui.byId('model-select').addEventListener('change', (event) => { core.state.modelProfileId = event.target.value; ui.updateAvailability(); });
        ui.byId('model-trigger').addEventListener('click', ui.openModelMenu);
        ui.byId('model-trigger').addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (ui.byId('model-popover').hidden)
                    ui.openModelMenu();
            }
        });
        ui.byId('model-options').addEventListener('keydown', (event) => {
            const options = [...ui.byId('model-options').children], index = options.indexOf(event.target);
            if (event.key === 'Escape') {
                event.preventDefault();
                ui.closeModelMenu(true);
                return;
            }
            if (!options.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
                return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
            options[next].focus();
        });
        ui.byId('model-configure').addEventListener('click', () => { ui.closeModelMenu(); ui.openSettings("models"); });
        ui.byId('voice-input').addEventListener('click', ui.startVoiceInput);
        document.addEventListener('click', (event) => {
            if (!ui.byId('model-popover').hidden && !ui.byId('model-picker').contains(event.target))
                ui.closeModelMenu();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !ui.byId('model-popover').hidden) {
                event.preventDefault();
                ui.closeModelMenu(true);
            }
        });
        ui.byId('message-mode').addEventListener('change', event => { core.setMessageMode(event.target.value); });
        ui.byId('message-text').addEventListener('input', ui.updateAvailability);
        ui.byId('message-attachments').addEventListener('change', (event) => {
            const input = event.currentTarget, selected = [...(input.files || [])];
            input.value = '';
            core.addAttachmentFiles(selected);
        });
        ui.byId('attachment-cancel').addEventListener('click', () => core.cancelAttachmentUpload(true));
        ui.byId('new-session').addEventListener('click', async () => {
            if (!core.state.modelProfileId || core.state.capabilities?.chat?.available !== true)
                return;
            ui.closeRail();
            await core.submitCommand('session.create', { modelProfileId: core.state.modelProfileId });
        });
        ui.byId('message-form').addEventListener('submit', async (event) => {
            event.preventDefault();
            if (event.submitter?.id === 'send-message' && ui.byId('send-message').dataset.action === 'stop')
                return core.stopCurrentTurn();
            return core.sendDraft();
        });
        ui.byId('cancel-turn').addEventListener('click', core.stopCurrentTurn);
    }
    return { paintModels, readMessageDraft, clearMessageDraft, paintDesktopComposer, mountComposer };
};
