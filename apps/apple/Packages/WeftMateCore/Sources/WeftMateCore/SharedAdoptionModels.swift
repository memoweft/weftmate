import Foundation

/// This endpoint has its own body and ledger; it is not a /commands payload.
public struct SharedAdoptionIntent: Codable, Equatable, Sendable {
    public let server: ServerConfiguration
    public let ownerId: String
    public let hostId: String
    public let conversationId: String
    public let requestId: String
    public let modelProfileId: String
    public let expectedSyncSeq: Int
    public let acknowledgeUncertainLocalTurn: Bool
    public let payload: Data

    public init(session: AccountSession, conversationID: String, requestID: String,
                modelProfileID: String, expectedSyncSeq: Int, acknowledgeUncertainLocalTurn: Bool = false) throws {
        try self.init(server: session.server, ownerId: session.account.ownerId, hostId: session.hostId,
            conversationId: conversationID, requestId: requestID, modelProfileId: modelProfileID, expectedSyncSeq: expectedSyncSeq, acknowledgeUncertainLocalTurn: acknowledgeUncertainLocalTurn)
    }
    private init(server: ServerConfiguration, ownerId: String, hostId: String, conversationId: String,
                 requestId: String, modelProfileId: String, expectedSyncSeq: Int, acknowledgeUncertainLocalTurn: Bool) throws {
        try SharedValidation.require(SharedValidation.id(ownerId) && SharedValidation.id(hostId) &&
            SharedValidation.id(conversationId) && SharedValidation.request(requestId) && SharedValidation.profile(modelProfileId) &&
            expectedSyncSeq > 0 && expectedSyncSeq <= SharedValidation.maximumSequence)
        struct Body: Encodable { let requestId: String; let modelProfileId: String; let expectedSyncSeq: Int; let acknowledgeUncertainLocalTurn: Bool? }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        payload = try encoder.encode(Body(requestId: requestId, modelProfileId: modelProfileId, expectedSyncSeq: expectedSyncSeq, acknowledgeUncertainLocalTurn: acknowledgeUncertainLocalTurn ? true : nil))
        self.server = server; self.ownerId = ownerId; self.hostId = hostId; self.conversationId = conversationId
        self.requestId = requestId; self.modelProfileId = modelProfileId; self.expectedSyncSeq = expectedSyncSeq
        self.acknowledgeUncertainLocalTurn = acknowledgeUncertainLocalTurn
    }
    enum CodingKeys: String, CodingKey { case server, ownerId, hostId, conversationId, requestId, modelProfileId, expectedSyncSeq, acknowledgeUncertainLocalTurn, payload }
    public init(from decoder: any Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(server: box.decode(ServerConfiguration.self, forKey: .server), ownerId: box.decode(String.self, forKey: .ownerId),
            hostId: box.decode(String.self, forKey: .hostId), conversationId: box.decode(String.self, forKey: .conversationId),
            requestId: box.decode(String.self, forKey: .requestId), modelProfileId: box.decode(String.self, forKey: .modelProfileId),
            expectedSyncSeq: box.decode(Int.self, forKey: .expectedSyncSeq),
            acknowledgeUncertainLocalTurn: box.decodeIfPresent(Bool.self, forKey: .acknowledgeUncertainLocalTurn) ?? false)
        guard try box.decode(Data.self, forKey: .payload) == payload else { throw APIFailure.invalidResponse }
    }
}

public enum SharedAdoptionValidationLevel: String, Codable, Sendable { case bindingMatched, rejectedCommandOnly }
public struct SharedAdoptionReceipt: Codable, Equatable, Sendable {
    public let command: SharedCommandReceipt
    public let projection: SharedConversationProjection
    public var bindingRevision: Int? { projection.binding?.revision }
    public var validationLevel: SharedAdoptionValidationLevel { projection.binding == nil ? .rejectedCommandOnly : .bindingMatched }
    // Construction is confined to validated SDK replies and checked persisted decoding.
    init(command: SharedCommandReceipt, projection: SharedConversationProjection,
         intent: SharedAdoptionIntent, knownBindingRevision: Int? = nil) throws {
        self.command = command; self.projection = projection
        try validate(intent: intent, knownBindingRevision: knownBindingRevision)
    }
    public func validate(intent: SharedAdoptionIntent, knownBindingRevision: Int? = nil) throws {
        try command.validateStructure()
        try projection.validate(conversationID: intent.conversationId, hostID: intent.hostId)
        try SharedValidation.require(knownBindingRevision.map { $0 > 0 && $0 <= SharedValidation.maximumSequence } ?? true)
        guard command.requestId == intent.requestId, command.kind == .create, command.targetDeviceId == intent.hostId,
              command.conversationId == intent.conversationId, command.sourceSyncEventId == nil,
              command.sessionId != nil else { throw APIFailure.identityMismatch }
        guard let binding = projection.binding else {
            // The server removes rejected creation bindings. This proves rejection metadata, not profile or body hash.
            guard command.state == .rejected, projection.status == .unbound else { throw APIFailure.identityMismatch }
            return
        }
        guard command.sessionId == binding.sessionId,
              command.commandId == binding.adoptCommandId, binding.modelProfileId == intent.modelProfileId,
              binding.cutoverSyncSeq == intent.expectedSyncSeq,
              knownBindingRevision == nil || knownBindingRevision == binding.revision else { throw APIFailure.identityMismatch }
    }
}
public enum SharedAdoptionReconciliation: Equatable, Sendable { case found(SharedAdoptionReceipt), notFound }
