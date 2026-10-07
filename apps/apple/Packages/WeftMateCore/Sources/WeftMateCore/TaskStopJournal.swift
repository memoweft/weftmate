import CryptoKit
import Darwin
import Foundation

public enum TaskStopJournalFailure: Error, Equatable, Sendable, LocalizedError {
    case intentConflict, staleRevision, submissionAlreadyAttempted, unresolvedRootStop, invalidPermit, invalidAcknowledgment
    case corruptFile, unsupportedVersion(Int), unsafeFile, storageUnavailable, busy, limitExceeded
    public var errorDescription: String? {
        switch self {
        case .intentConflict: "这个停止请求标识已绑定另一项任务。"
        case .staleRevision: "停止记录已更新，请重新读取。"
        case .submissionAlreadyAttempted: "停止请求已尝试提交；现在只能读取任务状态，不能重复提交。"
        case .unresolvedRootStop: "此任务已有未完成查证的停止请求；现在只能读取任务状态，不能换标识再次提交。"
        case .invalidPermit, .invalidAcknowledgment: "停止许可或回执与原任务不一致。"
        case .corruptFile: "本机停止记录损坏，已保留原文件。"
        case .unsupportedVersion: "本机停止记录版本暂不支持，已保留原文件。"
        case .unsafeFile, .storageUnavailable: "无法安全保存停止记录。"
        case .busy: "停止记录正在由另一实例使用。"
        case .limitExceeded: "停止记录达到保存上限，未删除已有请求。"
        }
    }
}
public struct TaskStopRecord: Codable, Equatable, Sendable {
    public let intent: TaskStopIntent
    public let state: TaskStopJournalState
    public let revision: UInt64
    public let acknowledgment: TaskStopAcknowledgment?
    fileprivate let nonce: String?
    fileprivate var key: String { get throws { try LocalAccountScope(server: intent.server, ownerId: intent.ownerId).cacheKey + "|" + intent.requestId } }
    fileprivate func validate() throws {
        try SharedValidation.require(revision < UInt64.max && (nonce.map { UUID(uuidString: $0) != nil } ?? true))
        if let acknowledgment {
            try acknowledgment.validate(intent: intent)
            guard state == .acknowledged else { throw TaskStopJournalFailure.corruptFile }
        } else { guard state != .acknowledged else { throw TaskStopJournalFailure.corruptFile } }
        if state != .prepared, nonce == nil { throw TaskStopJournalFailure.corruptFile }
    }
}
private struct TaskStopEnvelope: Codable {
    var schemaVersion = 1
    var generation: UInt64 = 0
    var records: [TaskStopRecord] = []
    func validate() throws {
        guard schemaVersion == 1 else { throw TaskStopJournalFailure.unsupportedVersion(schemaVersion) }
        guard records.count <= 256, generation < UInt64.max else { throw TaskStopJournalFailure.limitExceeded }
        var keys = Set<String>()
        var unresolvedRoots = Set<String>()
        for record in records {
            try record.validate()
            guard try keys.insert(record.key).inserted else { throw TaskStopJournalFailure.corruptFile }
            if record.state != .acknowledged {
                let root = try LocalAccountScope(server: record.intent.server, ownerId: record.intent.ownerId).cacheKey + "|" + record.intent.hostId + "|" + record.intent.rootCommandId + "|" + record.intent.sessionId
                guard unresolvedRoots.insert(root).inserted else { throw TaskStopJournalFailure.corruptFile }
            }
        }
    }
}

public actor TaskStopJournal {
    public static let fileName = "task-stop-operations-v1.json"
    private let files: TaskStopFiles
    public init(directory: URL? = nil) throws {
        let location: URL
        if let directory { location = directory }
        else {
            guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { throw TaskStopJournalFailure.storageUnavailable }
            location = support.appendingPathComponent("WeftMate/TaskStop", isDirectory: true)
        }
        files = try TaskStopFiles(directory: location)
    }
    public func persist(_ intent: TaskStopIntent) throws -> TaskStopRecord {
        try transact { envelope in
            let key = try self.key(intent)
            if let previous = try envelope.records.first(where: { try $0.key == key }) {
                guard previous.intent == intent else { throw TaskStopJournalFailure.intentConflict }
                return (previous, false)
            }
            let account = try LocalAccountScope(server: intent.server, ownerId: intent.ownerId)
            for previous in envelope.records where previous.intent.hostId == intent.hostId && previous.intent.rootCommandId == intent.rootCommandId && previous.intent.sessionId == intent.sessionId {
                guard try LocalAccountScope(server: previous.intent.server, ownerId: previous.intent.ownerId) == account else { continue }
                guard previous.state == .acknowledged, let acknowledgment = previous.acknowledgment,
                      intent.observedControlState == .active,
                      let priorDate = stopDate(acknowledgment.controlUpdatedAt), let currentDate = stopDate(intent.observedControlUpdatedAt), currentDate > priorDate else {
                    throw TaskStopJournalFailure.unresolvedRootStop
                }
            }
            guard envelope.records.count < 256 else { throw TaskStopJournalFailure.limitExceeded }
            let record = TaskStopRecord(intent: intent, state: .prepared, revision: 0, acknowledgment: nil, nonce: nil)
            envelope.records.append(record); return (record, true)
        }
    }
    public func operation(for intent: TaskStopIntent) throws -> TaskStopRecord? {
        try read { envelope in
            let value = try envelope.records.first { try $0.key == self.key(intent) }
            if let value, value.intent != intent { throw TaskStopJournalFailure.intentConflict }
            return value
        }
    }
    public func operations(account: LocalAccountScope) throws -> [TaskStopRecord] {
        try read { envelope in try envelope.records.filter { try LocalAccountScope(server: $0.intent.server, ownerId: $0.intent.ownerId) == account } }
    }
    /// An explicit caller action may mint a permit only while the durable request has never been attempted.
    public func submissionPermit(for intent: TaskStopIntent, expectedRevision: UInt64) throws -> TaskStopSubmissionPermit {
        let record: TaskStopRecord = try transact { envelope in
            let index = try self.index(intent, envelope)
            let previous = envelope.records[index]
            guard previous.revision == expectedRevision else { throw TaskStopJournalFailure.staleRevision }
            guard previous.state == .prepared else { throw TaskStopJournalFailure.submissionAlreadyAttempted }
            if previous.nonce != nil { return (previous, false) }
            let updated = TaskStopRecord(intent: intent, state: .prepared, revision: previous.revision + 1, acknowledgment: nil, nonce: UUID().uuidString.lowercased())
            envelope.records[index] = updated; return (updated, true)
        }
        return TaskStopSubmissionPermit(intent: record.intent, journal: self, nonce: record.nonce!, expectedRevision: record.revision)
    }
    func checkPrepared(_ permit: TaskStopSubmissionPermit) throws {
        try read { envelope in
            let previous = envelope.records[try self.index(permit.intent, envelope)]
            guard previous.state == .prepared else { throw TaskStopJournalFailure.submissionAlreadyAttempted }
            guard previous.nonce == permit.nonce, previous.revision == permit.expectedRevision else { throw TaskStopJournalFailure.invalidPermit }
        }
    }
    func consume(_ permit: TaskStopSubmissionPermit) throws {
        try transact { envelope in
            let index = try self.index(permit.intent, envelope)
            let previous = envelope.records[index]
            guard previous.state == .prepared else { throw TaskStopJournalFailure.submissionAlreadyAttempted }
            guard previous.revision == permit.expectedRevision, previous.nonce == permit.nonce else { throw TaskStopJournalFailure.invalidPermit }
            envelope.records[index] = TaskStopRecord(intent: previous.intent, state: .attemptedUnknown, revision: previous.revision + 1, acknowledgment: nil, nonce: previous.nonce)
            return ((), true)
        }
    }
    func acknowledge(_ permit: TaskStopSubmissionPermit, _ acknowledgment: TaskStopAcknowledgment) throws {
        try acknowledgment.validate(intent: permit.intent)
        try transact { envelope in
            let index = try self.index(permit.intent, envelope)
            let previous = envelope.records[index]
            guard previous.nonce == permit.nonce, previous.state == .attemptedUnknown || previous.state == .acknowledged else { throw TaskStopJournalFailure.invalidPermit }
            if let prior = previous.acknowledgment {
                guard prior == acknowledgment else { throw TaskStopJournalFailure.invalidAcknowledgment }
                return ((), false)
            }
            envelope.records[index] = TaskStopRecord(intent: previous.intent, state: .acknowledged, revision: previous.revision + 1, acknowledgment: acknowledgment, nonce: previous.nonce)
            return ((), true)
        }
    }
    private func key(_ intent: TaskStopIntent) throws -> String { try LocalAccountScope(server: intent.server, ownerId: intent.ownerId).cacheKey + "|" + intent.requestId }
    private func index(_ intent: TaskStopIntent, _ envelope: TaskStopEnvelope) throws -> Int {
        guard let index = try envelope.records.firstIndex(where: { try $0.key == self.key(intent) }) else { throw TaskStopJournalFailure.invalidPermit }
        guard envelope.records[index].intent == intent else { throw TaskStopJournalFailure.intentConflict }
        return index
    }
    private func read<T>(_ operation: (TaskStopEnvelope) throws -> T) throws -> T {
        let lock = try files.acquire(); defer { files.release(lock) }
        return try operation(files.load())
    }
    private func transact<T>(_ operation: (inout TaskStopEnvelope) throws -> (T, Bool)) throws -> T {
        let lock = try files.acquire(); defer { files.release(lock) }
        var envelope = try files.load()
        let (result, changed) = try operation(&envelope)
        if changed { envelope.generation += 1; try envelope.validate(); try files.write(envelope) }
        return result
    }
}

private func stopDate(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) { return date }
    formatter.formatOptions = [.withInternetDateTime]; return formatter.date(from: value)
}

private struct TaskStopFiles: Sendable {
    let directory: URL
    var dataURL: URL { directory.appendingPathComponent(TaskStopJournal.fileName) }
    var lockURL: URL { directory.appendingPathComponent("task-stop-operations-v1.lock") }
    init(directory: URL) throws {
        guard directory.isFileURL else { throw TaskStopJournalFailure.unsafeFile }
        self.directory = directory
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var info = stat()
        guard lstat(directory.path, &info) == 0, info.st_mode & S_IFMT == S_IFDIR, info.st_uid == geteuid(), chmod(directory.path, 0o700) == 0 else { throw TaskStopJournalFailure.unsafeFile }
    }
    func acquire() throws -> Int32 {
        let fd = open(lockURL.path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw TaskStopJournalFailure.unsafeFile }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_nlink == 1, info.st_uid == geteuid(), fchmod(fd, 0o600) == 0 else { close(fd); throw TaskStopJournalFailure.unsafeFile }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { close(fd); throw TaskStopJournalFailure.busy }
        return fd
    }
    func release(_ fd: Int32) { _ = flock(fd, LOCK_UN); _ = close(fd) }
    func load() throws -> TaskStopEnvelope {
        let fd = open(dataURL.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        if fd < 0 {
            if errno == ENOENT { return TaskStopEnvelope() }
            throw TaskStopJournalFailure.unsafeFile
        }
        defer { close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_nlink == 1, info.st_uid == geteuid(), info.st_mode & 0o077 == 0 else { throw TaskStopJournalFailure.unsafeFile }
        guard info.st_size <= 1_048_576 else { throw TaskStopJournalFailure.limitExceeded }
        var bytes = Data(); var buffer = [UInt8](repeating: 0, count: 8_192)
        while true {
            let count = Darwin.read(fd, &buffer, buffer.count)
            if count == 0 { break }
            if count < 0 { if errno == EINTR { continue }; throw TaskStopJournalFailure.storageUnavailable }
            guard bytes.count + count <= 1_048_576 else { throw TaskStopJournalFailure.limitExceeded }
            bytes.append(contentsOf: buffer.prefix(count))
        }
        let envelope: TaskStopEnvelope
        do {
            guard let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                  Set(object.keys) == ["schemaVersion", "generation", "records"] else {
                throw TaskStopJournalFailure.corruptFile
            }
            envelope = try JSONDecoder().decode(TaskStopEnvelope.self, from: bytes)
        } catch { throw TaskStopJournalFailure.corruptFile }
        try envelope.validate(); return envelope
    }
    func write(_ envelope: TaskStopEnvelope) throws {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let bytes = try encoder.encode(envelope)
        guard bytes.count <= 1_048_576 else { throw TaskStopJournalFailure.limitExceeded }
        let temporary = directory.appendingPathComponent(".task-stop-\(UUID().uuidString).tmp")
        let fd = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw TaskStopJournalFailure.storageUnavailable }
        defer { close(fd); _ = unlink(temporary.path) }
        try bytes.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let count = Darwin.write(fd, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                if count < 0 { if errno == EINTR { continue }; throw TaskStopJournalFailure.storageUnavailable }
                guard count > 0 else { throw TaskStopJournalFailure.storageUnavailable }; offset += count
            }
        }
        guard fsync(fd) == 0, rename(temporary.path, dataURL.path) == 0 else { throw TaskStopJournalFailure.storageUnavailable }
        let folder = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard folder >= 0 else { throw TaskStopJournalFailure.storageUnavailable }
        defer { close(folder) }
        guard fsync(folder) == 0 else { throw TaskStopJournalFailure.storageUnavailable }
    }
}
