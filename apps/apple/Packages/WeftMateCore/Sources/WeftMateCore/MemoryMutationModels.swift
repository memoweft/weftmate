import Foundation

public enum MemoryMutationKind: String, Codable, Sendable {
    case correct, mute, deleteItem, deleteEvidence
    public var isDeletion: Bool { self == .deleteItem || self == .deleteEvidence }
}
/// A memory-domain operation, never an arbitrary HTTP request or a shared-session command.
public struct MemoryMutationIntent: Codable, Equatable, Sendable {
    public let server: ServerConfiguration
    public let ownerId: String
    public let hostId: String
    public let operation: MemoryMutationKind
    public let itemKind: MemoryKind?
    public let targetId: String
    public let requestId: String
    public let expectedWorldRevision: Int
    public let correction: String?
    public let payload: Data
    var endpointPath: String {
        if operation == .deleteEvidence { return "/memory/evidence/\(targetId)" }
        let item = "/memory/items/\(itemKind!.rawValue)/\(targetId)"
        return item + (operation == .correct ? "/correct" : operation == .mute ? "/mute" : "")
    }
    var httpMethod: String { operation.isDeletion ? "DELETE" : "POST" }
    public init(session: AccountSession, operation: MemoryMutationKind, itemKind: MemoryKind? = nil,
                targetID: String, requestID: String, expectedWorldRevision: Int, correction: String? = nil) throws {
        try self.init(server: session.server, ownerId: session.account.ownerId, hostId: session.hostId, operation: operation,
            itemKind: itemKind, targetId: targetID, requestId: requestID, expectedWorldRevision: expectedWorldRevision, correction: correction)
    }
    private init(server: ServerConfiguration, ownerId: String, hostId: String, operation: MemoryMutationKind,
                 itemKind: MemoryKind?, targetId: String, requestId: String, expectedWorldRevision: Int, correction: String?) throws {
        let reserved = Set(["constructor", "__defineGetter__", "__defineSetter__", "hasOwnProperty", "__lookupGetter__", "__lookupSetter__",
            "isPrototypeOf", "propertyIsEnumerable", "toString", "valueOf", "__proto__", "toLocaleString"])
        try SharedValidation.require(SharedValidation.id(ownerId) && SharedValidation.id(hostId) && MemoryValidation.itemID(targetId) &&
            SharedValidation.request(requestId) && !reserved.contains(requestId) && MemoryValidation.revision(expectedWorldRevision) &&
            (operation == .deleteEvidence ? itemKind == nil : itemKind != nil))
        if operation == .correct {
            try SharedValidation.require(itemKind != .entity && correction.map { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.utf16.count <= 4_000 } == true)
        } else { try SharedValidation.require(correction == nil) }
        struct Body: Encodable { let requestId: String; let expectedWorldRevision: Int; let text: String? }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let payload = try encoder.encode(Body(requestId: requestId, expectedWorldRevision: expectedWorldRevision, text: correction))
        try SharedValidation.require(payload.count <= (operation == .correct ? 16_384 : 12_288))
        self.server = server; self.ownerId = ownerId; self.hostId = hostId; self.operation = operation; self.itemKind = itemKind
        self.targetId = targetId; self.requestId = requestId; self.expectedWorldRevision = expectedWorldRevision; self.correction = correction; self.payload = payload
    }
    enum CodingKeys: String, CodingKey { case server, ownerId, hostId, operation, itemKind, targetId, requestId, expectedWorldRevision, correction, payload }
    public init(from decoder: any Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(server: box.decode(ServerConfiguration.self, forKey: .server), ownerId: box.decode(String.self, forKey: .ownerId),
            hostId: box.decode(String.self, forKey: .hostId), operation: box.decode(MemoryMutationKind.self, forKey: .operation),
            itemKind: box.decodeIfPresent(MemoryKind.self, forKey: .itemKind), targetId: box.decode(String.self, forKey: .targetId),
            requestId: box.decode(String.self, forKey: .requestId), expectedWorldRevision: box.decode(Int.self, forKey: .expectedWorldRevision),
            correction: box.decodeIfPresent(String.self, forKey: .correction))
        guard try box.decode(Data.self, forKey: .payload) == payload else { throw APIFailure.invalidResponse }
    }
}
public enum MemoryMutationState: String, Codable, Sendable {
    case applied, noChange = "no_change", revisionConflict = "revision_conflict", rejected
    public var effectApplied: Bool { self == .applied || self == .noChange }
}
public enum MemoryStorageCleanupState: String, Codable, Sendable { case complete, pending }
public struct MemoryStorageCleanup: Codable, Equatable, Sendable {
    public let state: MemoryStorageCleanupState
    public let detailCode: String
    func validate() throws {
        let complete = ["current_journal_committed", "current_wal_truncated"]
        let pending = ["wal_reader_busy", "checkpoint_pending", "host_journal_cleanup_pending"]
        try SharedValidation.require((state == .complete ? complete : pending).contains(detailCode))
    }
}
public struct MemoryMutationReceipt: Codable, Equatable, Sendable {
    public let commandId: String
    public let requestId: String
    public let state: MemoryMutationState
    public let worldRevision: Int
    public let reasonCode: String?
    public let storageCleanup: MemoryStorageCleanup?
    public var effectApplied: Bool { state.effectApplied }
    public var cleanupPending: Bool { storageCleanup?.state == .pending }
    /// No absent cleanup field is promoted to a completed physical cleanup.
    public var cleanupConfirmedComplete: Bool { effectApplied && storageCleanup?.state == .complete }
    public func validate(intent: MemoryMutationIntent, knownReceipt: Self? = nil) throws {
        try SharedValidation.require(SharedValidation.id(commandId) && MemoryValidation.revision(worldRevision) &&
            (reasonCode.map(MemoryValidation.code) ?? true))
        guard requestId == intent.requestId else { throw APIFailure.identityMismatch }
        if effectApplied { try SharedValidation.require(worldRevision >= intent.expectedWorldRevision) }
        if let storageCleanup {
            try storageCleanup.validate()
            try SharedValidation.require(intent.operation.isDeletion && effectApplied)
        }
        if let knownReceipt {
            guard knownReceipt.requestId == requestId, knownReceipt.commandId == commandId,
                  knownReceipt.state == state, knownReceipt.worldRevision == worldRevision else { throw APIFailure.identityMismatch }
            if knownReceipt.storageCleanup != nil, storageCleanup == nil { throw APIFailure.invalidResponse }
            if knownReceipt.cleanupConfirmedComplete, !cleanupConfirmedComplete { throw APIFailure.invalidResponse }
        }
    }
}
public enum MemoryMutationReconciliation: Equatable, Sendable { case found(MemoryMutationReceipt), notFound }
