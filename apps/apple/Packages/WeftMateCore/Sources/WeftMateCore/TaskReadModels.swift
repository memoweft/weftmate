import CryptoKit
import Foundation

public struct TaskReadScope: Equatable, Sendable {
    public let server: ServerConfiguration
    public let ownerId: String
    public let hostId: String
    init(_ session: AccountSession) { server = session.server; ownerId = session.account.ownerId; hostId = session.hostId }
}
/// Read-only command identity. New tool kinds retain their wire value without acquiring known tool capabilities.
public struct TaskCommandKind: RawRepresentable, Decodable, Equatable, Sendable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public static let create = Self(rawValue: "session.create")
    public static let message = Self(rawValue: "session.message")
    public static let cancel = Self(rawValue: "session.cancel")
    public static let openApp = Self(rawValue: "desktop.open_app")
    public static let writeArtifact = Self(rawValue: "desktop.write_artifact")
    public var isKnown: Bool { [Self.create, .message, .cancel, .openApp, .writeArtifact].contains(self) }
    public init(from decoder: any Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(String.self)
        try SharedValidation.require(SharedValidation.matches(rawValue, "^[A-Za-z][A-Za-z0-9._:-]{0,127}$"))
    }
}
public struct TaskCommandVerification: Decodable, Equatable, Sendable {
    public let status: String
    public let method: String
    public let observedAt: String?
}
public struct TaskCommandRecord: Decodable, Equatable, Sendable, Identifiable {
    public var id: String { commandId }
    public let commandId: String
    public let requestId: String
    public let kind: TaskCommandKind
    public let targetDeviceId: String
    public let state: SharedCommandState
    /// Unknown service states remain visible and are conservatively projected as uncertain.
    public let rawState: String
    public var hasUnknownState: Bool { SharedCommandState(rawValue: rawState) == nil }
    public let sessionId: String?
    public let receiptId: String?
    public let taskId: String?
    public let rootTaskId: String?
    public let taskAction: String?
    public let artifactId: String?
    public let fileName: String?
    public let size: Int?
    public let sha256: String?
    public let verification: TaskCommandVerification?
    public let errorCode: String?
    public let createdAt: String
    public let updatedAt: String
    enum CodingKeys: String, CodingKey {
        case commandId, requestId, kind, targetDeviceId, state, sessionId, receiptId, taskId, rootTaskId, taskAction
        case artifactId, fileName, size, sha256, verification, errorCode, createdAt, updatedAt
    }
    public init(from decoder: any Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        commandId = try box.decode(String.self, forKey: .commandId)
        requestId = try box.decode(String.self, forKey: .requestId)
        kind = try box.decode(TaskCommandKind.self, forKey: .kind)
        targetDeviceId = try box.decode(String.self, forKey: .targetDeviceId)
        rawState = try box.decode(String.self, forKey: .state)
        try SharedValidation.require(SharedValidation.matches(rawState, "^[A-Za-z][A-Za-z0-9_]{0,63}$"))
        state = SharedCommandState(rawValue: rawState) ?? .uncertain
        sessionId = try box.decodeIfPresent(String.self, forKey: .sessionId)
        receiptId = try box.decodeIfPresent(String.self, forKey: .receiptId)
        taskId = try box.decodeIfPresent(String.self, forKey: .taskId)
        rootTaskId = try box.decodeIfPresent(String.self, forKey: .rootTaskId)
        taskAction = try box.decodeIfPresent(String.self, forKey: .taskAction)
        errorCode = try box.decodeIfPresent(String.self, forKey: .errorCode)
        createdAt = try box.decode(String.self, forKey: .createdAt)
        updatedAt = try box.decode(String.self, forKey: .updatedAt)
        if kind.isKnown {
            artifactId = try box.decodeIfPresent(String.self, forKey: .artifactId)
            fileName = try box.decodeIfPresent(String.self, forKey: .fileName)
            size = try box.decodeIfPresent(Int.self, forKey: .size)
            sha256 = try box.decodeIfPresent(String.self, forKey: .sha256)
            verification = try box.decodeIfPresent(TaskCommandVerification.self, forKey: .verification)
        } else {
            // Future tool-specific schemas cannot invalidate unrelated conversation/task data,
            // and cannot become artifact verification or download permission.
            artifactId = nil; fileName = nil; size = nil; sha256 = nil; verification = nil
        }
    }
    func validate(hostID: String, sessionID: String) throws {
        guard targetDeviceId == hostID, self.sessionId == sessionID else { throw APIFailure.identityMismatch }
        try SharedValidation.require(SharedValidation.id(commandId) && SharedValidation.request(requestId) &&
            (receiptId.map(SharedValidation.receipt) ?? true) && (taskId.map(SharedValidation.id) ?? true) &&
            (rootTaskId.map(SharedValidation.id) ?? true) && MemoryValidation.time(createdAt) && MemoryValidation.time(updatedAt) &&
            (errorCode.map(MemoryValidation.code) ?? true))
    }
    func validateArtifact(taskID: String, artifactID: String? = nil) throws {
        try SharedValidation.require(kind == .writeArtifact && taskId == taskID && self.artifactId.map(SharedValidation.id) == true &&
            (artifactID == nil || artifactId == artifactID) && fileName.map(TaskReadValidation.fileName) == true &&
            size.map { (1...131_072).contains($0) } == true && sha256.map(SharedValidation.hash) == true)
    }
}
public enum TaskControlState: String, Codable, Sendable { case active, uncertain, stopRequested = "stop_requested" }
public enum TaskStopStatus: String, Codable, Sendable { case requested, cancelRequested = "cancel_requested", unconfirmed, stopped, completed }
public struct TaskControlSnapshot: Decodable, Equatable, Sendable {
    public let state: TaskControlState
    public let updatedAt: String
    public let canSupplement: Bool
    public let canStop: Bool
    public let canResume: Bool
    public let stopRequestedAt: String?
    public let stopStatus: TaskStopStatus?
    public let pendingReceipts: Int?
    public let stopObservedAt: String?
    public let legacyStopIntent: Bool?
    public let reasonCode: String?
    func validate() throws {
        try SharedValidation.require(MemoryValidation.time(updatedAt) &&
            [stopRequestedAt, stopObservedAt].allSatisfy { $0.map(MemoryValidation.time) ?? true } &&
            (reasonCode.map(MemoryValidation.code) ?? true) && (pendingReceipts.map { (0...5_000).contains($0) } ?? true))
        if state == .stopRequested {
            try SharedValidation.require(stopStatus != nil && pendingReceipts != nil && !canSupplement && !canStop)
            if stopStatus == .stopped || stopStatus == .completed { try SharedValidation.require(pendingReceipts == 0) }
        } else { try SharedValidation.require(stopStatus == nil && pendingReceipts == nil && !canResume) }
    }
}
public enum TaskReplyStatus: String, Decodable, Sendable { case waiting, streaming, completed, aborted, blocked, failed, unconfirmed }
/// Server-reported evidence for the root task's latest accepted message, not a client-generated completion.
public struct TaskReplyEvidence: Decodable, Equatable, Sendable {
    public let status: TaskReplyStatus
    public let turn: Int?
    public let assistantChunks: Int
    public let textChunks: Int
    public let reasoningChunks: Int
    public let assistantMessages: Int
    public let toolSaveObserved: Bool
    public let step: Int?
    public let observedAt: String?
    public let terminalAt: String?
    public let firstChunkAt: String?
    public let lastChunkAt: String?
    func validate() throws {
        try SharedValidation.require([assistantChunks, textChunks, reasoningChunks, assistantMessages].allSatisfy { (0...100_000).contains($0) } &&
            (turn.map(MemoryValidation.revision) ?? true) && (step.map(MemoryValidation.revision) ?? true) &&
            [observedAt, terminalAt, firstChunkAt, lastChunkAt].allSatisfy { $0.map(MemoryValidation.time) ?? true })
    }
}
public struct TaskSourceLink: Decodable, Equatable, Sendable { public let linkId: String; public let label: String; public let url: String }
public struct TaskSourceMetadata: Decodable, Equatable, Sendable, Identifiable {
    public var id: String { snapshotId }
    public let snapshotId: String
    public let kind: String?
    public let title: String?
    public let url: String?
    public let requestedUrl: String?
    public let readAt: String
    public let contentSha256: String?
    public let fileSha256: String?
    public let truncated: Bool?
    public let cited: Bool?
    public let links: [TaskSourceLink]?
    public let relativePath: String?
    public let lineStart: Int?
    public let lineEnd: Int?
    public let totalLines: Int?
    public let hasMore: Bool?
    public let projectId: String?
    public let projectRevision: Int?
    public let versionHash: String?
    public let segmentIndex: Int?
    public let segmentCount: Int?
    public let byteStart: Int?
    public let byteEnd: Int?
    public let totalCapturedBytes: Int?
    public let captureTruncated: Bool?
    public let parentSnapshotId: String?
    func validate() throws {
        try SharedValidation.require(SharedValidation.id(snapshotId) && MemoryValidation.time(readAt))
        if kind == "webpage" {
            try SharedValidation.require(title.map { $0.utf16.count <= 512 } == true && url.map(TaskReadValidation.webURL) == true &&
                requestedUrl.map(TaskReadValidation.webURL) == true && contentSha256.map(SharedValidation.hash) == true && truncated != nil)
            let links = links ?? []
            try SharedValidation.require(links.count <= 200 && Set(links.map(\.linkId)).count == links.count)
            for link in links { try SharedValidation.require(SharedValidation.id(link.linkId) && link.label.utf16.count <= 512 && TaskReadValidation.webURL(link.url)) }
            if let versionHash {
                try SharedValidation.require(SharedValidation.hash(versionHash) &&
                    segmentIndex.map { $0 >= 0 } == true && segmentCount.map { $0 > 0 && $0 <= 1_000 } == true && segmentIndex! < segmentCount! &&
                    byteStart.map { $0 >= 0 } == true && byteEnd.map { $0 >= byteStart! } == true &&
                    totalCapturedBytes.map { $0 >= byteEnd! && $0 <= 262_144 } == true && captureTruncated != nil &&
                    (parentSnapshotId.map(SharedValidation.id) ?? true))
            }
        } else {
            try SharedValidation.require(kind == nil && relativePath.map(TaskReadValidation.relativePath) == true &&
                fileSha256.map(SharedValidation.hash) == true && lineStart.map { $0 >= 1 } == true &&
                lineEnd.map { $0 >= lineStart! } == true && totalLines.map { $0 >= lineEnd! } == true && hasMore != nil &&
                projectId.map(SharedValidation.id) == true && projectRevision.map { $0 > 0 && $0 <= SharedValidation.maximumSequence } == true)
        }
    }
}
public struct TaskSnapshot: Equatable, Sendable {
    public let scope: TaskReadScope
    public let taskId: String
    public let sessionId: String
    public let sourceText: String
    public let source: TaskCommandRecord
    public let artifacts: [TaskCommandRecord]
    public let steps: [TaskCommandRecord]
    public let sources: [TaskSourceMetadata]
    public let supplements: [TaskCommandRecord]
    public let resumes: [TaskCommandRecord]
    public let control: TaskControlSnapshot
    public let replyEvidence: TaskReplyEvidence
    static func decode(_ data: Data, scope: TaskReadScope, taskID: String) throws -> Self {
        struct Wire: Decodable {
            let taskId: String; let sessionId: String; let sourceText: String; let source: TaskCommandRecord
            let artifacts: [TaskCommandRecord]; let steps: [TaskCommandRecord]; let sources: [TaskSourceMetadata]
            let supplements: [TaskCommandRecord]; let resumes: [TaskCommandRecord]; let control: TaskControlSnapshot; let replyEvidence: TaskReplyEvidence
        }
        let wire: Wire = try MemoryValidation.decode(data)
        guard wire.taskId == taskID, wire.source.commandId == taskID, wire.source.kind == .message,
              wire.source.rootTaskId == nil else { throw APIFailure.identityMismatch }
        try SharedValidation.require(SharedValidation.id(wire.sessionId) && wire.sourceText.utf16.count <= 16_384)
        try wire.source.validate(hostID: scope.hostId, sessionID: wire.sessionId)
        for rows in [wire.artifacts, wire.steps, wire.supplements, wire.resumes] {
            try SharedValidation.require(rows.count <= 5_000 && Set(rows.map(\.commandId)).count == rows.count)
            for row in rows { try row.validate(hostID: scope.hostId, sessionID: wire.sessionId) }
        }
        for row in wire.artifacts { try row.validateArtifact(taskID: taskID) }
        let childTasks = Set([taskID] + wire.supplements.map(\.commandId) + wire.resumes.map(\.commandId))
        for row in wire.steps {
            try SharedValidation.require(![TaskCommandKind.create, .message, .cancel, .writeArtifact].contains(row.kind) &&
                (row.rootTaskId == nil || row.rootTaskId == taskID))
            // Legacy open_app rows may lack taskId. New types must explicitly belong to this root or its children.
            try SharedValidation.require(row.taskId.map(childTasks.contains) ?? (row.kind == .openApp))
        }
        for row in wire.supplements { try SharedValidation.require(row.kind == .message && row.rootTaskId == taskID && row.taskAction == "supplement") }
        for row in wire.resumes { try SharedValidation.require(row.kind == .message && row.rootTaskId == taskID && row.taskAction == "resume") }
        let commands = [wire.source] + wire.artifacts + wire.steps + wire.supplements + wire.resumes
        try SharedValidation.require(Set(commands.map(\.commandId)).count == commands.count)
        try SharedValidation.require(wire.sources.count <= 5_000 && Set(wire.sources.map(\.snapshotId)).count == wire.sources.count)
        for source in wire.sources { try source.validate() }
        try wire.control.validate(); try wire.replyEvidence.validate()
        return .init(scope: scope, taskId: taskID, sessionId: wire.sessionId, sourceText: wire.sourceText, source: wire.source,
            artifacts: wire.artifacts, steps: wire.steps, sources: wire.sources, supplements: wire.supplements, resumes: wire.resumes,
            control: wire.control, replyEvidence: wire.replyEvidence)
    }
}
public enum TaskSourceVerification: String, Sendable { case deliveredTextSHA256Verified, originalFileMetadataOnly }
public struct TaskSourcePreview: Equatable, Sendable {
    public let scope: TaskReadScope
    public let taskId: String
    public let metadata: TaskSourceMetadata
    public let text: String
    public let verification: TaskSourceVerification
    static func decode(_ data: Data, scope: TaskReadScope, taskID: String, sourceID: String) throws -> Self {
        struct TextWire: Decodable { struct Source: Decodable { let text: String }; let source: Source }
        struct MetaWire: Decodable { let source: TaskSourceMetadata }
        let wire: TextWire = try MemoryValidation.decode(data, maximum: 262_144)
        let meta: MetaWire = try MemoryValidation.decode(data, maximum: 262_144)
        guard meta.source.snapshotId == sourceID else { throw APIFailure.identityMismatch }
        try meta.source.validate()
        let bytes = Data(wire.source.text.utf8)
        guard bytes.count <= 32_768 else { throw APIFailure.responseTooLarge }
        let verification: TaskSourceVerification
        if meta.source.kind == "webpage" {
            guard meta.source.contentSha256 == TaskReadValidation.sha(bytes), meta.source.fileSha256 == meta.source.contentSha256 else { throw APIFailure.invalidResponse }
            if let start = meta.source.byteStart, let end = meta.source.byteEnd { try SharedValidation.require(end - start == bytes.count) }
            verification = .deliveredTextSHA256Verified
        } else { verification = .originalFileMetadataOnly }
        return .init(scope: scope, taskId: taskID, metadata: meta.source, text: wire.source.text, verification: verification)
    }
}
public struct TaskArtifactPreview: Equatable, Sendable {
    public let scope: TaskReadScope; public let artifact: TaskCommandRecord; public let text: String
}
public struct TaskArtifactDownload: Equatable, Sendable {
    public let scope: TaskReadScope; public let artifact: TaskCommandRecord; public let data: Data
}
enum TaskReadValidation {
    static func sha(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    static func webURL(_ value: String) -> Bool {
        guard value.utf8.count <= 2_048, let url = URLComponents(string: value),
              let host = url.host, !host.isEmpty, url.url != nil else { return false }
        return ["http", "https"].contains(url.scheme ?? "") && url.user == nil && url.password == nil
    }
    static func relativePath(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 512 && !value.hasPrefix("/") && !value.contains("\\") && !value.contains(":") &&
            value.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }
    static func fileName(_ value: String) -> Bool {
        guard !value.isEmpty, value.utf8.count <= 160, !value.contains(".."),
              value.precomposedStringWithCanonicalMapping == value,
              value == value.trimmingCharacters(in: .whitespacesAndNewlines),
              SharedValidation.matches(value, "^[\\p{L}\\p{N}][\\p{L}\\p{N} ._-]*$"), !value.hasSuffix(".") else { return false }
        let stem = value.lastIndex(of: ".").map { String(value[..<$0]) } ?? value
        return !stem.hasSuffix(" ") && !stem.hasSuffix(".") &&
            !SharedValidation.matches(stem, "(?i)^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\\.|$)")
    }
    static func artifact(_ record: TaskCommandRecord, scope: TaskReadScope, taskID: String, artifactID: String) throws {
        try SharedValidation.require(SharedValidation.id(taskID) && SharedValidation.id(artifactID) && record.sessionId.map(SharedValidation.id) == true)
        try record.validate(hostID: scope.hostId, sessionID: record.sessionId!)
        try record.validateArtifact(taskID: taskID, artifactID: artifactID)
        try SharedValidation.require(record.state == .observed && record.verification?.status == "observed" && record.verification?.method == "sha256_readback" &&
            record.verification?.observedAt.map(MemoryValidation.time) == true)
    }
    static func artifactBytes(_ data: Data, record: TaskCommandRecord) throws {
        guard data.count <= 131_072 else { throw APIFailure.responseTooLarge }
        guard record.size == data.count, record.sha256 == sha(data), !data.contains(0), String(data: data, encoding: .utf8) != nil else { throw APIFailure.invalidResponse }
    }
}
