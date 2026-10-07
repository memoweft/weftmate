import Foundation

enum SharedValidation {
    static let maximumSequence = 9_007_199_254_740_991
    static func id(_ value: String) -> Bool { matches(value, "^[A-Za-z0-9_-]{1,128}$") }
    static func request(_ value: String) -> Bool {
        value != "." && value != ".." && matches(value, "^[A-Za-z0-9_.:-]{1,128}$")
    }
    static func profile(_ value: String) -> Bool { matches(value, "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$") }
    static func receipt(_ value: String) -> Bool { matches(value, "^[A-Za-z0-9._:-]{1,160}$") }
    static func hash(_ value: String) -> Bool { matches(value, "^[a-f0-9]{64}$") }
    static func matches(_ value: String, _ pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) != nil
    }
    static func require(_ condition: Bool) throws { if !condition { throw APIFailure.invalidResponse } }
}

public struct SharedSessionRecord: Codable, Equatable, Sendable, Identifiable {
    public var id: String { sessionId }
    public let sessionId: String
    public let title: String
    public let running: Bool
    public let sendAvailable: Bool
    public let conversationId: String?
    public let modelProfileId: String?
    public let unavailable: Bool?
    func validate() throws {
        try SharedValidation.require(SharedValidation.id(sessionId) && title.utf16.count <= 256 &&
            conversationId.map(SharedValidation.id) ?? true && modelProfileId.map(SharedValidation.profile) ?? true &&
            !(unavailable == true && (sendAvailable || running)))
    }
}

/// Catalogue visibility/configuration is not proof of a successful model generation.
public struct SharedHostModel: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let model: String
    public let configured: Bool
    public let routeFingerprint: String?
    public let source: String?
    public let sourceKind: String?
    public let accountModelId: String?
    public let revision: Int?
    func validate() throws {
        try SharedValidation.require(SharedValidation.profile(id) && name.utf16.count <= 256 && model.utf16.count <= 128 &&
            (!configured || !model.isEmpty) && (routeFingerprint.map(SharedValidation.hash) ?? true) &&
            (source == nil || source == "host") && (sourceKind.map { ["local", "cloud"].contains($0) } ?? true) &&
            (accountModelId.map(SharedValidation.id) ?? true) && (revision.map { $0 > 0 && $0 <= SharedValidation.maximumSequence } ?? true))
    }
}

/// A non-secret model identity; it does not grant access to model credentials.
public struct SharedOriginalModel: Codable, Equatable, Sendable {
    public let modelId: String
    public let displayName: String
    public let routeFingerprint: String?
    public let hostProfileId: String?
    func validate() throws {
        try SharedValidation.require(SharedValidation.matches(modelId, "^[A-Za-z0-9._:/-]{1,128}$") &&
            !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && displayName.count <= 100 &&
            routeFingerprint.map(SharedValidation.hash) ?? true && hostProfileId.map(SharedValidation.profile) ?? true)
    }
}

public enum SharedBindingStatus: String, Codable, Sendable { case unbound, creating, active, uncertain }
public struct SharedConversationBinding: Codable, Equatable, Sendable {
    public let conversationId: String
    public let sessionId: String
    public let modelProfileId: String
    public let revision: Int
    public let cutoverSyncSeq: Int
    public let contextHash: String
    public let historyMessageCount: Int
    public let truncated: Bool
    public let omittedImages: Int
    public let adoptCommandId: String
    func validate(conversationID: String, through: Int) throws {
        try SharedValidation.require(conversationId == conversationID && SharedValidation.id(sessionId) &&
            SharedValidation.profile(modelProfileId) && revision > 0 && revision <= SharedValidation.maximumSequence &&
            cutoverSyncSeq > 0 && cutoverSyncSeq <= through && SharedValidation.hash(contextHash) &&
            historyMessageCount >= 0 && historyMessageCount <= 20_000 && omittedImages >= 0 &&
            SharedValidation.id(adoptCommandId))
    }
}
public struct SharedAdoptedMessage: Codable, Equatable, Sendable {
    public let commandId: String
    public let requestId: String
    public let sourceSyncEventId: String
    public let receiptId: String?
    public let state: SharedCommandState
}
public struct SharedConversationProjection: Codable, Equatable, Sendable {
    public let source: String
    public let conversationId: String
    public let hostId: String
    public let syncThroughSeq: Int
    public let originalModel: SharedOriginalModel?
    public let status: SharedBindingStatus
    public let canAdopt: Bool
    public let reasonCode: String?
    public var requiresLocalTurnConfirmation: Bool { status == .unbound && reasonCode == "LOCAL_TURN_UNCONFIRMED" }
    public var canAdoptWithConfirmation: Bool { status == .unbound && (canAdopt || requiresLocalTurnConfirmation) }
    public let binding: SharedConversationBinding?
    public let adoptedMessages: [SharedAdoptedMessage]?
    func validate(conversationID: String, hostID: String) throws {
        guard source == "host", conversationId == conversationID, hostId == hostID else { throw APIFailure.identityMismatch }
        try SharedValidation.require(syncThroughSeq >= 0 && syncThroughSeq <= SharedValidation.maximumSequence &&
            reasonCode.map { SharedValidation.matches($0, "^[A-Z][A-Z0-9_]{0,63}$") } ?? true &&
            !(status != .unbound && canAdopt))
        try originalModel?.validate()
        if let binding { try binding.validate(conversationID: conversationID, through: syncThroughSeq) }
        try SharedValidation.require(status == .unbound ? binding == nil : binding != nil)
        let messages = adoptedMessages ?? []
        try SharedValidation.require(messages.count <= 20_000 && Set(messages.map(\.commandId)).count == messages.count &&
            Set(messages.map(\.requestId)).count == messages.count)
        for message in messages {
            try SharedValidation.require(SharedValidation.id(message.commandId) && SharedValidation.request(message.requestId) &&
                SharedValidation.id(message.sourceSyncEventId) && message.receiptId.map(SharedValidation.receipt) ?? true)
        }
    }
}

public enum SharedCommandKind: String, Codable, Sendable { case create = "session.create", message = "session.message", cancel = "session.cancel" }
public enum SharedCommandState: String, Codable, Sendable {
    case pending, dispatching, acceptedByDSH = "accepted_by_dsh", acceptedByHost = "accepted_by_host", observed, uncertain, rejected
    /// Acceptance is not a completed or stopped turn.
    public var isAccepted: Bool { self == .acceptedByDSH || self == .acceptedByHost || self == .observed }
}
public struct SharedCommandPayload: Codable, Equatable, Sendable {
    public let requestId: String
    public let kind: SharedCommandKind
    public let targetDeviceId: String
    public let sessionId: String?
    public let text: String?
    public let mode: String?
    public let modelProfileId: String?
    public let sourceSyncEventId: String?
    public let attachments: [OriginalAttachment]?
    public let originalAttachments: [OriginalAttachment]?
    public let attachmentMessageId: String?
    public init(requestId: String, kind: SharedCommandKind, targetDeviceId: String,
                sessionId: String? = nil, text: String? = nil, modelProfileId: String? = nil,
                sourceSyncEventId: String? = nil, attachments: [OriginalAttachment]? = nil,
                originalAttachments: [OriginalAttachment]? = nil, attachmentMessageId: String? = nil) throws {
        self.requestId = requestId; self.kind = kind; self.targetDeviceId = targetDeviceId
        self.sessionId = sessionId; self.text = text; self.modelProfileId = modelProfileId
        self.sourceSyncEventId = sourceSyncEventId; mode = kind == .message ? "queue" : nil
        self.attachments = attachments; self.originalAttachments = originalAttachments
        self.attachmentMessageId = attachmentMessageId
        try validate()
    }
    func validate() throws {
        if let text, text.utf16.count > 8_192 { throw ClientInputFailure.messageTooLong }
        try SharedValidation.require(SharedValidation.request(requestId) && SharedValidation.id(targetDeviceId))
        if kind != .message {
            try SharedValidation.require(attachments == nil && originalAttachments == nil && attachmentMessageId == nil)
        }
        try AttachmentLimits.validate(staged: attachments, originals: originalAttachments, messageID: attachmentMessageId)
        switch kind {
        case .create:
            try SharedValidation.require(modelProfileId.map(SharedValidation.profile) == true && sessionId == nil &&
                text == nil && mode == nil && sourceSyncEventId == nil)
        case .message:
            try SharedValidation.require(sessionId.map(SharedValidation.id) == true && modelProfileId == nil &&
                text.map { (!$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || attachments != nil || originalAttachments != nil) && $0.utf16.count <= 8_192 } == true &&
                mode == "queue" && sourceSyncEventId.map(SharedValidation.id) ?? true)
        case .cancel:
            try SharedValidation.require(sessionId.map(SharedValidation.id) == true && modelProfileId == nil &&
                text == nil && mode == nil && sourceSyncEventId == nil)
        }
    }
    public func encoded() throws -> Data {
        try validate()
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let bytes = try encoder.encode(self)
        guard bytes.count <= 12_288 else { throw ClientInputFailure.requestTooLarge }
        return bytes
    }
    static func decode(_ data: Data) throws -> Self {
        try SharedValidation.require(data.count <= 12_288)
        guard let keys = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              Set(keys.keys).isSubset(of: ["requestId", "kind", "targetDeviceId", "sessionId", "text", "mode", "modelProfileId", "sourceSyncEventId", "attachments", "originalAttachments", "attachmentMessageId"]) else {
            throw APIFailure.invalidResponse
        }
        let payload: Self
        do { payload = try JSONDecoder().decode(Self.self, from: data) } catch { throw APIFailure.invalidResponse }
        try payload.validate()
        // Foundation decoders must agree on identity and optional fields even for ambiguous duplicate JSON keys.
        try SharedValidation.require(keys["requestId"] as? String == payload.requestId && keys["kind"] as? String == payload.kind.rawValue &&
            keys["targetDeviceId"] as? String == payload.targetDeviceId && keys["sessionId"] as? String == payload.sessionId &&
            keys["text"] as? String == payload.text && keys["mode"] as? String == payload.mode &&
            keys["modelProfileId"] as? String == payload.modelProfileId && keys["sourceSyncEventId"] as? String == payload.sourceSyncEventId &&
            keys["attachmentMessageId"] as? String == payload.attachmentMessageId)
        for key in ["attachments", "originalAttachments"] {
            let raw = keys[key].map { try? JSONSerialization.data(withJSONObject: $0) } ?? nil
            let parsed = try raw.map { try JSONDecoder().decode([OriginalAttachment].self, from: $0) }
            try SharedValidation.require(parsed == (key == "attachments" ? payload.attachments : payload.originalAttachments))
        }
        return payload
    }
}

/// The exact persisted bytes are reused after a lost reply. No method creates a replacement request ID.
public struct SharedCommandIntent: Codable, Equatable, Sendable {
    public let server: ServerConfiguration
    public let ownerId: String
    public let hostId: String
    public let payload: Data
    let command: SharedCommandPayload
    public var requestId: String { command.requestId }
    public var kind: SharedCommandKind { command.kind }
    public var sessionId: String? { command.sessionId }
    public var sourceSyncEventId: String? { command.sourceSyncEventId }
    public var text: String? { command.text }
    public var parsedPayload: SharedCommandPayload { command }
    public init(session: AccountSession, command: SharedCommandPayload) throws {
        try self.init(server: session.server, ownerId: session.account.ownerId, hostId: session.hostId, payload: command.encoded())
    }
    public init(server: ServerConfiguration, ownerId: String, hostId: String, payload: Data) throws {
        try SharedValidation.require(SharedValidation.id(ownerId) && SharedValidation.id(hostId))
        let command = try SharedCommandPayload.decode(payload)
        guard command.targetDeviceId == hostId else { throw APIFailure.identityMismatch }
        self.server = server; self.ownerId = ownerId; self.hostId = hostId; self.payload = payload; self.command = command
    }
    enum CodingKeys: String, CodingKey { case server, ownerId, hostId, payload }
    public init(from decoder: any Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(server: box.decode(ServerConfiguration.self, forKey: .server),
            ownerId: box.decode(String.self, forKey: .ownerId), hostId: box.decode(String.self, forKey: .hostId),
            payload: box.decode(Data.self, forKey: .payload))
    }
}

public struct SharedCommandReceipt: Codable, Equatable, Sendable {
    public let commandId: String
    public let requestId: String
    public let kind: SharedCommandKind
    public let targetDeviceId: String
    public let state: SharedCommandState
    public let sessionId: String?
    public let conversationId: String?
    public let sourceSyncEventId: String?
    public let receiptId: String?
    public let errorCode: String?
    func validateStructure() throws {
        try SharedValidation.require(SharedValidation.id(commandId) && SharedValidation.id(targetDeviceId) &&
            SharedValidation.request(requestId) && sessionId.map(SharedValidation.id) == true &&
            conversationId.map(SharedValidation.id) ?? true && sourceSyncEventId.map(SharedValidation.id) ?? true &&
            receiptId.map(SharedValidation.receipt) ?? true &&
            errorCode.map { SharedValidation.matches($0, "^[A-Z][A-Z0-9_]{0,63}$") } ?? true)
    }
    func validate(intent: SharedCommandIntent) throws {
        try validateStructure()
        guard requestId == intent.requestId, kind == intent.kind, targetDeviceId == intent.hostId,
              (kind == .create ? sessionId != nil : sessionId == intent.sessionId),
              sourceSyncEventId == intent.sourceSyncEventId else { throw APIFailure.identityMismatch }
    }
}
public enum SharedCommandReconciliation: Equatable, Sendable { case found(SharedCommandReceipt), notFound }

public struct SharedHistoryImage: Codable, Equatable, Sendable {
    public let attachmentId: String
    public let contentType: String
    public let size: Int
    public let width: Int
    public let height: Int
    public let name: String?
}
public struct SharedHistoryData: Codable, Equatable, Sendable {
    public let text: String?
    public let images: [SharedHistoryImage]?
    public let originalAttachments: [OriginalAttachment]?
    public let attachmentMessageId: String?
    public let unpreviewedOriginalImageIds: [String]?
    public let receiptId: String?
    public let truncated: Bool?
    public let turn: Int?
    public let reason: String?
}
public struct SharedHistoryEvent: Codable, Equatable, Sendable, Identifiable {
    public var id: Int { seq }
    public let seq: Int
    public let type: String
    public let at: String?
    public let data: SharedHistoryData
    func validate() throws {
        try SharedValidation.require(seq >= 0 && seq <= SharedValidation.maximumSequence && !type.isEmpty && type.utf8.count <= 128 &&
            at.map { $0.utf8.count <= 64 } ?? true && data.text.map { $0.utf16.count <= 16_384 } ?? true &&
            data.receiptId.map(SharedValidation.receipt) ?? true && data.turn.map { $0 > 0 && $0 <= SharedValidation.maximumSequence } ?? true)
        let images = data.images ?? []
        try OriginalAttachmentValidation.validate(data.originalAttachments, messageID: data.attachmentMessageId,
            unpreviewedIDs: data.unpreviewedOriginalImageIds)
        try SharedValidation.require(images.count <= 4)
        for image in images {
            try SharedValidation.require(image.attachmentId.hasPrefix("sha256:") && SharedValidation.hash(String(image.attachmentId.dropFirst(7))) &&
                ["image/png", "image/jpeg", "image/webp", "image/gif"].contains(image.contentType) &&
                image.size > 0 && image.width > 0 && image.height > 0 && image.name.map { $0.utf16.count <= 120 } ?? true)
        }
        if type == "user.message" || type == "assistant.message" {
            try SharedValidation.require(!(data.text ?? "").isEmpty || !images.isEmpty ||
                (type == "user.message" && !(data.originalAttachments ?? []).isEmpty))
        }
        if type == "turn.ended" {
            try SharedValidation.require(["completed", "aborted", "error", "blocked", "unknown"].contains(data.reason ?? ""))
        }
    }
    public func chatMessage(sessionID: String) -> ChatMessage? {
        guard type == "user.message" || type == "assistant.message" else { return nil }
        return .init(id: "host|\(sessionID)|\(seq)", role: type == "user.message" ? .user : .assistant,
            text: data.text ?? "", occurredAt: at, sourceDeviceId: nil,
            attachmentCount: OriginalAttachmentValidation.count(originals: data.originalAttachments,
                previewCount: data.images?.count ?? 0, unpreviewedIDs: data.unpreviewedOriginalImageIds),
            truncated: data.truncated ?? false, pendingContext: false, images: data.images ?? [], originalAttachments: data.originalAttachments ?? [],
            attachmentMessageId: data.attachmentMessageId, unpreviewedOriginalImageIds: data.unpreviewedOriginalImageIds ?? [])
    }
}
public struct SharedHistoryPage: Equatable, Sendable {
    public let sessionId: String
    public let afterSeq: Int
    public let events: [SharedHistoryEvent]
    public let nextSeq: Int
    public let hasMore: Bool
    public var messages: [ChatMessage] { events.compactMap { $0.chatMessage(sessionID: sessionId) } }
    public static func decode(_ data: Data, sessionID: String, afterSeq: Int, limit: Int = 100) throws -> Self {
        try SharedValidation.require(SharedValidation.id(sessionID) && afterSeq >= -1 && afterSeq <= SharedValidation.maximumSequence && (1...100).contains(limit))
        guard data.count <= 1_048_576 else { throw APIFailure.responseTooLarge }
        struct Wire: Decodable { let events: [SharedHistoryEvent]; let nextSeq: Int; let hasMore: Bool }
        let wire: Wire
        do { wire = try JSONDecoder().decode(Wire.self, from: data) } catch { throw APIFailure.invalidResponse }
        try SharedValidation.require(wire.events.count <= limit && wire.nextSeq >= afterSeq &&
            wire.nextSeq <= SharedValidation.maximumSequence && (!wire.hasMore || wire.nextSeq > afterSeq))
        var prior = afterSeq
        for event in wire.events {
            try event.validate()
            try SharedValidation.require(event.seq > prior && event.seq <= wire.nextSeq); prior = event.seq
        }
        return .init(sessionId: sessionID, afterSeq: afterSeq, events: wire.events, nextSeq: wire.nextSeq, hasMore: wire.hasMore)
    }
}

public enum SharedTurnProgress: Equatable, Sendable {
    case pending, accepted, running, completed, aborted, failed, blocked, unknown
}
/// Receipt-to-turn correlation is conservative. An uncorrelated end never completes an accepted request.
public struct SharedTurnTracker: Sendable {
    public let sessionId: String
    public private(set) var nextSeq = -1
    public private(set) var messages: [ChatMessage] = []
    private var openTurn: Int?
    private var receiptTurns: [String: Int] = [:]
    private var ambiguousReceipts = Set<String>()
    private var endings: [Int: String] = [:]
    private var runningTurns = Set<Int>()
    private var seenTurns = Set<Int>()
    private var ambiguousTurns = Set<Int>()
    public init(sessionID: String, afterSeq: Int = -1) throws {
        try SharedValidation.require(SharedValidation.id(sessionID) && afterSeq >= -1); sessionId = sessionID; nextSeq = afterSeq
    }
    public mutating func apply(_ page: SharedHistoryPage) throws {
        guard page.sessionId == sessionId, page.afterSeq == nextSeq else { throw APIFailure.identityMismatch }

        for event in page.events {
            if let message = event.chatMessage(sessionID: sessionId) { messages.append(message) }
            if event.type == "turn.started" {
                if let previous = openTurn { ambiguousTurns.insert(previous); runningTurns.remove(previous) }
                openTurn = event.data.turn
                if let turn = openTurn {
                    if !seenTurns.insert(turn).inserted { ambiguousTurns.insert(turn) }
                    runningTurns.insert(turn)
                }
            } else if event.type == "user.message", let receipt = event.data.receiptId {
                if let turn = openTurn, receiptTurns[receipt] == nil, !ambiguousReceipts.contains(receipt) {
                    receiptTurns[receipt] = turn
                } else { receiptTurns[receipt] = nil; ambiguousReceipts.insert(receipt) }
            } else if event.type == "turn.ended" {
                if let turn = event.data.turn, turn == openTurn {
                    endings[turn] = event.data.reason; runningTurns.remove(turn)
                } else if let previous = openTurn {
                    ambiguousTurns.insert(previous); runningTurns.remove(previous)
                }
                openTurn = nil
            }
        }
        nextSeq = page.nextSeq
    }
    public func progress(for receipt: SharedCommandReceipt) -> SharedTurnProgress {
        guard receipt.sessionId == sessionId, receipt.kind == .message else { return .unknown }
        if receipt.state == .rejected { return .failed }
        if receipt.state == .pending || receipt.state == .dispatching { return .pending }
        guard receipt.state.isAccepted else { return .unknown }
        guard let id = receipt.receiptId, let turn = receiptTurns[id], !ambiguousReceipts.contains(id) else { return .accepted }
        guard !ambiguousTurns.contains(turn) else { return .unknown }
        if let reason = endings[turn] {
            switch reason {
            case "completed": return .completed
            case "aborted": return .aborted
            case "error": return .failed
            case "blocked": return .blocked
            default: return .unknown
            }
        }
        return runningTurns.contains(turn) ? .running : .unknown
    }
}
