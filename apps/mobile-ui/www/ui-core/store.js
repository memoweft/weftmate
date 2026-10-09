/* Shared state and injected /personal/v1 transport. No presentation dependencies. */
(() => {
    const factories = {};
    globalThis.WeftUiCore = { factories, create({ effects = {}, ...environment } = {}) {
            environment = { fetch: (...args) => globalThis.fetch(...args), storage: globalThis.localStorage, crypto: globalThis.crypto, ...environment };
            const authBase = '/personal/v1/auth';
            const accessBase = '/personal/v1';
            const receiptIdPattern = /^[A-Za-z0-9._:-]{1,160}$/;
            const state = { csrfToken: null, account: null, device: null, setupGrant: null, revokeId: null, toastTimer: null,
                ownerId: null, hostId: null, online: false, capabilities: null, models: [], modelProfileId: null,
                sessions: [], selectedSessionId: null, activeChatSource: 'desktop', afterSeq: -1, seenSeq: new Set(), tasks: [], nextBefore: null,
                unresolvedSubmission: false, unresolvedRequests: new Set(), reviewableRequests: new Set(), reviewRequestId: null,
                acknowledgedDesktop: new Set(),
                syncAvailable: false, phonePane: false, phoneEvents: [], phoneAfterSeq: 0, phoneHasMore: true,
                phoneLoading: false, selectedPhoneConversationId: null, phoneDeviceNames: new Map(),
                phoneSending: false, phoneSendNotice: '', phoneDrafts: new Map(), desktopDraft: '',
                refreshTimer: null, refreshing: false,
                submitting: false, cancelSubmitting: false, lastSubmissionMs: 0,
                historyEvents: new Map(), nextBeforeSeq: null, hasOlder: false, olderLoading: false, historyGeneration: 0, historyInFlight: null, historyHasMore: false, turnStatus: null, turnEndReasonKind: null,
                identityGeneration: 0, accountViewGeneration: 0, currentView: null,
                attachmentDrafts: new Map(), attachmentGroups: new Map(), attachmentAttempts: new Map(),
                attachmentUpload: null, attachmentHasher: null, attachmentStatus: '',
                avatarGeneration: 0, avatarSelectionGeneration: 0,
                profileDraftAvatar: undefined, profileConflict: false, profileSaving: false, profileOperationGeneration: 0, profileDraftGeneration: 0,
                avatarChecking: false, avatarObjectUrl: null,
                profileFetchGeneration: 0, deviceFetchGeneration: 0, pendingDeviceFetchGeneration: 0, deviceEditing: null, deviceNotice: '', cachedDevices: [] };
            const memory = { viewGeneration: 0, entryGeneration: 0, queryGeneration: 0, selectedGeneration: 0, operationGeneration: 0,
                status: null, items: [], revision: null, cursor: null, hasMore: false, query: '', kind: 'cognition',
                selected: null, sources: [], mode: 'detail', drafts: new Map(), activeOperation: null,
                unresolvedMarker: null, cleanupMarker: null, cleanupRetrying: false, receiptNotice: null };
            const conversationTasks = { ownerId: null, identity: -1, generation: 0, entries: new Map(), inFlight: null };
            const conversationApprovals = { scope: null, entries: new Map(), reads: new Map(), operations: new Map(), readGeneration: 0 };
            const conversationQuestions = { scope: null, entries: new Map(), reads: new Map(), operations: new Map(), drafts: new Map(), readGeneration: 0 };
            const api = (path, options) => core.requestJson(`${core.authBase}${path}`, options);
            const browserRequestId = /^[0-9a-f-]{36}$/;
            const browserModelId = /^[A-Za-z0-9._-]{1,128}$/;
            const memoryBase = `${accessBase}/memory`;
            const memoryKinds = { cognition: '理解', entity: '人物与事物', relationship: '关系', event: '经历' };
            const memoryPreDispatchCodes = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'INVALID_REQUEST', 'NOT_FOUND', 'MEMORY_DISABLED',
                'MEMORY_UNAVAILABLE', 'MEMORY_ACTION_UNSUPPORTED', 'MEMORY_DELETE_UNAVAILABLE']);
            const memoryItemId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
            const memoryPathId = (id) => typeof id === 'string' && memoryItemId.test(id) ? id : null;
            const markerId = /^[A-Za-z0-9_.:-]{1,128}$/;
            const sessionIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
            const syncIdPattern = /^(?:[A-Za-z][A-Za-z0-9_-]{0,31}-)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
            const originalAttachmentBytes = 1024 * 1024 * 1024;
            const sharedImageBytes = 5 * 1024 * 1024;
            const sharedMessageBytes = 10 * 1024 * 1024;
            const sharedTextBytes = 16 * 1024;
            const attachmentImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
            const attachmentTextTypes = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/x-ndjson']);
            const attachmentTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/;
            const approvalModes = [
                ['auto', '自动（推荐）', '由 WeftMate 判断，有风险才问你'],
                ['ask', '每次询问', '执行和修改前都先问'],
                ['accept-edits', '自动接受文件修改', '改文件直接做，其他风险照常询问'],
                ['plan', '先出计划', '先给计划，你确认后再做'],
                ['allow-all', '全部允许', '不再询问，删除、发布和付款也会直接执行'],
            ];
            let currentApprovalMode = 'auto';
            const approvalIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
            const approvalRequestPattern = /^[A-Za-z0-9_.:-]{1,128}$/;
            const approvalIdentityFields = ['approvalId', 'sessionId', 'taskId', 'sourceCommandId', 'sourceReceiptId',
                'turn', 'callId', 'rootCallId', 'toolName', 'createdAt'];
            const questionIdentityFields = ['questionRpcId', 'sessionId', 'taskId', 'sourceCommandId', 'sourceReceiptId', 'turn', 'createdAt'];
            let resourceCache = null;
            const serviceStateLabels = { ready: '运行中', connected: '运行中', stopped: '已停止', starting: '启动中',
                disabled: '未启用', unavailable: '不可用', unconfigured: '尚未配置', degraded: '需要处理' };
            const core = { authBase, accessBase, receiptIdPattern, state, memory, conversationTasks, conversationApprovals, conversationQuestions, api, browserRequestId, browserModelId, memoryBase, memoryKinds, memoryPreDispatchCodes, memoryItemId, memoryPathId, markerId, sessionIdPattern, syncIdPattern, originalAttachmentBytes, sharedImageBytes, sharedMessageBytes, sharedTextBytes, attachmentImageTypes, attachmentTextTypes, attachmentTypePattern, approvalModes, currentApprovalMode, approvalIdPattern, approvalRequestPattern, approvalIdentityFields, questionIdentityFields, resourceCache, serviceStateLabels };
            core.state.messageMode = 'queue';
            core.state.projects = [];
            core.state.projectCanManage = false;
            core.state.projectPending = null;
            core.state.projectFetchGeneration = 0;
            core.state.accountModels = [];
            core.state.accountModelsCanManage = false;
            core.state.accountModelFetchGeneration = 0;
            core.state.accountModelEditing = null;
            core.state.accountModelBusy = false;
            core.state.browserHostId = null;
            core.state.browserAvailable = false;
            core.state.browserFetchGeneration = 0;
            core.state.phoneBindings = new Map();
            core.state.phoneHostEvents = new Map();
            core.state.phoneHistoryCursors = new Map();
            core.state.phoneHandoffBusy = false;
            core.state.phoneHandoffSelections = new Map();
            for (const factory of Object.values(factories))
                Object.assign(core, factory(core, effects, environment));
            return core;
        } };
})();
