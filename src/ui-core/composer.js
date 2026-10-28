/* Shared composer state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.composer = (core, effects, environment) => {
    const messages = new Map();
    // Presentation identities live for this identity generation. Consuming an
    // optimistic echo never consumes the message's process or its aliases.
    const presentationAliases = new Map(), presentationTurns = new Map();
    let presentationRows = new WeakMap(), presentationOrder = 0;
    let turnRequestScope;
    function requestScope() {
        const scope = `${core.state.ownerId}:${core.state.identityGeneration}`;
        if (scope !== turnRequestScope) { presentationAliases.clear(); presentationTurns.clear(); presentationRows=new WeakMap();presentationOrder=0;turnRequestScope=scope; }
    }
    const presentationScope = row => row?.chatId ? `chat:${row.chatId}` : core.state.selectedChatId && (!row?.sessionId || row.sessionId===core.state.selectedSessionId)
        ? `chat:${core.state.selectedChatId}` : `session:${row?.sessionId || core.state.selectedSessionId || core.state.newConversationId}`;
    const eventSession = event => event.sessionId || event.sourceRef?.sessionId || core.state.selectedSessionId || '';
    const canonicalEntry = entry => entry?.mergedInto ? canonicalEntry(entry.mergedInto) : entry;
    function mergeMessageEntries(left, right) {
        left=canonicalEntry(left);right=canonicalEntry(right);
        if(left===right)return left;
        const [keep,other]=left.order<right.order ? [left,right] : [right,left];
        for(const [key,value] of Object.entries(other)) if(keep[key]===undefined)keep[key]=value;
        for(const turn of other.turns)keep.turns.add(turn);
        other.mergedInto=keep;
        for(const [key,entry] of presentationAliases)if(entry===other)presentationAliases.set(key,keep);
        for(const owners of presentationTurns.values())if(owners.delete(other))owners.add(keep);
        return keep;
    }
    function messageEntry(fields, event, conversation = presentationScope(fields)) {
        requestScope();
        const session = event ? eventSession(event) : fields.sessionId || '';
        const source = event && (event.presentationKey || event.eventId || `${session}:${event.sourceRef?.seq ?? event.seq}`);
        const aliases = [fields.requestId && `request:${fields.requestId}`, fields.receiptId && `receipt:${session}:${fields.receiptId}`,
            fields.commandId && `command:${fields.commandId}`, source && `event:${source}`].filter(Boolean).map(key => `${conversation}|${key}`);
        const matches=[...new Set(aliases.map(key=>canonicalEntry(presentationAliases.get(key))).filter(Boolean))];
        const entry = matches.length ? matches.reduce(mergeMessageEntries) : {
            key: fields.requestId ? `request:${fields.requestId}` : fields.receiptId ? `legacy:${session}:receipt:${fields.receiptId}` : `legacy:${source}`,
            conversation, at: fields.at || event?.at, turns: new Set(),order:presentationOrder++
        };
        for (const key of aliases) presentationAliases.set(key,entry);
        for (const key of ['requestId','receiptId','commandId','sessionId']) if (fields[key]) entry[key]=fields[key];
        entry.at ||= fields.at || event?.at;
        return entry;
    }
    function rememberTurnRequest(row) {
        requestScope();
        const previous=canonicalEntry(presentationRows.get(row));
        const conversation=presentationScope(row);
        let entry=messageEntry(row,undefined,conversation);
        if(previous)entry=mergeMessageEntries(previous,entry);
        presentationRows.set(row,entry);
        // The request alias exists from send, before a session has been created.
        // Add the receipt alias after creation/acceptance using that same entry.
        if (row.receiptId && row.sessionId) presentationAliases.set(`${conversation}|receipt:${row.sessionId}:${row.receiptId}`,entry);
        return entry;
    }
    function observeMessageProcesses(events) {
        requestScope();
        const conversation=presentationScope();
        for (const event of events) if (['task.queued','task.started','task.ended'].includes(event.type)) {
            if(event.type==='task.queued' && event.data?.inherited)continue;
            for (const data of event.data?.tasks || [event.data || {}]) {
                if (!data.requestId && !data.receiptId) continue;
                const entry=messageEntry({...data,sessionId:eventSession(event)},undefined,conversation);
                entry.at ||= event.at;
                if (typeof data.text==='string') entry.text=data.text;
                if (event.type==='task.queued') entry.queued=event;
                if (event.type==='task.ended') entry.ended=event;
                // Queued tasks can belong to a future turn. Only a native
                // started task establishes a turn owner, never queue proximity.
                if (event.type!=='task.started') continue;
                const turn=data.turn ?? /^turn-(.+)$/.exec(data.turnTaskId || '')?.[1];
                if (turn==null) continue;
                const key=`${conversation}|${eventSession(event)}:turn-${turn}`;
                if (!presentationTurns.has(key)) presentationTurns.set(key,new Set());
                const owners=presentationTurns.get(key);
                for(const owner of [...owners])if(!owner.requestId && !owner.receiptId && !owner.pending)mergeMessageEntries(owner,entry);
                const bound=canonicalEntry(entry);owners.add(bound);bound.turns.add(key);
            }
        }
        for (const event of events) if (event.type==='user.message') {
            const entry=messageEntry({...event.data,sessionId:eventSession(event)},event,conversation);
            entry.userSeen=true;entry.pending=undefined;entry.text=undefined;
        }
    }
    function messageProcesses(events, pending = []) {
        requestScope();
        // Constructor-seed queue insertions are history, never child-runtime
        // work. Keep actual user events and all executable queue facts intact.
        events=events.filter(event=>!(event.type==='task.queued' && event.data?.inherited));
        for (const row of pending) { const entry=rememberTurnRequest(row);entry.pending=row;entry.text=row.text; }
        observeMessageProcesses(events);
        const conversation=presentationScope(), entries=new Set(), assignments=new Map();
        for (const row of pending) entries.add(rememberTurnRequest(row));
        for (const event of events) if (event.type==='user.message') entries.add(messageEntry({...event.data,sessionId:eventSession(event)},event,conversation));
        for (const event of events) if (event.type==='task.queued') for (const data of event.data?.tasks || [event.data || {}]) {
            if ((data.requestId || data.receiptId) && typeof data.text==='string') {
                const entry=messageEntry({...data,sessionId:eventSession(event)},undefined,conversation);
                // Native inbox queued can carry only a receipt. Keep that fact
                // until task.started identifies it; don't guess by text/order
                // or display a second copy of a locally submitted message.
                if(!entry.requestId && !entry.userSeen && pending.some(row=>!row.receiptId && (!row.sessionId || row.sessionId===eventSession(event))))continue;
                entries.add(entry);
            }
        }
        const projected=globalThis.WeftUiCore.projectTimeline(events,[],true);
        for (const block of projected.groups) {
            const session=block.sessionId || block.steps[0]?.sessionId || core.state.selectedSessionId || '';
            const taskId=block.taskId?.startsWith(session+':') ? block.taskId : `${session}:${block.taskId}`;
            const turnKey=`${conversation}|${taskId}`;
            let owners=presentationTurns.get(turnKey);
            const facts=globalThis.WeftUiCore.progressEvents(events,block);
            const users=facts.filter(event=>event.type==='user.message');
            // An orphan history fragment may have mounted before its user page.
            // Merge aliases into that original identity when the page arrives.
            if (owners?.size===1 && users.length===1) {
                const owner=[...owners][0];
                if(!owner.requestId && !owner.receiptId && !owner.pending)
                    mergeMessageEntries(owner,messageEntry({...users[0].data,sessionId:eventSession(users[0])},users[0],conversation));
            }
            if (!owners?.size && users.length) {
                owners=new Set(users.map(event=>messageEntry({...event.data,sessionId:eventSession(event)},event,conversation)));
                presentationTurns.set(turnKey,owners);
            }
            if (!owners?.size) {
                // A live unowned start is just a fact until task.started or the
                // user receipt identifies it. It cannot replace a sent process.
                if (pending.some(row=>!row.sessionId || row.sessionId===session) || [...entries].some(entry=>!entry.turns.size && entry.queued && entry.sessionId===session)) continue;
                const start=events.find(event=>event.seq===block.seq) || events[0];
                const entry=messageEntry({},start,conversation);
                owners=new Set([entry]);presentationTurns.set(turnKey,owners);
            }
            for (const entry of owners) {
                entries.add(entry);entry.turns.add(turnKey);
                if (!assignments.has(entry)) assignments.set(entry,[]);
                assignments.get(entry).push({block,facts});
            }
        }
        const userByEntry = new Map();
        for (const event of events) if (event.type === 'user.message') {
            const entry = canonicalEntry(messageEntry({...event.data,sessionId:eventSession(event)},event,conversation));
            if (!userByEntry.has(entry)) userByEntry.set(entry,event);
        }
        return [...new Set([...entries].map(canonicalEntry))].map(entry=>{
            const assigned=assignments.get(entry) || [], latest=assigned.at(-1);
            const user=userByEntry.get(entry);
            const local=pending.find(row=>rememberTurnRequest(row)===entry) || (!entry.userSeen && entry.pending);
            let facts=assigned.flatMap(({facts})=>facts);
            // A message owns one disclosure, even when a continuation has more
            // than one native turn. Fold its steps under one presentation turn.
            const start=facts.find(event=>event.type==='turn.started');
            const turn=latest?.block.taskId?.split('turn-').at(-1) || `pending-${entry.key}`;
            const session=latest?.block.sessionId || latest?.block.steps[0]?.sessionId || entry.sessionId || '';
            const taskId=`${session ? session+':' : ''}turn-${turn}`;
            facts=facts.filter(event=>!['turn.started','turn.ended','user.message'].includes(event.type)).map(event=>({...event,data:{...event.data,taskId}}));
            const ended=entry.ended && (!latest || String(entry.ended.data?.turn)===String(turn)) ? entry.ended : null;
            const end=latest?.facts.findLast(event=>['turn.ended','task.ended'].includes(event.type)) || ended;
            const anchor=user || entry.queued;
            const position=user?.seq ?? anchor?.seq ?? Math.max(-1,...events.map(event=>event.seq))+1+Math.max(0,pending.indexOf(local));
            const at=entry.at || user?.at || local?.at || start?.at;
            const first={...(start || {}),seq:(facts[0]?.seq ?? position)-0.1,at:start?.at || at,type:'turn.started',sourceRef:{...start?.sourceRef,sessionId:session},data:{turn,pendingRequestId:entry.requestId}};
            const last=end && {...end,seq:Math.max(first.seq,...facts.map(event=>event.seq))+0.1,type:'turn.ended',data:{...end.data,turn}};
            const unaccepted=!latest && !entry.turns.size && !entry.queued && !user && !['accepted_by_dsh','observed'].includes(local?.command?.state);
            const submission=unaccepted && (local?.status==='confirming' || local?.status==='failed' && local.command?.state==='uncertain') ? 'confirming'
                : unaccepted && ['failed','undelivered'].includes(local?.status) ? 'failed' : undefined;
            return {key:entry.key,messageKey:entry.key.startsWith('request:')?entry.key.slice(8):entry.key,requestId:entry.requestId,started:!!latest,user,pending:local || (!entry.userSeen && entry.text!==undefined ? {requestId:entry.key,text:entry.text,at,status:'accepted'} : null),at,position,
                events:[first,...(user?[user]:[]),...facts,...(last?[last]:[])],taskId,submission};
        });
    }
    function turnPresentationKey(events, block) {
        const process=messageProcesses(events).find(process=>process.taskId===block.taskId || process.events.some(event=>event.type==='turn.started' && event.data.turn===events.find(event=>event.seq===block.seq)?.data?.turn));
        if (process) return process.key;
        const start=events.find(event=>event.seq===block.seq);
        const anchor=start?.presentationKey || start?.eventId || start?.sourceRef?.seq;
        return block.pendingRequestId ? `request:${block.pendingRequestId}` : `${block.taskId}:${anchor ?? block.seq}`;
    }
    function messagePresentationKey(event) {
        if (event.type!=='user.message') return event.presentationKey || event.eventId;
        const entry=messageEntry({...event.data,sessionId:eventSession(event)},event);
        return entry.key.startsWith('request:') ? entry.key.slice(8) : entry.key;
    }
    const thinkingWrites = new Map();
    async function refreshThinkingModels() {
        const identity = core.state.identityGeneration;
        const value = await core.accessApi('/models');
        if (identity === core.state.identityGeneration) {core.state.modelsKnown=Array.isArray(value.models);core.state.models = (value.models || []).filter(row => row.configured);}
    }
    function thinkingView() {
        const session = core.state.sessions.find(row => row.sessionId === core.state.selectedSessionId);
        const model = core.state.models.find(row => row.id === (core.state.modelProfileId || session?.selectedModelProfileId || session?.modelProfileId));
        return { supported: model?.deepThinking?.supported === true,
            enabled: core.state.newConversation ? core.state.newConversationThinking === true : session?.deepThinking === true,
            busy: thinkingWrites.has(`${core.state.ownerId}/${core.state.selectedSessionId}`) };
    }
    async function setDeepThinking(enabled) {
        if (typeof enabled !== 'boolean' || !thinkingView().supported || thinkingView().busy) return;
        if (core.state.newConversation) { core.state.newConversationThinking = enabled; effects.updateAvailability(); return; }
        const context = core.conversationTaskContext(), key = `${context.ownerId}/${context.sessionId}`;
        const write = core.accessApi(`/sessions/${encodeURIComponent(context.sessionId)}/thinking`,
            { method: 'PATCH', protectedWrite: true, body: { enabled } });
        thinkingWrites.set(key, write); effects.updateAvailability();
        try {
            const saved = await write;
            if (core.conversationTaskCurrent(context)) {
                const row = core.state.sessions.find(row => row.sessionId === context.sessionId);
                if (row) row.deepThinking = saved.enabled === true;
            }
        } catch { if (core.conversationTaskCurrent(context)) effects.toast('深入思考未保存，请重试'); }
        finally { thinkingWrites.delete(key); effects.updateAvailability(); }
    }
    function beginOptimistic(fields) {
        const row = {ownerId: core.state.ownerId, identity: core.state.identityGeneration, at:new Date().toISOString(), status:'sending', ...fields};
        messages.set(row.requestId, row);
        rememberTurnRequest(row).pending=row;
        effects.renderOptimisticMessages?.();
        return row;
    }
    function optimisticMessages(legacy = false) {
        if (!legacy && core.mainOptimisticMessages) return core.mainOptimisticMessages();
        return [...messages.values()].filter(row => row.ownerId === core.state.ownerId &&
            row.identity === core.state.identityGeneration && (row.sessionId === core.state.selectedSessionId || core.state.newConversation && core.state.selectedSessionId===null && row.draftId===core.state.newConversationId) &&
            (row.sessionId !== null || row.draftId === core.state.newConversationId));
    }
    function reconcileOptimistic(command) {
        const row = messages.get(command?.requestId);
        if (!row || row.ownerId !== core.state.ownerId || row.identity !== core.state.identityGeneration) return;
        row.command = command;
        row.receiptId = command.receiptId;
        rememberTurnRequest(row);
        row.status = ['accepted_by_dsh', 'observed'].includes(command.state) ? 'accepted' :
            ['failed', 'rejected', 'blocked', 'uncertain'].includes(command.state) ? 'failed' : 'sending';
        if (row.status === 'accepted' && row.sessionId === core.state.selectedSessionId && effects.readMessageDraft() === row.text)
            effects.clearMessageDraft();
        // History can arrive before the send receipt. Consume the placeholder
        // before repainting, rather than waiting for another history request.
        observeOptimistic([...core.state.historyEvents.values()], true);
        effects.renderOptimisticMessages?.();
    }
    function observeOptimistic(events, legacy = false) {
        if (!legacy && core.observeMainOptimistic) return core.observeMainOptimistic(events);
        observeMessageProcesses(events);
        for (const event of events) if (['task.queued','task.started'].includes(event.type)) for (const data of event.data?.tasks || [event.data || {}]) {
            if(event.type==='task.queued' && event.data?.inherited)continue;
            const row = messages.get(data.requestId);
            if (row && row.ownerId === core.state.ownerId && row.identity === core.state.identityGeneration &&
                row.sessionId === (event.sessionId || event.sourceRef?.sessionId || core.state.selectedSessionId) && data.receiptId)
                {row.receiptId = data.receiptId;rememberTurnRequest(row);}
        }
        for (const event of events) if (event.type === 'user.message' && event.data?.receiptId) {
            for (const row of optimisticMessages(true)) if (row.receiptId === event.data.receiptId) {
                row.status = 'accepted';
                if (effects.readMessageDraft() === row.text) effects.clearMessageDraft();
                messages.delete(row.requestId);
            }
        }
    }
    function startNewConversation(legacy = false, temporary = false) {
        if (!legacy && !temporary && core.startChatConversation) return core.startChatConversation();
        if (temporary) core.state.selectedChatId = null;
        if (core.state.submitting || core.state.unresolvedSubmission) return;
        core.cancelSessionSelection?.();
        const fromPhone = core.state.activeChatSource === 'phone';
        if (fromPhone && core.state.selectedPhoneConversationId && !core.readPhoneOutbox())
            core.state.phoneDrafts.set(core.state.selectedPhoneConversationId, effects.readMessageDraft());
        core.cancelAttachmentUpload();
        core.state.activeChatSource = 'desktop';
        core.state.selectedPhoneConversationId = null;
        effects.paintDesktopComposer(fromPhone);
        const defaultProfile = core.state.modelSettings?.defaultModelProfileId;
        if (defaultProfile && core.state.models.some(model => model.id === defaultProfile)) {
            core.state.modelProfileId = defaultProfile; effects.paintModels();
        }
        core.state.newConversation = true;
        core.state.newConversationTemporary = temporary;
        core.state.newConversationProjectId = null;
        core.state.newConversationId = environment.crypto.randomUUID();
        core.state.newConversationApprovalMode = null;
        core.state.newConversationThinking = core.state.personalization?.defaultDeepThinking === true;
        core.state.selectedSessionId = null;
        core.state.historyGeneration++;
        core.state.historyEvents.clear(); core.state.seenSeq.clear(); core.state.afterSeq = -1;
        core.state.nextBeforeSeq = null; core.state.hasOlder = false; core.state.olderLoading = false;
        core.state.historyHasMore = false; core.state.turnEndReasonKind = null;
        core.state.turnStatus = null;
        core.resetConversationApprovals(); core.resetConversationQuestions();
        effects.renderConversationApprovals();effects.renderConversationQuestions();effects.renderConversationTasks();
        effects.paintSelectedSession(null);
        effects.renderOlderControl(); effects.closePhoneImagePreview(); effects.removeResourcePreview();
        effects.clearHistoryView(); effects.renderSessions(); effects.updateAvailability();
        effects.showConversation(); effects.closeRail();
        effects.scrollToLatest();
        void core.refreshNewConversationApprovalMode();
    }
    async function deliverOptimistic(row) {
        const current = () => row.ownerId === core.state.ownerId && row.identity === core.state.identityGeneration;
        if(!current())return;
        row.status = 'sending'; effects.renderOptimisticMessages?.();
        if (!row.sessionId) {
            row.creating = true;
            core.creatingOptimisticSession = true;
            const submitted = row.creationCommand?.state === 'accepted_by_dsh' ? row.creationCommand
                : await core.submitCommand('session.create', {modelProfileId: row.modelProfileId, ...(row.temporary ? {temporary: true} : {})}, null, row.createRequestId);
            const created = row.creationCommand || core.state.tasks.find(command=>command.requestId===row.createRequestId) || submitted;
            core.creatingOptimisticSession = false;
            row.creating = false;
            if (!current()) return;
            if (!created?.sessionId || created.state !== 'accepted_by_dsh') { row.status = created && ['pending','dispatching'].includes(created.state) ? 'sending' : 'failed'; effects.renderOptimisticMessages?.(); return; }
            row.sessionId = created.sessionId;
            if (row.projectId) await core.updateSession(row.sessionId, {projectId:row.projectId});
            if (row.attachments) {
                const oldKey = `${row.ownerId}|new`;
                const newKey = `${row.ownerId}|${row.sessionId}`;
                for (const entries of [core.state.attachmentDrafts, core.state.attachmentAttempts, core.state.attachmentGroups]) {
                    if (entries.has(oldKey)) { entries.set(newKey, entries.get(oldKey)); entries.delete(oldKey); }
                }
            }
            // The creation receipt already identifies the durable session.
            // Reading every older conversation is not a prerequisite for
            // delivering its first message or observing the native turn.
            void core.refreshSessions().catch(() => {});
            if (core.state.newConversation && core.state.selectedSessionId === null && core.state.newConversationId === row.draftId) await core.selectSession(row.sessionId);
        }
        if(row.approvalMode){
            const modeReceipt = await core.accessApi(`/sessions/${encodeURIComponent(row.sessionId)}/approval-mode`,{method:'PATCH',protectedWrite:true,body:{mode:row.approvalMode}});
            if(modeReceipt.mode!==row.approvalMode)throw {code:'APPROVAL_RECEIPT_INVALID'};
            if(!current())return;
            if(core.state.selectedSessionId===row.sessionId)void core.refreshApprovalMode(row.sessionId);
        }
        if (row.deepThinking === true) {
            await core.accessApi(`/sessions/${encodeURIComponent(row.sessionId)}/thinking`,
                {method:'PATCH', protectedWrite:true, body:{enabled:true}});
            if (!current()) return;
            const session = core.state.sessions.find(item => item.sessionId === row.sessionId);
            if (session) session.deepThinking = true;
        }
        const submitted = row.attachments ? await sendIntentAction(() => core.sendDesktopMessageWithAttachments(row.text, row.requestId), row.intent)
            : await core.submitCommand('session.message', {sessionId: row.sessionId, text: row.text, intent: row.intent}, row.sessionId, row.requestId);
        const sent = core.state.tasks.find(command=>command.requestId===row.requestId) || submitted;
        if (!current()) return;
        if (sent) reconcileOptimistic(sent); else row.status = 'failed';
        if (sent?.state === 'accepted_by_dsh' && core.state.selectedSessionId === row.sessionId) {
            if (effects.readMessageDraft() === row.text) effects.clearMessageDraft();
            await core.refreshHistory();
            observeOptimistic([...core.state.historyEvents.values()]);
        }
        effects.renderOptimisticMessages?.(); effects.updateAvailability();
    }
    function deliverSafely(row) {
        return deliverOptimistic(row).catch(()=>{
            row.creating=false;
            if(row.ownerId!==core.state.ownerId||row.identity!==core.state.identityGeneration)return;
            if(row.status!=='accepted')row.status='failed';
            effects.renderOptimisticMessages?.();effects.updateAvailability();
        });
    }
    function handleOptimisticCreation(command) {
        const row = [...messages.values()].find(row=>row.createRequestId===command?.requestId && row.ownerId===core.state.ownerId && row.identity===core.state.identityGeneration);
        if (!row) return false;
        if (row.creationCommand?.state !== 'accepted_by_dsh' || !['pending','dispatching'].includes(command.state)) row.creationCommand = command;
        if (!row.creating && !row.sessionId && command.state==='accepted_by_dsh') {
            row.creating=true;
            void deliverSafely(row);
        } else if (['rejected','failed','uncertain'].includes(command.state)) {row.status='failed';effects.renderOptimisticMessages?.();}
        return true;
    }
    async function retryOptimistic(requestId) {
        const row = optimisticMessages().find(row => row.requestId === requestId);
        if (!row || row.status !== 'failed' || core.state.submitting) return;
        const current=()=>row.ownerId===core.state.ownerId&&row.identity===core.state.identityGeneration;
        row.status='sending';effects.renderOptimisticMessages?.();
        const lookupId = row.sessionId ? requestId : row.createRequestId;
        // Query the original durable receipt before replaying the exact same request.
        try {
            const result = await core.accessApi(`/commands/by-request/${encodeURIComponent(lookupId)}`);
            if(!current())return;
            if (result.command) {
                if (row.sessionId) reconcileOptimistic(result.command);
                if (row.sessionId && result.command.state === 'accepted_by_dsh') { await core.refreshHistory(); return; }
                if (['failed', 'rejected', 'blocked'].includes(result.command.state)) {
                    // A definitive rejection did not deliver a message. A new attempt is safe.
                    core.forgetMarker(lookupId);
                    if (!row.sessionId) row.createRequestId = environment.crypto.randomUUID();
                    else { messages.delete(requestId); row.requestId = environment.crypto.randomUUID(); messages.set(row.requestId, row); }
                }
            }
        } catch (error) { if(!current())return;if (error.code !== 'NOT_FOUND') { row.status = 'failed'; effects.renderOptimisticMessages?.(); return; } core.setOnline(true); }
        core.state.unresolvedRequests.delete(lookupId);
        core.state.unresolvedSubmission = core.state.unresolvedRequests.size > 0;
        return row.retry ? row.retry(row) : deliverSafely(row);
    }
    function addAttachmentFiles(selected) {
        const key = core.attachmentDraftKey();
        if (!key || core.state.activeChatSource !== 'desktop' || core.state.attachmentUpload || selected.length === 0)
            return;
        const drafts = [...core.currentAttachmentDrafts()];
        let rejected = 0;
        for (const file of selected) {
            if (drafts.length >= 4 || !(file instanceof Blob) || !core.validAttachmentName(file.name) ||
                !Number.isSafeInteger(file.size) || file.size < 1 || file.size > core.originalAttachmentBytes) {
                rejected++;
                continue;
            }
            const contentType = core.attachmentMime(file);
            const duplicate = drafts.some((item) => item.file.name === file.name && item.file.size === file.size &&
                item.file.lastModified === file.lastModified && item.contentType === contentType);
            if (duplicate) {
                rejected++;
                continue;
            }
            drafts.push({ attachmentId: `attachment-${environment.crypto.randomUUID()}`, file, contentType, sha256: null });
        }
        if (drafts.length)
            core.state.attachmentDrafts.set(key, drafts);
        core.invalidateAttachmentAttempt(key);
        core.state.attachmentStatus = rejected ? '部分文件未添加：每次最多 4 个，单个须为 1 B–1 GiB，名称不能含路径字符。' : '';
        effects.renderAttachmentDrafts();
        effects.updateAvailability();
    }
    function composerInputMode(sessionId) {
        return conversationRunning(sessionId) ? messageModePreference() : 'queue';
    }
    function conversationRunning(sessionId) {
        // The selected conversation's native turn events can arrive before the
        // slower session-list projection. Never infer running from acceptance:
        // an accepted message may still be queued behind another task.
        if (core.state.activeChatSource === 'desktop' && sessionId === core.state.selectedSessionId && core.state.turnStatus) {
            const boundary = [...core.state.historyEvents.values()].filter(event => ['turn.started', 'turn.ended'].includes(event.type)).sort((a,b) => a.seq-b.seq).at(-1);
            const snapshot = Date.parse(core.state.sessionSnapshotAt);
            if (Number.isFinite(snapshot) && Date.parse(boundary?.at) > snapshot)
                return core.state.turnStatus === 'running';
            if (!Number.isFinite(snapshot) && core.state.turnStatus !== 'running') return false;
        }
        return core.state.sessions.find(item => item.sessionId === sessionId)?.running === true;
    }
    function messageModePreference() {
        const owner = core.state.account?.ownerId || core.state.ownerId;
        if (core.state.messageModeOwner !== owner) {
            core.state.messageModeOwner = owner;
            let saved;
            try { saved = owner && environment.storage.getItem(`weftmate:message-mode:${owner}`); } catch { /* unavailable device storage */ }
            core.state.messageMode = saved === 'steer' ? 'steer' : 'queue';
        }
        return core.state.messageMode === 'steer' ? 'steer' : 'queue';
    }
    async function sendIntentAction(action, intent) {
        const previous = messageModePreference(), context = core.conversationTaskContext();
        if (intent) core.state.messageMode = intent;
        try { return await action(); }
        finally { if (intent && core.conversationTaskCurrent(context)) core.state.messageMode = previous; }
    }
    function sendBlocker(text, main = false) {
        if (core.state.approvalModeSaving) return '正在保存审批方式，请稍候再发送。';
        if (core.state.sessionSelecting) return '正在打开对话，请稍候再发送。';
        if (core.state.sideCreating) return '正在创建对话，请稍候再发送。';
        if (core.folderMutationPending?.()) return '正在准备文件夹，请稍候再发送。';
        if (core.state.submitting) return '上一条消息正在发送，请稍候。';
        if (core.state.attachmentUpload) return '附件正在上传，完成后再发送。';
        if (core.state.unresolvedSubmission) return '上一条消息的发送结果还在核对，请稍候。';
        if (!core.state.online || ['restarting','unavailable'].includes(core.state.connection?.host?.runtime)) return '电脑暂时无法连接，消息仍在草稿里。';
        if (core.state.capabilities?.chat?.available !== true) return '暂时无法发送，请稍候再试。';
        if (!core.state.modelProfileId || !core.state.models.some(model => model.id === core.state.modelProfileId)) return '先选择一个模型，再发送消息。';
        if (main ? core.state.personalCapabilities?.chatSend !== 1 || !core.state.mainChat?.sendAvailable
            : !core.state.newConversation && core.state.sessions.find(item => item.sessionId === core.state.selectedSessionId)?.sendAvailable !== true)
            return '这段对话暂时无法发送，请重新打开或新建对话。';
        if (thinkingView().busy) return '正在保存模型设置，请稍候再发送。';
        if (optimisticMessages(main ? false : true).some(row => row.text === text && row.status === 'sending')) return '这条消息正在发送，请稍候。';
        if (!text.trim() && !core.currentAttachmentDrafts().length) return '先输入消息或添加附件。';
        return '';
    }
    function explainSendBlocker(reason) {
        effects.toast(reason);
        effects.updateAvailability();
        return { sent: false, reason };
    }
    async function sendDraft(text = effects.readMessageDraft(), intent, legacy = false) {
        if (!legacy && core.sendMainDraft) return core.sendMainDraft(text, intent);
        if (core.state.activeChatSource === 'phone') {
            if (core.folderMutationPending?.()) return explainSendBlocker('正在准备文件夹，请稍候再发送。');
            return sendIntentAction(() => core.sendPhoneMessage(), intent);
        }
        const blocker = sendBlocker(text);
        if (blocker) return explainSendBlocker(blocker);
        const attachments = core.currentAttachmentDrafts();
        const row = {ownerId: core.state.ownerId, identity: core.state.identityGeneration,
            sessionId: core.state.selectedSessionId, modelProfileId: core.state.modelProfileId,
            projectId: core.state.newConversationProjectId,
            draftId: core.state.newConversationId,
            temporary: core.state.newConversation && core.state.newConversationTemporary === true,
            requestId: attachments.length ? core.attachmentAttempt(core.attachmentDraftKey(), text, attachments).requestId : environment.crypto.randomUUID(), createRequestId: environment.crypto.randomUUID(),
            text, attachments: attachments.length > 0, files: attachments.map(item => item.file?.name || '附件'),
            deepThinking: core.state.newConversation ? thinkingView().supported && thinkingView().enabled : undefined,
            approvalMode: core.state.newConversation ? core.state.newConversationApprovalMode : null,
            intent: intent === 'queue' || intent === 'steer' ? intent : core.composerInputMode(core.state.selectedSessionId), status: 'sending'};
        messages.set(row.requestId, row);
        rememberTurnRequest(row).pending=row;
        effects.renderOptimisticMessages?.(); effects.scrollToLatest();
        return deliverSafely(row);
    }
    async function stopCurrentTurn() {
        const session = core.state.activeChatSource === 'phone' ? core.phoneBinding()?.sessionId : core.state.selectedSessionId;
        const context = core.conversationTaskContext();
        const current = core.taskQueue().filter(row => row.state === 'running').at(-1);
        if (session && conversationRunning(session) && !core.state.cancelSubmitting) {
            const stoppedNotice = () => {
                if (!core.conversationTaskCurrent(context)) return;
                const queued = core.taskQueue().filter(row => row.state === 'queued').length;
                effects.toast(queued ? `已停止当前回复，还有 ${queued} 条排队消息会继续` : '已停止');
            };
            if (!current?.taskId || current.taskId.startsWith('turn-')) {
                const result = await core.submitCommand('session.cancel', { sessionId: session }, session);
                if (result?.state === 'accepted_by_dsh') stoppedNotice();
                return result;
            }
            core.state.cancelSubmitting = true;
            effects.updateAvailability();
            try {
                const key = `${context.ownerId}/${context.identity}/${session}/${current.taskId}`;
                if (core.stopAttempt?.key !== key)
                    core.stopAttempt = { key, requestId: environment.crypto.randomUUID() };
                await core.accessApi(`/tasks/${encodeURIComponent(current.taskId)}/stop`, {
                    method: 'POST', protectedWrite: true, body: { requestId: core.stopAttempt.requestId } });
                stoppedNotice();
            } catch (error) {
                if (core.conversationTaskCurrent(context)) effects.toast(core.taskControlError(error));
            } finally {
                core.state.cancelSubmitting = false;
                effects.updateAvailability();
            }
        }
    }
    function composerState(text, legacy = false) {
        if (!legacy && core.mainComposerState) return core.mainComposerState(text);
        const phoneChat = core.state.activeChatSource === 'phone';
        const pendingPhone = phoneChat ? core.readPhoneOutbox() : null;
        const recovery = phoneChat && !pendingPhone ? core.readPhoneRecovery() : null;
        const pendingHere = pendingPhone?.event.conversationId === core.state.selectedPhoneConversationId;
        const recoveryHere = recovery?.event.conversationId === core.state.selectedPhoneConversationId;
        const bound = phoneChat ? core.phoneBinding() : null;
        const boundSession = bound && core.state.sessions.find(item => item.sessionId === bound.sessionId);
        const phoneReady = core.state.online && !!core.state.ownerId && !!core.state.selectedPhoneConversationId && !core.state.phoneSending &&
            (bound ? boundSession?.sendAvailable === true : core.state.syncAvailable && !!core.state.device?.id);
        const chat = core.state.online && !['restarting','unavailable'].includes(core.state.connection?.host?.runtime) && core.state.capabilities?.chat?.available === true;
        const model = core.state.models.some(item => item.id === core.state.modelProfileId);
        const selected = core.state.sessions.find(item => item.sessionId === core.state.selectedSessionId);
        const canSendHere = selected?.sendAvailable === true || core.state.newConversation === true;
        const attachmentCount = phoneChat ? 0 : core.currentAttachmentDrafts().length;
        const attachmentBusy = !!core.state.attachmentUpload;
        const messageDisabled = phoneChat ? !core.state.ownerId || !!pendingPhone || !!recovery : !core.state.account || !model || !canSendHere || attachmentBusy;
        const running = phoneChat ? boundSession?.running === true : conversationRunning(core.state.selectedSessionId);
        const blockedDesktop = core.desktopBlocker();
        const hint = phoneChat && bound ? core.state.phoneSendNotice || '' : phoneChat
            ? pendingPhone && !pendingHere ? '另一条手机对话有未确认的同步请求。请先切回原对话核对。'
                : pendingHere ? core.state.phoneSendNotice || '这条文字的同步结果待核对。重试会沿用同一个消息编号。'
                    : recovery && !recoveryHere ? '旧设备有未确认文字，请先切回原手机对话核对。'
                        : recoveryHere ? '重新登录后保留了旧文字。先核对服务器是否已接收，再决定是否重新同步。' : core.state.phoneSendNotice || ''
            : !core.state.online ? '等待重新连接电脑。'
                : core.state.executionAccount === false ? executionAccountHint()
                : selected?.archived ? '这段对话已归档，请在会话菜单中恢复后继续。'
                    : selected && !canSendHere ? '旧会话历史可读；要继续聊天或在对话中执行，请新建受限远端会话。'
                    : !chat || !model ? '电脑尚无可用模型。历史可阅读，聊天请先在电脑设置中配置模型。' : '';
        return {
            placeholder: running ? globalThis.WeftUiCore.runningPlaceholder(messageModePreference()) : phoneChat ? '补充到这条手机对话' : '向 WeftMate 说说你的目标',
            phoneChat, running, hint, attachmentBusy,
            newSessionDisabled: !chat || !model || core.state.submitting || attachmentBusy || core.state.unresolvedSubmission,
            modelDisabled: phoneChat || !chat || !core.state.models.length,
            modelName: core.state.models.find(item => item.id === core.state.modelProfileId)?.name || '选择模型',
            messageDisabled, voiceDisabled: messageDisabled || core.state.submitting || core.state.phoneSending,
            sendDisabled: phoneChat
                ? !phoneReady || (!!pendingPhone && !pendingHere) || (!!recovery && !recoveryHere) || (!pendingPhone && !recovery && !text.trim())
                : !!sendBlocker(text),
            sendText: phoneChat ? bound ? '发送到电脑' : recoveryHere && !pendingPhone ? '核对旧请求' : pendingHere ? '核对并重试' : '同步文字' : '发送',
            attachmentsDisabled: phoneChat || !chat || !model || !canSendHere || core.state.submitting || attachmentBusy || core.state.unresolvedSubmission || attachmentCount >= 4,
            desktopText: blockedDesktop ? '查看原事情' : '打开记事本',
            desktopDisabled: blockedDesktop ? false : !core.state.online || core.state.capabilities?.desktopOpenApp?.available !== true || !core.state.capabilities.desktopOpenApp.appIds?.includes('notepad') || core.state.submitting || core.state.unresolvedSubmission,
            cancelHidden: phoneChat || !running,
            cancelDisabled: !core.state.online || !running || core.state.cancelSubmitting,
        };
    }
    function selectModelProfile(id) {
        if (!core.state.models.some(model => model.id === id))
            return false;
        core.state.modelProfileId = id;
        effects.updateAvailability();
        return true;
    }
    function setMessageMode(mode) {
        messageModePreference();
        core.state.messageMode = mode === 'steer' ? 'steer' : 'queue';
        if (core.state.messageModeOwner) try { environment.storage.setItem(`weftmate:message-mode:${core.state.messageModeOwner}`, core.state.messageMode); } catch { /* unavailable device storage */ }
        if (core.state.personalizationOwner === core.state.messageModeOwner && core.state.personalization) void core.savePersonalization({messageMode: core.state.messageMode}).catch(() => {});
        if (core.state.messageModeOwner && environment.messageModeStorage) void environment.messageModeStorage(`weftmate:message-mode:${core.state.messageModeOwner}`, core.state.messageMode).catch(() => {});
        effects.updateAvailability();
    }
    async function loadMessageModePreference() {
        const value = messageModePreference(), owner = core.state.messageModeOwner, identity = core.state.identityGeneration;
        await core.loadPersonalization().catch(() => {});
        if (identity !== core.state.identityGeneration || owner !== core.state.messageModeOwner) return messageModePreference();
        if (core.state.personalizationOwner === owner && core.state.personalization) return core.state.messageMode;
        if (!owner || !environment.messageModeStorage) return value;
        try {
            const saved = await environment.messageModeStorage(`weftmate:message-mode:${owner}`);
            if (identity === core.state.identityGeneration && owner === core.state.messageModeOwner && ['steer', 'queue'].includes(saved)) core.state.messageMode = saved;
        } catch { /* keep this origin's account preference when native storage is unavailable */ }
        return core.state.messageMode;
    }
    function processingStageLabel(value, events = [...core.state.historyEvents.values()], now = Date.now()) {
        if (core.state.connection && core.state.connection.kind !== 'online') return `${core.state.connection.label} · 等待接续`;
        const started = [...events].filter(event => event.type === 'turn.started').sort((a, b) => a.seq - b.seq).at(-1);
        const elapsed = now - Date.parse(started?.at);
        return processingLabel(value) + (Number.isFinite(elapsed) && elapsed >= 0 ? ` ${Math.floor(elapsed / 1000)} 秒` : '');
    }
    function processingLabel(value) {
        if (core.state.connection && core.state.connection.kind !== 'online') return `${core.state.connection.label} · 等待接续`;
        if (value?.phase === 'loading') return `正在加载模型${value.modelName ? ` ${value.modelName}` : ''}…`;
        if (value?.phase === 'queued' && Number.isSafeInteger(value.ahead) && value.ahead > 0) return `模型排队中，前面还有 ${value.ahead} 个请求`;
        return { memory: '正在读取记忆…', retrying: '模型响应慢，正在重试…', reasoning: '正在思考…', answering: '正在回复…' }[value?.phase] || '正在思考…';
    }
    function executionAccountHint() {
        if (core.state.executionAccount !== false) return '';
        const name = core.state.executionAccountName || '原账号';
        return `这台电脑由账号 ${name} 负责执行；当前账号只能聊天。切回 ${name} 或在 ${name} 的设置里移交。`;
    }
    return { rememberTurnRequest, observeMessageProcesses, messageProcesses, resetMessageProcesses:()=>{turnRequestScope=undefined;requestScope();}, turnPresentationKey, messagePresentationKey, executionAccountHint, refreshThinkingModels, thinkingView, setDeepThinking, handleOptimisticCreation, beginOptimistic, optimisticMessages, reconcileOptimistic, observeOptimistic, startNewConversation, retryOptimistic,
        addAttachmentFiles, composerInputMode, conversationRunning, messageModePreference, loadMessageModePreference, sendBlocker, explainSendBlocker, sendDraft, stopCurrentTurn, composerState, selectModelProfile, setMessageMode, processingLabel, processingStageLabel };
};

globalThis.WeftUiCore.contextUsageView = value => {
    const used = Number.isSafeInteger(value?.usedTokens) && value.usedTokens >= 0 ? value.usedTokens : null;
    const limit = Number.isSafeInteger(value?.contextWindow) && value.contextWindow > 0 ? value.contextWindow : null;
    const compact = number => number >= 1e6 ? `${Number((number / 1e6).toFixed(1))}M` : number >= 1e3 ? `${Number((number / 1e3).toFixed(1))}k` : String(number);
    const ratio = used !== null && limit !== null ? used / limit : null;
    return {ratio, warning: ratio !== null && ratio >= .8,
        label: ratio !== null ? `背景信息窗口：${Math.round(ratio * 100)}% 已用` : '背景信息窗口：用量待确认',
        detail: used !== null ? `已用 ${compact(used)} 标记${limit !== null ? `，共 ${compact(limit)}` : '，上限未知'}` : '当前占用尚未提供'};
};

globalThis.WeftUiCore.runningPlaceholder = mode => mode === 'queue' ? '排队到下一条…' : mode === 'steer' ? '引导当前回复…' : '补充或跟进…';
