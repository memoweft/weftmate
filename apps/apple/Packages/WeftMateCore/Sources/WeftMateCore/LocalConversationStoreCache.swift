import Foundation

/// A previously verified list item. Its UI projection never asserts live activity or send permission.
public struct LocalCachedConversationSummary: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let conversationId: String?
    public let sessionId: String?
    public let hostId: String
    public let originalModelLabel: String?
    public let originalModel: SharedOriginalModel?
    public var conversationKey: String {
        if let conversationId { return "conversation:" + conversationId }
        return "session:" + (sessionId ?? "")
    }
    public var conversation: ConversationSummary {
        .init(id: id, title: title, conversationId: conversationId, sessionId: sessionId,
              running: false, sendAvailable: false, originalModelLabel: originalModelLabel)
    }
    public init(conversation: ConversationSummary, hostId: String, originalModel: SharedOriginalModel? = nil) throws {
        id = conversation.id; title = conversation.title; conversationId = conversation.conversationId
        sessionId = conversation.sessionId; self.hostId = hostId
        originalModelLabel = conversation.originalModelLabel; self.originalModel = originalModel
        try validate()
    }
    func validate() throws {
        guard localCacheIdentifier(id), title.utf8.count <= 2_048, SharedValidation.id(hostId),
              conversationId.map(SharedValidation.id) ?? true, sessionId.map(SharedValidation.id) ?? true,
              conversationId != nil || sessionId != nil,
              originalModelLabel.map({ $0.utf8.count <= 512 }) ?? true else {
            throw LocalConversationStoreFailure.invalidCache
        }
        do { try originalModel?.validate() } catch { throw LocalConversationStoreFailure.invalidCache }
    }
}

public struct LocalCachedConversationList: Codable, Equatable, Sendable {
    public let account: LocalAccountScope
    public let hostId: String
    public let conversations: [LocalCachedConversationSummary]
    private let cachedAtMilliseconds: Int64
    public var cachedAt: Date { Date(timeIntervalSince1970: Double(cachedAtMilliseconds) / 1_000) }
    public var isCached: Bool { true }
    init(account: LocalAccountScope, hostId: String, conversations: [LocalCachedConversationSummary]) {
        self.account = account; self.hostId = hostId; self.conversations = conversations
        cachedAtMilliseconds = localCacheNow()
    }
    var key: String { account.cacheKey }
    func validate(_ limits: LocalConversationStoreLimits) throws {
        guard SharedValidation.id(hostId), cachedAtMilliseconds >= 0,
              conversations.count <= limits.conversationCount else {
            throw LocalConversationStoreFailure.invalidCache
        }
        var keys = Set<String>(), ids = Set<String>()
        for conversation in conversations {
            try conversation.validate()
            guard conversation.hostId == hostId, keys.insert(conversation.conversationKey).inserted,
                  ids.insert(conversation.id).inserted else { throw LocalConversationStoreFailure.invalidCache }
        }
    }
}

/// Text and source metadata only. Attachment bodies and private model configuration are not cached here.
public struct LocalCachedMessage: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let role: MessageRole
    public let text: String
    public let occurredAt: String?
    public let sourceDeviceId: String?
    public let attachmentCount: Int
    public let truncated: Bool
    public let pendingContext: Bool
    /// Optional additions keep existing schema-2 cache records readable.
    public let originalAttachments: [OriginalAttachment]?
    public let attachmentMessageId: String?
    public let unpreviewedOriginalImageIds: [String]?
    /// Present only for the SDK's exact host|session|seq projection; unknown sources stay unknown.
    public let hostSequence: Int?
    public let hostSessionId: String?
    public var message: ChatMessage {
        .init(id: id, role: role, text: text, occurredAt: occurredAt, sourceDeviceId: sourceDeviceId,
              attachmentCount: attachmentCount, truncated: truncated, pendingContext: pendingContext,
              originalAttachments: originalAttachments ?? [], attachmentMessageId: attachmentMessageId,
              unpreviewedOriginalImageIds: unpreviewedOriginalImageIds ?? [])
    }
    init(_ message: ChatMessage) {
        id = message.id; role = message.role; text = message.text; occurredAt = message.occurredAt
        sourceDeviceId = message.sourceDeviceId; attachmentCount = message.attachmentCount
        truncated = message.truncated; pendingContext = message.pendingContext
        originalAttachments = message.originalAttachments.isEmpty ? nil : message.originalAttachments
        attachmentMessageId = message.attachmentMessageId
        unpreviewedOriginalImageIds = message.unpreviewedOriginalImageIds.isEmpty ? nil : message.unpreviewedOriginalImageIds
        let parts = message.id.split(separator: "|", omittingEmptySubsequences: false)
        if parts.count == 3, parts[0] == "host", SharedValidation.id(String(parts[1])),
           let seq = Int(parts[2]), (0...SharedValidation.maximumSequence).contains(seq) {
            hostSessionId = String(parts[1]); hostSequence = seq
        } else { hostSessionId = nil; hostSequence = nil }
    }
    func validate(sessionId: String?) throws {
        do {
            try OriginalAttachmentValidation.validate(originalAttachments, messageID: attachmentMessageId,
                unpreviewedIDs: unpreviewedOriginalImageIds)
        } catch { throw LocalConversationStoreFailure.invalidCache }
        guard localCacheIdentifier(id), occurredAt.map({ $0.utf8.count <= 128 }) ?? true,
              sourceDeviceId.map(SharedValidation.id) ?? true, (0...1_000).contains(attachmentCount),
              (hostSequence == nil) == (hostSessionId == nil) else { throw LocalConversationStoreFailure.invalidCache }
        let inferred = LocalCachedMessage(message)
        guard inferred.hostSequence == hostSequence, inferred.hostSessionId == hostSessionId,
              hostSessionId.map({ $0 == sessionId }) ?? true else { throw LocalConversationStoreFailure.invalidCache }
    }
}

public struct LocalCachedHistory: Codable, Equatable, Sendable {
    public let account: LocalAccountScope
    public let conversationKey: String
    public let hostId: String
    public let sessionId: String?
    public let cachedMessages: [LocalCachedMessage]
    public let observedThroughSeq: Int?
    private let cachedAtMilliseconds: Int64
    public var cachedAt: Date { Date(timeIntervalSince1970: Double(cachedAtMilliseconds) / 1_000) }
    public var messages: [ChatMessage] { cachedMessages.map(\.message) }
    public var isCached: Bool { true }
    /// A transcript projection cannot reconstruct receipt/turn associations; always rebuild online from -1.
    public var rebuildAfterSeq: Int { -1 }
    init(account: LocalAccountScope, conversationKey: String, hostId: String, sessionId: String?,
         messages: [ChatMessage], observedThroughSeq: Int?) {
        self.account = account; self.conversationKey = conversationKey; self.hostId = hostId
        self.sessionId = sessionId; cachedMessages = messages.map(LocalCachedMessage.init)
        self.observedThroughSeq = observedThroughSeq; cachedAtMilliseconds = localCacheNow()
    }
    var key: String { account.cacheKey + "|" + conversationKey + "|" + hostId + "|" + (sessionId ?? "") }
    func validate(_ limits: LocalConversationStoreLimits) throws {
        guard localCacheConversationKey(conversationKey), SharedValidation.id(hostId),
              sessionId.map(SharedValidation.id) ?? true,
              observedThroughSeq.map({ (0...SharedValidation.maximumSequence).contains($0) }) ?? true,
              cachedAtMilliseconds >= 0 else { throw LocalConversationStoreFailure.invalidCache }
        if conversationKey.hasPrefix("session:") {
            guard sessionId == String(conversationKey.dropFirst("session:".count)) else {
                throw LocalConversationStoreFailure.invalidCache
            }
        }
        guard cachedMessages.count <= limits.historyMessageCount else {
            throw LocalConversationStoreFailure.limitExceeded(.historyMessages)
        }
        var ids = Set<String>(), priorHostSeq = -1
        for message in cachedMessages {
            try message.validate(sessionId: sessionId)
            guard ids.insert(message.id).inserted else { throw LocalConversationStoreFailure.invalidCache }
            if let seq = message.hostSequence {
                guard seq > priorHostSeq, observedThroughSeq.map({ seq <= $0 }) ?? true else {
                    throw LocalConversationStoreFailure.invalidCache
                }
                priorHostSeq = seq
            }
        }
        guard try localCacheBytes(self) <= limits.historyBytes else {
            throw LocalConversationStoreFailure.limitExceeded(.historyBytes)
        }
    }
}

func localCacheBytes<T: Encodable>(_ value: T) throws -> Int {
    let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(value).count
}
func localCacheNow() -> Int64 { Int64(Date().timeIntervalSince1970 * 1_000) }
func localCacheIdentifier(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 256 && value == value.trimmingCharacters(in: .whitespacesAndNewlines)
        && value.unicodeScalars.allSatisfy { !CharacterSet.controlCharacters.contains($0) }
}
func localCacheConversationKey(_ key: String) -> Bool {
    guard localCacheIdentifier(key) else { return false }
    if key.hasPrefix("conversation:") { return SharedValidation.id(String(key.dropFirst("conversation:".count))) }
    if key.hasPrefix("session:") { return SharedValidation.id(String(key.dropFirst("session:".count))) }
    return false
}
