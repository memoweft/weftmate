import Foundation

/// Public account/host/session identity only; it carries no authentication material.
public struct SessionInteractionScope: Codable, Equatable, Sendable {
    public let server: ServerConfiguration
    public let ownerId: String
    public let hostId: String
    public let sessionId: String

    public init(session: AccountSession, sessionID: String) throws {
        server = session.server; ownerId = session.account.ownerId; hostId = session.hostId; sessionId = sessionID
        try validate()
    }
    func validate() throws {
        try SharedValidation.require([ownerId, hostId, sessionId].allSatisfy(SharedValidation.id))
    }
    func validate(session: AccountSession) throws {
        try validate()
        guard server == session.server, ownerId == session.account.ownerId, hostId == session.hostId else {
            throw APIFailure.accountChanged
        }
    }
    func validate(cursorScope: Self) throws {
        guard server == cursorScope.server, ownerId == cursorScope.ownerId, hostId == cursorScope.hostId else {
            throw APIFailure.accountChanged
        }
        try SharedValidation.require(sessionId == cursorScope.sessionId)
    }
}

/// Unknown wire states remain unknown and never acquire answering or completion capabilities.
public struct SessionInteractionStatus: RawRepresentable, Codable, Equatable, Sendable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public static let pending = Self(rawValue: "pending")
    public static let answered = Self(rawValue: "answered")
    public static let resolved = Self(rawValue: "resolved")
    public static let unavailable = Self(rawValue: "unavailable")
    public var isKnown: Bool { [Self.pending, .answered, .resolved, .unavailable].contains(self) }
    public var isTerminal: Bool { self == .resolved || self == .unavailable }
    public init(from decoder: any Decoder) throws { rawValue = try decoder.singleValueContainer().decode(String.self) }
    public func encode(to encoder: any Encoder) throws {
        var box = encoder.singleValueContainer(); try box.encode(rawValue)
    }
}

/// Only these two outcomes may be submitted to the permission endpoint.
public enum ApprovalDecisionOutcome: String, Codable, Sendable { case allowedOnce = "allowed-once", rejected }
public struct ApprovalOutcome: RawRepresentable, Codable, Equatable, Sendable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public static let allowedOnce = Self(rawValue: "allowed-once")
    public static let rejected = Self(rawValue: "rejected")
    public static let cancelled = Self(rawValue: "cancelled")
    public static let unavailable = Self(rawValue: "unavailable")
    public var isKnown: Bool { [Self.allowedOnce, .rejected, .cancelled, .unavailable].contains(self) }
    public init(from decoder: any Decoder) throws { rawValue = try decoder.singleValueContainer().decode(String.self) }
    public func encode(to encoder: any Encoder) throws {
        var box = encoder.singleValueContainer(); try box.encode(rawValue)
    }
}

public struct SessionApproval: Codable, Equatable, Sendable, Identifiable {
    public var id: String { approvalId }
    public let approvalId: String
    public let sessionId: String
    public let taskId: String
    public let sourceCommandId: String
    public let sourceReceiptId: String
    public let turn: Int
    public let callId: String
    public let rootCallId: String?
    public let toolName: String
    public let reason: String
    public let createdAt: String
    public let status: SessionInteractionStatus
    public let decisionOutcome: ApprovalOutcome?
    public let decisionRequestId: String?
    public let answeredAt: String?
    public let outcome: ApprovalOutcome?
    public let resolvedAt: String?
    public var canDecide: Bool { status == .pending }

    func validate(scope: SessionInteractionScope) throws {
        guard sessionId == scope.sessionId else { throw APIFailure.identityMismatch }
        try InteractionValidation.identity(id: approvalId, task: taskId, command: sourceCommandId,
            receipt: sourceReceiptId, turn: turn, createdAt: createdAt)
        try SharedValidation.require(!callId.isEmpty && (rootCallId.map { !$0.isEmpty } ?? true) && !toolName.isEmpty &&
            !status.rawValue.isEmpty && (decisionRequestId.map(SharedValidation.request) ?? true) &&
            [answeredAt, resolvedAt].allSatisfy { $0.map(MemoryValidation.time) ?? true })
    }
    func matchesIdentity(_ other: Self) -> Bool {
        approvalId == other.approvalId && sessionId == other.sessionId && taskId == other.taskId &&
            sourceCommandId == other.sourceCommandId && sourceReceiptId == other.sourceReceiptId &&
            turn == other.turn && callId == other.callId && rootCallId == other.rootCallId && createdAt == other.createdAt
    }
}

public struct ApprovalPageCursor: Equatable, Sendable {
    public let scope: SessionInteractionScope
    public let beforeID: String
    fileprivate let seenIDs: Set<String>
    func validate(scope: SessionInteractionScope) throws {
        try scope.validate(cursorScope: self.scope)
        try SharedValidation.require(SharedValidation.id(beforeID))
    }
}
public struct ApprovalPage: Equatable, Sendable {
    public let scope: SessionInteractionScope
    public let approvals: [SessionApproval]
    public let nextBefore: String?
    public let nextCursor: ApprovalPageCursor?
    public let hasMore: Bool
    static func decode(_ data: Data, scope: SessionInteractionScope, limit: Int, previous: ApprovalPageCursor?) throws -> Self {
        struct Wire: Decodable { let approvals: [SessionApproval]; let nextBefore: String?; let hasMore: Bool }
        try previous?.validate(scope: scope)
        let wire: Wire = try MemoryValidation.decode(data)
        let seen = try InteractionValidation.page(ids: wire.approvals.map(\.approvalId), limit: limit,
            next: wire.nextBefore, hasMore: wire.hasMore, priorBefore: previous?.beforeID, seen: previous?.seenIDs ?? [])
        for approval in wire.approvals { try approval.validate(scope: scope) }
        let cursor = wire.nextBefore.map { ApprovalPageCursor(scope: scope, beforeID: $0, seenIDs: seen) }
        return .init(scope: scope, approvals: wire.approvals, nextBefore: wire.nextBefore, nextCursor: cursor, hasMore: wire.hasMore)
    }
}

/// Construct, persist, and then submit this intent. Retries use its exact payload bytes and requestId.
public struct ApprovalDecisionIntent: Codable, Equatable, Sendable {
    public let scope: SessionInteractionScope
    public let approval: SessionApproval
    public let outcome: ApprovalDecisionOutcome
    public let requestId: String
    public let payload: Data
    public var approvalId: String { approval.approvalId }
    public var sessionId: String { scope.sessionId }
    public var taskId: String { approval.taskId }
    public var sourceCommandId: String { approval.sourceCommandId }
    public var sourceReceiptId: String { approval.sourceReceiptId }
    public init(scope: SessionInteractionScope, approval: SessionApproval, outcome: ApprovalDecisionOutcome, requestID: String) throws {
        try scope.validate(); try approval.validate(scope: scope)
        try SharedValidation.require(approval.canDecide && SharedValidation.request(requestID))
        self.scope = scope; self.approval = approval; self.outcome = outcome; requestId = requestID
        struct Body: Encodable { let requestId: String; let outcome: ApprovalDecisionOutcome }
        payload = try InteractionValidation.encode(Body(requestId: requestID, outcome: outcome))
    }
    enum CodingKeys: String, CodingKey { case scope, approval, outcome, requestId, payload }
    public init(from decoder: any Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(scope: box.decode(SessionInteractionScope.self, forKey: .scope),
            approval: box.decode(SessionApproval.self, forKey: .approval), outcome: box.decode(ApprovalDecisionOutcome.self, forKey: .outcome),
            requestID: box.decode(String.self, forKey: .requestId))
        guard try box.decode(Data.self, forKey: .payload) == payload else { throw APIFailure.invalidResponse }
    }
}
/// A matched 200 registers the decision; the native decision and task completion are separate evidence.
public struct ApprovalDecisionReceipt: Codable, Equatable, Sendable {
    public let scope: SessionInteractionScope
    public let approval: SessionApproval
    public let requestId: String
    static func decode(_ data: Data, intent: ApprovalDecisionIntent) throws -> Self {
        struct Wire: Decodable { let approval: SessionApproval; let requestId: String }
        let wire: Wire = try MemoryValidation.decode(data)
        try wire.approval.validate(scope: intent.scope)
        guard wire.requestId == intent.requestId, wire.approval.matchesIdentity(intent.approval) else { throw APIFailure.identityMismatch }
        try SharedValidation.require(wire.approval.status == .answered && wire.approval.decisionRequestId == intent.requestId &&
            wire.approval.decisionOutcome?.rawValue == intent.outcome.rawValue && wire.approval.answeredAt != nil)
        return .init(scope: intent.scope, approval: wire.approval, requestId: wire.requestId)
    }
}

public struct QuestionOption: Codable, Equatable, Sendable {
    public let label: String
    public let description: String?
}
public struct SessionQuestion: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let question: String
    public let header: String?
    public let options: [QuestionOption]?
    public let multiSelect: Bool?
    public let detail: String?
    public let intent: String?
    func validate() throws {
        let labels = (options ?? []).map(\.label)
        try SharedValidation.require(!id.isEmpty && !question.isEmpty && labels.allSatisfy { !$0.isEmpty } && Set(labels).count == labels.count)
    }
}
public struct QuestionAnswerItem: Codable, Equatable, Sendable {
    public let id: String
    public let selected: [String]
    public let custom: String?
    public init(id: String, selected: [String], custom: String? = nil) { self.id = id; self.selected = selected; self.custom = custom }
    func validate(question: SessionQuestion) throws {
        let labels = Set((question.options ?? []).map(\.label))
        try SharedValidation.require(id == question.id && Set(selected).count == selected.count && selected.allSatisfy(labels.contains))
        if let custom { try SharedValidation.require(!custom.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
        try SharedValidation.require(!selected.isEmpty || custom != nil)
        if question.multiSelect != true { try SharedValidation.require(selected.count <= 1 && (selected.isEmpty || custom == nil)) }
    }
}
public struct QuestionAnswer: Codable, Equatable, Sendable {
    public let answers: [QuestionAnswerItem]
    public init(answers: [QuestionAnswerItem]) { self.answers = answers }
    func validate(questions: [SessionQuestion]) throws {
        try SharedValidation.require(answers.count == questions.count)
        for (answer, question) in zip(answers, questions) { try answer.validate(question: question) }
    }
}
public struct QuestionOutcome: RawRepresentable, Codable, Equatable, Sendable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public static let answered = Self(rawValue: "answered")
    public static let cancelled = Self(rawValue: "cancelled")
    public var isKnown: Bool { [Self.answered, .cancelled].contains(self) }
    public init(from decoder: any Decoder) throws { rawValue = try decoder.singleValueContainer().decode(String.self) }
    public func encode(to encoder: any Encoder) throws {
        var box = encoder.singleValueContainer(); try box.encode(rawValue)
    }
}
public struct SessionQuestionBatch: Codable, Equatable, Sendable, Identifiable {
    public var id: String { questionRpcId }
    public let questionRpcId: String
    public let observedSeq: Int?
    public let sessionId: String
    public let taskId: String
    public let sourceCommandId: String
    public let sourceReceiptId: String
    public let turn: Int
    public let questions: [SessionQuestion]
    public let createdAt: String
    public let status: SessionInteractionStatus
    public let answer: QuestionAnswer?
    public let answerRequestId: String?
    public let answeredAt: String?
    public let answerAcceptedAt: String?
    public let outcome: QuestionOutcome?
    public let resolvedAt: String?
    public let reasonCode: String?
    public let unavailableAt: String?
    public var canAnswer: Bool { status == .pending }
    /// Native `outcome: answered` alone does not acknowledge an answer from this personal entry point.
    public func acceptedAnswer(requestID: String) -> Bool { answerRequestId == requestID && answerAcceptedAt != nil }
    func validate(scope: SessionInteractionScope) throws {
        guard sessionId == scope.sessionId else { throw APIFailure.identityMismatch }
        try InteractionValidation.identity(id: questionRpcId, task: taskId, command: sourceCommandId,
            receipt: sourceReceiptId, turn: turn, createdAt: createdAt)
        try SharedValidation.require(!status.rawValue.isEmpty && !questions.isEmpty && Set(questions.map(\.id)).count == questions.count &&
            (answerRequestId.map(SharedValidation.request) ?? true) &&
            [answeredAt, answerAcceptedAt, resolvedAt, unavailableAt].allSatisfy { $0.map(MemoryValidation.time) ?? true })
        for question in questions { try question.validate() }
        try answer?.validate(questions: questions)
    }
    func matchesIdentity(_ other: Self) -> Bool {
        questionRpcId == other.questionRpcId && sessionId == other.sessionId && taskId == other.taskId &&
            sourceCommandId == other.sourceCommandId && sourceReceiptId == other.sourceReceiptId && turn == other.turn &&
            questions == other.questions && createdAt == other.createdAt
    }
}
public struct QuestionPageCursor: Equatable, Sendable {
    public let scope: SessionInteractionScope
    public let beforeID: String
    fileprivate let seenIDs: Set<String>
    func validate(scope: SessionInteractionScope) throws {
        try scope.validate(cursorScope: self.scope)
        try SharedValidation.require(SharedValidation.id(beforeID))
    }
}
public struct QuestionPage: Equatable, Sendable {
    public let scope: SessionInteractionScope
    public let questions: [SessionQuestionBatch]
    public let nextBefore: String?
    public let nextCursor: QuestionPageCursor?
    public let hasMore: Bool
    static func decode(_ data: Data, scope: SessionInteractionScope, limit: Int, previous: QuestionPageCursor?) throws -> Self {
        struct Wire: Decodable { let questions: [SessionQuestionBatch]; let nextBefore: String?; let hasMore: Bool }
        try previous?.validate(scope: scope)
        let wire: Wire = try MemoryValidation.decode(data)
        let seen = try InteractionValidation.page(ids: wire.questions.map(\.questionRpcId), limit: limit,
            next: wire.nextBefore, hasMore: wire.hasMore, priorBefore: previous?.beforeID, seen: previous?.seenIDs ?? [])
        for question in wire.questions { try question.validate(scope: scope) }
        let cursor = wire.nextBefore.map { QuestionPageCursor(scope: scope, beforeID: $0, seenIDs: seen) }
        return .init(scope: scope, questions: wire.questions, nextBefore: wire.nextBefore, nextCursor: cursor, hasMore: wire.hasMore)
    }
}
public struct QuestionAnswerIntent: Codable, Equatable, Sendable {
    public let scope: SessionInteractionScope
    public let question: SessionQuestionBatch
    public let answer: QuestionAnswer
    public let requestId: String
    public let payload: Data
    public var questionRpcId: String { question.questionRpcId }
    public var sessionId: String { scope.sessionId }
    public var taskId: String { question.taskId }
    public var sourceCommandId: String { question.sourceCommandId }
    public var sourceReceiptId: String { question.sourceReceiptId }
    public init(scope: SessionInteractionScope, question: SessionQuestionBatch, answers: [QuestionAnswerItem], requestID: String) throws {
        try scope.validate(); try question.validate(scope: scope)
        try SharedValidation.require(question.canAnswer && SharedValidation.request(requestID))
        let answer = QuestionAnswer(answers: answers); try answer.validate(questions: question.questions)
        self.scope = scope; self.question = question; self.answer = answer; requestId = requestID
        struct Body: Encodable { let requestId: String; let answer: QuestionAnswer }
        payload = try InteractionValidation.encode(Body(requestId: requestID, answer: answer))
    }
    enum CodingKeys: String, CodingKey { case scope, question, answer, requestId, payload }
    public init(from decoder: any Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(scope: box.decode(SessionInteractionScope.self, forKey: .scope),
            question: box.decode(SessionQuestionBatch.self, forKey: .question),
            answers: box.decode(QuestionAnswer.self, forKey: .answer).answers, requestID: box.decode(String.self, forKey: .requestId))
        guard try box.decode(Data.self, forKey: .payload) == payload else { throw APIFailure.invalidResponse }
    }
}
/// The server's stable answered snapshot. GET the list again before merging it over a newer terminal record.
public struct QuestionAnswerReceipt: Codable, Equatable, Sendable {
    public let scope: SessionInteractionScope
    public let question: SessionQuestionBatch
    public let requestId: String
    public var answerAcceptedByEntry: Bool { question.acceptedAnswer(requestID: requestId) }
    static func decode(_ data: Data, intent: QuestionAnswerIntent) throws -> Self {
        struct Wire: Decodable { let question: SessionQuestionBatch; let requestId: String }
        let wire: Wire = try MemoryValidation.decode(data)
        try wire.question.validate(scope: intent.scope)
        guard wire.requestId == intent.requestId, wire.question.matchesIdentity(intent.question) else { throw APIFailure.identityMismatch }
        try SharedValidation.require(wire.question.status == .answered && wire.question.answerRequestId == intent.requestId &&
            wire.question.answer == intent.answer && wire.question.answeredAt != nil)
        return .init(scope: intent.scope, question: wire.question, requestId: wire.requestId)
    }
}

enum InteractionValidation {
    static func identity(id: String, task: String, command: String, receipt: String, turn: Int, createdAt: String) throws {
        try SharedValidation.require([id, task, command].allSatisfy(SharedValidation.id) && SharedValidation.receipt(receipt) &&
            MemoryValidation.revision(turn) && MemoryValidation.time(createdAt))
    }
    static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(value)
    }
    static func page(ids: [String], limit: Int, next: String?, hasMore: Bool, priorBefore: String?, seen: Set<String>) throws -> Set<String> {
        try SharedValidation.require((1...100).contains(limit) && ids.count <= limit &&
            (hasMore ? !ids.isEmpty && next != nil : next == nil) && (next.map(SharedValidation.id) ?? true) &&
            (next == nil || next != priorBefore))
        var seen = seen
        for id in ids { try SharedValidation.require(SharedValidation.id(id) && seen.insert(id).inserted) }
        return seen
    }
}
