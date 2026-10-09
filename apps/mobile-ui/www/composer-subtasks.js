/* Shared desktop/phone presentation. Actions open the original timeline step. */
globalThis.WeftComposerSubtasks = {
    paint(container, rows, {scope,root}) {
        if (!container) return;
        const changed = container.dataset.scope !== scope;
        container.dataset.scope = scope;
        container.hidden = !rows.length;
        if (!rows.length || changed) { container.replaceChildren(); if (!rows.length) return; }
        let trigger = container.querySelector('.subtasks-trigger'), menu = container.querySelector('.subtasks-popover');
        if (!trigger) {
            trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'subtasks-trigger';
            trigger.setAttribute('aria-expanded','false'); trigger.setAttribute('aria-haspopup','dialog');
            menu = document.createElement('div'); menu.className = 'subtasks-popover'; menu.hidden = true;
            menu.setAttribute('role','dialog'); menu.setAttribute('aria-label','当前回合子任务');
            const close = focus => {menu.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();};
            trigger.onclick = () => { menu.hidden = !menu.hidden;trigger.setAttribute('aria-expanded',String(!menu.hidden));
                if(!menu.hidden){globalThis.WeftPopover.position(menu,trigger);menu.querySelector('button')?.focus();} };
            menu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}});
            container.onfocusout = event => {if(!container.contains(event.relatedTarget))close(false);};
            container.append(trigger,menu);
        }
        trigger.textContent = `${rows.length} 个子任务`; trigger.setAttribute('aria-label',`${rows.length} 个子任务`);
        const signature = JSON.stringify(rows); if (menu.dataset.signature === signature) return;
        const focused = document.activeElement?.dataset.subtask;
        menu.dataset.signature = signature;
        const existing = new Map([...menu.children].map(button=>[button.dataset.subtask,button]));
        for(const button of existing.values())if(!rows.some(row=>row.key===button.dataset.subtask))button.remove();
        for (const row of rows) {
            const button = existing.get(row.key) || document.createElement('button'); button.type = 'button'; button.dataset.subtask = row.key;
            const name = document.createElement('strong'); name.textContent = row.name;
            const status = document.createElement('span'); status.textContent = `${row.status} · ${row.duration}`;
            button.className = row.state === 'failed' ? 'is-failed' : ''; button.replaceChildren(name,status);
            button.setAttribute('aria-label',`${row.name}，${row.status}，${row.duration}，查看步骤`);
            button.onclick = () => {
                menu.hidden=true;trigger.setAttribute('aria-expanded','false');
                const step = [...root.querySelectorAll('.execution-step')].find(detail => detail.dataset.step === String(row.stepId));
                if (step) {for(let ancestor=step.parentElement;ancestor&&ancestor!==root;ancestor=ancestor.parentElement)if(ancestor.tagName==='DETAILS')ancestor.open=true;
                    step.open=true;const summary=step.querySelector('summary');summary?.focus();summary?.scrollIntoView({block:'center'});}
            };
            if(!button.parentNode)menu.append(button); if(focused===row.key)button.focus({preventScroll:true});
        }
        if(!menu.hidden)globalThis.WeftPopover.position(menu,trigger);
    }
};
