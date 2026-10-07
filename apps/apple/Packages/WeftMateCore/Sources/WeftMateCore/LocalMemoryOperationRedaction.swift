import Foundation

/// Endpoint/request metadata with no correction text, payload, or text-derived hash.
public struct LocalMemoryOperationIdentity: Codable, Equatable, Sendable {
    public let server: ServerConfiguration
    public let ownerId: String
    public let hostId: String
    public let operation: MemoryMutationKind
    public let itemKind: MemoryKind?
    public let targetId: String
    public let requestId: String
    public let expectedWorldRevision: Int
    public init(intent: MemoryMutationIntent) {
        server = intent.server; ownerId = intent.ownerId; hostId = intent.hostId; operation = intent.operation
        itemKind = intent.itemKind; targetId = intent.targetId; requestId = intent.requestId
        expectedWorldRevision = intent.expectedWorldRevision
    }
    public var account: LocalAccountScope { get throws { try LocalAccountScope(server: server, ownerId: ownerId) } }
    var key: String { get throws { try account.cacheKey + "|" + requestId } }
    func validate() throws {
        guard SharedValidation.id(ownerId), SharedValidation.id(hostId), MemoryValidation.itemID(targetId),
              SharedValidation.request(requestId), MemoryValidation.revision(expectedWorldRevision),
              (operation == .deleteEvidence ? itemKind == nil : itemKind != nil),
              operation != .correct || itemKind != .entity else { throw LocalMemoryOperationFailure.corruptFile }
        _ = try account
    }
    func matches(_ correction: MemoryCorrectionIdentity) -> Bool {
        operation == .correct && ownerId == correction.ownerId && hostId == correction.hostId
            && itemKind == correction.itemKind && targetId == correction.targetId && requestId == correction.requestId
            && expectedWorldRevision == correction.expectedWorldRevision
            && (try? account) == (try? LocalAccountScope(server: correction.server, ownerId: correction.ownerId))
    }
    func matches(_ intent: MemoryMutationIntent) -> Bool {
        ownerId == intent.ownerId && hostId == intent.hostId && operation == intent.operation
            && itemKind == intent.itemKind && targetId == intent.targetId && requestId == intent.requestId
            && expectedWorldRevision == intent.expectedWorldRevision
            && (try? account) == (try? LocalAccountScope(server: intent.server, ownerId: intent.ownerId))
    }
}

public enum LocalMemoryRedactionDisposition: String, Sendable { case complete, pending, notApplicable }
public enum LocalMemoryRedactionNonApplicability: String, Sendable { case notItemDeletion, deletionNotProved }

/// Describes this one atomic journal snapshot; it makes no backup/snapshot/media-erasure claim.
public struct LocalMemoryRedactionResult: Sendable {
    public let disposition: LocalMemoryRedactionDisposition
    public let nonApplicability: LocalMemoryRedactionNonApplicability?
    public let redactedRequestIds: [String]
    public let alreadyRedactedRequestIds: [String]
    public let pendingRequestIds: [String]
    public let retainedNewerRequestIds: [String]
    public let proofs: [MemoryCorrectionRedactionProof]
    public let deletionRecordRevision: UInt64?
    public var deletionProofAvailable: Bool { nonApplicability == nil }
    public var currentJournalScopeComplete: Bool { disposition == .complete && pendingRequestIds.isEmpty }
}
