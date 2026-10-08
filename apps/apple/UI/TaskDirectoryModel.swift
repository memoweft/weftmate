import Combine
import Foundation
import WeftMateCore

/// Cross-device task discovery uses authenticated cloud command metadata, never a local send ledger.
@MainActor
final class TaskDirectoryModel: ObservableObject {
    static let pageSize = 50
    static let maximumDisplayedTasks = 256
    let sessionId: String
    let expectedHostId: String
    let accountEpoch: UUID
    @Published private(set) var supplementReceiptIDs = Set<String>()
    @Published private(set) var rootCommands: [TaskRootCommandMetadata] = []
    @Published private(set) var loading = false
    @Published private(set) var error: String?
    @Published private(set) var hasRead = false
    @Published private(set) var hasMore = false
    @Published private(set) var limitReached = false
    @Published private(set) var unsupportedRootCount = 0
    @Published private(set) var lastReadAt: Date?

    private let client: PersonalClient
    private let initialSession: AccountSession?
    private let currentEpoch: @MainActor () -> UUID
    private let currentSession: @MainActor () -> AccountSession?
    private var active = true
    private var generation = UUID()
    private var cursor: TaskCommandPageCursor?
    private var worker: Task<TaskCommandPage, Error>?

    init(client: PersonalClient, sessionId: String, expectedHostId: String, accountEpoch: UUID,
         currentEpoch: @escaping @MainActor () -> UUID, currentSession: @escaping @MainActor () -> AccountSession?) {
        self.client = client; self.sessionId = sessionId; self.expectedHostId = expectedHostId
        self.accountEpoch = accountEpoch; self.currentEpoch = currentEpoch; self.currentSession = currentSession
        initialSession = currentSession()
    }

    var scopeIsCurrent: Bool {
        active && accountIsCurrent
    }
    private var accountIsCurrent: Bool {
        guard !sessionId.isEmpty, currentEpoch() == accountEpoch,
              let initialSession, let current = currentSession(),
              initialSession.verification == .verified, current.verification == .verified else { return false }
        return initialSession.server == current.server && initialSession.account.ownerId == current.account.ownerId
            && initialSession.hostId == current.hostId && current.hostId == expectedHostId
    }
    /// Destination construction rechecks the captured account, including after the parent has suspended reads.
    func canOpen(_ row: TaskRootCommandMetadata) -> Bool {
        accountIsCurrent && row.targetDeviceId == expectedHostId && row.sessionId == sessionId && rootCommands.contains(row)
    }
    var canLoadMore: Bool { scopeIsCurrent && hasMore && cursor != nil && !loading && !limitReached }
    func activate() { active = true }
    /// Pushing a task detail cancels reads but preserves its navigation row until the parent returns.
    func suspend() { active = false; generation = UUID(); worker?.cancel(); worker = nil; loading = false }
    func cancel() { active = false; generation = UUID(); clearContent() }

    func refresh() async {
        guard !loading, requireScope() else { return }
        generation = UUID(); clearContent()
        await loadPage(before: nil)
    }
    /// No automatic scans: a page without this session's roots can still offer explicit continuation.
    func loadMore() async {
        guard canLoadMore, requireScope(), let cursor else { return }
        await loadPage(before: cursor)
    }
    private func loadPage(before: TaskCommandPageCursor?) async {
        guard requireScope(), !loading else { return }
        loading = true; error = nil
        let request = generation, client = client, sessionId = sessionId
        let task = Task { try await client.taskCommands(sessionID: sessionId, limit: Self.pageSize, before: before) }
        worker = task
        defer { if request == generation { loading = false; worker = nil } }
        do {
            let page = try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { task.cancel() })
            guard request == generation, requireScope() else { return }
            try validate(page)
            let existing = before == nil ? [] : rootCommands
            var ids = Set(existing.map(\.commandId))
            guard page.rootCommands.allSatisfy({ ids.insert($0.commandId).inserted }) else { throw APIFailure.invalidResponse }
            guard existing.count + page.rootCommands.count <= Self.maximumDisplayedTasks else {
                limitReached = true
                error = "本次显示的任务已达到上限。请刷新查看最新记录；已有记录未删除。"
                return
            }
            supplementReceiptIDs = (before == nil ? [] : supplementReceiptIDs).union(page.supplementReceiptIDs)
            rootCommands = existing + page.rootCommands
            unsupportedRootCount = (before == nil ? 0 : unsupportedRootCount) + page.unsupportedRootCount
            cursor = page.nextCursor; hasMore = page.hasMore; hasRead = true; lastReadAt = Date()
        } catch {
            guard request == generation, requireScope() else { return }
            if let failure = error as? APIFailure {
                switch failure {
                case .accountChanged, .identityMismatch, .notAuthenticated, .server(401, _):
                    generation = UUID(); clearContent()
                default: break
                }
            }
            self.error = (error as? LocalizedError)?.errorDescription ?? "任务目录读取未完成，请稍后重试。"
        }
    }
    private func validate(_ page: TaskCommandPage) throws {
        guard let initialSession, page.scope.server == initialSession.server,
              page.scope.ownerId == initialSession.account.ownerId, page.scope.hostId == expectedHostId,
              page.sessionId == sessionId, page.hasMore == (page.nextCursor != nil),
              page.rootCommands.allSatisfy({ $0.sessionId == sessionId && $0.targetDeviceId == expectedHostId }) else { throw APIFailure.identityMismatch }
    }
    @discardableResult private func requireScope() -> Bool {
        guard scopeIsCurrent else {
            generation = UUID(); clearContent()
            error = "账户或原会话已改变，请从当前会话重新打开任务目录。"
            return false
        }
        return true
    }
    private func clearContent() {
        worker?.cancel(); worker = nil; rootCommands = []; supplementReceiptIDs = []; cursor = nil; loading = false
        hasRead = false; hasMore = false; limitReached = false; unsupportedRootCount = 0; lastReadAt = nil; error = nil
    }
}
