/* Desktop sessions component: paint data, bind controls, invoke shared actions. */
globalThis.WeftUiComponents.factories.sessions = (core, ui) => {
    const collapsedGroups = new Set();
    let activeMenu, activeSubmenu;
    const collapsedProjects = new Set();
    let sidebarSignature;
    const priorStatuses = new Map();
    let hoverCard, hoverTimer, hoverTrigger;
    function relativeActivity(value) {
        if (!value || !Number.isFinite(Date.parse(value))) return '未记录';
        const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
        if (minutes < 1) return '刚刚';
        if (minutes < 60) return `${minutes} 分`;
        if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时`;
        if (minutes < 2880) return '昨天';
        return `${Math.floor(minutes / 1440)} 天前`;
    }
    function appendStatus(row, session) {
        const state = WeftUiCore.sessionStatus(session);
        const status = ui.element('span', 'session-status');
        if (state.rank) {
            const dot = ui.element('span', state.kind === 'running' ? 'session-running-dot' : `session-unread-dot is-${state.kind}`);
            dot.setAttribute('role','img'); dot.setAttribute('aria-label', state.label); status.dataset.tooltip = state.label; status.append(dot);
        }
        const id = session.sessionId || row.dataset.statusKey;
        if (id && priorStatuses.get(id) === 'running' && state.rank && state.kind !== 'running') status.classList.add('status-entering');
        if (id) priorStatuses.set(id, state.kind);
        row.append(status);
        const flags = [state.label, session.pinned && '已置顶', (session.temporary || session.memoryMode === 'off') && '临时对话'].filter(Boolean);
        if (flags.length) (row.tagName === 'BUTTON' ? row : row.firstElementChild).setAttribute('aria-description', flags.join('，'));
    }
    function closeHoverCard() {
        clearTimeout(hoverTimer); hoverTimer = null; hoverCard?.remove(); hoverCard = null;
        hoverTrigger?.removeAttribute('aria-describedby'); hoverTrigger = null;
    }
    async function archiveWithUndo(session) {
        const token = core.accountToken();
        if (await core.archiveSession(session.sessionId, true)) ui.toast('对话已归档。', async () => {
            if (core.accountIdentityCurrent(token)) await core.archiveSession(session.sessionId, false);
        });
    }
    function bindRowActions(row, session, more) {
        const title = session.title || '新对话';
        more.title = `更多操作 ${title}`;
        for (const [icon, label, run] of [
            ['pin', session.pinned ? '取消置顶' : '置顶', () => core.updateSession(session.sessionId, { pinned: !session.pinned })],
            ['archive', '归档', () => archiveWithUndo(session)],
        ]) {
            const button = ui.element('button', 'session-quick-action'); button.type = 'button';
            button.dataset.quickAction = icon;
            button.dataset.tooltip = icon === 'pin' ? (session.pinned ? '取消置顶' : '置顶聊天') : '归档'; button.setAttribute('aria-label', `${label} ${title}`);
            if (icon === 'pin') button.setAttribute('aria-pressed', String(!!session.pinned));
            button.append(globalThis.WeftIcons.create(icon, 16));
            button.onclick = async () => { closeHoverCard(); button.disabled = true;
                try { await run(); } catch (error) { ui.toast(core.sessionLifecycleMessage(error)); }
                finally { button.disabled = false; } };
            row.insertBefore(button, more);
        }
        const show = () => {
            closeHoverCard();
            hoverTimer = setTimeout(() => {
                hoverTimer = null;
                if (!row.isConnected || document.querySelector('.session-menu:not([hidden])')) return;
                const details = core.sessionHoverDetails(session);
                hoverCard = ui.element('div', 'session-hover-card'); hoverCard.setAttribute('role', 'tooltip');
                hoverCard.id = 'session-hover-details'; hoverTrigger = row.children[0]; hoverTrigger.setAttribute('aria-describedby', hoverCard.id);
                hoverCard.setAttribute('aria-label', '对话详情');
                const head = ui.element('div', 'session-hover-head');
                head.append(ui.element('strong', '', details.title));
                const device = WeftIcons.create('desktop', 16); device.setAttribute('role', 'img');
                device.removeAttribute('aria-hidden');
                device.setAttribute('aria-label', session.hostId && session.hostId !== core.state.hostId ? '其它设备' : '这台电脑');
                head.append(device, ui.element('span', 'session-hover-time', relativeActivity(details.activity))); hoverCard.append(head);
                const project = core.state.projects?.find(item => item.projectId === session.projectId);
                const state = WeftUiCore.sessionStatus(session);
                if (state.label) hoverCard.append(ui.element('p', 'session-hover-state', state.label));
                if (project) { const location = ui.element('p', 'session-hover-project'); location.append(WeftIcons.create('folder', 16), ui.element('span', '', project.name)); hoverCard.append(location); }
                document.body.append(hoverCard); globalThis.WeftPopover.position(hoverCard, row, {side:'right'});
            }, 500);
        };
        row.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse' && matchMedia('(hover: hover) and (pointer: fine)').matches) show(); });
        row.addEventListener('pointerleave', closeHoverCard);
        row.addEventListener('focusin', () => { if (matchMedia('(hover: hover) and (pointer: fine)').matches) show(); });
        row.addEventListener('focusout', event => { if (!row.contains(event.relatedTarget)) closeHoverCard(); });
        row.addEventListener('keydown', event => {
            if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) { event.preventDefault(); sessionMenu(session, row.firstElementChild); }
            if (event.key === 'Escape' && (hoverCard || hoverTimer)) { event.preventDefault(); closeHoverCard(); }
        });
        const main = row.children[0]; let longPress, pressed = false;
        main.addEventListener('pointerdown', event => { if (event.pointerType !== 'touch') return;
            pressed = false; longPress = setTimeout(() => { pressed = true; sessionMenu(session, main); }, 500); });
        for (const event of ['pointerup', 'pointercancel', 'pointermove']) main.addEventListener(event, () => clearTimeout(longPress));
        main.addEventListener('click', event => { if (pressed) { event.preventDefault(); event.stopImmediatePropagation(); pressed = false; } }, true);
    }
    const canManageProjectFolders = () => core.state.projectCanManage && !!globalThis.weftmateDesktop;
    function projectError(error) {
        return { PROJECT_REVISION_CHANGED: '项目已在其他设备更新，请关闭并重新打开设置。',
            SESSION_BUSY: '项目对话仍在运行，请结束后再修改项目。', PROJECT_UNSAFE_PATH: '文件夹不可用，请选择本机已有文件夹。' }[error?.code] || core.failureMessage(error);
    }
    function confirmRemoveProject(project, parent) {
        const dialog = ui.element('dialog', 'dialog confirm-dialog'); dialog.setAttribute('aria-label', '移除项目');
        const body = ui.element('div', 'dialog-body'); body.append(ui.element('h2', '', `移除「${project.name}」？`),
            ui.element('p', '', '只移除项目登记，不删除文件夹里的任何文件。对话保留，并从下一回合使用各自的独立工作目录。'));
        const notice = ui.element('p', 'form-error'); notice.setAttribute('role', 'alert');
        const footer = ui.element('div', 'dialog-footer');
        const cancel = ui.element('button', 'button secondary', '取消'); cancel.onclick = () => dialog.close();
        const remove = ui.element('button', 'button danger', '移除登记');
        remove.onclick = async () => { remove.disabled = true; try { await core.removeProject(project); dialog.close(); parent?.close(); }
            catch (error) { notice.textContent = projectError(error); remove.disabled = false; } };
        footer.append(cancel, remove); dialog.append(body, notice, footer); dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal(); cancel.focus();
    }
    function editProject(project = null) {
        if (!canManageProjectFolders()) return;
        const dialog = ui.element('dialog', 'dialog project-dialog'); dialog.setAttribute('aria-label', project ? '项目设置' : '新建项目');
        const form = ui.element('form'), body = ui.element('div', 'dialog-body'); body.append(ui.element('h2', '', project ? '项目设置' : '新建项目'));
        const field = (caption, control) => { const label = ui.element('label', 'project-field', caption); label.append(control); body.append(label); control.setAttribute('aria-label', caption); return control; };
        let folder;
        const name = ui.element('input'); name.value = project?.name || ''; name.required = true; name.maxLength = 80;
        if (!project) {
            body.append(ui.element('p', 'muted', '一个项目对应电脑上的一个文件夹。项目对话默认在这里读写文件和运行命令。'));
            folder = field('电脑上的文件夹', ui.element('input')); folder.required = true; folder.readOnly = true; folder.placeholder = '请用系统选择文件夹'; folder.autocomplete = 'off';
            const suggestName = () => { if (!name.value) name.value = folder.value.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ''; };
            folder.addEventListener('change', suggestName);
            if (globalThis.weftmateDesktop?.pickProjectFolder) {
                const choose = ui.element('button', 'button secondary', '选择文件夹…'); choose.type = 'button';
                choose.onclick = async () => { try { const identity = core.state.identityGeneration, path = await globalThis.weftmateDesktop.pickProjectFolder(); if (path && identity === core.state.identityGeneration) { folder.value = path; suggestName(); const choice=await globalThis.weftmateDesktop.inspectProjectFolder(path);if(choice.warning){notice.textContent=choice.warning;permission.value='read-only';permission.dispatchEvent(new Event('weft:sync'));} } }
                    catch { notice.textContent = '无法打开系统选择框，请重试。'; } }; body.append(choose);
            }
        }
        field('项目名称', name);
        const instructions = field('项目说明', ui.element('textarea')); instructions.value = project?.instructions || ''; instructions.rows = 5; instructions.maxLength = 16000;
        instructions.placeholder = '给助手的固定说明，例如背景、编码规范或写作要求';
        const permission = field('文件权限', ui.element('select')); permission.append(new Option('只读', 'read-only'), new Option('可写', 'write')); permission.value = project?.permission || 'write';
        body.append(ui.element('p', 'field-help', '项目说明会自动带给模型。可写权限仅适用于项目文件夹；危险操作继续按对话审批模式处理。'));
        const notice = ui.element('p', 'form-error'); notice.setAttribute('role', 'alert'); body.append(notice);
        const footer = ui.element('div', 'dialog-footer');
        const cancel = ui.element('button', 'button secondary', '取消'); cancel.type = 'button'; cancel.onclick = () => dialog.close();
        const save = ui.element('button', 'button primary', project ? '保存' : '创建项目'); save.type = 'submit';
        if (project) { const remove = ui.element('button', 'button danger', '移除项目'); remove.type = 'button'; remove.onclick = () => confirmRemoveProject(project, dialog); footer.append(remove); }
        footer.append(cancel, save); form.append(body, footer); dialog.append(form);
        const requestId = crypto.randomUUID();
        form.onsubmit = async event => { event.preventDefault(); save.disabled = true; notice.textContent = '';
            try { const fields={name:name.value.trim().normalize('NFC'),instructions:instructions.value,permission:permission.value};
                if(project)await core.saveProject(project,fields);
                else await globalThis.weftmateDesktop.createFolderProject({...fields,requestId,rootPath:folder.value.trim()});
                await core.refreshSessionProjects();ui.renderSessions();dialog.close(); }
            catch (error) { notice.textContent = projectError(error); } finally { save.disabled = false; } };
        dialog.onclose = () => dialog.remove(); document.body.append(dialog); globalThis.WeftPopover.bindSettingsSelect(permission); dialog.showModal(); (folder || name).focus();
    }
    async function newProjectConversation(project, button) {
        button.disabled = true;
        try { const sessionId = await core.createProjectConversation(project, core.state.modelProfileId || core.state.models[0]?.id);
            await core.refreshSessions(); if (sessionId) await core.selectSession(sessionId); }
        catch (error) { ui.byId('sessions-status').textContent = projectError(error); }
        finally { button.disabled = false; }
    }
    function renderSidebarProjects(list, query) {
        const heading = ui.element('li', 'project-section-heading'); heading.append(ui.element('span', '', '项目'));
        if (canManageProjectFolders()) { const add = ui.element('button', 'project-action'); add.type = 'button'; add.setAttribute('aria-label', '新建项目'); add.append(WeftIcons.create('plus', 16)); add.onclick = () => editProject(); heading.append(add); }
        list.append(heading);
        const projects = (core.state.projects || []).filter(project => !project.revoked); let projectMatches = 0;
        if (!projects.length) list.append(ui.element('li', 'project-empty', core.state.projectsError || (core.state.projectCanManage ? '添加一个文件夹，开始项目对话。' : '在电脑上添加项目后，可在这里开始对话。')));
        for (const project of projects) {
            const sessions = core.projectConversations(project.projectId);
            if (query && !project.name.toLocaleLowerCase().includes(query) && !sessions.some(session => (session.title || '新对话').toLocaleLowerCase().includes(query))) continue;
            projectMatches++;
            const row = ui.element('li', 'sidebar-project'); row.dataset.projectId = project.projectId;
            const title = ui.element('div', 'sidebar-project-heading');
            const toggle = ui.element('button', 'sidebar-project-toggle'); toggle.type = 'button'; toggle.setAttribute('aria-expanded', String(!collapsedProjects.has(project.projectId))); toggle.append(WeftIcons.create(collapsedProjects.has(project.projectId) ? 'folder' : 'folder-open', 16), ui.element('span', '', project.name));
            toggle.onclick = () => { collapsedProjects.has(project.projectId) ? collapsedProjects.delete(project.projectId) : collapsedProjects.add(project.projectId); renderSessions(); };
            const add = ui.element('button', 'project-action'); add.type = 'button'; add.setAttribute('aria-label', `在项目 ${project.name} 新建对话`); add.append(WeftIcons.create('plus', 16)); add.disabled = !core.state.models.length; add.onclick = () => newProjectConversation(project, add); title.append(toggle); if (collapsedProjects.has(project.projectId)) { title.dataset.statusKey = `project:${project.projectId}`; appendStatus(title, core.sidebarStatus('projects',project.projectId,sessions)); } title.append(add);
            const projectMenu = trigger => WeftPopover.openMenu(trigger, [
                {name:'新建项目对话',icon:'compose',disabled:!core.state.models.length,action:()=>newProjectConversation(project, add)},
                ...(canManageProjectFolders() ? [{name:'项目设置',icon:'settings',action:()=>editProject(project)},
                    {name:'移除项目',icon:'trash',danger:true,action:()=>confirmRemoveProject(project)}] : [])
            ], {label:'项目操作'});
            let projectPress, projectPressed = false;
            toggle.addEventListener('pointerdown', event => { if (event.pointerType === 'touch') { projectPressed = false; projectPress = setTimeout(() => { projectPressed = true; projectMenu(toggle); }, 500); } });
            for (const event of ['pointerup','pointercancel','pointermove']) toggle.addEventListener(event, () => clearTimeout(projectPress));
            toggle.addEventListener('click', event => { if (projectPressed) { event.preventDefault(); event.stopImmediatePropagation(); projectPressed = false; } }, true);
            toggle.oncontextmenu = event => { event.preventDefault(); projectMenu(toggle); };
            toggle.addEventListener('keydown', event => { if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); projectMenu(toggle); } });
            if (canManageProjectFolders()) { const settings = ui.element('button', 'project-action'); settings.type = 'button'; settings.setAttribute('aria-label', `项目菜单 ${project.name}`); settings.setAttribute('aria-haspopup', 'menu'); settings.append(WeftIcons.create('more', 16)); settings.onclick = () => projectMenu(settings); title.insertBefore(settings, add); }
            row.append(title);
            if (!collapsedProjects.has(project.projectId) || query) {
                const children = ui.element('ul', 'project-conversations');
                for (const session of query || core.projectExpanded(project.projectId) ? sessions : sessions.slice(0, 5)) {
                    if (query && !project.name.toLocaleLowerCase().includes(query) && !(session.title || '新对话').toLocaleLowerCase().includes(query)) continue;
                    const child = ui.element('li', 'session-row' + (session.unread ? ' is-unread' : '')); child.dataset.sessionId = session.sessionId;
                    const button = ui.element('button', core.state.selectedSessionId === session.sessionId ? 'is-current' : ''); button.type = 'button'; button.append(ui.element('span', 'session-title', session.title || '新对话'));
                    button.onclick = () => core.selectSession(session.sessionId);
                    const more = ui.element('button', 'session-more'); more.type = 'button'; more.setAttribute('aria-label', `更多操作 ${session.title || '新对话'}`); more.append(WeftIcons.create('more', 16)); more.onclick = () => sessionMenu(session, more); button.oncontextmenu = event => { event.preventDefault(); sessionMenu(session, button); }; child.append(button); appendStatus(child, session); child.append(more); bindRowActions(child, session, more); children.append(child);
                }
                if (!query && sessions.length > 5) {
                    const expanded = core.projectExpanded(project.projectId), item = ui.element('li');
                    const more = ui.element('button', 'project-expand', expanded ? '收起对话' : `展开显示（${sessions.length - 5}）`);
                    more.dataset.projectExpand = project.projectId;
                    more.type = 'button'; more.setAttribute('aria-label', `${more.textContent} ${project.name}`); more.setAttribute('aria-expanded', String(expanded));
                    more.onclick = () => { core.setProjectExpanded(project.projectId, !expanded); renderSessions();
                        [...list.querySelectorAll('.project-expand')].find(button => button.dataset.projectExpand === project.projectId)?.focus(); };
                    item.append(more); children.append(item);
                }
                if (!sessions.length) { const empty = ui.element('li', 'project-empty'); const button = ui.element('button', '', '新建项目对话'); button.type = 'button'; button.onclick = () => newProjectConversation(project, button); empty.append(button); children.append(empty); }
                row.append(children);
            }
            list.append(row);
        }
        return projectMatches;
    }
    function closeMenu() { activeSubmenu?.remove(); activeSubmenu=null; if (activeMenu) { activeMenu.remove(); activeMenu = null; } }
    function editName(title, initial, save) {
        const dialog = ui.element('dialog', 'dialog confirm-dialog'); dialog.setAttribute('aria-label', title);
        const form = ui.element('form', 'dialog-body'); form.append(ui.element('h2', '', title));
        const input = ui.element('input'); input.value = initial; input.required = true; input.maxLength = 256; input.setAttribute('aria-label', title);
        const error = ui.element('p', 'form-error'); error.setAttribute('role','alert');
        const submit = ui.element('button','button primary','保存'); submit.type = 'submit';
        const cancel = ui.element('button','button secondary','取消'); cancel.type = 'button'; cancel.onclick = () => dialog.close();
        form.append(input,error,submit,cancel); dialog.append(form);
        form.onsubmit = async event => { event.preventDefault(); submit.disabled = true; try { await save(input.value); dialog.close(); } catch(cause) { error.textContent = core.failureMessage(cause); } finally { submit.disabled = false; } };
        dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal(); input.focus(); input.select();
    }
    function manageGroups(){
        const dialog=ui.element('dialog','dialog confirm-dialog');dialog.setAttribute('aria-label','管理分组');const body=ui.element('div','dialog-body');body.append(ui.element('h2','','管理分组'));
        const notice=ui.element('p','form-error');notice.setAttribute('role','alert');
        for(const group of core.state.sessionGroups||[]){const row=ui.element('div','archived-session-row');row.append(ui.element('span','',group.name));
            const rename=ui.element('button','button secondary','重命名');rename.setAttribute('aria-label',`重命名分组 ${group.name}`);rename.onclick=()=>{dialog.close();editName('重命名分组',group.name,name=>core.sessionGroupAction('PATCH',group.id,name));};
            const remove=ui.element('button','button danger','删除');remove.setAttribute('aria-label',`删除分组 ${group.name}`);remove.onclick=async()=>{remove.disabled=true;try{await core.sessionGroupAction('DELETE',group.id);await core.refreshSessions();row.remove();}catch(error){notice.textContent=core.failureMessage(error);remove.disabled=false;}};row.append(rename,remove);body.append(row);
        }
        const close=ui.element('button','button secondary','关闭');close.onclick=()=>dialog.close();body.append(notice,close);dialog.append(body);dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();
    }
    function renameInline(session) {
        const row = [...ui.byId('session-list').querySelectorAll('.session-row')].find(item => item.dataset.sessionId === session.sessionId);
        if (!row) return;
        const button = row.firstElementChild, input = ui.element('input','session-rename'); input.value = session.title || '新对话'; input.maxLength = 256; input.setAttribute('aria-label','重命名对话');
        button.hidden = true; row.prepend(input); input.focus(); input.select();
        const cancel = () => { input.remove(); button.hidden = false; button.focus(); };
        input.onkeydown = async event => { if(event.key === 'Escape'){event.preventDefault();cancel();}
            if(event.key === 'Enter'){event.preventDefault();input.disabled = true;try{await core.updateSession(session.sessionId,{title:input.value});if(core.state.selectedSessionId===session.sessionId)paintSelectedSession(session.sessionId);}catch(error){input.disabled=false;input.setCustomValidity(core.failureMessage(error));input.reportValidity();input.focus();}} };
        input.oninput = () => input.setCustomValidity('');
    }
    function sessionMenu(session, trigger, groupsOnly = false) {
        closeHoverCard();
        if(groupsOnly){activeSubmenu?.remove();}else closeMenu();
        const menu = ui.element('div', 'session-menu'); if(groupsOnly)activeSubmenu=menu;else activeMenu = menu; menu.setAttribute('role','menu'); menu.setAttribute('aria-label',groupsOnly === 'retention' ? '自动删除期限' : groupsOnly === 'project' ? '移至项目' : groupsOnly?'移至分组':'对话操作');
        const notice = ui.element('p','form-error'); notice.setAttribute('role','alert');
        const action = (label, run, options = {}) => {
            if(options.separator){const line=ui.element('div','session-menu-separator');line.setAttribute('role','separator');menu.append(line);}
            const button = ui.element('button', options.danger?'session-menu-item danger':'session-menu-item'); button.type='button';button.setAttribute('role',options.role || 'menuitem');
            button.append(ui.element('span','',label));
            if (options.checked !== undefined) { button.setAttribute('aria-checked', String(options.checked)); const icon=options.role==='menuitemradio'?ui.element('span','session-menu-radio'):globalThis.WeftIcons.create('allow',16);icon.setAttribute('aria-hidden','true'); icon.classList.add('session-menu-check');if(options.role!=='menuitemradio')icon.style.visibility=options.checked?'visible':'hidden';button.append(icon); }
            if(options.key)button.append(ui.element('span','session-menu-key',options.key));
            if(options.submenu){button.setAttribute('aria-haspopup','menu');button.addEventListener('keydown',event=>{if(event.key==='ArrowRight'){event.preventDefault();button.click();}});const icon=globalThis.WeftIcons.create('chevron',16);icon.classList.add('session-submenu-icon');button.append(icon);}
            button.onclick=async()=>{button.disabled=true;try{await run();}catch(error){notice.textContent=core.sessionLifecycleMessage(error);menu.append(notice);}finally{button.disabled=false;}};
            menu.append(button); return button;
        };
        if(groupsOnly === 'retention') {
            for (const days of [1,7,30,null]) action(days===null?'不自动删除':`${days} 天后自动删除`,async()=>{await core.updateSession(session.sessionId,{autoDeleteDays:days});closeMenu();paintSelectedSession(core.state.selectedSessionId);},{role:'menuitemradio',checked:(session.autoDeleteDays ?? (session.autoDeleteDays === null ? null : 30)) === days});
        } else if(groupsOnly === 'project') {
            for (const project of core.state.projects.filter(project => !project.revoked)) action(project.name, async () => { await core.updateSession(session.sessionId, { projectId: project.projectId }); closeMenu(); await core.refreshSessions(); if (core.state.selectedSessionId === session.sessionId) paintSelectedSession(session.sessionId); },{role:'menuitemradio',checked:session.projectId===project.projectId});
            action('移出项目', async () => { await core.updateSession(session.sessionId, { projectId: null }); closeMenu(); await core.refreshSessions(); },{role:'menuitemradio',checked:!session.projectId});
        } else if(groupsOnly){
            for(const group of core.state.sessionGroups || []) action(group.name,async()=>{await core.updateSession(session.sessionId,{groupId:group.id});closeMenu();},{role:'menuitemradio',checked:session.groupId===group.id});
            action('新建分组…',()=>{closeMenu();editName('新建分组','',async name=>{const result=await core.sessionGroupAction('POST',null,name);if(result)await core.updateSession(session.sessionId,{groupId:result.group.id});});},{separator:true});
            action('移出分组',async()=>{await core.updateSession(session.sessionId,{groupId:null});closeMenu();},{role:'menuitemradio',checked:!session.groupId});
            action('管理分组',()=>{closeMenu();manageGroups();});
        }else{
            const runs={project:()=>sessionMenu(session,menu.querySelector('[data-project-menu]'),'project'),pin:async()=>{await core.updateSession(session.sessionId,{pinned:!session.pinned});closeMenu();},unread:async()=>{await core.updateSession(session.sessionId,{unread:!session.unread});closeMenu();},
                rename:()=>{closeMenu();renameInline(session);},fork:async()=>{const child=await core.forkSession(session.sessionId);closeMenu();if(!child)return;await core.refreshSessions();await core.selectSession(child.sessionId);},
                group:()=>sessionMenu(session,menu.querySelector('[data-group-menu]'),true),archive:async()=>{if(session.archived)await core.archiveSession(session.sessionId,false);else await archiveWithUndo(session);closeMenu();},delete:()=>{closeMenu();confirmDelete(session);}};
            if (session.kind === 'main') action('这次别记：开临时对话', () => { closeMenu(); core.startNewConversation(false, true); });
            else {
                const toggle = action('此对话不形成记忆', async () => { await core.updateSession(session.sessionId, {memoryMode: session.memoryMode === 'off' ? 'on' : 'off'}); closeMenu(); paintSelectedSession(core.state.selectedSessionId); ui.toast('从下一回合生效。之前形成的记忆保留，可去记忆页遗忘。'); });
                toggle.setAttribute('role', 'menuitemcheckbox'); toggle.setAttribute('aria-checked', String(session.memoryMode === 'off'));
                const toggleCheck=WeftIcons.create('allow',16);toggleCheck.classList.add('session-menu-check');toggleCheck.style.visibility=session.memoryMode==='off'?'visible':'hidden';toggle.append(toggleCheck);
                const recall = action('使用已有记忆', async () => { await core.updateSession(session.sessionId, {recallEnabled: session.recallEnabled === false}); closeMenu(); });
                recall.setAttribute('role', 'menuitemcheckbox'); recall.setAttribute('aria-checked', String(session.recallEnabled !== false));
                const recallCheck=WeftIcons.create('allow',16);recallCheck.classList.add('session-menu-check');recallCheck.style.visibility=session.recallEnabled!==false?'visible':'hidden';recall.append(recallCheck);
                if (session.memoryMode === 'off') { const retention=action(`自动删除：${session.autoDeleteDays === null ? '不自动删除' : (session.autoDeleteDays ?? 30)+' 天'}`,()=>sessionMenu(session,retention,'retention'),{submenu:true}); }
            }
            const buttons = new Map();
            for(const item of globalThis.WeftUiCore.sessionMenuItems(session)){ const button = action(item.label,runs[item.id],{...item,...(['pin','unread'].includes(item.id)?{role:'menuitemcheckbox',checked:!!session[item.id==='pin'?'pinned':'unread']}:{})}); if (item.id === 'project') button.dataset.projectMenu = ''; if (item.id === 'group') button.dataset.groupMenu = ''; buttons.set(item.id,button); }
            menu.onkeydown = event => {
                if(event.ctrlKey || event.altKey || event.metaKey)return;
                const id=globalThis.WeftUiCore.sessionMenuKey(event.key);if(id){event.preventDefault();buttons.get(id)?.click();}
            };
        }
        menu.addEventListener('keydown', event=>{
            const buttons=[...menu.querySelectorAll('[role=menuitem], [role=menuitemcheckbox], [role=menuitemradio]')];let index=buttons.indexOf(document.activeElement);
            if(event.key==='Escape'||groupsOnly&&event.key==='ArrowLeft'){event.preventDefault();if(groupsOnly){activeSubmenu?.remove();activeSubmenu=null;}else closeMenu();trigger.focus?.();}
            else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[index]?.focus();}
        });
        document.body.append(menu);
        const anchor=groupsOnly?{getBoundingClientRect:()=>{const rect=trigger.getBoundingClientRect();return {left:rect.right+8,right:rect.right+8,top:rect.top-8,bottom:rect.top-8};}}:trigger;
        globalThis.WeftPopover.position(menu,anchor,{side:'bottom'});menu.querySelector('button')?.focus();
    }
    document.addEventListener('pointerdown',event=>{if(activeMenu&&!activeMenu.contains(event.target)&&!activeSubmenu?.contains(event.target))closeMenu();});
    function confirmDelete(session) {
        const dialog = ui.element('dialog', 'dialog confirm-dialog'); dialog.setAttribute('aria-label', '删除对话');
        const body = ui.element('div', 'dialog-body'); body.append(ui.element('h2', '', '删除对话？'),
            ui.element('p', '', session.projectId ? '这会永久删除对话与执行记录，项目文件夹里的文件不会删除。运行中的对话会先停止。' : '这会永久删除对话、工作目录与经验，无法恢复。运行中的对话会先停止。'));
        const label = ui.element('label'); const forget = ui.element('input'); forget.type = 'checkbox';
        label.append(forget, document.createTextNode('同时忘掉从这段对话形成的记忆')); body.append(label);
        const snippetsLabel = ui.element('label'), snippets = ui.element('input'); snippets.type = 'checkbox';
        snippetsLabel.append(snippets, document.createTextNode('同时删除对话里含这句话的原话')); snippetsLabel.hidden = true;
        const summary = ui.element('p'); summary.setAttribute('role', 'status'); body.append(summary, snippetsLabel);
        let preview = null, previewGeneration = 0;
        const error = ui.element('p', 'form-error'); error.setAttribute('role', 'alert'); body.append(error);
        const footer = ui.element('div', 'dialog-footer');
        const cancel = ui.element('button', 'button secondary', '取消'); cancel.type = 'button'; cancel.addEventListener('click', () => dialog.close());
        const remove = ui.element('button', 'button danger', '永久删除'); remove.type = 'button';
        forget.addEventListener('change', async () => {
            const generation = ++previewGeneration; preview = null; snippets.checked = false;
            snippetsLabel.hidden = !forget.checked; summary.textContent = ''; error.textContent = '';
            remove.disabled = forget.checked;
            if (!forget.checked) return;
            summary.textContent = '正在读取遗忘范围…';
            try {
                const result = await core.previewSessionForget(session.sessionId);
                if (generation !== previewGeneration || !dialog.open) return;
                preview = result; summary.textContent = `将一起忘掉 ${result.itemCount} 项记忆，清除 ${result.evidenceCount} 条来源。勾选删除原话也会清除其他对话里的对应片段。`;
                remove.disabled = false;
            } catch (cause) {
                if (generation !== previewGeneration || !dialog.open) return;
                summary.textContent = ''; error.textContent = '无法读取遗忘范围，请取消勾选或重新打开确认框。';
            }
        });
        remove.addEventListener('click', async () => {
            remove.disabled = true; error.textContent = '';
            if (forget.checked && !preview) return;
            try { await core.deleteSession(session.sessionId, forget.checked, { deleteConversationSnippets: snippets.checked, worldRevision: preview?.worldRevision }); dialog.close(); }
            catch (cause) { error.textContent = core.sessionLifecycleMessage(cause); }
            finally { remove.disabled = forget.checked && !preview; }
        });
        footer.append(cancel, remove); dialog.append(body, footer); dialog.addEventListener('close', () => dialog.remove());
        document.body.append(dialog); dialog.showModal(); cancel.focus();
    }
    function paintSelectedSession(sessionId) {
        ui.byId('chat-intro').hidden = false;
        ui.byId('desktop-action').hidden = true;
        const selected = core.state.sessions.find((item) => item.sessionId === sessionId);
        ui.byId('assistant-title').textContent = selected?.title || '新对话';
        const temporary = selected?.memoryMode === 'off' || !selected && core.state.newConversationTemporary;
        let memoryNotice = ui.byId('temporary-chat-notice');
        if (!memoryNotice) { memoryNotice = ui.element('p', 'muted temporary-chat-notice'); memoryNotice.id = 'temporary-chat-notice'; memoryNotice.setAttribute('role', 'status'); ui.byId('assistant-title').parentElement.append(memoryNotice); }
        memoryNotice.textContent = temporary ? `临时对话 · 不会形成记忆，${selected?.autoDeleteDays === null ? '不自动删除' : (selected?.expiresAt ? Math.max(0, Math.ceil((Date.parse(selected.expiresAt) - Date.now()) / 86400000)) : selected?.autoDeleteDays ?? 30) + ' 天后自动删除'}` : '';
        memoryNotice.hidden = !temporary;
        let hint = ui.byId('temporary-composer-hint');
        if (!hint) { hint = ui.element('p', 'muted temporary-composer-hint'); hint.id = 'temporary-composer-hint'; ui.byId('message-form').prepend(hint); }
        hint.textContent = temporary ? '这次聊的内容不会形成记忆，也不会出现在其他对话。' : '';
        hint.hidden = !temporary;
        let notice = ui.byId('project-conversation-notice');
        if (!notice) { notice = ui.element('p', 'project-conversation-notice'); notice.id = 'project-conversation-notice'; notice.setAttribute('role', 'status'); ui.byId('transcript').before(notice); }
        notice.textContent = selected?.projectNotice || (selected?.projectName ? `项目：${selected.projectName}` : ''); notice.hidden = !notice.textContent;
        globalThis.WeftMotion?.changed(ui.byId('chat-scroll'), sessionId, 'base');
    }
    function renderSessions() {
        archivedRedraw?.();
        const signature = JSON.stringify([core.state.ownerId, core.state.identityGeneration, core.state.selectedSessionId,
            core.state.activeChatSource, core.state.selectedPhoneConversationId, core.state.models.length,
            core.state.projectCanManage, core.state.projectsError, core.state.sessions, core.state.projects,
            core.state.sessionGroups, core.state.sessionStatusSummary, core.phoneConversations(), '',
            [...collapsedGroups], [...collapsedProjects], (core.state.projects || []).map(p => core.projectExpanded(p.projectId))]);
        // Live updates often repaint the same sidebar. Keep its hovered / focused
        // rows mounted so the half-second detail timer and keyboard path survive.
        if (signature === sidebarSignature && ui.byId('session-list').children.length) return;
        sidebarSignature = signature;
        const focused = document.activeElement, focusRow = focused?.closest?.('.session-row');
        const focusId = focusRow?.dataset.sessionId, focusAction = focused?.dataset.quickAction;
        const focusMore = focused?.className?.split(' ').includes('session-more');
        closeHoverCard();
        const list = ui.byId('session-list');
        list.replaceChildren();
        const phone = core.phoneConversations().filter(record => !core.state.sessions.find(session =>
            session.sessionId === core.phoneBinding(record.id)?.sessionId)?.projectId);
        const linkedSessionIds = new Set(phone.map((record) => core.phoneBinding(record.id)?.sessionId).filter(Boolean));

        ui.byId('sessions-status').textContent = '';
        const query = ('' || '').normalize('NFKC').trim().toLocaleLowerCase();
        let currentGroup = null, matches = 0;
        const sessions = core.sessionList().filter(session => !session.projectId);
        for (const session of globalThis.WeftUiCore.sortSessions(sessions).sort(globalThis.WeftUiCore.compareSessionGroups)) {
            if (!core.sessionIdPattern.test(session.sessionId) || linkedSessionIds.has(session.sessionId))
                continue;
            const title = typeof session.title === 'string' && session.title ? session.title : '新对话';
            if (query && !title.normalize('NFKC').toLocaleLowerCase().includes(query))
                continue;
            const group = session.pinned ? '置顶' : (core.state.sessionGroups || []).find(item => item.id === session.groupId)?.name || '未分组';
            const groupId = session.pinned ? 'pinned' : session.groupId || 'ungrouped';
            if (groupId !== currentGroup) {
                const heading = ui.element('li','session-group');const toggle=ui.element('button','session-group-toggle',group);toggle.type='button';toggle.setAttribute('aria-expanded',String(!collapsedGroups.has(groupId)));
                toggle.onclick=()=>{collapsedGroups.has(groupId)?collapsedGroups.delete(groupId):collapsedGroups.add(groupId);renderSessions();};heading.append(toggle);
                if (collapsedGroups.has(groupId)) { heading.dataset.statusKey = `group:${groupId}`; appendStatus(heading, core.sidebarStatus('groups',groupId,sessions.filter(row => (row.pinned ? 'pinned' : row.groupId || 'ungrouped') === groupId))); }
                if(!['pinned','ungrouped'].includes(groupId)) {
                    const manage=ui.element('button','session-group-manage');manage.type='button';manage.setAttribute('aria-label',`管理分组 ${group}`);manage.append(globalThis.WeftIcons.create('more',16));
                    manage.onclick=()=>{editName('重命名分组',group,name=>core.sessionGroupAction('PATCH',groupId,name));};
                    const remove=ui.element('button','session-group-manage');remove.type='button';remove.setAttribute('aria-label',`删除分组 ${group}`);remove.append(globalThis.WeftIcons.create('trash',16));remove.onclick=()=>{void core.sessionGroupAction('DELETE',groupId).then(()=>core.refreshSessions()).catch(error=>{ui.byId('sessions-status').textContent=core.failureMessage(error);});};heading.append(manage,remove);
                }
                list.append(heading);currentGroup=groupId;
            }
            if(collapsedGroups.has(groupId) && !query) continue;
            matches++;
            const row = ui.element('li');
            const button = ui.element('button', core.state.activeChatSource === 'desktop' &&
                session.sessionId === core.state.selectedSessionId ? 'is-current' : '');
            button.type = 'button';
            const label = ui.element('span', 'session-title');
            label.append(ui.element('span', 'session-title-text', title));
            button.append(label);
            button.addEventListener('click', () => { void core.selectSession(session.sessionId); });
            row.append(button);
            appendStatus(row, session);
            row.className = 'session-row' + (session.unread ? ' is-unread' : ''); row.dataset.sessionId = session.sessionId;
            const more = ui.element('button', 'session-more'); more.append(globalThis.WeftIcons.create('more',16)); more.type = 'button'; more.setAttribute('aria-haspopup','menu'); more.setAttribute('aria-label', `更多操作 ${title}`);
            more.addEventListener('click', () => sessionMenu(session, more)); row.append(more); bindRowActions(row, session, more);
            button.addEventListener('contextmenu', event => { event.preventDefault(); sessionMenu(session, button); });
            if (session.archived) button.setAttribute('aria-label', `${title}，已归档`);
            list.append(row);
        }
        for (const record of phone) {
            if (query && !core.phoneDisplayTitle(record).normalize('NFKC').toLocaleLowerCase().includes(query))
                continue;
            matches++;
            const row = ui.element('li');
            const button = ui.element('button', core.state.activeChatSource === 'phone' &&
                record.id === core.state.selectedPhoneConversationId ? 'is-current' : '');
            button.type = 'button';
            button.append(ui.element('span', 'session-title', core.phoneDisplayTitle(record)));
            const native = core.state.sessions.find(session=>session.sessionId===core.phoneBinding(record.id)?.sessionId);
            row.className = 'session-row'; if(native) { row.dataset.sessionId=native.sessionId; }
            button.addEventListener('click', () => { core.selectPhoneConversation(record.id); });
            row.append(button); appendStatus(row, native ?? record);
            list.append(row);
        }
        if (core.state.sessionListNextCursor || core.state.sessionListCursor) {
            const row = ui.element('li'), more = ui.element('button','',core.state.sessionListNextCursor ? '更早的对话' : '最近对话');
            more.type='button';more.onclick=()=>core.pageSessions(!!core.state.sessionListNextCursor).catch(error=>ui.byId('sessions-status').textContent=core.failureMessage(error));row.append(more);list.append(row);
        }
        const projectMatches = renderSidebarProjects(list, query);
        if (focusId) {
            const replacement = [...list.querySelectorAll('.session-row')].find(row => row.dataset.sessionId === focusId);
            (focusAction ? replacement?.querySelector(`[data-quick-action="${focusAction}"]`) : focusMore ? replacement?.querySelector('.session-more') : replacement?.children[0])?.focus({preventScroll:true});
        }
        ui.byId('sessions-status').textContent = matches || projectMatches ? '' : query ? '没有找到会话。' : '还没有普通对话。';
        if (matches <= 20) globalThis.WeftMotion?.changed(list, JSON.stringify([query, sessions.map(row => row.sessionId)]), 'fast');
        else globalThis.WeftMotion?.cancel(list);
    }
    function mountSessions() {

        ui.byId('load-older').addEventListener('click', () => { void core.loadOlderHistory(); });
        const create=ui.byId('new-session'),temporary=ui.byId('new-temporary-session'),group=ui.element('div','rail-new-group');create.before(group);group.append(create);
        const toggle=ui.element('button','rail-new-dropdown');toggle.type='button';toggle.setAttribute('aria-label','选择新对话类型');toggle.setAttribute('aria-haspopup','menu');toggle.setAttribute('aria-expanded','false');toggle.append(WeftIcons.create('chevron',16));group.append(toggle);
        const menu=ui.element('div','session-menu rail-new-menu');menu.setAttribute('role','menu');menu.setAttribute('aria-label','新对话类型');menu.hidden=true;
        const normal=ui.element('button','session-menu-item','新旁聊');normal.type='button';normal.setAttribute('role','menuitem');normal.prepend(WeftIcons.create('compose',16));temporary.className='session-menu-item';temporary.setAttribute('role','menuitem');temporary.prepend(WeftIcons.create('clock',16));menu.append(normal,temporary);group.append(menu);
        const close=()=>{menu.hidden=true;toggle.setAttribute('aria-expanded','false')};normal.onclick=()=>{close();create.click()};temporary.addEventListener('click',close);
        toggle.onclick=()=>{menu.hidden=!menu.hidden;toggle.setAttribute('aria-expanded',String(!menu.hidden));if(!menu.hidden){WeftPopover.position(menu,toggle,{side:'bottom'});normal.focus()}};
        menu.onkeydown=event=>{if(event.key==='Escape'){event.stopPropagation();close();toggle.focus()}if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();(document.activeElement===normal?temporary:normal).focus()}};
        document.addEventListener('pointerdown',event=>{if(!group.contains(event.target))close()});
    }
    function showSettingsArchived(target) {
        const search=ui.element('input','settings-search');search.type='search';search.setAttribute('aria-label','搜索已归档对话');search.placeholder='搜索已归档对话';
        const list=ui.element('div','archived-session-list'),notice=ui.element('p','muted');notice.setAttribute('role','status');target.replaceChildren(search,list,notice);
        const draw=()=>{list.replaceChildren();for(const session of core.sessionList(true).filter(item=>(item.title||'').toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()))){
            const row=ui.element('div','archived-session-row');row.append(ui.element('span','',session.title||'新对话'));
            const restore=ui.element('button','button secondary','恢复');restore.type='button';restore.onclick=async()=>{restore.disabled=true;try{await core.archiveSession(session.sessionId,false);draw();}catch(error){notice.textContent=core.failureMessage(error);restore.disabled=false;}};
            const remove=ui.element('button','button danger','删除');remove.type='button';remove.onclick=()=>confirmDelete(session);row.append(restore,remove);list.append(row);}
            notice.textContent=list.children.length?'':'没有已归档对话。';};search.oninput=draw;
        void core.refreshSessions().then(draw).catch(error=>{notice.textContent=core.failureMessage(error);});
        archivedRedraw=draw;
    }
    let archivedRedraw;
    return { appendSessionStatus: appendStatus, canManageProjectFolders, editProject, paintSelectedSession, renderSessions, mountSessions, showSettingsArchived };
};
