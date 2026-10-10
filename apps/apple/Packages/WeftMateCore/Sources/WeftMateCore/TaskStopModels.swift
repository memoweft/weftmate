import Foundation

public struct TaskStopIntent: Codable, Equatable, Sendable {
    public let server: ServerConfiguration
    public let ownerId: String
    public let hostId: String
    public let rootCommandId: String
    public let sessionId: String
    public let sourceReceiptId: String?
    public let requestId: String
    public let observedControlState: TaskControlState
    public let observedControlUpdatedAt: String
    public let payload: Data
    public init(snapshot: TaskSnapshot, requestID: String) throws {
        try SharedValidation.require(snapshot.control.canStop)
        try self.init(server: snapshot.scope.server, ownerId: snapshot.scope.ownerId, hostId: snapshot.scope.hostId,
            rootCommandId: snapshot.taskId, sessionId: snapshot.sessionId, sourceReceiptId: snapshot.source.receiptId, requestId: requestID,
            observedControlState: snapshot.control.state, observedControlUpdatedAt: snapshot.control.updatedAt)
        try validate(snapshot: snapshot, phase: .preflight)
    }
    private init(server: ServerConfiguration, ownerId: String, hostId: String, rootCommandId: String,
                 sessionId: String, sourceReceiptId: String?, requestId: String,
                 observedControlState: TaskControlState, observedControlUpdatedAt: String) throws {
        try SharedValidation.require(SharedValidation.id(ownerId) && SharedValidation.id(hostId) && SharedValidation.id(rootCommandId) &&
            SharedValidation.id(sessionId) && (sourceReceiptId.map(SharedValidation.receipt) ?? true) && SharedValidation.request(requestId) &&
            observedControlState != .stopRequested && MemoryValidation.time(observedControlUpdatedAt))
        self.server = server; self.ownerId = ownerId; self.hostId = hostId; self.rootCommandId = rootCommandId
        self.sessionId = sessionId; self.sourceReceiptId = sourceReceiptId; self.requestId = requestId
        self.observedControlState = observedControlState; self.observedControlUpdatedAt = observedControlUpdatedAt
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        payload = try encoder.encode(["requestId": requestId])
    }
    enum MatchPhase { case preflight, response, observation }
    func validate(snapshot: TaskSnapshot, phase: MatchPhase) throws {
        guard snapshot.scope.server == server, snapshot.scope.ownerId == ownerId, snapshot.scope.hostId == hostId,
              snapshot.taskId == rootCommandId, snapshot.source.commandId == rootCommandId,
              [.message, .chatMessage].contains(snapshot.source.kind), snapshot.sessionId == sessionId, snapshot.source.sessionId == sessionId else {
            throw APIFailure.identityMismatch
        }
        if phase == .preflight || sourceReceiptId != nil {
            guard snapshot.source.receiptId == sourceReceiptId else { throw APIFailure.identityMismatch }
        }
        if phase == .preflight {
            guard snapshot.control.state == observedControlState, snapshot.control.updatedAt == observedControlUpdatedAt else { throw APIFailure.identityMismatch }
        }
    }
    enum CodingKeys: String, CodingKey { case server, ownerId, hostId, rootCommandId, sessionId, sourceReceiptId, requestId, observedControlState, observedControlUpdatedAt, payload }
    public init(from decoder: any Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(server: box.decode(ServerConfiguration.self, forKey: .server), ownerId: box.decode(String.self, forKey: .ownerId),
            hostId: box.decode(String.self, forKey: .hostId), rootCommandId: box.decode(String.self, forKey: .rootCommandId),
            sessionId: box.decode(String.self, forKey: .sessionId), sourceReceiptId: box.decodeIfPresent(String.self, forKey: .sourceReceiptId),
            requestId: box.decode(String.self, forKey: .requestId), observedControlState: box.decode(TaskControlState.self, forKey: .observedControlState),
            observedControlUpdatedAt: box.decode(String.self, forKey: .observedControlUpdatedAt))
        guard try box.decode(Data.self, forKey: .payload) == payload else { throw APIFailure.invalidResponse }
    }
}
public enum TaskStopProofLevel: String, Sendable { case response202MatchedRoot, taskStateOnly }
public struct TaskStopObservation: Sendable {
    public let task: TaskSnapshot
    public let proofLevel: TaskStopProofLevel
    public let journalAcknowledgmentSaved: Bool
    public var ownStopAcknowledged: Bool { proofLevel == .response202MatchedRoot }
}
public struct TaskStopAcknowledgment: Codable, Equatable, Sendable {
    public let rootCommandId: String
    public let sessionId: String
    public let returnedSourceReceiptId: String?
    public let stopStatus: TaskStopStatus
    public let controlUpdatedAt: String
    init(_ task: TaskSnapshot, intent: TaskStopIntent) throws {
        try intent.validate(snapshot: task, phase: .response)
        try SharedValidation.require(task.control.state == .stopRequested && task.control.stopStatus != nil)
        rootCommandId = task.taskId; sessionId = task.sessionId; returnedSourceReceiptId = task.source.receiptId
        stopStatus = task.control.stopStatus!
        controlUpdatedAt = task.control.updatedAt
    }
    func validate(intent: TaskStopIntent) throws {
        try SharedValidation.require(rootCommandId == intent.rootCommandId && sessionId == intent.sessionId &&
            (returnedSourceReceiptId.map(SharedValidation.receipt) ?? true) && MemoryValidation.time(controlUpdatedAt))
        guard intent.sourceReceiptId == nil || intent.sourceReceiptId == returnedSourceReceiptId else { throw APIFailure.identityMismatch }
    }
}
public enum TaskStopJournalState: String, Codable, Sendable { case prepared, attemptedUnknown, acknowledged }
/// A sealed capability from the durable journal. It cannot be encoded, forged, or minted by an external caller.
public struct TaskStopSubmissionPermit: Sendable {
    public let intent: TaskStopIntent
    let journal: TaskStopJournal
    let nonce: String
    let expectedRevision: UInt64
    init(intent: TaskStopIntent, journal: TaskStopJournal, nonce: String, expectedRevision: UInt64) {
        self.intent = intent; self.journal = journal; self.nonce = nonce; self.expectedRevision = expectedRevision
    }
    func checkPrepared() async throws { try await journal.checkPrepared(self) }
    func consume() async throws { try await journal.consume(self) }
    func acknowledge(_ acknowledgment: TaskStopAcknowledgment) async throws { try await journal.acknowledge(self, acknowledgment) }
}
