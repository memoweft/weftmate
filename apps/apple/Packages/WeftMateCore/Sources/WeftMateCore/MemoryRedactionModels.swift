import Foundation

/// Non-body identity of a correction. It contains no correction text, payload, or payload hash.
public struct MemoryCorrectionIdentity: Codable, Equatable, Sendable {
    public let server: ServerConfiguration
    public let ownerId: String
    public let hostId: String
    public let itemKind: MemoryKind
    public let targetId: String
    public let requestId: String
    public let expectedWorldRevision: Int
    init(_ intent: MemoryMutationIntent) throws {
        try SharedValidation.require(intent.operation == .correct && intent.itemKind != nil)
        server = intent.server; ownerId = intent.ownerId; hostId = intent.hostId; itemKind = intent.itemKind!
        targetId = intent.targetId; requestId = intent.requestId; expectedWorldRevision = intent.expectedWorldRevision
        try validate()
    }
    func validate() throws {
        try SharedValidation.require(SharedValidation.id(ownerId) && SharedValidation.id(hostId) &&
            itemKind != .entity && MemoryValidation.itemID(targetId) && SharedValidation.request(requestId) &&
            MemoryValidation.revision(expectedWorldRevision))
    }
    func sameScope(server: ServerConfiguration, ownerID: String, hostID: String) throws -> Bool {
        try LocalAccountScope(server: self.server, ownerId: ownerId) == LocalAccountScope(server: server, ownerId: ownerID) && hostId == hostID
    }
    func matches(_ intent: MemoryMutationIntent) throws -> Bool {
        try sameScope(server: intent.server, ownerID: intent.ownerId, hostID: intent.hostId) && intent.operation == .correct &&
            intent.itemKind == itemKind && intent.targetId == targetId && intent.requestId == requestId && intent.expectedWorldRevision == expectedWorldRevision
    }
}

public struct MemoryCorrectionRedactionProof: Codable, Equatable, Sendable {
    public let correction: MemoryCorrectionIdentity
    public let correctionReceipt: MemoryMutationReceipt
    public let deletionIntent: MemoryMutationIntent
    public let deletionReceipt: MemoryMutationReceipt
    public init(correction: MemoryMutationIntent, correctionReceipt: MemoryMutationReceipt,
                deletedBy: MemoryMutationIntent, deletionReceipt: MemoryMutationReceipt) throws {
        try correctionReceipt.validate(intent: correction)
        try self.init(identity: MemoryCorrectionIdentity(correction), correctionReceipt: correctionReceipt,
            deletionIntent: deletedBy, deletionReceipt: deletionReceipt)
    }
    private init(identity: MemoryCorrectionIdentity, correctionReceipt: MemoryMutationReceipt,
                 deletionIntent: MemoryMutationIntent, deletionReceipt: MemoryMutationReceipt) throws {
        correction = identity; self.correctionReceipt = correctionReceipt; self.deletionIntent = deletionIntent; self.deletionReceipt = deletionReceipt
        try validate()
    }
    public func validate() throws {
        try correction.validate()
        try deletionReceipt.validate(intent: deletionIntent)
        try SharedValidation.require(deletionIntent.operation == .deleteItem && deletionReceipt.effectApplied &&
            deletionIntent.itemKind == correction.itemKind && deletionIntent.targetId == correction.targetId &&
            deletionIntent.requestId != correction.requestId && correction.expectedWorldRevision <= deletionReceipt.worldRevision)
        guard try correction.sameScope(server: deletionIntent.server, ownerID: deletionIntent.ownerId, hostID: deletionIntent.hostId) else {
            throw APIFailure.identityMismatch
        }
        try validateCorrectionReceipt(correctionReceipt)
        try SharedValidation.require(correctionReceipt.worldRevision <= deletionReceipt.worldRevision)
    }
    func validateCorrectionReceipt(_ receipt: MemoryMutationReceipt, known: MemoryMutationReceipt? = nil) throws {
        try SharedValidation.require(SharedValidation.id(receipt.commandId) && MemoryValidation.revision(receipt.worldRevision) &&
            (receipt.reasonCode.map(MemoryValidation.code) ?? true) && receipt.storageCleanup == nil)
        guard receipt.requestId == correction.requestId else { throw APIFailure.identityMismatch }
        if receipt.effectApplied { try SharedValidation.require(receipt.worldRevision >= correction.expectedWorldRevision) }
        if let known {
            guard receipt.commandId == known.commandId, receipt.requestId == known.requestId, receipt.state == known.state,
                  receipt.worldRevision == known.worldRevision else { throw APIFailure.identityMismatch }
        }
    }
    enum CodingKeys: String, CodingKey { case correction, correctionReceipt, deletionIntent, deletionReceipt }
    public init(from decoder: any Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(identity: box.decode(MemoryCorrectionIdentity.self, forKey: .correction),
            correctionReceipt: box.decode(MemoryMutationReceipt.self, forKey: .correctionReceipt),
            deletionIntent: box.decode(MemoryMutationIntent.self, forKey: .deletionIntent),
            deletionReceipt: box.decode(MemoryMutationReceipt.self, forKey: .deletionReceipt))
    }
}
public enum MemoryRAMRedaction: Equatable, Sendable { case redacted, alreadyRedacted, deferredInFlight }

struct MemoryRAMIntentIdentity: Equatable, Sendable {
    let server: ServerConfiguration
    let ownerId: String
    let hostId: String
    let operation: MemoryMutationKind
    let itemKind: MemoryKind?
    let targetId: String
    let requestId: String
    let expectedWorldRevision: Int
    init(_ intent: MemoryMutationIntent) {
        server = intent.server; ownerId = intent.ownerId; hostId = intent.hostId; operation = intent.operation
        itemKind = intent.itemKind; targetId = intent.targetId; requestId = intent.requestId; expectedWorldRevision = intent.expectedWorldRevision
    }
    init(_ identity: MemoryCorrectionIdentity) {
        server = identity.server; ownerId = identity.ownerId; hostId = identity.hostId; operation = .correct
        itemKind = identity.itemKind; targetId = identity.targetId; requestId = identity.requestId; expectedWorldRevision = identity.expectedWorldRevision
    }
    func matches(_ identity: MemoryCorrectionIdentity) throws -> Bool {
        try identity.sameScope(server: server, ownerID: ownerId, hostID: hostId) && operation == .correct && itemKind == identity.itemKind &&
            targetId == identity.targetId && requestId == identity.requestId && expectedWorldRevision == identity.expectedWorldRevision
    }
}
