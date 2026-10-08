/* Shared account state, data and actions. Presentation is supplied through named effects. */
globalThis.WeftUiCore.factories.account = (core, effects, environment) => {
    function profileName() { return core.state.account?.displayName ?? core.state.account?.username ?? ''; }
    function avatarSignature(bytes, mimeType) {
        const png = bytes.length >= 16 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
        const jpeg = bytes.length >= 16 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
        const webp = bytes.length >= 16 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
            && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
        return mimeType === 'image/png' && png || mimeType === 'image/jpeg' && jpeg || mimeType === 'image/webp' && webp;
    }
    function accountModelMarkerKey() { return `weftmate:account-model-operation:${core.state.ownerId || 'none'}`; }
    function savedAccountModelMarker() {
        try {
            const value = JSON.parse(environment.storage.getItem(core.accountModelMarkerKey()) || 'null');
            return value?.ownerId === core.state.ownerId && value?.hostId === core.state.hostId &&
                /^[0-9a-f-]{36}$/.test(value.requestId || '') &&
                ['create', 'update', 'test', 'stop_using', 'remove'].includes(value.kind) ? value : null;
        }
        catch {
            return null;
        }
    }
    function storeAccountModelMarker(marker) {
        try {
            environment.storage.setItem(core.accountModelMarkerKey(), JSON.stringify(marker));
            return true;
        }
        catch {
            return false;
        }
    }
    function forgetAccountModelMarker(requestId) {
        if (core.savedAccountModelMarker()?.requestId === requestId)
            try {
                environment.storage.removeItem(core.accountModelMarkerKey());
            }
            catch { /* Pending state stays visible. */ }
    }
    async function accountModelReceipt(marker, token) {
        try {
            const result = await core.accessApi(`/account/models/by-request/${encodeURIComponent(marker.requestId)}`);
            if (!core.accountCurrent(token))
                return null;
            const operation = result?.operation;
            if (operation?.requestId !== marker.requestId || operation.kind !== marker.kind)
                throw { code: 'MODEL_RECEIPT_INVALID' };
            if (operation.status === 'succeeded') {
                core.forgetAccountModelMarker(marker.requestId);
                const checked = operation.testResult;
                effects.accountModelStatus(operation.kind === 'test'
                    ? (checked?.configured === true && checked.reachable === true && checked.modelListed === true
                        ? '目录与鉴权已核对；尚未发送推理消息。'
                        : '连接检查已完成，但目录、鉴权或模型列表未通过；尚未发送推理消息。')
                    : operation.kind === 'stop_using'
                        ? '已停止使用；原会话记录与绑定仍保留，后续新发送需要另选可用模型。'
                        : operation.kind === 'remove'
                            ? '已移除账户配置；手机另存的副本保持不变。'
                            : '账户模型配置已保存；已有会话模型绑定保持不变。', operation.kind === 'test' && !(checked?.configured === true && checked.reachable === true && checked.modelListed === true));
                void core.refreshAccountModels(true);
                void core.refreshModels();
            }
            else if (operation.status === 'failed') {
                core.forgetAccountModelMarker(marker.requestId);
                effects.accountModelStatus('这次模型操作未完成；原有配置仍可查看。', true);
            }
            else
                effects.accountModelStatus(operation.reasonCode === 'RUNTIME_BUSY'
                    ? '电脑正在处理其他回合；原模型请求已保存，稍后用同编号核对。'
                    : '模型操作仍在处理；原请求编号已保存，不会再次创建。');
            return result;
        }
        catch (error) {
            if (core.accountCurrent(token))
                effects.accountModelStatus(error.code === 'NOT_FOUND'
                    ? '电脑尚未找到原请求；原编号已保存。请核对输入后再明确重试。'
                    : '原请求暂时无法核对，配置与密钥输入仍保留在本页。', true);
            return null;
        }
    }
    async function submitAccountModelControl(model, kind) {
        const token = core.accountToken();
        if (!core.accountCurrent(token) || core.state.accountModelBusy)
            return;
        const prior = core.savedAccountModelMarker();
        if (prior && (prior.kind !== kind || prior.accountModelId !== model.accountModelId)) {
            effects.accountModelStatus('上一项模型操作仍待核对；先刷新原请求状态。', true);
            return;
        }
        const marker = prior || { ownerId: core.state.ownerId, hostId: core.state.hostId,
            requestId: environment.crypto.randomUUID(), kind, accountModelId: model.accountModelId,
            expectedRevision: model.revision };
        if (!core.storeAccountModelMarker(marker)) {
            effects.accountModelStatus('无法保存请求编号，本次没有提交。', true);
            return;
        }
        const path = `/account/models/${encodeURIComponent(model.accountModelId)}${kind === 'test' ? '/test'
            : kind === 'stop_using' ? '/stop-using' : ''}`;
        core.state.accountModelBusy = true;
        effects.renderAccountModels();
        try {
            const previous = await core.accountModelReceipt(marker, token);
            if (!core.accountCurrent(token) || previous?.operation)
                return;
            const sent = await core.accessApi(path, { method: kind === 'remove' ? 'DELETE' : 'POST',
                protectedWrite: true, body: { requestId: marker.requestId,
                    expectedRevision: marker.expectedRevision } });
            if (!core.accountCurrent(token))
                return;
            if (sent?.operation?.requestId !== marker.requestId)
                throw { code: 'MODEL_RECEIPT_INVALID' };
            await core.accountModelReceipt(marker, token);
        }
        catch (error) {
            if (core.accountCurrent(token))
                effects.accountModelStatus('结果待核对，原请求编号已保留；不会重复提交。', true);
        }
        finally {
            if (core.accountCurrent(token)) {
                core.state.accountModelBusy = false;
                effects.renderAccountModels();
            }
        }
    }
    function browserIntentKey(ownerId = core.state.ownerId, hostId = core.state.browserHostId) {
        return `weftmate-browser-intent:${ownerId}:${hostId}`;
    }
    function savedBrowserIntent(ownerId = core.state.ownerId, hostId = core.state.browserHostId) {
        if (!ownerId || !hostId)
            return null;
        try {
            const value = JSON.parse(environment.storage.getItem(core.browserIntentKey(ownerId, hostId)) || 'null');
            return value?.ownerId === ownerId && value.hostId === hostId &&
                core.browserModelId.test(value.modelProfileId ?? '') &&
                core.browserRequestId.test(value.sessionRequestId ?? '') && core.browserRequestId.test(value.messageRequestId ?? '') &&
                typeof value.goal === 'string' && value.goal.length > 0 && value.goal.length <= 6000 &&
                Array.isArray(value.urls) && value.urls.length >= 1 && value.urls.length <= 5 &&
                value.urls.every((url) => typeof url === 'string' && url.length <= 2048) ? value : null;
        }
        catch {
            return null;
        }
    }
    async function reconcileBrowserIntent(intent) {
        const token = core.accountToken();
        const current = () => core.accountCurrent(token) && core.state.browserHostId === intent.hostId;
        if (!current())
            return;
        effects.browserWorkspaceNotice('正在按原编号核对网页会话…');
        let command = null;
        try {
            command = (await core.accessApi(`/commands/by-request/${encodeURIComponent(intent.sessionRequestId)}`))?.command || null;
        }
        catch (error) {
            if (!current())
                return;
            if (error.code !== 'NOT_FOUND') {
                effects.browserWorkspaceNotice('暂时无法核对原会话请求；选择和编号已保留。');
                return;
            }
        }
        if (!command) {
            try {
                command = (await core.accessApi('/workspaces/browser/sessions', { method: 'POST', protectedWrite: true,
                    body: { requestId: intent.sessionRequestId, modelProfileId: intent.modelProfileId } }))?.command || null;
            }
            catch {
                if (current())
                    effects.browserWorkspaceNotice('会话送达状态不明；原编号已保留，不会另建会话。');
                return;
            }
        }
        if (!current())
            return;
        if (command?.kind !== 'session.create' || command.requestId !== intent.sessionRequestId ||
            command.workspaceKind !== 'browser' || !core.sessionIdPattern.test(command.sessionId ?? '')) {
            effects.browserWorkspaceNotice('网页会话回执与原选择不一致，已保留请求供核对。');
            return;
        }
        for (let attempt = 0; attempt < 5 && current() && ['pending', 'dispatching'].includes(command.state); attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 800));
            if (!current())
                return;
            try {
                command = (await core.accessApi(`/commands/by-request/${encodeURIComponent(intent.sessionRequestId)}`))?.command || command;
            }
            catch {
                break;
            }
        }
        if (command.state !== 'accepted_by_dsh') {
            effects.browserWorkspaceNotice('电脑尚未确认网页会话，原编号仍保留。');
            return;
        }
        let sessions;
        try {
            sessions = (await core.accessApi('/sessions'))?.sessions;
        }
        catch {
            if (current())
                effects.browserWorkspaceNotice('网页会话列表暂不可核对，原编号仍保留。');
            return;
        }
        if (!current())
            return;
        if (!Array.isArray(sessions) || !sessions.some((item) => item.sessionId === command.sessionId &&
            item.workspaceKind === 'browser' && item.modelProfileId === intent.modelProfileId)) {
            effects.browserWorkspaceNotice('网页会话已受理，等待准确绑定进入列表。');
            return;
        }
        core.state.sessions = sessions;
        const text = `${intent.goal}\n\n网页链接：\n${intent.urls.join('\n')}`;
        let message = null;
        try {
            message = (await core.accessApi(`/commands/by-request/${encodeURIComponent(intent.messageRequestId)}`))?.command || null;
        }
        catch (error) {
            if (error.code !== 'NOT_FOUND') {
                if (current())
                    effects.browserWorkspaceNotice('网页目标状态暂无法核对，原编号仍保留。');
                return;
            }
        }
        if (!current())
            return;
        if (!message) {
            try {
                message = (await core.accessApi('/commands', { method: 'POST', protectedWrite: true,
                    body: { requestId: intent.messageRequestId, kind: 'session.message',
                        targetDeviceId: intent.hostId, sessionId: command.sessionId, text, mode: 'queue' } }))?.command || null;
            }
            catch {
                if (current())
                    effects.browserWorkspaceNotice('网页目标送达状态不明；原消息编号已保留。');
                return;
            }
        }
        if (!current())
            return;
        if (message?.kind !== 'session.message' || message.requestId !== intent.messageRequestId ||
            message.sessionId !== command.sessionId || message.workspaceKind !== 'browser') {
            effects.browserWorkspaceNotice('网页目标回执与原选择不一致，编号已保留。');
            return;
        }
        if (message.state !== 'accepted_by_dsh') {
            effects.browserWorkspaceNotice('电脑已记录网页目标，正在派发；可按原编号重新核对。');
            return;
        }
        try {
            environment.storage.removeItem(core.browserIntentKey(intent.ownerId, intent.hostId));
        }
        catch { /* same request remains safe */ }
        await core.enterAssistant();
        if (core.state.ownerId === intent.ownerId && core.state.sessions.some((item) => item.sessionId === command.sessionId)) {
            await core.selectSession(command.sessionId);
            effects.toast('网页目标已送达原会话；请在事情中查看实际阅读与来源。');
        }
    }
    async function refreshAccountModels(preserveStatus = false) {
        const token = core.accountToken();
        if (!core.accountCurrent(token))
            return;
        const generation = ++core.state.accountModelFetchGeneration;
        if (!preserveStatus)
            effects.accountModelStatus('正在读取当前账户的电脑模型…');
        try {
            const result = await core.readAccountModels();
            if (!core.accountCurrent(token) || generation !== core.state.accountModelFetchGeneration)
                return;
            if (!Array.isArray(result.models))
                throw { code: 'MODEL_RECEIPT_INVALID' };
            effects.showAccountModels(true);
            core.state.accountModels = result.models.filter((item) => typeof item?.accountModelId === 'string' && Number.isSafeInteger(item.revision) &&
                typeof item.name === 'string' && typeof item.modelId === 'string');
            core.state.accountModelsCanManage = result.canManage === true;
            effects.renderAccountModels();
            const marker = core.savedAccountModelMarker();
            if (marker)
                void core.accountModelReceipt(marker, token);
            else if (!preserveStatus)
                effects.accountModelStatus(core.state.accountModels.length
                    ? '测试连接只核目录和鉴权；配置变化不会改变已有会话的模型。'
                    : '可把手机已保存的云模型从手机明确上传，或在此新增账户配置。');
        }
        catch (error) {
            if (core.accountCurrent(token) && error.code === 'NOT_FOUND')
                effects.showAccountModels(false);
            if (core.accountCurrent(token) && generation === core.state.accountModelFetchGeneration)
                effects.accountModelStatus(error.code === 'NOT_FOUND' ? '当前电脑尚未接入账户模型配置。'
                    : '账户模型目录暂时无法读取；已有聊天与草稿保持原样。', true);
        }
    }
    async function refreshProjects() {
        const token = core.accountToken();
        if (!core.accountCurrent(token))
            return;
        const generation = ++core.state.projectFetchGeneration;
        effects.projectNotice('正在读取项目…');
        try {
            const payload = await core.readProjects();
            if (!core.accountCurrent(token) || generation !== core.state.projectFetchGeneration)
                return;
            if (!Array.isArray(payload?.projects) || typeof payload.canManage !== 'boolean')
                throw { code: 'REQUEST_FAILED' };
            core.state.projects = payload.projects;
            core.state.projectCanManage = payload.canManage;
            effects.renderProjects();
        }
        catch (error) {
            if (!core.accountCurrent(token) || generation !== core.state.projectFetchGeneration)
                return;
            core.state.projects = [];
            core.state.projectCanManage = false;
            effects.clearProjectView();
            effects.projectNotice(error.status === 404
                ? '当前电脑服务还没有项目目录功能；原有聊天与历史仍可使用。'
                : error.code === 'NETWORK' ? '电脑暂时不可达，重连后可刷新项目。' : '项目暂时无法读取，请刷新重试。');
        }
    }
    async function saveAccountModelDraft(input) {
        const token = core.accountToken();
        if (!core.accountCurrent(token) || !core.state.accountModelsCanManage || core.state.accountModelBusy) {
            effects.accountModelFormNotice('账户状态正在变化；请核对后重试。');
            return;
        }
        const name = input.name.trim().normalize('NFC');
        const baseUrl = input.baseUrl.trim();
        const modelId = input.modelId.trim();
        const modelTier = input.modelTier;
        const apiKey = input.apiKey;
        if (!name || !/^[A-Za-z0-9._:/-]{1,128}$/.test(modelId) || !baseUrl) {
            effects.accountModelFormNotice('请填写名称、提供方地址和有效模型 ID。');
            return;
        }
        let route;
        try {
            route = new URL(baseUrl);
        }
        catch {
            effects.accountModelFormNotice('请输入完整的模型服务地址。');
            return;
        }
        if (!['http:', 'https:'].includes(route.protocol) || route.username || route.password || route.search || route.hash ||
            !route.pathname.replace(/\/+$/, '').endsWith('/v1')) {
            effects.accountModelFormNotice('请输入 HTTPS 或本机/局域网 HTTP 的 /v1 地址，不能包含账号、参数或片段。');
            return;
        }
        const editing = core.state.accountModelEditing;
        const priorModel = editing && core.state.accountModels.find((item) => item.accountModelId === editing.id);
        if (editing && (!priorModel || priorModel.revision !== editing.revision)) {
            effects.accountModelFormNotice('配置修订已变化，请先刷新目录，表单内容仍保留。');
            return;
        }
        if ((!editing || priorModel?.baseUrl !== baseUrl) && !apiKey) {
            effects.accountModelFormNotice('新建或更换服务地址时，请输入该地址的密钥。');
            return;
        }
        const kind = editing ? 'update' : 'create';
        const existing = core.savedAccountModelMarker();
        if (existing && (existing.kind !== kind || existing.accountModelId !== (editing?.id ?? undefined) ||
            existing.name !== name || existing.baseUrl !== baseUrl || existing.modelId !== modelId ||
            (existing.modelTier ?? 'auto') !== modelTier ||
            existing.expectedRevision !== (editing?.revision ?? undefined))) {
            effects.accountModelFormNotice('上一项账户模型操作仍待核对；请保持原输入并刷新请求状态。');
            return;
        }
        const marker = existing || { ownerId: core.state.ownerId, hostId: core.state.hostId,
            requestId: environment.crypto.randomUUID(), kind, ...(editing ? { accountModelId: editing.id,
                expectedRevision: editing.revision } : {}), name, baseUrl, modelId, modelTier };
        if (!core.storeAccountModelMarker(marker)) {
            effects.accountModelFormNotice('无法保存请求编号，本次没有提交。');
            return;
        }
        core.state.accountModelBusy = true;
        effects.accountModelFormBusy(true);
        effects.accountModelFormNotice('正在核对原请求并保存配置…');
        try {
            const known = await core.accountModelReceipt(marker, token);
            if (!core.accountCurrent(token))
                return;
            if (!known?.operation) {
                const body = { requestId: marker.requestId, ...(editing ? { expectedRevision: editing.revision } : {}),
                    name, baseUrl, modelId, ...(marker.modelTier !== undefined ? { modelTier } : {}), ...(apiKey ? { apiKey } : {}) };
                const result = await core.saveAccountModel(editing, body);
                if (!core.accountCurrent(token) || result?.operation?.requestId !== marker.requestId)
                    throw { code: 'MODEL_RECEIPT_INVALID' };
            }
            const settled = await core.accountModelReceipt(marker, token);
            if (!core.accountCurrent(token))
                return;
            if (settled?.operation?.status === 'succeeded') {
                effects.resetAccountModelForm();
                core.state.accountModelEditing = null;
                effects.accountModelFormNotice('配置已保存。测试连接需单独点击；尚未发送推理消息。');
            }
            else
                effects.accountModelFormNotice('请求正在核对，原编号和输入仍保留。');
        }
        catch (failure) {
            if (core.accountCurrent(token))
                effects.accountModelFormNotice(failure.code === 'NETWORK'
                    ? '送达结果不明，原请求编号与输入仍保留；请刷新核对。'
                    : failure.code === 'REQUEST_CONFLICT' ? '原请求内容或配置修订不同；请先核对原操作。'
                        : '配置未完成；密钥仍留在本页输入框中供你核对。');
        }
        finally {
            if (core.accountCurrent(token)) {
                core.state.accountModelBusy = false;
                effects.accountModelFormBusy(false);
                effects.renderAccountModels();
            }
        }
    }
    async function saveProfileDraft(input) {
        if (core.state.profileSaving || core.state.avatarChecking || core.state.profileConflict || !core.profileDraftDirty(input.displayName))
            return;
        const token = core.accountToken();
        const operation = ++core.state.profileOperationGeneration;
        const name = input.displayName.normalize('NFKC').trim();
        if (!name || Array.from(name).length > 64 || /[\u0000-\u001f\u007f]/.test(name)) {
            return effects.profileError('昵称须为 1–64 个字符，不能包含控制字符。');
        }
        const revision = core.state.account?.profileRevision;
        if (!Number.isSafeInteger(revision))
            return effects.profileError('资料版本不可用，请读取最新资料后重试。');
        const body = { expectedRevision: revision };
        if (name !== core.profileName())
            body.displayName = name;
        if (core.state.profileDraftAvatar !== undefined)
            body.avatar = core.state.profileDraftAvatar;
        if (!Object.hasOwn(body, 'displayName') && !Object.hasOwn(body, 'avatar'))
            return effects.resetProfileDraft();
        core.state.profileSaving = true;
        effects.profileControls();
        effects.profileError('');
        effects.profileStatus('正在保存资料…');
        try {
            const result = await core.saveProfile(body);
            if (!core.accountCurrent(token))
                return;
            if (result?.account?.profileRevision !== revision + 1)
                throw { code: 'REQUEST_FAILED' };
            const readback = await core.readProfile();
            if (!core.accountCurrent(token))
                return;
            if (readback?.account?.ownerId !== token.ownerId || readback?.device?.id !== token.deviceId
                || readback.account.profileRevision !== revision + 1)
                throw { code: 'REQUEST_FAILED' };
            if (Object.hasOwn(body, 'displayName') && readback.account.displayName !== name)
                throw { code: 'REQUEST_FAILED' };
            if (Object.hasOwn(body, 'avatar')) {
                const currentAvatar = readback.account.avatar;
                if (body.avatar === null ? currentAvatar !== null
                    : currentAvatar?.mimeType !== body.avatar.mimeType || currentAvatar?.dataBase64 !== body.avatar.dataBase64) {
                    throw { code: 'REQUEST_FAILED' };
                }
            }
            core.state.account = readback.account;
            core.state.profileDraftAvatar = undefined;
            effects.resetProfileDraft();
            effects.profileStatus('资料已保存，并从账户重新读取确认。');
        }
        catch (error) {
            if (!core.accountCurrent(token))
                return;
            effects.profileStatus('');
            if (error.code === 'UNAUTHORIZED')
                return core.sessionExpired();
            if (error.code === 'REQUEST_CONFLICT' || error.status === 409) {
                core.state.profileConflict = true;
                effects.showProfileReload(true);
                effects.profileError('资料已被其他设备修改。当前草稿已保留；请读取最新资料并核对，再决定是否保存。');
            }
            else
                effects.profileError('资料未确认保存。请读取最新资料核对后再试，当前草稿已保留。');
        }
        finally {
            if (core.accountCurrent(token) && operation === core.state.profileOperationGeneration) {
                core.state.profileSaving = false;
                effects.profileControls();
            }
        }
    }
    async function registerProjectDraft(input) {
        if (!core.state.projectCanManage)
            return;
        const token = core.accountToken();
        const name = input.name.trim().normalize('NFC');
        const rootPath = input.rootPath.trim();
        if (!name || !rootPath) {
            effects.projectDraftNotice('请填写项目名称和电脑资料目录。');
            return;
        }
        const pending = core.state.projectPending?.name === name && core.state.projectPending?.rootPath === rootPath
            ? core.state.projectPending : { name, rootPath, requestId: environment.crypto.randomUUID() };
        core.state.projectPending = pending;
        effects.projectDraftBusy(true);
        effects.projectDraftNotice('正在登记并核对目录…');
        try {
            const payload = await core.registerProject({ requestId: pending.requestId, name, rootPath });
            if (!core.accountCurrent(token) || core.state.projectPending !== pending)
                return;
            if (!payload?.project?.projectId)
                throw { code: 'REQUEST_FAILED' };
            core.state.projectPending = null;
            input.name = '';
            input.rootPath = '';
            effects.projectDraftNotice('项目已登记。手机同账户现在可以选择它。');
            void core.refreshProjects();
        }
        catch (error) {
            if (!core.accountCurrent(token) || core.state.projectPending !== pending)
                return;
            if (error.code !== 'NETWORK')
                core.state.projectPending = null;
            effects.projectDraftNotice(error.code === 'NETWORK'
                ? '送达结果不明。草稿与请求编号已保留；可用原信息重试或先刷新项目核对。'
                : error.code === 'PROJECT_UNSAFE_PATH' || error.code === 'PROJECT_ROOT_CHANGED'
                    ? '目录无法安全读取，请选择普通本地资料目录后重试。'
                    : error.code === 'FORBIDDEN' ? '只有原电脑账户可以登记目录。'
                        : '登记未完成，请检查目录并重试。');
        }
        finally {
            if (core.accountCurrent(token))
                effects.projectDraftBusy(false);
        }
    }
    async function startBrowserDraft(input) {
        if (!core.state.browserAvailable || !core.state.browserHostId)
            return;
        const token = core.accountToken();
        effects.showBrowserNotice();
        const goal = input.goal.trim();
        const urls = input.urls.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
        const modelProfileId = input.modelProfileId;
        if (!goal || goal.length > 6000 || /https?:\/\//iu.test(goal) || urls.length < 1 || urls.length > 5 ||
            !core.state.models.some((item) => item.id === modelProfileId)) {
            effects.browserWorkspaceNotice('请填写目标和1–5条单独列出的公共链接；目标中不要重复贴链接。');
            return;
        }
        if (urls.some((value) => {
            try {
                const parsed = new URL(value);
                return !['http:', 'https:'].includes(parsed.protocol) ||
                    parsed.username || parsed.password || new TextEncoder().encode(value).length > 2048;
            }
            catch {
                return true;
            }
        })) {
            effects.browserWorkspaceNotice('链接须是完整的公共 HTTP/HTTPS 地址，且不能包含账号密码。');
            return;
        }
        if (new TextEncoder().encode(`${goal}\n\n网页链接：\n${urls.join('\n')}`).length > 8192) {
            effects.browserWorkspaceNotice('目标和链接合计过长，请缩短后重试。');
            return;
        }
        const previous = core.savedBrowserIntent();
        if (previous && (previous.goal !== goal || previous.modelProfileId !== modelProfileId ||
            JSON.stringify(previous.urls) !== JSON.stringify(urls))) {
            effects.browserWorkspaceNotice('上一项网页任务仍待核对，请保留原目标与模型，避免重复派发。');
            return;
        }
        const intent = previous || { ownerId: core.state.ownerId, hostId: core.state.browserHostId,
            goal, urls, modelProfileId, sessionRequestId: environment.crypto.randomUUID(), messageRequestId: environment.crypto.randomUUID() };
        try {
            environment.storage.setItem(core.browserIntentKey(), JSON.stringify(intent));
        }
        catch {
            effects.browserWorkspaceNotice('无法安全保存请求编号，暂不能发送。');
            return;
        }
        effects.browserDraftBusy(true);
        try {
            if (core.accountCurrent(token))
                await core.reconcileBrowserIntent(intent);
        }
        finally {
            if (core.accountCurrent(token))
                effects.browserDraftBusy(false);
        }
    }
    function profileDraftDirty(name) { return name !== core.profileName() || core.state.profileDraftAvatar !== undefined; }
    async function refreshPendingDevices() {
        const generation = core.state.identityGeneration;
        const ownerId = core.state.account?.ownerId;
        if (!core.state.csrfToken || !ownerId)
            return;
        const fetchGeneration = ++core.state.pendingDeviceFetchGeneration;
        const current = () => core.state.identityGeneration === generation && core.state.account?.ownerId === ownerId
            && core.state.pendingDeviceFetchGeneration === fetchGeneration;
        try {
            const payload = await core.readPendingDevices();
            if (!current() || !Array.isArray(payload.devices))
                return;
            effects.paintPendingDevices(payload, current);
        }
        catch (error) {
            if (!current() || error.code === 'NOT_FOUND')
                return;
            effects.pendingDevicesError('待批准设备暂时无法读取，请点击刷新重试。');
        }
    }
    async function refreshProfile({ preserveDraft = false } = {}) {
        const token = core.accountToken();
        const draftGeneration = core.state.profileDraftGeneration;
        const fetchGeneration = ++core.state.profileFetchGeneration;
        if (!core.accountCurrent(token))
            return;
        if (!preserveDraft && (effects.profileDirty() || core.state.avatarChecking))
            return;
        effects.profileStatus('正在读取资料…');
        try {
            const payload = await core.readProfile();
            if (!core.accountCurrent(token) || fetchGeneration !== core.state.profileFetchGeneration)
                return;
            if (draftGeneration !== core.state.profileDraftGeneration) {
                effects.profileStatus(preserveDraft
                    ? '读取期间草稿发生变化，本次结果未应用。请重新读取最新资料。'
                    : '当前草稿已保留，保存时会检查资料版本。');
                return;
            }
            if (payload?.account?.ownerId !== core.state.account?.ownerId || payload?.device?.id !== core.state.device?.id
                || !Number.isSafeInteger(payload.account.profileRevision))
                throw { code: 'REQUEST_FAILED' };
            if (!preserveDraft && (effects.profileDirty() || core.state.avatarChecking)) {
                effects.profileStatus('资料读取已完成；当前输入仍保留，保存时会检查资料版本。');
                return;
            }
            const nameWasChanged = effects.profileNameInput() !== core.profileName();
            const avatarWasChanged = core.state.profileDraftAvatar !== undefined || core.state.avatarChecking;
            core.state.account = payload.account;
            if (preserveDraft) {
                effects.paintProfileReadFields(nameWasChanged, avatarWasChanged, token);
                core.state.profileConflict = false;
                effects.showProfileReload(false);
                effects.profileError('');
                effects.profileStatus('已读取最新资料；未修改的字段已更新。请核对保留的草稿，再明确保存。');
                effects.profileControls();
            }
            else
                effects.resetProfileDraft();
        }
        catch (error) {
            if (!core.accountCurrent(token) || fetchGeneration !== core.state.profileFetchGeneration)
                return;
            if (error.code === 'UNAUTHORIZED')
                return core.sessionExpired();
            effects.profileStatus('');
            effects.showProfileReload(true);
            effects.profileError('资料暂时无法读取，请稍后重试。当前输入仍保留。');
        }
    }
    async function refreshDevices() {
        void core.refreshPendingDevices();
        const token = core.accountToken();
        if (!core.accountCurrent(token))
            return;
        if (core.state.deviceEditing) {
            effects.devicesNoticeHidden(false);
            effects.devicesNotice('请先保存或取消设备名称修改，再刷新列表。');
            return;
        }
        const generation = ++core.state.deviceFetchGeneration;
        effects.devicesNoticeHidden(false);
        effects.devicesNotice('正在读取设备…');
        try {
            const payload = await core.readDevices();
            if (!core.accountCurrent(token) || generation !== core.state.deviceFetchGeneration)
                return;
            if (!Array.isArray(payload.devices))
                throw { code: 'REQUEST_FAILED' };
            if (core.state.deviceEditing) {
                effects.devicesNotice('设备记录已读取；请先保存或取消当前改名，再刷新列表。');
                return;
            }
            core.state.cachedDevices = payload.devices;
            effects.renderDevices(payload.devices);
            effects.devicesNoticeHidden(!core.state.deviceNotice);
            if (core.state.deviceNotice) {
                effects.devicesNotice(core.state.deviceNotice);
                core.state.deviceNotice = '';
            }
        }
        catch (error) {
            if (!core.accountCurrent(token) || generation !== core.state.deviceFetchGeneration)
                return;
            if (error.code === 'UNAUTHORIZED')
                return core.sessionExpired();
            effects.devicesNotice(core.state.deviceNotice ? `${core.state.deviceNotice}但列表暂时无法刷新，请稍后重试。` : '设备记录暂时无法读取。请点击刷新重试。');
            core.state.deviceNotice = '';
        }
    }
    async function refreshBrowserWorkspace() {
        const token = core.accountToken();
        if (!core.accountCurrent(token))
            return;
        const generation = ++core.state.browserFetchGeneration;
        effects.browserWorkspaceText('正在核对网页阅读能力…');
        try {
            const payload = await core.readBrowserWorkspace();
            if (!core.accountCurrent(token) || generation !== core.state.browserFetchGeneration)
                return;
            if (payload?.workspaceKind !== 'browser' || typeof payload.available !== 'boolean' ||
                typeof payload.hostId !== 'string' || payload.hostId !== core.state.hostId)
                throw { code: 'REQUEST_FAILED' };
            core.state.browserHostId = payload.hostId;
            core.state.browserAvailable = payload.available;
            effects.browserWorkspaceAvailable(payload.available);
            if (!payload.available) {
                effects.browserWorkspaceText('当前账户或电脑暂不能发起网页阅读；原有任务仍可查看。');
                return;
            }
            const prior = core.savedBrowserIntent();
            if (prior) {
                effects.browserUrlDraft(prior.urls.join('\n'));
                effects.browserGoalDraft(prior.goal);
            }
            effects.renderBrowserModels();
            effects.browserWorkspaceText(prior ? '发现上次未确认的网页任务，正在用原编号核对。' : '');
            effects.browserWorkspaceHidden(!prior);
            if (prior)
                void core.reconcileBrowserIntent(prior);
        }
        catch (error) {
            if (!core.accountCurrent(token) || generation !== core.state.browserFetchGeneration)
                return;
            core.state.browserAvailable = false;
            effects.browserWorkspaceAvailable(false);
            effects.browserWorkspaceHidden(false);
            effects.browserWorkspaceText(error.status === 404 ? '当前电脑服务还没有网页资料入口；原有项目和聊天仍可使用。'
                : error.code === 'NETWORK' ? '电脑暂时不可达，重连后可核对原网页任务。' : '网页阅读状态暂不可核对。');
        }
    }
    return { profileName, avatarSignature, accountModelMarkerKey, savedAccountModelMarker, storeAccountModelMarker, forgetAccountModelMarker, accountModelReceipt, submitAccountModelControl, browserIntentKey, savedBrowserIntent, reconcileBrowserIntent, refreshAccountModels, refreshProjects, saveAccountModelDraft, saveProfileDraft, registerProjectDraft, startBrowserDraft, profileDraftDirty, refreshPendingDevices, refreshProfile, refreshDevices, refreshBrowserWorkspace };
};
