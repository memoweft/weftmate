import CryptoKit
import Darwin
import Foundation

/// The whitelist currently contains adoption only. There is no arbitrary URL/method/header/body API.
public enum LocalEndpointOperationKind: String, Codable, Sendable { case sharedAdoption }
public enum LocalEndpointOperationFailure: Error, Equatable, Sendable, LocalizedError {
    case invalidIntent, invalidReceipt, intentConflict, staleRevision, invalidTransition, immutableAcknowledgement
    case corruptFile, unsupportedVersion(Int), unsafeFile, storageUnavailable, busy
    case payloadLimit, recordLimit, fileLimit
    public var errorDescription: String? {
        switch self {
        case .invalidIntent: "采用会话的本机意图无效，尚未提交。"
        case .invalidReceipt, .immutableAcknowledgement: "采用回执与原请求或已保存的标识不一致。"
        case .intentConflict: "这个采用请求标识已绑定另一份内容，不能替换。"
        case .staleRevision, .invalidTransition: "采用状态已更新，请先重新读取原请求。"
        case .corruptFile: "本机采用记录损坏，已保留原文件。"
        case .unsupportedVersion: "本机采用记录版本暂不支持，已保留原文件。"
        case .unsafeFile, .storageUnavailable: "无法安全保存采用记录，请检查应用存储目录。"
        case .busy: "采用记录正由另一实例使用，请稍后重试。"
        case .payloadLimit, .recordLimit, .fileLimit: "采用记录达到保存上限，未删除或截断原内容。"
        }
    }
}
public struct LocalEndpointOperationLimits: Equatable, Sendable {
    public let recordCount: Int
    public let payloadBytes: Int
    public let fileBytes: Int
    public init(recordCount: Int = 256, payloadBytes: Int = 65_536, fileBytes: Int = 4_194_304) {
        self.recordCount = recordCount; self.payloadBytes = payloadBytes; self.fileBytes = fileBytes
    }
    public static let `default` = Self()
    func validate() throws {
        guard recordCount > 0, payloadBytes > 0, fileBytes > 0, fileBytes <= 67_108_864 else {
            throw LocalEndpointOperationFailure.invalidIntent
        }
    }
}

/// A local acknowledgement journal, not a replacement for the cloud's binding authority.
public struct LocalEndpointOperationRecord: Codable, Equatable, Sendable {
    public let endpoint: LocalEndpointOperationKind
    public let intent: SharedAdoptionIntent
    public let payloadSHA256: String
    public let state: LocalCommandState
    public let revision: UInt64
    public let receipt: SharedAdoptionReceipt?
    public let errorCode: String?
    public let knownCommandId: String?
    public let knownSessionId: String?
    public let knownBindingRevision: Int?
    private let createdAtMilliseconds: Int64
    private let updatedAtMilliseconds: Int64
    public var createdAt: Date { Date(timeIntervalSince1970: Double(createdAtMilliseconds) / 1_000) }
    public var updatedAt: Date { Date(timeIntervalSince1970: Double(updatedAtMilliseconds) / 1_000) }
    public var validationLevel: SharedAdoptionValidationLevel? { receipt?.validationLevel }
    public var lastReceiptBindingMatched: Bool { receipt?.validationLevel == .bindingMatched }
    fileprivate init(intent: SharedAdoptionIntent, state: LocalCommandState = .queued, revision: UInt64 = 0,
                     receipt: SharedAdoptionReceipt? = nil, errorCode: String? = nil,
                     previous: LocalEndpointOperationRecord? = nil) {
        endpoint = .sharedAdoption; self.intent = intent; payloadSHA256 = endpointHash(intent.payload)
        self.state = state; self.revision = revision; self.receipt = receipt; self.errorCode = errorCode
        knownCommandId = receipt?.command.commandId ?? previous?.knownCommandId
        knownSessionId = receipt?.command.sessionId ?? previous?.knownSessionId
        knownBindingRevision = receipt?.bindingRevision ?? previous?.knownBindingRevision
        createdAtMilliseconds = previous?.createdAtMilliseconds ?? endpointNow()
        updatedAtMilliseconds = endpointNow()
    }
    fileprivate var account: LocalAccountScope { get throws { try LocalAccountScope(server: intent.server, ownerId: intent.ownerId) } }
    fileprivate var key: String { get throws { try account.cacheKey + "|" + intent.requestId } }
    fileprivate func validate(_ limits: LocalEndpointOperationLimits) throws {
        try endpointValidate(intent, limits)
        guard endpoint == .sharedAdoption, payloadSHA256 == endpointHash(intent.payload),
              createdAtMilliseconds >= 0, updatedAtMilliseconds >= 0,
              errorCode.map(endpointErrorCode) ?? true,
              knownCommandId.map(SharedValidation.id) ?? true, knownSessionId.map(SharedValidation.id) ?? true,
              knownBindingRevision.map({ (1...SharedValidation.maximumSequence).contains($0) }) ?? true else {
            throw LocalEndpointOperationFailure.corruptFile
        }
        if let receipt {
            do { try receipt.validate(intent: intent, knownBindingRevision: knownBindingRevision) }
            catch { throw LocalEndpointOperationFailure.corruptFile }
            guard knownCommandId == receipt.command.commandId, knownSessionId == receipt.command.sessionId,
                  receipt.bindingRevision.map({ $0 == knownBindingRevision }) ?? true,
                  state == .uncertain || state == endpointState(receipt.command.state) else {
                throw LocalEndpointOperationFailure.corruptFile
            }
        } else {
            guard knownCommandId == nil, knownSessionId == nil, knownBindingRevision == nil,
                  state != .accepted, state != .rejected || errorCode != nil else {
                throw LocalEndpointOperationFailure.corruptFile
            }
        }
    }
}
private struct LocalEndpointEnvelope: Codable {
    var schemaVersion = 1
    var generation: UInt64 = 0
    var records: [LocalEndpointOperationRecord] = []
    func validate(_ limits: LocalEndpointOperationLimits) throws {
        guard schemaVersion == 1 else { throw LocalEndpointOperationFailure.unsupportedVersion(schemaVersion) }
        guard records.count <= limits.recordCount else { throw LocalEndpointOperationFailure.recordLimit }
        var keys = Set<String>()
        for record in records {
            try record.validate(limits)
            guard try keys.insert(record.key).inserted else { throw LocalEndpointOperationFailure.corruptFile }
        }
    }
}

public actor LocalEndpointOperationStore {
    public static let fileName = "endpoint-operations-v1.json"
    public let limits: LocalEndpointOperationLimits
    private let files: LocalEndpointFiles
    public init(directory: URL? = nil, limits: LocalEndpointOperationLimits = .default) throws {
        try limits.validate()
        let location: URL
        if let directory { location = directory }
        else {
            guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
                throw LocalEndpointOperationFailure.storageUnavailable
            }
            location = support.appendingPathComponent("WeftMate/LocalState", isDirectory: true)
        }
        let files = LocalEndpointFiles(directory: location.standardizedFileURL)
        try files.prepare()
        let descriptor = try files.acquireLock()
        defer { files.releaseLock(descriptor) }
        _ = try files.read(limits)
        self.files = files; self.limits = limits
    }
    @discardableResult
    public func persist(_ intent: SharedAdoptionIntent) throws -> LocalEndpointOperationRecord {
        try endpointValidate(intent, limits)
        let key = try endpointKey(intent)
        return try mutate { state in
            if let existing = try state.records.first(where: { try $0.key == key }) {
                guard endpointSameIntent(existing.intent, intent) else { throw LocalEndpointOperationFailure.intentConflict }
                return (existing, false)
            }
            guard state.records.count < limits.recordCount else { throw LocalEndpointOperationFailure.recordLimit }
            let record = LocalEndpointOperationRecord(intent: intent); state.records.append(record)
            return (record, true)
        }
    }
    public func operation(for intent: SharedAdoptionIntent) throws -> LocalEndpointOperationRecord? {
        try endpointValidate(intent, limits)
        let key = try endpointKey(intent)
        return try read { state in
            let found = try state.records.first { try $0.key == key }
            if let found, !endpointSameIntent(found.intent, intent) { throw LocalEndpointOperationFailure.intentConflict }
            return found
        }
    }
    public func operations(account: LocalAccountScope) throws -> [LocalEndpointOperationRecord] {
        try read { state in try state.records.filter { try $0.account == account } }
    }
    @discardableResult
    public func recordReceipt(_ receipt: SharedAdoptionReceipt, for intent: SharedAdoptionIntent,
                              expectedRevision: UInt64) throws -> LocalEndpointOperationRecord {
        try endpointValidate(intent, limits)
        return try change(intent, expectedRevision: expectedRevision) { previous in
            do { try receipt.validate(intent: intent, knownBindingRevision: previous.knownBindingRevision) }
            catch { throw LocalEndpointOperationFailure.invalidReceipt }
            guard previous.knownCommandId.map({ $0 == receipt.command.commandId }) ?? true,
                  previous.knownSessionId.map({ $0 == receipt.command.sessionId }) ?? true,
                  previous.knownBindingRevision.map({ receipt.bindingRevision == nil || $0 == receipt.bindingRevision }) ?? true else {
                throw LocalEndpointOperationFailure.immutableAcknowledgement
            }
            let next = endpointState(receipt.command.state)
            guard previous.state != .rejected || next == .rejected,
                  previous.state != .accepted || next == .accepted || next == .rejected else {
                throw LocalEndpointOperationFailure.invalidTransition
            }
            if previous.state == next && previous.receipt == receipt && previous.errorCode == receipt.command.errorCode { return previous }
            return .init(intent: previous.intent, state: next, revision: previous.revision + 1,
                         receipt: receipt, errorCode: receipt.command.errorCode, previous: previous)
        }
    }
    @discardableResult
    public func markUncertain(_ intent: SharedAdoptionIntent, expectedRevision: UInt64,
                              errorCode: String? = nil) throws -> LocalEndpointOperationRecord {
        guard errorCode.map(endpointErrorCode) ?? true else { throw LocalEndpointOperationFailure.invalidTransition }
        return try change(intent, expectedRevision: expectedRevision) { previous in
            guard previous.state == .queued || previous.state == .uncertain else { throw LocalEndpointOperationFailure.invalidTransition }
            if previous.state == .uncertain && previous.errorCode == errorCode { return previous }
            return .init(intent: previous.intent, state: .uncertain, revision: previous.revision + 1,
                         receipt: previous.receipt, errorCode: errorCode, previous: previous)
        }
    }
    /// Only a definite rejection before any known cloud command may use an HTTP error code alone.
    @discardableResult
    public func markRejected(_ intent: SharedAdoptionIntent, expectedRevision: UInt64,
                             errorCode: String) throws -> LocalEndpointOperationRecord {
        guard endpointErrorCode(errorCode) else { throw LocalEndpointOperationFailure.invalidTransition }
        return try change(intent, expectedRevision: expectedRevision) { previous in
            guard previous.knownCommandId == nil && previous.state != .accepted else { throw LocalEndpointOperationFailure.invalidTransition }
            if previous.state == .rejected && previous.errorCode == errorCode { return previous }
            return .init(intent: previous.intent, state: .rejected, revision: previous.revision + 1,
                         errorCode: errorCode, previous: previous)
        }
    }
    private func change(_ intent: SharedAdoptionIntent, expectedRevision: UInt64,
                        transform: (LocalEndpointOperationRecord) throws -> LocalEndpointOperationRecord) throws -> LocalEndpointOperationRecord {
        let key = try endpointKey(intent)
        return try mutate { state in
            guard let index = try state.records.firstIndex(where: { try $0.key == key }) else { throw LocalEndpointOperationFailure.invalidTransition }
            let previous = state.records[index]
            guard endpointSameIntent(previous.intent, intent) else { throw LocalEndpointOperationFailure.intentConflict }
            guard previous.revision == expectedRevision, previous.revision < UInt64.max else { throw LocalEndpointOperationFailure.staleRevision }
            let updated = try transform(previous)
            if updated == previous { return (previous, false) }
            state.records[index] = updated; return (updated, true)
        }
    }
    private func read<T>(_ operation: (LocalEndpointEnvelope) throws -> T) throws -> T {
        let descriptor = try files.acquireLock(); defer { files.releaseLock(descriptor) }
        return try operation(files.read(limits))
    }
    private func mutate<T>(_ operation: (inout LocalEndpointEnvelope) throws -> (T, Bool)) throws -> T {
        let descriptor = try files.acquireLock(); defer { files.releaseLock(descriptor) }
        var state = try files.read(limits)
        let (result, changed) = try operation(&state)
        if changed {
            guard state.generation < UInt64.max else { throw LocalEndpointOperationFailure.staleRevision }
            state.generation += 1; try files.write(state, limits)
        }
        return result
    }
}

private func endpointHash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
private func endpointNow() -> Int64 { Int64(Date().timeIntervalSince1970 * 1_000) }
private func endpointErrorCode(_ value: String) -> Bool { SharedValidation.matches(value, "^[A-Z][A-Z0-9_]{0,63}$") }
private func endpointKey(_ intent: SharedAdoptionIntent) throws -> String {
    try LocalAccountScope(server: intent.server, ownerId: intent.ownerId).cacheKey + "|" + intent.requestId
}
private func endpointSameIntent(_ a: SharedAdoptionIntent, _ b: SharedAdoptionIntent) -> Bool {
    (try? LocalAccountScope(server: a.server, ownerId: a.ownerId)) == (try? LocalAccountScope(server: b.server, ownerId: b.ownerId))
        && a.hostId == b.hostId && a.conversationId == b.conversationId && a.requestId == b.requestId
        && a.modelProfileId == b.modelProfileId && a.expectedSyncSeq == b.expectedSyncSeq && a.payload == b.payload
}
private func endpointValidate(_ intent: SharedAdoptionIntent, _ limits: LocalEndpointOperationLimits) throws {
    guard intent.payload.count <= limits.payloadBytes else { throw LocalEndpointOperationFailure.payloadLimit }
    do {
        _ = try LocalAccountScope(server: intent.server, ownerId: intent.ownerId)
        _ = try JSONDecoder().decode(SharedAdoptionIntent.self, from: JSONEncoder().encode(intent))
    } catch { throw LocalEndpointOperationFailure.invalidIntent }
}
private func endpointState(_ state: SharedCommandState) -> LocalCommandState {
    switch state {
    case .pending, .dispatching: .queued
    case .acceptedByDSH, .acceptedByHost, .observed: .accepted
    case .uncertain: .uncertain
    case .rejected: .rejected
    }
}

private struct LocalEndpointFiles: Sendable {
    let directory: URL
    var data: URL { directory.appendingPathComponent(LocalEndpointOperationStore.fileName) }
    var lock: URL { directory.appendingPathComponent(".endpoint-operations.lock") }
    func prepare() throws {
        do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
        catch { throw LocalEndpointOperationFailure.storageUnavailable }
        let fd = Darwin.open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw LocalEndpointOperationFailure.unsafeFile }; defer { Darwin.close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_uid == geteuid(), info.st_mode & 0o777 == 0o700 else {
            throw LocalEndpointOperationFailure.unsafeFile
        }
    }
    func acquireLock() throws -> Int32 {
        let fd = Darwin.open(lock.path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw LocalEndpointOperationFailure.unsafeFile }
        var acquired = false; defer { if !acquired { Darwin.close(fd) } }
        try validateFile(fd)
        let clock = ContinuousClock(), deadline = ContinuousClock().now.advanced(by: .seconds(2))
        while flock(fd, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EWOULDBLOCK || errno == EINTR else { throw LocalEndpointOperationFailure.storageUnavailable }
            guard clock.now < deadline else { throw LocalEndpointOperationFailure.busy }; usleep(10_000)
        }
        acquired = true; return fd
    }
    func releaseLock(_ fd: Int32) { flock(fd, LOCK_UN); Darwin.close(fd) }
    func validateFile(_ fd: Int32) throws {
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_uid == geteuid(), info.st_nlink == 1,
              info.st_mode & S_IFMT == S_IFREG, info.st_mode & 0o777 == 0o600 else {
            throw LocalEndpointOperationFailure.unsafeFile
        }
    }
    func read(_ limits: LocalEndpointOperationLimits) throws -> LocalEndpointEnvelope {
        let fd = Darwin.open(data.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        if fd < 0 { if errno == ENOENT { return LocalEndpointEnvelope() }; throw LocalEndpointOperationFailure.unsafeFile }
        defer { Darwin.close(fd) }; try validateFile(fd)
        var bytes = Data(), buffer = [UInt8](repeating: 0, count: 16_384)
        while true {
            let count = buffer.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
            if count < 0 { if errno == EINTR { continue }; throw LocalEndpointOperationFailure.storageUnavailable }
            if count == 0 { break }
            guard bytes.count + count <= limits.fileBytes else { throw LocalEndpointOperationFailure.fileLimit }
            bytes.append(contentsOf: buffer.prefix(count))
        }
        do {
            guard let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                  Set(object.keys) == ["schemaVersion", "generation", "records"] else { throw LocalEndpointOperationFailure.corruptFile }
            let envelope = try JSONDecoder().decode(LocalEndpointEnvelope.self, from: bytes)
            try envelope.validate(limits); return envelope
        } catch let failure as LocalEndpointOperationFailure { throw failure }
        catch { throw LocalEndpointOperationFailure.corruptFile }
    }
    func write(_ envelope: LocalEndpointEnvelope, _ limits: LocalEndpointOperationLimits) throws {
        try envelope.validate(limits)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let bytes = try encoder.encode(envelope)
        guard bytes.count <= limits.fileBytes else { throw LocalEndpointOperationFailure.fileLimit }
        let temporary = directory.appendingPathComponent(".endpoint-operations-" + UUID().uuidString + ".tmp")
        let fd = Darwin.open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw LocalEndpointOperationFailure.storageUnavailable }
        defer { Darwin.close(fd); Darwin.unlink(temporary.path) }
        try bytes.withUnsafeBytes { raw in
            guard let pointer = raw.baseAddress else { throw LocalEndpointOperationFailure.storageUnavailable }
            var offset = 0
            while offset < raw.count {
                let wrote = Darwin.write(fd, pointer.advanced(by: offset), raw.count - offset)
                if wrote < 0 { if errno == EINTR { continue }; throw LocalEndpointOperationFailure.storageUnavailable }
                guard wrote > 0 else { throw LocalEndpointOperationFailure.storageUnavailable }; offset += wrote
            }
        }
        guard fsync(fd) == 0, Darwin.rename(temporary.path, data.path) == 0 else { throw LocalEndpointOperationFailure.storageUnavailable }
        let directoryFD = Darwin.open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard directoryFD >= 0 else { throw LocalEndpointOperationFailure.storageUnavailable }; defer { Darwin.close(directoryFD) }
        guard fsync(directoryFD) == 0 else { throw LocalEndpointOperationFailure.storageUnavailable }
    }
}
