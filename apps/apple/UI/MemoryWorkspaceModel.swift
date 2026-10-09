import Combine
import Foundation
import WeftMateCore

struct MemoryOperationPresentation: Identifiable, Sendable {
    var id: String { record.requestId }
    let record: LocalMemoryOperationRecord
    let note: String?
    let lookupNotFound: Bool
    var title: String {
        switch record.identity.operation {
        case .correct: "纠正记忆"
        case .mute: "停用记忆"
        case .deleteItem: "删除记忆"
        case .deleteEvidence: "删除来源"
        }
    }
    var status: String {
        if record.isRedacted { return "旧纠正文字已移除，操作状态保留" }
        switch record.state {
        case .queued: return "已记下，等待连接"
        case .uncertain: return "结果待确认"
        case .applied: return record.cleanupPending ? "已生效，存储清理待完成" : "已生效"
        case .noChange: return record.cleanupPending ? "内容未变化，存储清理待完成" : "内容未变化"
        case .revisionConflict: return "版本已变化，请重新读取"
        case .rejected: return "操作未接受"
        }
    }
}

struct MemoryActionContext: Sendable {
    let generation: UUID
    let detailToken: UUID
    let session: AccountSession
    let kind: MemoryKind
    let itemId: String
    let worldRevision: Int
    let operation: MemoryMutationKind
    let evidenceId: String?
    let correction: String?
}

@MainActor
final class MemoryWorkspaceModel: ObservableObject {
    @Published var forgetConfirmation = ForgetConfirmationState()
    @Published private(set) var forgetPreviewLoading = false
    @Published private(set) var forgetPreviewError: String?
    private var forgetPreviewToken = UUID()
    private var forgetTarget: String?
    func prepareForget(_ context: MemoryActionContext) async {
        forgetConfirmation = .init(); forgetPreviewError = nil; forgetTarget = nil
        let token = UUID(); forgetPreviewToken = token
        guard context.operation.isDeletion, matches(context) else { return }
        forgetPreviewLoading = true
        defer { if forgetPreviewToken == token { forgetPreviewLoading = false } }
        do {
            let preview = try await client.memoryForgetPreview(kind: context.kind, itemID: context.itemId, evidenceID: context.evidenceId, expectedRevision: context.worldRevision)
            guard token == forgetPreviewToken, matches(context) else { return }
            forgetTarget = context.evidenceId ?? context.itemId; forgetConfirmation.preview = preview
        } catch { if token == forgetPreviewToken, matches(context) { forgetPreviewError = "无法读取遗忘范围，或内容版本已变化。请重新读取后确认。" } }
    }
    func cancelForget() { forgetPreviewToken = UUID(); forgetTarget = nil; forgetConfirmation = .init(); forgetPreviewLoading = false; forgetPreviewError = nil }
    func canForget(_ context: MemoryActionContext) -> Bool {
        canMutate && matches(context) && forgetTarget == (context.evidenceId ?? context.itemId) && forgetConfirmation.preview?.worldRevision == context.worldRevision
    }
    @Published var query = ""
    @Published var kind: MemoryKind = .cognition
    @Published private(set) var correctionText = ""
    @Published private(set) var status: MemoryStatusSnapshot?
    @Published private(set) var items: [MemoryItem] = []
    @Published private(set) var detail: MemoryItemDetail?
    @Published private(set) var sources: MemorySourcesSnapshot?
    @Published private(set) var loading = false
    @Published private(set) var detailLoading = false
    @Published private(set) var sourcesLoading = false
    @Published private(set) var hasMore = false
    @Published private(set) var error: String?
    @Published private(set) var detailError: String?
    @Published private(set) var notice: String?
    @Published private(set) var operations: [String: MemoryOperationPresentation] = [:]
    @Published private(set) var busyOperations = Set<String>()
    @Published private(set) var journalUsable = false

    private let client: PersonalClient
    private let journal: LocalMemoryOperationStore?
    private let expectedSession: AccountSession?
    private let epoch: UUID
    private let currentEpoch: @MainActor () -> UUID
    private let currentSession: @MainActor () -> AccountSession?
    private var generation = UUID()
    private var detailRequest = UUID()
    private var cursor: MemoryPageCursor?
    private var worldRevision: Int?
    private var activeQuery = ""
    private var activeKind: MemoryKind = .cognition
    private var workers: [String: Task<Void, Never>] = [:]
    private var operationTokens: [String: UUID] = [:]
    private var preparationWorker: Task<Void, Never>?
    private var preparationToken = UUID()
    private var preparingMutation = false
    private var active = true
    private var listWorker: Task<Void, Never>?
    private var listWorkerID = UUID()
    private var detailWorker: Task<Void, Never>?
    private var detailWorkerID = UUID()
    private var sourceWorker: Task<Void, Never>?
    private var sourceWorkerID = UUID()

    init(client: PersonalClient, journal: LocalMemoryOperationStore?, accountEpoch: UUID,
         currentEpoch: @escaping @MainActor () -> UUID, currentSession: @escaping @MainActor () -> AccountSession?) {
        self.client = client; self.journal = journal; epoch = accountEpoch
        self.currentEpoch = currentEpoch; self.currentSession = currentSession
        expectedSession = currentSession()
        journalUsable = journal != nil
        if journal == nil { notice = "本机操作记录未能打开。可以读取记忆，修改暂不可用。" }
    }

    var validScope: Bool {
        guard active, currentEpoch() == epoch, let expectedSession, let current = currentSession() else { return false }
        return current.server == expectedSession.server && current.account.ownerId == expectedSession.account.ownerId
            && current.hostId == expectedSession.hostId
    }
    private func canPublish(_ token: UUID) -> Bool { validScope && generation == token && !Task.isCancelled }
    private func checkScope(_ scope: MemoryReadScope) -> Bool {
        guard validScope, let current = currentSession() else { return false }
        return scope.server == current.server && scope.ownerId == current.account.ownerId && scope.hostId == current.hostId
    }
    var visibleOperations: [MemoryOperationPresentation] {
        operations.values.sorted { $0.record.createdAt < $1.record.createdAt }
    }
    var editorToken: UUID { detailRequest }
    var correctionValidationMessage: String? {
        guard !correctionText.isEmpty, let detail, let session = currentSession() else { return nil }
        if correctionText.utf16.count > 4_000 { return "纠正内容太长，请缩短后保存。" }
        do {
            _ = try MemoryMutationIntent(session: session, operation: .correct, itemKind: detail.item.kind,
                targetID: detail.item.id, requestID: "apple-memory-00000000-0000-0000-0000-000000000000",
                expectedWorldRevision: detail.worldRevision, correction: correctionText)
            return nil
        } catch let error as ClientInputFailure { return error.errorDescription }
        catch { return nil }
    }
    func setCorrection(_ text: String, token: UUID) {
        guard validScope, token == detailRequest, detail != nil else { return }
        correctionText = text
    }
    func actionContext(_ operation: MemoryMutationKind, evidenceID: String? = nil) -> MemoryActionContext? {
        guard canMutate, let session = currentSession(), let detail else { return nil }
        let allowed: Bool
        switch operation {
        case .correct: allowed = detail.availableActions.correct.available
        case .mute: allowed = detail.availableActions.mute.available
        case .deleteItem: allowed = detail.availableActions.delete.available
        case .deleteEvidence:
            allowed = status?.status.capabilities.deleteEvidence == true && evidenceID.map { id in
                sources?.sources.contains { $0.evidenceId == id } == true
            } == true
        }
        guard allowed else { return nil }
        return .init(generation: generation, detailToken: detailRequest, session: session,
            kind: detail.item.kind, itemId: detail.item.id, worldRevision: detail.worldRevision,
            operation: operation, evidenceId: evidenceID, correction: operation == .correct ? correctionText : nil)
    }
    private func matches(_ context: MemoryActionContext) -> Bool {
        guard validScope, generation == context.generation, detailRequest == context.detailToken,
              let session = currentSession(), let detail else { return false }
        return session == context.session && detail.item.id == context.itemId && detail.item.kind == context.kind
            && detail.worldRevision == context.worldRevision
    }
    var canMutate: Bool { validScope && currentSession()?.verification == .verified && journalUsable && !preparingMutation }

    func reload(cancelOperations: Bool = true) async {
        guard currentEpoch() == epoch else { invalidate(); return }
        active = true
        listWorker?.cancel()
        let token = UUID(); listWorkerID = token
        let worker = Task { [weak self] in
            guard let self, !Task.isCancelled else { return }
            await self.performReload(cancelOperations: cancelOperations)
        }
        listWorker = worker
        await listWorker?.value
        if listWorkerID == token { listWorker = nil }
    }

    private func performReload(cancelOperations: Bool) async {
        guard validScope else { invalidate(); return }
        let request = UUID(); generation = request
        let nextQuery = query; let nextKind = kind
        loading = true; error = nil; items = []; cursor = nil; hasMore = false; worldRevision = nil
        closeDetail(cancelOperations: cancelOperations)
        defer { if generation == request && validScope { loading = false } }
        do {
            if let journal, let session = currentSession() {
                let account = try LocalAccountScope(server: session.server, ownerId: session.account.ownerId)
                do {
                    let records = try await journal.operations(account: account)
                    guard canPublish(request) else { return }
                    journalUsable = true
                    operations = Dictionary(uniqueKeysWithValues: records.filter { $0.identity.hostId == session.hostId }.map {
                        ($0.requestId, .init(record: $0, note: "本机保存的操作状态，尚未确认当前结果。", lookupNotFound: false))
                    })
                    for record in records where record.identity.hostId == session.hostId {
                        guard canPublish(request) else { return }
                        if let proof = record.redactionProof,
                           try await client.redactMemoryCorrection(proof) == .deferredInFlight {
                            guard canPublish(request) else { return }
                            notice = "本机保存的旧纠正文字已移除，仍有进行中的操作等待释放。"
                        }
                    }
                } catch {
                    guard canPublish(request) else { return }
                    journalUsable = false
                    notice = "本机操作记录暂不可用，修改已暂停。" + safeMessage(error)
                }
            }

            let service = try await client.memoryStatus()
            guard canPublish(request), checkScope(service.scope) else { return }
            status = service
            guard service.status.capabilities.list else {
                error = "记忆服务当前不支持读取列表。"; return
            }
            let page = try await client.memoryItems(kind: nextKind, query: nextQuery)
            guard canPublish(request), checkScope(page.scope) else { return }
            items = page.items; cursor = page.nextCursor; hasMore = page.hasMore; worldRevision = page.worldRevision
            activeQuery = nextQuery; activeKind = nextKind
        } catch {
            guard canPublish(request) else { return }
            self.error = safeMessage(error)
        }
    }

    func loadMore() async {
        guard listWorker == nil else { return }
        let token = UUID(); listWorkerID = token
        let worker = Task { [weak self] in
            guard let self, !Task.isCancelled else { return }
            await self.performLoadMore()
        }
        listWorker = worker
        await listWorker?.value
        if listWorkerID == token { listWorker = nil }
    }

    private func performLoadMore() async {
        guard validScope, !loading, let cursor, hasMore else { return }
        let request = generation; loading = true
        defer { if generation == request && validScope { loading = false } }
        do {
            let page = try await client.memoryItems(kind: activeKind, query: activeQuery, after: cursor)
            guard canPublish(request), checkScope(page.scope) else { return }
            items.append(contentsOf: page.items); self.cursor = page.nextCursor; hasMore = page.hasMore
        } catch {
            guard canPublish(request) else { return }
            if case APIFailure.server(409, "MEMORY_REVISION_CHANGED") = error {
                notice = "记忆内容已更新，正在重新读取当前版本。"
                await reload()
            } else { self.error = safeMessage(error) }
        }
    }

    func open(_ item: MemoryItem) async {
        closeDetail()
        let token = UUID(); detailWorkerID = token
        let worker = Task { [weak self] in
            guard let self, !Task.isCancelled else { return }
            await self.performOpen(item)
        }
        detailWorker = worker
        await detailWorker?.value
        if detailWorkerID == token { detailWorker = nil }
    }

    private func performOpen(_ item: MemoryItem) async {
        guard validScope else { invalidate(); return }
        let request = UUID(); detailRequest = request
        detail = nil; sources = nil; detailError = nil; correctionText = ""; detailLoading = true
        defer { if detailRequest == request && validScope { detailLoading = false } }
        do {
            let value = try await client.memoryDetail(kind: item.kind, itemID: item.id, expectedWorldRevision: worldRevision)
            guard !Task.isCancelled, detailRequest == request, checkScope(value.scope) else { return }
            detail = value
        } catch {
            guard !Task.isCancelled, detailRequest == request, validScope else { return }
            detailError = safeMessage(error)
            if case APIFailure.server(409, "MEMORY_REVISION_CHANGED") = error { await reload() }
        }
    }

    func loadSources() async {
        guard sourceWorker == nil else { return }
        let token = UUID(); sourceWorkerID = token
        let worker = Task { [weak self] in
            guard let self, !Task.isCancelled else { return }
            await self.performLoadSources()
        }
        sourceWorker = worker
        await sourceWorker?.value
        if sourceWorkerID == token { sourceWorker = nil }
    }

    private func performLoadSources() async {
        guard validScope, !sourcesLoading, let detail else { return }
        let request = detailRequest; sourcesLoading = true; detailError = nil
        defer { if detailRequest == request && validScope { sourcesLoading = false } }
        do {
            let value = try await client.memorySources(kind: detail.item.kind, itemID: detail.item.id,
                expectedWorldRevision: detail.worldRevision)
            guard !Task.isCancelled, detailRequest == request, checkScope(value.scope) else { return }
            sources = value
        } catch {
            guard !Task.isCancelled, detailRequest == request, validScope else { return }
            detailError = safeMessage(error)
        }
    }

    func closeSources() {
        sourceWorker?.cancel(); sourceWorker = nil; sourceWorkerID = UUID()
        detailRequest = UUID(); sources = nil; sourcesLoading = false
    }

    func closeDetail(cancelOperations: Bool = true) {
        detailWorker?.cancel(); sourceWorker?.cancel()
        detailWorker = nil; sourceWorker = nil
        detailWorkerID = UUID(); sourceWorkerID = UUID()
        if cancelOperations {
            preparationWorker?.cancel(); preparationToken = UUID(); preparingMutation = false
            workers.values.forEach { $0.cancel() }
        }

        cancelForget()
        detailRequest = UUID(); detail = nil; sources = nil; correctionText = ""
        detailError = nil; detailLoading = false; sourcesLoading = false
    }

    func mutate(_ context: MemoryActionContext) async {
        guard preparationWorker == nil, canMutate, matches(context) else { return }
        let token = UUID(); preparationToken = token
        let worker = Task { [weak self] in
            guard let self, !Task.isCancelled else { return }
            await self.performMutation(context)
        }
        preparationWorker = worker
        await worker.value
        if preparationToken == token { preparationWorker = nil }
    }

    private func performMutation(_ context: MemoryActionContext) async {
        guard canMutate, matches(context), let journal else { return }
        if context.operation == .correct, let error = correctionValidationMessage { notice = error; return }
        if context.operation.isDeletion && !canForget(context) { return }
        let operation = context.operation
        let target = context.evidenceId ?? context.itemId
        guard !operations.values.contains(where: { $0.record.identity.targetId == target &&
            ($0.record.state == .queued || $0.record.state == .uncertain) }) else {
            notice = "这项内容还有待确认操作，请先重新确认。"; return
        }
        preparingMutation = true
        let request = generation
        defer { if request == generation { preparingMutation = false } }
        do {
            let intent = try MemoryMutationIntent(session: context.session, operation: operation,
                itemKind: operation == .deleteEvidence ? nil : context.kind, targetID: target,
                requestID: "apple-memory-" + UUID().uuidString.lowercased(), expectedWorldRevision: context.worldRevision,
                correction: context.correction, deleteConversationSnippets: operation.isDeletion ? forgetConfirmation.deleteConversationSnippets : nil)
            let record = try await journal.persist(intent)
            guard canPublish(request), matches(context) else { return }
            publish(record, note: "操作已记下，正在确认。")
            await reconcile(record.requestId, allowSubmission: true)
        } catch { if canPublish(request) { notice = safeMessage(error) } }
    }

    func reconcile(_ requestID: String, allowSubmission: Bool = false) async {
        guard validScope, let row = operations[requestID], !busyOperations.contains(requestID), let journal else { return }
        if allowSubmission, !row.lookupNotFound && row.record.state != .queued { return }
        let request = generation; let token = UUID(); operationTokens[requestID] = token
        busyOperations.insert(requestID)
        let worker = Task { [weak self] in
            guard let self, !Task.isCancelled, self.canPublish(request) else { return }
            defer {
                if self.operationTokens[requestID] == token {
                    self.busyOperations.remove(requestID); self.workers[requestID] = nil
                    self.operationTokens[requestID] = nil
                }
            }
            do {
                guard let intent = row.record.intent else {
                    guard let proof = row.record.redactionProof else { return }
                    _ = try await self.client.reconcileRedactedMemoryCorrection(proof)
                    guard self.canPublish(request) else { return }
                    self.publish(row.record, note: "旧纠正文已移除，仅重新确认保存的操作状态。")
                    return
                }
                let result = try await self.client.reconcileMemoryMutation(intent, allowSubmission: allowSubmission,
                    knownReceipt: row.record.receipt)
                if case .notFound = result, !self.canPublish(request) { return }
                switch result {
                case .notFound:
                    self.publish(row.record, note: row.record.receipt == nil ? "当前未确认生效，可明确继续原操作。" : "已有保存结果，但服务当前无法确认；未重复操作。",
                                 lookupNotFound: row.record.receipt == nil && (row.record.state == .queued || row.record.state == .uncertain))
                case .found(let receipt):
                    let prior = try await journal.operation(for: intent) ?? row.record
                    let saved = try await journal.recordReceipt(receipt, for: intent, expectedRevision: prior.revision)
                    guard self.canPublish(request) else { return }
                    self.publish(saved)
                    await self.applyConfirmedEffect(saved)
                }
            } catch {
                if let intent = row.record.intent {
                    var saved = (try? await journal.operation(for: intent)) ?? row.record
                    if saved.state == .queued || saved.state == .uncertain {
                        if let value = try? await journal.markUncertain(intent, expectedRevision: saved.revision,
                            errorCode: (error as? APIFailure)?.safeCode ?? "MEMORY_UNCONFIRMED") { saved = value }
                    }
                    guard self.canPublish(request) else { return }
                    self.publish(saved, note: "结果未确认，已保留这次操作。" + self.safeMessage(error))
                } else { self.publish(row.record, note: self.safeMessage(error)) }
            }
        }
        workers[requestID] = worker
        await worker.value
    }

    func retryCleanup(_ requestID: String) async {
        guard validScope, !busyOperations.contains(requestID), let row = operations[requestID],
              let intent = row.record.intent, let receipt = row.record.receipt, receipt.cleanupPending,
              let journal else { return }
        let request = generation; let token = UUID(); operationTokens[requestID] = token
        busyOperations.insert(requestID)
        let worker = Task { [weak self] in
            guard let self, self.canPublish(request) else { return }
            defer {
                if self.operationTokens[requestID] == token {
                    self.busyOperations.remove(requestID); self.workers[requestID] = nil; self.operationTokens[requestID] = nil
                }
            }
            do {
                let prepared = try await journal.prepareCleanupRetry(for: intent, expectedRevision: row.record.revision)
                try Task.checkCancellation()
                guard self.canPublish(request) else { return }
                let result = try await self.client.retryMemoryCleanup(intent, knownReceipt: receipt, allowSubmission: true)
                if case .found(let fresh) = result {
                    let prior = try await journal.operation(for: intent) ?? prepared
                    let saved = try await journal.recordReceipt(fresh, for: intent, expectedRevision: prior.revision)
                    guard self.canPublish(request) else { return }
                    self.publish(saved); await self.applyConfirmedEffect(saved)
                } else if self.canPublish(request) { self.publish(prepared, note: "存储清理当前未确认，请重新读取。") }
            } catch {
                let prior = (try? await journal.operation(for: intent)) ?? row.record
                let uncertain = (try? await journal.markCleanupUncertain(for: intent, expectedRevision: prior.revision,
                    errorCode: (error as? APIFailure)?.safeCode ?? "CLEANUP_UNCONFIRMED")) ?? prior
                guard self.canPublish(request) else { return }
                self.publish(uncertain, note: "存储清理结果待确认，未重复删除内容。")
            }
        }
        workers[requestID] = worker
        await worker.value
    }

    private func applyConfirmedEffect(_ record: LocalMemoryOperationRecord) async {
        guard validScope, !Task.isCancelled, let intent = record.intent, let receipt = record.receipt else { return }
        let request = generation
        if receipt.state == .revisionConflict {
            notice = "内容版本已变化。本次未覆盖，请重新读取后明确操作。"
            await reload(cancelOperations: false); return
        }
        guard receipt.effectApplied else { return }
        if intent.operation.isDeletion {
            if intent.operation == .deleteItem { items.removeAll { $0.id == intent.targetId && $0.kind == intent.itemKind } }
            closeDetail(cancelOperations: false)
            if intent.operation == .deleteItem, let journal {
                do {
                    let result = try await journal.redactCorrections(deletedBy: intent, expectedRevision: record.revision)
                    var deferred = 0
                    for proof in result.proofs {
                        guard canPublish(request) else { return }
                        if try await client.redactMemoryCorrection(proof) == .deferredInFlight { deferred += 1 }
                    }
                    guard canPublish(request) else { return }
                    if !result.retainedNewerRequestIds.isEmpty {
                        notice = "删除确认之前的已确定纠正记录已清理，后续版本记录保留。"
                    } else {
                        notice = result.currentJournalScopeComplete && deferred == 0
                            ? "本机当前操作记录中的旧纠正文字已移除；备份和其他副本不在此范围。"
                            : "本机旧纠正文字仍有待确认项，尚未全部移除。"
                    }
                    if !result.pendingRequestIds.isEmpty { notice = (notice ?? "") + " 还有尚未确认的旧操作。" }
                    if deferred > 0 { notice = (notice ?? "") + " 正在进行的旧操作尚未完成内存清理。" }
                    if let session = currentSession() {
                        let account = try LocalAccountScope(server: session.server, ownerId: session.account.ownerId)
                        let rows = try await journal.operations(account: account)
                        guard canPublish(request) else { return }
                        operations = Dictionary(uniqueKeysWithValues: rows.filter { $0.identity.hostId == session.hostId }.map { ($0.requestId, .init(record: $0, note: nil, lookupNotFound: false)) })
                    }
                } catch { if canPublish(request) { notice = "删除已生效，本机旧纠正文字的清理尚未确认。" } }
            }
        } else {
            closeDetail(cancelOperations: false)
            notice = intent.operation == .correct ? "纠正已生效，正在读取当前内容。" : "停用已生效，正在读取当前状态。"
        }
        if receipt.cleanupPending { notice = (notice.map { $0 + " " } ?? "") + "服务端存储清理待完成。" }
        guard canPublish(request) else { return }
        let outcomeNotice = notice
        await reload(cancelOperations: false)
        if validScope, !Task.isCancelled { notice = outcomeNotice }
    }

    private func publish(_ record: LocalMemoryOperationRecord, note: String? = nil, lookupNotFound: Bool = false) {
        guard validScope, !Task.isCancelled, record.identity.hostId == currentSession()?.hostId else { return }
        operations[record.requestId] = .init(record: record, note: note, lookupNotFound: lookupNotFound)
    }
    private func safeMessage(_ error: Error) -> String {
        if error is CancellationError { return "操作已暂停，已保存的状态会在重新打开后保留。" }
        if let failure = error as? LocalMemoryOperationFailure {
            return switch failure {
            case .staleRevision, .invalidTransition: "本机操作状态已更新，请先重新确认。"
            case .redactedRequest: "这次操作的旧纠正文字已移除，只能重新确认状态。"
            case .invalidIntent: "内容或目标已变化，本次尚未提交。"
            case .invalidReceipt, .intentConflict: "操作结果未能与原记录对应，请重新确认。"
            default: failure.errorDescription ?? "本机操作记录暂不可用。"
            }
        }
        return (error as? LocalizedError)?.errorDescription ?? "记忆操作暂时未完成，请稍后重试。"
    }
    func invalidate() {
        active = false
        listWorker?.cancel(); detailWorker?.cancel(); sourceWorker?.cancel()
        listWorker = nil; detailWorker = nil; sourceWorker = nil
        listWorkerID = UUID(); detailWorkerID = UUID(); sourceWorkerID = UUID()

        generation = UUID(); detailRequest = UUID()
        preparationWorker?.cancel(); preparationWorker = nil; preparationToken = UUID(); preparingMutation = false
        workers.values.forEach { $0.cancel() }; workers = [:]; operationTokens = [:]
        items = []; detail = nil; sources = nil; correctionText = ""; status = nil
        operations = [:]; busyOperations = []; loading = false; detailLoading = false; sourcesLoading = false
        cursor = nil; worldRevision = nil; hasMore = false; error = nil; detailError = nil; notice = nil
    }
}
