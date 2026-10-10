import Foundation

/// Versions are wire numbers, never truthiness or strings. Unknown versions retain the legacy session UI.
public struct ChatCapabilities: Codable, Equatable, Sendable {
    public let values: [String: JSONValue]
    public init(_ values: [String: JSONValue] = [:]) { self.values = values }
    public func supports(_ name: String) -> Bool { values[name] == .number(1) }
    public var timeline: Bool {
        supports("chats") && supports("chatTimeline") && ["chatSearch", "chatSend", "sideChats", "chatResources", "chatLifecycle"].allSatisfy { values[$0] == nil || supports($0) }
    }
}
public struct LogicalChat: Codable, Identifiable, Equatable, Sendable {
    public let chatId: String
    public let kind: String
    public let title: String
    public let activeSessionId: String?
    public let conversationId: String?
    public let modelProfileId: String?
    public let timeZone: String
    public let revision: Int
    public let contentRevision: Int
    public let running: Bool
    public let sendAvailable: Bool
    public let taskAvailable: Bool?
    public let pinned: Bool
    public let archived: Bool
    public let unread: Bool
    public let groupId: String?
    public let projectId: String?
    public let projectName: String?
    public let processing: ConversationProcessing?
    public let contextUsage: ConversationContextUsage?
    public let contextTransfer: JSONValue?
    public let originRefs: [JSONValue]?
    public let contextOrganizing: Bool?
    public let relayError: String?
    public let temporary: Bool?
    public let memoryMode: String?
    public let recallEnabled: Bool?
    public let autoDeleteDays: Int?
    public let expiresAt: String?
    public let hasTemporaryContent: Bool?
    public var id: String { chatId }
    public var isMain: Bool { kind == "main" }
    public var summary: ConversationSummary { summary(hostID: nil, updatedAt: nil) }
    public func summary(hostID: String?, updatedAt: String?) -> ConversationSummary {
        .init(id: chatId, title: title, conversationId: conversationId, sessionId: activeSessionId,
              running: running, sendAvailable: sendAvailable, originalModelLabel: modelProfileId, archived: archived,
              pinned: pinned, unread: unread, groupId: groupId, contextUsage: contextUsage, processing: processing,
              projectId: projectId, projectName: projectName, taskAvailable: taskAvailable, hostId: hostID, updatedAt: updatedAt,
              chatId: chatId, chatKind: kind, chatContentRevision: contentRevision, temporaryState: temporaryState)
    }
    public var temporaryState: TemporaryChatState {
        .init(temporary: temporary ?? false, memoryMode: memoryMode ?? "on", recallEnabled: recallEnabled ?? true,
              autoDeleteDays: autoDeleteDays, expiresAt: expiresAt, hasTemporaryContent: hasTemporaryContent ?? false)
    }
}
public struct TemporaryChatState: Codable, Equatable, Sendable {
    public var temporary: Bool
    public var memoryMode: String
    public var recallEnabled: Bool
    public var autoDeleteDays: Int?
    public var expiresAt: String?
    public var hasTemporaryContent: Bool
    public init(temporary: Bool = false, memoryMode: String = "on", recallEnabled: Bool = true, autoDeleteDays: Int? = nil, expiresAt: String? = nil, hasTemporaryContent: Bool = false) {
        self.temporary = temporary; self.memoryMode = memoryMode; self.recallEnabled = recallEnabled
        self.autoDeleteDays = autoDeleteDays; self.expiresAt = expiresAt; self.hasTemporaryContent = hasTemporaryContent
    }
    public var cacheAllowed: Bool { !temporary && memoryMode != "off" && !hasTemporaryContent }
    public func notice(now: Date = Date()) -> String {
        guard temporary || memoryMode == "off" else { return "" }
        let days = ChatDay.date(expiresAt).map { max(0, Int(ceil($0.timeIntervalSince(now) / 86400))) } ?? autoDeleteDays
        return "临时对话 · 不会形成记忆，" + (days.map { "\($0) 天后自动删除" } ?? "不自动删除")
    }
}
public struct ChatEvent: Codable, Equatable, Identifiable, Sendable {
    public let eventId: String
    public let chatId: String
    public let orderKey: String
    public let revision: Int
    public let type: String
    public let at: String?
    public let sourceRef: JSONValue
    public let data: JSONValue
    public var id: String { eventId }
    public var sessionID: String? { sourceRef["sessionId"]?.string ?? sourceRef["native"]?["sessionId"]?.string }
    public var text: String { data["text"]?.string ?? data["summary"]?.string ?? "" }
}
public struct ChatPage: Codable, Sendable {
    public let items: [ChatEvent]
    public let olderCursor: String?
    public let newerCursor: String?
    public let hasOlder: Bool
    public let hasNewer: Bool
    public let syncCursor: String
    public let contentRevision: Int
    public let indexState: String
    public let timeZone: String
    public let deletedAnchor: Bool?
}
public struct ChatChanges: Decodable, Sendable {
    public struct Removal: Decodable, Sendable { public let eventId: String; public let revision: Int }
    public let upserts: [ChatEvent]
    public let removals: [Removal]
    public let nextCursor: String
    public let hasMore: Bool
    public let contentRevision: Int
    public let indexState: String
    public let timeZone: String
}
public struct ChatSearchPage: Decodable, Sendable {
    public struct Hit: Decodable, Identifiable, Equatable, Sendable {
        public struct Highlight: Decodable, Equatable, Sendable { public let start: Int; public let end: Int }
        public let eventId: String; public let snippet: String; public let highlights: [Highlight]
        public var id: String { eventId }
    }
    public let hits: [Hit]; public let nextCursor: String?; public let hasMore: Bool
    public let contentRevision: Int; public let indexState: String; public let timeZone: String
}
public struct ChatDates: Decodable, Sendable {
    public struct Day: Decodable, Sendable { public let date: String; public let count: Int }
    public let days: [Day]; public let contentRevision: Int; public let indexState: String; public let timeZone: String
}
public struct ChatLocate: Decodable, Sendable { public let date: String; public let eventId: String?; public let contentRevision: Int; public let indexState: String; public let timeZone: String }
public struct ChatList: Decodable, Sendable { public let items: [LogicalChat]; public let nextCursor: String?; public let hasMore: Bool }
public struct ChatResourcePage: Decodable, Sendable { public let outputs: [JSONValue]; public let sources: [JSONValue]; public let nextCursor: String?; public let hasMore: Bool; public let contentRevision: Int }

public struct ChatAnchor: Equatable, Sendable {
    public var eventID: String
    public var pixelOffset: Double
    public init(eventID: String, pixelOffset: Double) { self.eventID = eventID; self.pixelOffset = pixelOffset }
}
/// Bounded body window; the host retains all original history. Paging and sync watermarks stay separate.
public struct ChatWindow: Sendable {
    public private(set) var events: [ChatEvent] = []
    public private(set) var syncCursor: String?
    public private(set) var olderCursor: String?
    public private(set) var newerCursor: String?
    public private(set) var hasOlder = false
    public private(set) var hasNewer = false
    public private(set) var contentRevision: Int?
    public private(set) var generation = UUID()
    public var anchor: ChatAnchor?
    public var expandedDays = Set<String>()
    public init() {}
    public mutating func reset() { self = .init() }
    public func requireRevision(_ value: Int) throws {
        if let contentRevision, contentRevision != value { throw APIFailure.server(status: 409, code: "CURSOR_RESET_REQUIRED") }
    }
    private mutating func merge(_ rows: [ChatEvent], older: Bool) {
        var map = Dictionary(uniqueKeysWithValues: events.map { ($0.id, $0) })
        for row in rows where row.revision >= (map[row.id]?.revision ?? -1) { map[row.id] = row }
        var ordered = map.values.sorted { $0.orderKey == $1.orderKey ? $0.id < $1.id : $0.orderKey < $1.orderKey }
        if ordered.count > 1000 {
            let start = anchor.flatMap { a in ordered.firstIndex { $0.id == a.eventID } }.map { max(0, min($0 - 100, ordered.count - 1000)) } ?? (older ? 0 : ordered.count - 1000)
            if start > 0 { hasOlder = true }; if start + 1000 < ordered.count { hasNewer = true }
            ordered = Array(ordered[start..<start + 1000])
        }
        events = ordered
    }
    public mutating func apply(_ page: ChatPage, older: Bool = false, replace: Bool = false) throws {
        try requireRevision(page.contentRevision)
        if replace { events = [] }
        contentRevision = page.contentRevision
        if syncCursor == nil { syncCursor = page.syncCursor }
        if older || replace || olderCursor == nil { olderCursor = page.olderCursor; hasOlder = page.hasOlder }
        if !older { newerCursor = page.newerCursor; hasNewer = page.hasNewer }
        merge(page.items, older: older)
    }
    public mutating func apply(_ page: ChatChanges) throws {
        try requireRevision(page.contentRevision); contentRevision = page.contentRevision
        let removed = Set(page.removals.map(\.eventId)); events.removeAll { removed.contains($0.id) }
        if let anchor, removed.contains(anchor.eventID) { self.anchor = nil }
        merge(page.upserts, older: false); syncCursor = page.nextCursor
    }
}
public struct ChatDaySection: Sendable, Identifiable {
    public let date: String
    public var events: [ChatEvent]
    public var id: String { date + "|" + (events.first?.id ?? "") }
}
public enum ChatDay {
    /// Date labels do not reorder late events. A day can reappear in a later native segment.
    public static func sections(_ events: [ChatEvent], timeZone: String) -> [ChatDaySection] {
        var result: [ChatDaySection] = []
        for event in events {
            let day = key(event, timeZone: timeZone)
            if result.last?.date == day { result[result.count - 1].events.append(event) }
            else { result.append(.init(date: day, events: [event])) }
        }
        return result
    }
    public static func date(_ value: String?) -> Date? {
        guard let value else { return nil }; let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = f.date(from: value) { return date }; f.formatOptions = [.withInternetDateTime]; return f.date(from: value)
    }
    public static func key(_ date: Date, timeZone: String) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = TimeZone(identifier: timeZone); f.dateFormat = "yyyy-MM-dd"; return f.string(from: date)
    }
    public static func key(_ event: ChatEvent, timeZone: String) -> String { date(event.at).map { key($0, timeZone: timeZone) } ?? "日期未记录" }
}

public struct LogicalCommand: Codable, Sendable, Equatable {
    public let commandId: String; public let requestId: String; public let kind: String; public let targetDeviceId: String
    public let state: String; public let chatId: String?; public let sessionId: String?; public let receiptId: String?
    public let contextTransfer: JSONValue?
    public func validate(request: JSONValue, hostID: String) throws {
        guard requestId == request["requestId"]?.string, targetDeviceId == hostID,
              kind == (request["kind"]?.string ?? "session.create"),
              request["chatId"]?.string.map({ $0 == chatId }) ?? true else { throw APIFailure.identityMismatch }
        if state == "accepted_by_dsh", sessionId == nil { throw APIFailure.invalidResponse }
    }
}
