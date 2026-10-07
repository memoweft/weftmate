import Combine
import CryptoKit
import Foundation
import UniformTypeIdentifiers
import WeftMateCore

struct TaskVerifiedExport: Identifiable, Sendable {
    let id: UUID
    let taskId: String
    let artifactId: String
    let fileName: String
    let data: Data
    let sha256: String
    /// The validated bytes remain UTF-8 text even when the original suffix names a binary format.
    var contentType: UTType {
        let suffix = (fileName as NSString).pathExtension
        switch suffix.lowercased() {
        case "csv": return .commaSeparatedText
        case "tsv": return .tabSeparatedText
        case "": return .utf8PlainText
        default: return UTType(filenameExtension: suffix, conformingTo: .utf8PlainText) ?? .utf8PlainText
        }
    }
}

/// Displays only data correlated with one captured account epoch and original task command.
@MainActor
final class TaskWorkspaceModel: ObservableObject {
    let taskId: String
    let expectedHostId: String
    let expectedSessionId: String
    let expectedRequestId: String?
    let accountEpoch: UUID
    @Published private(set) var snapshot: TaskSnapshot?
    @Published private(set) var lastReadAt: Date?
    @Published private(set) var loading = false
    @Published private(set) var error: String?
    @Published private(set) var sourcePreviews: [String: TaskSourcePreview] = [:]
    @Published private(set) var loadingSources = Set<String>()
    @Published private(set) var sourceErrors: [String: String] = [:]
    @Published private(set) var artifactPreviews: [String: TaskArtifactPreview] = [:]
    @Published private(set) var loadingArtifacts = Set<String>()
    @Published private(set) var artifactErrors: [String: String] = [:]
    @Published private(set) var exportingArtifacts = Set<String>()
    @Published private(set) var exportNotes: [String: String] = [:]
    @Published private(set) var scopeInvalidated = false
    @Published private(set) var contentVersion = UUID()
    @Published private(set) var stopBusy = false
    @Published private(set) var stopRecord: TaskStopRecord?
    @Published private(set) var stopError: String?
    @Published private(set) var stopAcknowledgedInMemory = false
    @Published private(set) var stopAcknowledgmentSaveFailed = false

    private let client: PersonalClient
    private let initialSession: AccountSession?
    private let currentEpoch: @MainActor () -> UUID
    private let currentSession: @MainActor () -> AccountSession?
    private let stateDirectory: URL?
    private var stopJournal: TaskStopJournal?
    private var stopRecordsLoaded = false
    private var active = true
    private var generation = UUID()
    private var sourceTokens: [String: UUID] = [:]
    private var artifactTokens: [String: UUID] = [:]
    private var exportTokens: [String: UUID] = [:]
    private var refreshWorker: Task<TaskSnapshot, Error>?
    private var sourceWorkers: [String: Task<TaskSourcePreview, Error>] = [:]
    private var artifactWorkers: [String: Task<TaskArtifactPreview, Error>] = [:]
    private var exportWorkers: [String: Task<TaskArtifactDownload, Error>] = [:]
    private var stopWorker: Task<TaskStopObservation, Error>?

    init(client: PersonalClient, taskId: String, expectedHostId: String, expectedSessionId: String,
         expectedRequestId: String? = nil, accountEpoch: UUID, stateDirectory: URL? = nil,
         currentEpoch: @escaping @MainActor () -> UUID,
         currentSession: @escaping @MainActor () -> AccountSession?) {
        self.client = client; self.taskId = taskId; self.expectedHostId = expectedHostId
        self.expectedSessionId = expectedSessionId; self.expectedRequestId = expectedRequestId
        self.accountEpoch = accountEpoch; self.currentEpoch = currentEpoch; self.currentSession = currentSession
        self.stateDirectory = stateDirectory
        initialSession = currentSession()
    }

    var scopeIsCurrent: Bool {
        active && contextIsCurrent
    }
    /// Navigation may suspend reads while the captured account/context remains valid.
    var contextIsCurrent: Bool {
        guard currentEpoch() == accountEpoch, let initialSession, let current = currentSession(),
              initialSession.verification == .verified, current.verification == .verified else { return false }
        return initialSession.server == current.server && initialSession.account.ownerId == current.account.ownerId
            && initialSession.hostId == current.hostId && current.hostId == expectedHostId
    }
    func activate() { active = true }
    func cancel() {
        active = false; generation = UUID(); clearContent()
    }

    func refresh() async {
        guard !loading, !stopBusy, requireScope() else { return }
        loading = true; error = nil
        let request = generation
        let client = client, taskId = taskId
        let worker = Task { try await client.taskDetail(taskID: taskId) }
        refreshWorker = worker
        defer { if request == generation { loading = false; refreshWorker = nil } }
        do {
            let value = try await workerValue(worker)
            guard requireScope(), request == generation else { return }
            try validate(value)
            applySnapshot(value)
            await loadStopRecord(generation: request)
        } catch {
            guard requireScope(), request == generation else { return }
            if handleScopeFailure(error) { return }
            self.error = friendly(error)
        }
    }
    func loadSource(_ sourceId: String) async {
        guard requireScope(), let expected = snapshot?.sources.first(where: { $0.snapshotId == sourceId }),
              !loadingSources.contains(sourceId) else { return }
        let token = UUID(), request = generation
        sourceTokens[sourceId] = token; loadingSources.insert(sourceId); sourceErrors[sourceId] = nil
        let client = client, taskId = taskId
        let worker = Task { try await client.taskSourcePreview(taskID: taskId, sourceID: sourceId) }
        sourceWorkers[sourceId] = worker
        defer { if sourceTokens[sourceId] == token { loadingSources.remove(sourceId); sourceWorkers[sourceId] = nil } }
        do {
            let value = try await workerValue(worker)
            guard requireScope(), request == generation, sourceTokens[sourceId] == token else { return }
            guard value.taskId == taskId, matches(value.scope), value.metadata == expected,
                  snapshot?.sources.first(where: { $0.snapshotId == sourceId }) == expected else { throw APIFailure.identityMismatch }
            sourcePreviews[sourceId] = value
        } catch {
            guard requireScope(), request == generation, sourceTokens[sourceId] == token else { return }
            if handleScopeFailure(error) { return }
            sourceErrors[sourceId] = friendly(error)
        }
    }
    func closeSource(_ sourceId: String) {
        sourceWorkers[sourceId]?.cancel(); sourceWorkers[sourceId] = nil
        sourceTokens[sourceId] = nil; loadingSources.remove(sourceId)
        sourcePreviews[sourceId] = nil; sourceErrors[sourceId] = nil
    }
    func previewArtifact(_ artifactId: String) async {
        guard requireScope(), let expected = expectedArtifact(artifactId), !loadingArtifacts.contains(artifactId) else { return }
        let token = UUID(), request = generation
        artifactTokens[artifactId] = token; loadingArtifacts.insert(artifactId); artifactErrors[artifactId] = nil
        let client = client, taskId = taskId
        let worker = Task { try await client.taskArtifactPreview(taskID: taskId, artifactID: artifactId) }
        artifactWorkers[artifactId] = worker
        defer { if artifactTokens[artifactId] == token { loadingArtifacts.remove(artifactId); artifactWorkers[artifactId] = nil } }
        do {
            let value = try await workerValue(worker)
            guard requireScope(), request == generation, artifactTokens[artifactId] == token else { return }
            guard matches(value.scope), artifactMatches(value.artifact, expected), expectedArtifact(artifactId) == expected else {
                throw APIFailure.identityMismatch
            }
            try validateBytes(Data(value.text.utf8), artifact: expected)
            artifactPreviews[artifactId] = value
        } catch {
            guard requireScope(), request == generation, artifactTokens[artifactId] == token else { return }
            if handleScopeFailure(error) { return }
            artifactErrors[artifactId] = friendly(error)
        }
    }
    /// Explicit action only; fetching a task or source never downloads an artifact.
    func prepareArtifactExport(_ artifactId: String) async -> TaskVerifiedExport? {
        guard requireScope(), let expected = expectedArtifact(artifactId), !exportingArtifacts.contains(artifactId) else { return nil }
        let token = UUID(), request = generation
        exportTokens[artifactId] = token; exportingArtifacts.insert(artifactId); artifactErrors[artifactId] = nil
        exportNotes[artifactId] = nil
        let client = client, taskId = taskId
        let worker = Task { try await client.taskArtifactBytes(taskID: taskId, artifactID: artifactId) }
        exportWorkers[artifactId] = worker
        defer { if exportTokens[artifactId] == token { exportingArtifacts.remove(artifactId); exportWorkers[artifactId] = nil } }
        do {
            let value = try await workerValue(worker)
            guard requireScope(), request == generation, exportTokens[artifactId] == token else { return nil }
            guard matches(value.scope), artifactMatches(value.artifact, expected), expectedArtifact(artifactId) == expected,
                  let name = expected.fileName, let hash = expected.sha256 else { throw APIFailure.identityMismatch }
            try validateBytes(value.data, artifact: expected)
            exportNotes[artifactId] = "完整文件已校验，等待选择保存位置。"
            return .init(id: token, taskId: taskId, artifactId: artifactId, fileName: name, data: value.data, sha256: hash)
        } catch {
            guard requireScope(), request == generation, exportTokens[artifactId] == token else { return nil }
            if handleScopeFailure(error) { return nil }
            artifactErrors[artifactId] = friendly(error); return nil
        }
    }
    func recordExportResult(_ result: Result<URL, Error>, export: TaskVerifiedExport) {
        guard requireScope(), export.taskId == taskId, exportTokens[export.artifactId] == export.id else { return }
        switch result {
        case .success: exportNotes[export.artifactId] = "已保存到你选择的位置。"
        case .failure(let error):
            let code = error as NSError
            exportNotes[export.artifactId] = code.domain == NSCocoaErrorDomain && code.code == NSUserCancelledError
                ? "已取消保存。" : "文件未保存，请重新选择位置。"
        }
    }
    func canExport(_ artifactId: String) -> Bool { scopeIsCurrent && expectedArtifact(artifactId) != nil }

    var canRequestStop: Bool {
        guard scopeIsCurrent, !loading, !stopBusy, stopRecordsLoaded, stopError == nil,
              let snapshot, snapshot.control.canStop, !stopAcknowledgmentSaveFailed else { return false }
        guard let stopRecord else { return !stopAcknowledgedInMemory }
        switch stopRecord.state {
        case .prepared:
            return stopRecord.intent.observedControlState == snapshot.control.state
                && stopRecord.intent.observedControlUpdatedAt == snapshot.control.updatedAt
                && stopRecord.intent.sourceReceiptId == snapshot.source.receiptId
        case .attemptedUnknown: return false
        case .acknowledged: return permitsNewStop(after: stopRecord, snapshot: snapshot)
        }
    }
    var stopActionLabel: String { stopRecord?.state == .prepared ? "继续停止任务" : "停止任务" }
    var localStopNotice: String? {
        if stopAcknowledgmentSaveFailed {
            return "服务已接收停止操作，但本机记录保存失败。请核对任务状态；当前页面不会再次提交。"
        }
        guard let record = stopRecord else { return nil }
        switch record.state {
        case .prepared:
            if let snapshot, record.intent.observedControlState != snapshot.control.state
                || record.intent.observedControlUpdatedAt != snapshot.control.updatedAt
                || record.intent.sourceReceiptId != snapshot.source.receiptId {
                return "停止操作已保存在本机，但原任务状态已改变。请先核对当前任务，不会自动提交。"
            }
            return "停止操作已保存在本机，尚未尝试提交。可继续这次操作。"
        case .attemptedUnknown: return "停止操作结果未确认，先读取任务状态。当前不会重复提交。"
        case .acknowledged:
            return "服务已接收停止操作，本机已保存这次状态。任务是否已经停止，请看当前任务状态。"
        }
    }

    /// Only an explicit user action can submit a never-attempted, durably persisted stop intent.
    func requestStop() async {
        guard canRequestStop, requireScope(), let snapshot else { return }
        stopBusy = true; stopError = nil
        let request = generation
        defer { if request == generation { stopBusy = false; stopWorker = nil } }
        do {
            let journal = try journal()
            let record: TaskStopRecord
            if let previous = stopRecord, previous.state == .prepared { record = previous }
            else { record = try await journal.persist(TaskStopIntent(snapshot: snapshot, requestID: UUID().uuidString.lowercased())) }
            guard requireScope(), request == generation, !Task.isCancelled else { return }
            stopRecord = record
            let permit = try await journal.submissionPermit(for: record.intent, expectedRevision: record.revision)
            guard requireScope(), request == generation, !Task.isCancelled else { return }
            let client = client
            let worker = Task { try await client.submitTaskStop(permit) }
            stopWorker = worker
            let observation = try await workerValue(worker)
            guard requireScope(), request == generation else { return }
            try validate(observation.task)
            stopAcknowledgedInMemory = observation.ownStopAcknowledged
            stopAcknowledgmentSaveFailed = observation.ownStopAcknowledged && !observation.journalAcknowledgmentSaved
            applySnapshot(observation.task)
            await loadStopRecord(generation: request)
        } catch {
            guard requireScope(), request == generation else { return }
            if handleScopeFailure(error) { return }
            stopError = friendly(error)
            await loadStopRecord(generation: request, preserveError: true)
        }
    }

    /// Reopening or observing an unknown stop never mints a new request or submission permit.
    func reconcileStop() async {
        guard requireScope(), !loading, !stopBusy, let record = stopRecord else { return }
        stopBusy = true; stopError = nil
        let request = generation
        defer { if request == generation { stopBusy = false; stopWorker = nil } }
        do {
            let client = client, intent = record.intent
            let worker = Task { try await client.reconcileTaskStop(intent) }
            stopWorker = worker
            let observation = try await workerValue(worker)
            guard requireScope(), request == generation else { return }
            try validate(observation.task)
            applySnapshot(observation.task)
            await loadStopRecord(generation: request)
        } catch {
            guard requireScope(), request == generation else { return }
            if handleScopeFailure(error) { return }
            stopError = friendly(error)
        }
    }

    private func journal() throws -> TaskStopJournal {
        if let stopJournal { return stopJournal }
        let value = try TaskStopJournal(directory: stateDirectory?.appendingPathComponent("TaskStop", isDirectory: true))
        stopJournal = value; return value
    }
    private func loadStopRecord(generation request: UUID, preserveError: Bool = false) async {
        guard let initialSession else { return }
        do {
            let account = try LocalAccountScope(server: initialSession.server, ownerId: initialSession.account.ownerId)
            let records = try await journal().operations(account: account)
            guard requireScope(), request == generation else { return }
            let relevant = records.filter { $0.intent.hostId == expectedHostId && $0.intent.rootCommandId == taskId && $0.intent.sessionId == expectedSessionId }
            stopRecord = relevant.first(where: { $0.state != .acknowledged }) ?? relevant.max {
                (taskDate($0.acknowledgment?.controlUpdatedAt ?? "") ?? .distantPast)
                    < (taskDate($1.acknowledgment?.controlUpdatedAt ?? "") ?? .distantPast)
            }
            stopRecordsLoaded = true
            if !preserveError { stopError = nil }
        } catch {
            guard requireScope(), request == generation else { return }
            stopRecordsLoaded = false; stopError = friendly(error)
        }
    }
    private func permitsNewStop(after record: TaskStopRecord, snapshot: TaskSnapshot) -> Bool {
        guard snapshot.control.state == .active, let prior = record.acknowledgment,
              let before = taskDate(prior.controlUpdatedAt), let now = taskDate(snapshot.control.updatedAt) else { return false }
        return now > before
    }
    private func taskDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let result = formatter.date(from: value) { return result }
        formatter.formatOptions = [.withInternetDateTime]; return formatter.date(from: value)
    }
    private func applySnapshot(_ value: TaskSnapshot) {
        if snapshot != value {
            cancelChildRequests(); contentVersion = UUID()
            sourceTokens = [:]; artifactTokens = [:]; exportTokens = [:]
            sourcePreviews = [:]; artifactPreviews = [:]; loadingSources = []; loadingArtifacts = []
            exportingArtifacts = []; sourceErrors = [:]; artifactErrors = [:]; exportNotes = [:]
        }
        snapshot = value; lastReadAt = Date()
    }

    private func validate(_ value: TaskSnapshot) throws {
        guard matches(value.scope), value.taskId == taskId, value.source.commandId == taskId,
              value.source.kind == .message, value.source.targetDeviceId == expectedHostId,
              value.sessionId == expectedSessionId, value.source.sessionId == expectedSessionId,
              expectedRequestId.map({ $0 == value.source.requestId }) ?? true else { throw APIFailure.identityMismatch }
    }
    private func matches(_ scope: TaskReadScope) -> Bool {
        guard let initialSession else { return false }
        return scope.server == initialSession.server && scope.ownerId == initialSession.account.ownerId
            && scope.hostId == expectedHostId
    }
    private func expectedArtifact(_ id: String) -> TaskCommandRecord? {
        guard let artifact = snapshot?.artifacts.first(where: { $0.artifactId == id }), artifact.taskId == taskId,
              artifact.targetDeviceId == expectedHostId, artifact.sessionId == expectedSessionId,
              artifact.kind == .writeArtifact, artifact.state == .observed,
              artifact.verification?.status == "observed", artifact.verification?.method == "sha256_readback",
              artifact.verification?.observedAt != nil, artifact.fileName != nil,
              artifact.size.map({ (1...131_072).contains($0) }) == true,
              artifact.sha256?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { return nil }
        return artifact
    }
    private func artifactMatches(_ actual: TaskCommandRecord, _ expected: TaskCommandRecord) -> Bool {
        actual.commandId == expected.commandId && actual.requestId == expected.requestId && actual.artifactId == expected.artifactId
            && actual.taskId == taskId && actual.sessionId == expectedSessionId && actual.targetDeviceId == expectedHostId
            && actual.fileName == expected.fileName && actual.size == expected.size && actual.sha256 == expected.sha256
            && actual.state == .observed && actual.verification?.status == "observed" && actual.verification?.method == "sha256_readback"
            && actual.verification?.observedAt != nil
    }
    private func validateBytes(_ data: Data, artifact: TaskCommandRecord) throws {
        guard data.count <= 131_072 else { throw APIFailure.responseTooLarge }
        let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard data.count == artifact.size, hash == artifact.sha256, !data.contains(0), String(data: data, encoding: .utf8) != nil else {
            throw APIFailure.invalidResponse
        }
    }
    @discardableResult private func requireScope() -> Bool {
        guard scopeIsCurrent else {
            if !scopeInvalidated { generation = UUID(); clearContent(); scopeInvalidated = true }
            error = "账户或原任务上下文已改变，请从当前会话重新打开任务。"
            return false
        }
        scopeInvalidated = false; return true
    }
    private func clearContent() {
        refreshWorker?.cancel(); refreshWorker = nil; cancelChildRequests(); stopWorker?.cancel(); stopWorker = nil
        contentVersion = UUID(); stopBusy = false; stopRecord = nil; stopError = nil; stopRecordsLoaded = false
        stopAcknowledgedInMemory = false; stopAcknowledgmentSaveFailed = false
        snapshot = nil; lastReadAt = nil; loading = false; sourcePreviews = [:]; sourceErrors = [:]
        sourceTokens = [:]; loadingSources = []; artifactPreviews = [:]; artifactErrors = [:]
        artifactTokens = [:]; loadingArtifacts = []; exportTokens = [:]; exportingArtifacts = []; exportNotes = [:]
    }
    private func cancelChildRequests() {
        for worker in sourceWorkers.values { worker.cancel() }; sourceWorkers = [:]
        for worker in artifactWorkers.values { worker.cancel() }; artifactWorkers = [:]
        for worker in exportWorkers.values { worker.cancel() }; exportWorkers = [:]
    }
    private func workerValue<Value: Sendable>(_ worker: Task<Value, Error>) async throws -> Value {
        try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
    }
    private func handleScopeFailure(_ error: Error) -> Bool {
        guard let failure = error as? APIFailure else { return false }
        switch failure {
        case .accountChanged, .identityMismatch, .notAuthenticated, .server(401, _):
            generation = UUID(); clearContent(); scopeInvalidated = true; self.error = friendly(error)
            return true
        default: return false
        }
    }
    private func friendly(_ error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? "读取未完成，请稍后重试。"
    }
}
