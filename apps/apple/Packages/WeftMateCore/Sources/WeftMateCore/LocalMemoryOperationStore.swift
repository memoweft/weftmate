import CryptoKit
import Darwin
import Foundation

public enum LocalMemoryOperationFailure: Error, Equatable, Sendable, LocalizedError {
    case invalidIntent, invalidReceipt, intentConflict, staleRevision, invalidTransition, redactedRequest
    case corruptFile, unsupportedVersion(Int), unsafeFile, storageUnavailable, busy
    case payloadLimit, recordLimit, fileLimit
    public var errorDescription: String? {
        switch self {
        case .invalidIntent: "记忆修改意图无效，尚未提交。"
        case .invalidReceipt: "记忆修改回执与原请求或已知结果不一致。"
        case .intentConflict: "这个记忆请求标识已绑定另一份内容，不能替换。"
        case .staleRevision, .invalidTransition: "记忆修改状态已更新，请先查询原请求。"
        case .redactedRequest: "这个请求的旧纠正文已脱敏，只能查看非正文证明或查询原请求，不能重新提交。"
        case .corruptFile: "本机记忆修改记录损坏，已保留原文件。"
        case .unsupportedVersion: "本机记忆修改记录版本暂不支持，已保留原文件。"
        case .unsafeFile, .storageUnavailable: "无法安全保存记忆修改记录，请检查应用存储目录。"
        case .busy: "记忆修改记录正由另一实例使用，请稍后重试。"
        case .payloadLimit, .recordLimit, .fileLimit: "记忆修改记录达到上限，未截断或删除原内容。"
        }
    }
}
public struct LocalMemoryOperationLimits: Equatable, Sendable {
    public let recordCount: Int
    public let payloadBytes: Int
    public let fileBytes: Int
    public init(recordCount: Int = 256, payloadBytes: Int = 16_384, fileBytes: Int = 4_194_304) {
        self.recordCount = recordCount; self.payloadBytes = payloadBytes; self.fileBytes = fileBytes
    }
    public static let `default` = Self()
    func validate() throws {
        guard recordCount > 0, payloadBytes > 0, fileBytes > 0, fileBytes <= 67_108_864 else {
            throw LocalMemoryOperationFailure.invalidIntent
        }
    }
}
public enum LocalMemoryOperationState: String, Codable, Sendable {
    case queued, uncertain, applied, noChange, revisionConflict, rejected
}
public enum LocalMemoryCleanupRetryState: String, Codable, Sendable { case prepared, uncertain, pending, complete }
public struct LocalMemoryCleanupRetry: Codable, Equatable, Sendable {
    public let payload: Data
    public let state: LocalMemoryCleanupRetryState
    public let attempts: Int
    public let errorCode: String?
    fileprivate init(state: LocalMemoryCleanupRetryState, attempts: Int, errorCode: String? = nil) {
        payload = Data("{}".utf8); self.state = state; self.attempts = attempts; self.errorCode = errorCode
    }
}

/// A journal of immutable memory-domain intentions. It neither grants memory access nor sends requests.
public struct LocalMemoryOperationRecord: Codable, Equatable, Sendable {
    public let identity: LocalMemoryOperationIdentity
    public let intent: MemoryMutationIntent?
    public let payloadSHA256: String?
    public let redactionProof: MemoryCorrectionRedactionProof?
    public let state: LocalMemoryOperationState
    public let revision: UInt64
    public let receipt: MemoryMutationReceipt?
    public let errorCode: String?
    public let cleanupRetry: LocalMemoryCleanupRetry?
    private let createdAtMilliseconds: Int64
    private let updatedAtMilliseconds: Int64
    public var createdAt: Date { Date(timeIntervalSince1970: Double(createdAtMilliseconds) / 1_000) }
    public var updatedAt: Date { Date(timeIntervalSince1970: Double(updatedAtMilliseconds) / 1_000) }
    public var effectApplied: Bool { receipt?.effectApplied == true }
    public var cleanupPending: Bool { receipt?.cleanupPending == true }
    public var isRedacted: Bool { intent == nil && redactionProof != nil }
    public var bodyAvailable: Bool { intent != nil }
    public var requestId: String { identity.requestId }
    /// This proves server cleanup only. It does not claim historical local correction journals were erased.
    public var serverStorageCleanupConfirmedComplete: Bool {
        identity.operation.isDeletion && receipt?.cleanupConfirmedComplete == true
    }
    fileprivate init(intent: MemoryMutationIntent, state: LocalMemoryOperationState = .queued,
                     revision: UInt64 = 0, receipt: MemoryMutationReceipt? = nil,
                     errorCode: String? = nil, cleanupRetry: LocalMemoryCleanupRetry? = nil,
                     previous: LocalMemoryOperationRecord? = nil) {
        identity = .init(intent: intent); self.intent = intent; payloadSHA256 = memoryJournalHash(intent.payload)
        redactionProof = nil; self.state = state
        self.revision = revision; self.receipt = receipt; self.errorCode = errorCode; self.cleanupRetry = cleanupRetry
        createdAtMilliseconds = previous?.createdAtMilliseconds ?? memoryJournalNow()
        updatedAtMilliseconds = memoryJournalNow()
    }
    fileprivate init(redacting previous: LocalMemoryOperationRecord, proof: MemoryCorrectionRedactionProof) {
        identity = previous.identity; intent = nil; payloadSHA256 = nil; redactionProof = proof
        state = previous.state; revision = previous.revision + 1; receipt = previous.receipt
        errorCode = previous.errorCode; cleanupRetry = nil
        createdAtMilliseconds = previous.createdAtMilliseconds; updatedAtMilliseconds = memoryJournalNow()
    }
    fileprivate init(identity: LocalMemoryOperationIdentity, intent: MemoryMutationIntent?, payloadSHA256: String?,
                     state: LocalMemoryOperationState, revision: UInt64, receipt: MemoryMutationReceipt?,
                     errorCode: String?, cleanupRetry: LocalMemoryCleanupRetry?, created: Int64, updated: Int64) {
        self.identity = identity; self.intent = intent; self.payloadSHA256 = payloadSHA256; redactionProof = nil
        self.state = state; self.revision = revision; self.receipt = receipt; self.errorCode = errorCode
        self.cleanupRetry = cleanupRetry; createdAtMilliseconds = created; updatedAtMilliseconds = updated
    }
    fileprivate var account: LocalAccountScope { get throws { try identity.account } }
    fileprivate var key: String { get throws { try identity.key } }
    fileprivate func validate(_ limits: LocalMemoryOperationLimits) throws {
        try identity.validate()
        guard createdAtMilliseconds >= 0, updatedAtMilliseconds >= 0,
              errorCode.map(MemoryValidation.code) ?? true else { throw LocalMemoryOperationFailure.corruptFile }
        guard let intent else {
            guard identity.operation == .correct, payloadSHA256 == nil, let redactionProof,
                  identity.matches(redactionProof.correction), receipt == redactionProof.correctionReceipt,
                  state == memoryJournalState(redactionProof.correctionReceipt.state), cleanupRetry == nil else {
                throw LocalMemoryOperationFailure.corruptFile
            }
            do { try redactionProof.validate() } catch { throw LocalMemoryOperationFailure.corruptFile }
            return
        }
        try memoryJournalValidate(intent, limits)
        guard identity == .init(intent: intent), payloadSHA256 == memoryJournalHash(intent.payload), redactionProof == nil else {
            throw LocalMemoryOperationFailure.corruptFile
        }
        if let receipt {
            do { try receipt.validate(intent: intent) } catch { throw LocalMemoryOperationFailure.corruptFile }
            guard state == memoryJournalState(receipt.state) else { throw LocalMemoryOperationFailure.corruptFile }
        } else {
            guard state == .queued || state == .uncertain || (state == .rejected && errorCode != nil) else {
                throw LocalMemoryOperationFailure.corruptFile
            }
        }
        if let cleanupRetry {
            guard intent.operation.isDeletion, receipt?.effectApplied == true, cleanupRetry.payload == Data("{}".utf8),
                  cleanupRetry.attempts > 0, cleanupRetry.errorCode.map(MemoryValidation.code) ?? true else {
                throw LocalMemoryOperationFailure.corruptFile
            }
            if cleanupRetry.state == .complete {
                guard receipt?.cleanupConfirmedComplete == true else { throw LocalMemoryOperationFailure.corruptFile }
            } else {
                guard receipt?.cleanupPending == true else { throw LocalMemoryOperationFailure.corruptFile }
            }
        }
    }
}
private struct LocalMemoryEnvelope: Codable {
    var schemaVersion = 2
    var generation: UInt64 = 0
    var records: [LocalMemoryOperationRecord] = []
    func validate(_ limits: LocalMemoryOperationLimits) throws {
        guard schemaVersion == 2 else { throw LocalMemoryOperationFailure.unsupportedVersion(schemaVersion) }
        guard records.count <= limits.recordCount else { throw LocalMemoryOperationFailure.recordLimit }
        var keys = Set<String>()
        for record in records {
            try record.validate(limits)
            guard try keys.insert(record.key).inserted else { throw LocalMemoryOperationFailure.corruptFile }
        }
    }
}
private struct LocalMemoryRecordV1: Decodable {
    let intent: MemoryMutationIntent
    let payloadSHA256: String
    let state: LocalMemoryOperationState
    let revision: UInt64
    let receipt: MemoryMutationReceipt?
    let errorCode: String?
    let cleanupRetry: LocalMemoryCleanupRetry?
    let createdAtMilliseconds: Int64
    let updatedAtMilliseconds: Int64
    func upgraded() -> LocalMemoryOperationRecord {
        .init(identity: .init(intent: intent), intent: intent, payloadSHA256: payloadSHA256, state: state,
              revision: revision, receipt: receipt, errorCode: errorCode, cleanupRetry: cleanupRetry,
              created: createdAtMilliseconds, updated: updatedAtMilliseconds)
    }
}
private struct LocalMemoryEnvelopeV1: Decodable {
    let schemaVersion: Int
    let generation: UInt64
    let records: [LocalMemoryRecordV1]
    func upgraded() -> LocalMemoryEnvelope { .init(schemaVersion: 2, generation: generation, records: records.map { $0.upgraded() }) }
}

public actor LocalMemoryOperationStore {
    public static let fileName = "memory-operations-v1.json"
    public static let schemaVersion = 2
    public let limits: LocalMemoryOperationLimits
    private let files: LocalMemoryFiles
    public init(directory: URL? = nil, limits: LocalMemoryOperationLimits = .default) throws {
        try limits.validate()
        let location: URL
        if let directory { location = directory }
        else {
            guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
                throw LocalMemoryOperationFailure.storageUnavailable
            }
            location = support.appendingPathComponent("WeftMate/LocalState", isDirectory: true)
        }
        let files = LocalMemoryFiles(directory: location.standardizedFileURL)
        try files.prepare()
        let descriptor = try files.acquireLock(); defer { files.releaseLock(descriptor) }
        _ = try files.read(limits); self.files = files; self.limits = limits
    }
    @discardableResult
    public func persist(_ intent: MemoryMutationIntent) throws -> LocalMemoryOperationRecord {
        try memoryJournalValidate(intent, limits)
        let key = try memoryJournalKey(intent)
        return try mutate { state in
            if let existing = try state.records.first(where: { try $0.key == key }) {
                guard !existing.isRedacted else { throw LocalMemoryOperationFailure.redactedRequest }
                guard let original = existing.intent, memoryJournalSameIntent(original, intent) else { throw LocalMemoryOperationFailure.intentConflict }
                return (existing, false)
            }
            guard state.records.count < limits.recordCount else { throw LocalMemoryOperationFailure.recordLimit }
            let record = LocalMemoryOperationRecord(intent: intent); state.records.append(record)
            return (record, true)
        }
    }
    public func operation(for intent: MemoryMutationIntent) throws -> LocalMemoryOperationRecord? {
        try memoryJournalValidate(intent, limits)
        let key = try memoryJournalKey(intent)
        return try read { state in
            let found = try state.records.first { try $0.key == key }
            if let found {
                guard found.identity.matches(intent) else { throw LocalMemoryOperationFailure.intentConflict }
                if let original = found.intent, !memoryJournalSameIntent(original, intent) { throw LocalMemoryOperationFailure.intentConflict }
            }
            return found
        }
    }
    public func operations(account: LocalAccountScope) throws -> [LocalMemoryOperationRecord] {
        try read { state in try state.records.filter { try $0.account == account } }
    }
    @discardableResult
    public func recordReceipt(_ receipt: MemoryMutationReceipt, for intent: MemoryMutationIntent,
                              expectedRevision: UInt64) throws -> LocalMemoryOperationRecord {
        return try change(intent, expectedRevision: expectedRevision) { previous in
            do { try receipt.validate(intent: intent, knownReceipt: previous.receipt) }
            catch { throw LocalMemoryOperationFailure.invalidReceipt }
            guard previous.receipt != nil || previous.state != .rejected else { throw LocalMemoryOperationFailure.invalidTransition }
            var cleanup = previous.cleanupRetry
            if let retry = cleanup {
                if receipt.cleanupConfirmedComplete { cleanup = .init(state: .complete, attempts: retry.attempts) }
                else if receipt.cleanupPending { cleanup = .init(state: .pending, attempts: retry.attempts) }
            }
            let next = memoryJournalState(receipt.state)
            if previous.receipt == receipt && previous.state == next && previous.cleanupRetry == cleanup && previous.errorCode == receipt.reasonCode { return previous }
            return .init(intent: intent, state: next, revision: previous.revision + 1,
                         receipt: receipt, errorCode: receipt.reasonCode, cleanupRetry: cleanup, previous: previous)
        }
    }
    @discardableResult
    public func markUncertain(_ intent: MemoryMutationIntent, expectedRevision: UInt64,
                              errorCode: String? = nil) throws -> LocalMemoryOperationRecord {
        guard errorCode.map(MemoryValidation.code) ?? true else { throw LocalMemoryOperationFailure.invalidTransition }
        return try change(intent, expectedRevision: expectedRevision) { previous in
            guard previous.receipt == nil, previous.state == .queued || previous.state == .uncertain else {
                throw LocalMemoryOperationFailure.invalidTransition
            }
            if previous.state == .uncertain && previous.errorCode == errorCode { return previous }
            return .init(intent: intent, state: .uncertain, revision: previous.revision + 1,
                         errorCode: errorCode, previous: previous)
        }
    }
    /// Use only a definite submission rejection; query/transport failures remain unknown.
    @discardableResult
    public func markRejected(_ intent: MemoryMutationIntent, expectedRevision: UInt64,
                             errorCode: String) throws -> LocalMemoryOperationRecord {
        guard MemoryValidation.code(errorCode) else { throw LocalMemoryOperationFailure.invalidTransition }
        return try change(intent, expectedRevision: expectedRevision) { previous in
            guard previous.receipt == nil, previous.state == .queued || previous.state == .uncertain || previous.state == .rejected else {
                throw LocalMemoryOperationFailure.invalidTransition
            }
            if previous.state == .rejected && previous.errorCode == errorCode { return previous }
            return .init(intent: intent, state: .rejected, revision: previous.revision + 1,
                         errorCode: errorCode, previous: previous)
        }
    }
    /// Persists one explicit cleanup retry intention; SDK must lookup the original deletion before POST {}.
    @discardableResult
    public func prepareCleanupRetry(for intent: MemoryMutationIntent, expectedRevision: UInt64) throws -> LocalMemoryOperationRecord {
        return try change(intent, expectedRevision: expectedRevision) { previous in
            guard intent.operation.isDeletion, previous.receipt?.effectApplied == true,
                  previous.receipt?.cleanupPending == true else { throw LocalMemoryOperationFailure.invalidTransition }
            if previous.cleanupRetry?.state == .prepared { return previous }
            guard previous.cleanupRetry?.state != .uncertain, previous.cleanupRetry?.state != .complete else {
                throw LocalMemoryOperationFailure.invalidTransition
            }
            let attempts = previous.cleanupRetry?.attempts ?? 0
            guard attempts < Int.max else { throw LocalMemoryOperationFailure.invalidTransition }
            return .init(intent: intent, state: previous.state, revision: previous.revision + 1,
                receipt: previous.receipt, errorCode: previous.errorCode,
                cleanupRetry: .init(state: .prepared, attempts: attempts + 1), previous: previous)
        }
    }
    @discardableResult
    public func markCleanupUncertain(for intent: MemoryMutationIntent, expectedRevision: UInt64,
                                     errorCode: String? = nil) throws -> LocalMemoryOperationRecord {
        guard errorCode.map(MemoryValidation.code) ?? true else { throw LocalMemoryOperationFailure.invalidTransition }
        return try change(intent, expectedRevision: expectedRevision) { previous in
            guard let retry = previous.cleanupRetry, retry.state == .prepared || retry.state == .uncertain else {
                throw LocalMemoryOperationFailure.invalidTransition
            }
            if retry.state == .uncertain && retry.errorCode == errorCode { return previous }
            return .init(intent: intent, state: previous.state, revision: previous.revision + 1,
                receipt: previous.receipt, errorCode: previous.errorCode,
                cleanupRetry: .init(state: .uncertain, attempts: retry.attempts, errorCode: errorCode), previous: previous)
        }
    }
    /// Redacts only proved terminal corrections covered by this proved item deletion, in one locked replacement.
    /// Unknown submissions keep their exact bytes and are reported; evidence deletion never infers item ownership.
    @discardableResult
    public func redactCorrections(deletedBy deletion: MemoryMutationIntent,
                                   expectedRevision: UInt64) throws -> LocalMemoryRedactionResult {
        try memoryJournalValidate(deletion, limits)
        if deletion.operation != .deleteItem {
            return .init(disposition: .notApplicable, nonApplicability: .notItemDeletion, redactedRequestIds: [],
                         alreadyRedactedRequestIds: [], pendingRequestIds: [], retainedNewerRequestIds: [],
                         proofs: [], deletionRecordRevision: nil)
        }
        let deletionKey = try memoryJournalKey(deletion)
        let scope = try LocalAccountScope(server: deletion.server, ownerId: deletion.ownerId)
        return try mutate { state in
            guard let deletionIndex = try state.records.firstIndex(where: { try $0.key == deletionKey }) else {
                return (.init(disposition: .notApplicable, nonApplicability: .deletionNotProved, redactedRequestIds: [],
                    alreadyRedactedRequestIds: [], pendingRequestIds: [], retainedNewerRequestIds: [],
                    proofs: [], deletionRecordRevision: nil), false)
            }
            let deleting = state.records[deletionIndex]
            guard !deleting.isRedacted, let original = deleting.intent, memoryJournalSameIntent(original, deletion) else {
                throw LocalMemoryOperationFailure.intentConflict
            }
            guard deleting.revision == expectedRevision else { throw LocalMemoryOperationFailure.staleRevision }
            guard let deletionReceipt = deleting.receipt, deletionReceipt.effectApplied else {
                return (.init(disposition: .notApplicable, nonApplicability: .deletionNotProved, redactedRequestIds: [],
                    alreadyRedactedRequestIds: [], pendingRequestIds: [], retainedNewerRequestIds: [],
                    proofs: [], deletionRecordRevision: deleting.revision), false)
            }
            var redacted: [String] = [], already: [String] = [], pending: [String] = [], newer: [String] = []
            var proofs: [MemoryCorrectionRedactionProof] = []
            for index in state.records.indices {
                let record = state.records[index], identity = record.identity
                guard identity.operation == .correct, try identity.account == scope,
                      identity.hostId == deletion.hostId, identity.itemKind == deletion.itemKind,
                      identity.targetId == deletion.targetId else { continue }
                if identity.expectedWorldRevision > deletionReceipt.worldRevision ||
                    (record.receipt.map { $0.worldRevision > deletionReceipt.worldRevision } ?? false) {
                    newer.append(identity.requestId); continue
                }
                if record.isRedacted, let proof = record.redactionProof {
                    already.append(identity.requestId); proofs.append(proof); continue
                }
                guard let correction = record.intent, let receipt = record.receipt else {
                    pending.append(identity.requestId); continue
                }
                guard record.revision < UInt64.max else { throw LocalMemoryOperationFailure.staleRevision }
                let proof: MemoryCorrectionRedactionProof
                do {
                    proof = try MemoryCorrectionRedactionProof(correction: correction, correctionReceipt: receipt,
                        deletedBy: deletion, deletionReceipt: deletionReceipt)
                } catch { throw LocalMemoryOperationFailure.invalidReceipt }
                state.records[index] = .init(redacting: record, proof: proof)
                redacted.append(identity.requestId); proofs.append(proof)
            }
            var deletionRevision = deleting.revision
            if !redacted.isEmpty {
                guard deleting.revision < UInt64.max else { throw LocalMemoryOperationFailure.staleRevision }
                deletionRevision += 1
                state.records[deletionIndex] = .init(intent: original, state: deleting.state, revision: deletionRevision,
                    receipt: deleting.receipt, errorCode: deleting.errorCode, cleanupRetry: deleting.cleanupRetry, previous: deleting)
            }
            let result = LocalMemoryRedactionResult(disposition: pending.isEmpty ? .complete : .pending, nonApplicability: nil,
                redactedRequestIds: redacted.sorted(), alreadyRedactedRequestIds: already.sorted(),
                pendingRequestIds: pending.sorted(), retainedNewerRequestIds: newer.sorted(), proofs: proofs,
                deletionRecordRevision: deletionRevision)
            return (result, !redacted.isEmpty)
        }
    }
    private func change(_ intent: MemoryMutationIntent, expectedRevision: UInt64,
                        transform: (LocalMemoryOperationRecord) throws -> LocalMemoryOperationRecord) throws -> LocalMemoryOperationRecord {
        try memoryJournalValidate(intent, limits)
        let key = try memoryJournalKey(intent)
        return try mutate { state in
            guard let index = try state.records.firstIndex(where: { try $0.key == key }) else { throw LocalMemoryOperationFailure.invalidTransition }
            let previous = state.records[index]
            guard !previous.isRedacted else { throw LocalMemoryOperationFailure.redactedRequest }
            guard let original = previous.intent, memoryJournalSameIntent(original, intent) else { throw LocalMemoryOperationFailure.intentConflict }
            guard previous.revision == expectedRevision, previous.revision < UInt64.max else { throw LocalMemoryOperationFailure.staleRevision }
            let updated = try transform(previous)
            if updated == previous { return (previous, false) }
            state.records[index] = updated; return (updated, true)
        }
    }
    private func read<T>(_ operation: (LocalMemoryEnvelope) throws -> T) throws -> T {
        let descriptor = try files.acquireLock(); defer { files.releaseLock(descriptor) }
        return try operation(files.read(limits))
    }
    private func mutate<T>(_ operation: (inout LocalMemoryEnvelope) throws -> (T, Bool)) throws -> T {
        let descriptor = try files.acquireLock(); defer { files.releaseLock(descriptor) }
        var state = try files.read(limits)
        let (result, changed) = try operation(&state)
        if changed {
            guard state.generation < UInt64.max else { throw LocalMemoryOperationFailure.staleRevision }
            state.generation += 1; try files.write(state, limits)
        }
        return result
    }
}

private func memoryJournalHash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
private func memoryJournalNow() -> Int64 { Int64(Date().timeIntervalSince1970 * 1_000) }
private func memoryJournalKey(_ intent: MemoryMutationIntent) throws -> String {
    try LocalAccountScope(server: intent.server, ownerId: intent.ownerId).cacheKey + "|" + intent.requestId
}
private func memoryJournalSameIntent(_ a: MemoryMutationIntent, _ b: MemoryMutationIntent) -> Bool {
    (try? LocalAccountScope(server: a.server, ownerId: a.ownerId)) == (try? LocalAccountScope(server: b.server, ownerId: b.ownerId))
        && a.hostId == b.hostId && a.operation == b.operation && a.itemKind == b.itemKind && a.targetId == b.targetId
        && a.requestId == b.requestId && a.expectedWorldRevision == b.expectedWorldRevision && a.payload == b.payload
}
private func memoryJournalValidate(_ intent: MemoryMutationIntent, _ limits: LocalMemoryOperationLimits) throws {
    guard intent.payload.count <= limits.payloadBytes else { throw LocalMemoryOperationFailure.payloadLimit }
    do {
        _ = try LocalAccountScope(server: intent.server, ownerId: intent.ownerId)
        _ = try JSONDecoder().decode(MemoryMutationIntent.self, from: JSONEncoder().encode(intent))
    } catch { throw LocalMemoryOperationFailure.invalidIntent }
}
private func memoryJournalState(_ state: MemoryMutationState) -> LocalMemoryOperationState {
    switch state {
    case .applied: .applied
    case .noChange: .noChange
    case .revisionConflict: .revisionConflict
    case .rejected: .rejected
    }
}

private struct LocalMemoryFiles: Sendable {
    let directory: URL
    var data: URL { directory.appendingPathComponent(LocalMemoryOperationStore.fileName) }
    var lock: URL { directory.appendingPathComponent(".memory-operations.lock") }
    func prepare() throws {
        do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
        catch { throw LocalMemoryOperationFailure.storageUnavailable }
        let fd = Darwin.open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw LocalMemoryOperationFailure.unsafeFile }; defer { Darwin.close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_uid == geteuid(), info.st_mode & 0o777 == 0o700 else {
            throw LocalMemoryOperationFailure.unsafeFile
        }
    }
    func acquireLock() throws -> Int32 {
        let fd = Darwin.open(lock.path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw LocalMemoryOperationFailure.unsafeFile }
        var acquired = false; defer { if !acquired { Darwin.close(fd) } }
        try validateFile(fd)
        let clock = ContinuousClock(), deadline = ContinuousClock().now.advanced(by: .seconds(2))
        while flock(fd, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EWOULDBLOCK || errno == EINTR else { throw LocalMemoryOperationFailure.storageUnavailable }
            guard clock.now < deadline else { throw LocalMemoryOperationFailure.busy }; usleep(10_000)
        }
        acquired = true; return fd
    }
    func releaseLock(_ fd: Int32) { flock(fd, LOCK_UN); Darwin.close(fd) }
    func validateFile(_ fd: Int32) throws {
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_uid == geteuid(), info.st_nlink == 1,
              info.st_mode & S_IFMT == S_IFREG, info.st_mode & 0o777 == 0o600 else {
            throw LocalMemoryOperationFailure.unsafeFile
        }
    }
    func read(_ limits: LocalMemoryOperationLimits) throws -> LocalMemoryEnvelope {
        let fd = Darwin.open(data.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        if fd < 0 { if errno == ENOENT { return LocalMemoryEnvelope() }; throw LocalMemoryOperationFailure.unsafeFile }
        defer { Darwin.close(fd) }; try validateFile(fd)
        var bytes = Data(), buffer = [UInt8](repeating: 0, count: 16_384)
        while true {
            let count = buffer.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
            if count < 0 { if errno == EINTR { continue }; throw LocalMemoryOperationFailure.storageUnavailable }
            if count == 0 { break }
            guard bytes.count + count <= limits.fileBytes else { throw LocalMemoryOperationFailure.fileLimit }
            bytes.append(contentsOf: buffer.prefix(count))
        }
        do {
            guard let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                  Set(object.keys) == ["schemaVersion", "generation", "records"] else { throw LocalMemoryOperationFailure.corruptFile }
            let envelope: LocalMemoryEnvelope
            guard let version = object["schemaVersion"] as? Int else { throw LocalMemoryOperationFailure.corruptFile }
            switch version {
            case 1: envelope = try JSONDecoder().decode(LocalMemoryEnvelopeV1.self, from: bytes).upgraded()
            case 2: envelope = try JSONDecoder().decode(LocalMemoryEnvelope.self, from: bytes)
            default: throw LocalMemoryOperationFailure.unsupportedVersion(version)
            }
            try envelope.validate(limits); return envelope
        } catch let failure as LocalMemoryOperationFailure { throw failure }
        catch { throw LocalMemoryOperationFailure.corruptFile }
    }
    func write(_ envelope: LocalMemoryEnvelope, _ limits: LocalMemoryOperationLimits) throws {
        try envelope.validate(limits)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let bytes = try encoder.encode(envelope)
        guard bytes.count <= limits.fileBytes else { throw LocalMemoryOperationFailure.fileLimit }
        let temporary = directory.appendingPathComponent(".memory-operations-" + UUID().uuidString + ".tmp")
        let fd = Darwin.open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw LocalMemoryOperationFailure.storageUnavailable }
        defer { Darwin.close(fd); Darwin.unlink(temporary.path) }
        try bytes.withUnsafeBytes { raw in
            guard let pointer = raw.baseAddress else { throw LocalMemoryOperationFailure.storageUnavailable }
            var offset = 0
            while offset < raw.count {
                let wrote = Darwin.write(fd, pointer.advanced(by: offset), raw.count - offset)
                if wrote < 0 { if errno == EINTR { continue }; throw LocalMemoryOperationFailure.storageUnavailable }
                guard wrote > 0 else { throw LocalMemoryOperationFailure.storageUnavailable }; offset += wrote
            }
        }
        guard fsync(fd) == 0, Darwin.rename(temporary.path, data.path) == 0 else { throw LocalMemoryOperationFailure.storageUnavailable }
        let directoryFD = Darwin.open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard directoryFD >= 0 else { throw LocalMemoryOperationFailure.storageUnavailable }; defer { Darwin.close(directoryFD) }
        guard fsync(directoryFD) == 0 else { throw LocalMemoryOperationFailure.storageUnavailable }
    }
}
