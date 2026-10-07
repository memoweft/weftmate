import Foundation

public enum MemoryKind: String, Codable, Sendable { case cognition, entity, relationship, event }
public struct MemoryReadScope: Equatable, Sendable {
    public let server: ServerConfiguration
    public let ownerId: String
    public let hostId: String
    init(_ session: AccountSession) { server = session.server; ownerId = session.account.ownerId; hostId = session.hostId }
}
public struct MemoryCapabilities: Decodable, Equatable, Sendable {
    public let list: Bool
    public let source: Bool
    public let inject: Bool
    public let correct: Bool
    public let mute: Bool
    public let deleteEvidence: Bool
    public let deleteWorldItem: Bool
}
public enum MemoryServiceState: String, Decodable, Sendable { case ready, degraded, disabled, unavailable }
public struct MemoryServiceStatus: Decodable, Equatable, Sendable {
    public let state: MemoryServiceState
    public let worldRevision: Int?
    public let capabilities: MemoryCapabilities
    public let pendingBoundaryCount: Int?
    public let blockedBoundaryCount: Int?
    public let discardedBoundaryCount: Int?
    public let lastFailureCode: String?
    public let reasonCode: String?
    func validate() throws {
        try MemoryValidation.require([worldRevision, pendingBoundaryCount, blockedBoundaryCount, discardedBoundaryCount]
            .allSatisfy { $0.map(MemoryValidation.revision) ?? true })
        try MemoryValidation.require([lastFailureCode, reasonCode].allSatisfy { $0.map(MemoryValidation.code) ?? true })
    }
}
public struct MemoryStatusSnapshot: Equatable, Sendable {
    public let scope: MemoryReadScope
    public let status: MemoryServiceStatus
}
public struct MemoryLifecycle: Decodable, Equatable, Sendable {
    public let invalidAt: String?
    public let archivedAt: String?
    public let mutedAt: String?
}
public enum MemoryCurrentState: String, Decodable, Sendable { case current, notCurrent = "not_current" }
public struct MemoryItem: Decodable, Equatable, Sendable, Identifiable {
    public let id: String
    public let kind: MemoryKind
    public let text: String
    public let truncated: Bool
    public let currentState: MemoryCurrentState
    public let createdAt: String
    public let updatedAt: String
    public let lifecycle: MemoryLifecycle
    public let sourceCount: Int
    func validate(kind: MemoryKind, itemID: String? = nil) throws {
        try MemoryValidation.require(MemoryValidation.itemID(id) && self.kind == kind && (itemID == nil || id == itemID) &&
            text.utf16.count <= 4_000 && MemoryValidation.time(createdAt) && MemoryValidation.time(updatedAt) &&
            [lifecycle.invalidAt, lifecycle.archivedAt, lifecycle.mutedAt].allSatisfy { $0.map(MemoryValidation.time) ?? true } &&
            MemoryValidation.revision(sourceCount))
    }
}
public struct MemoryPageCursor: Equatable, Sendable {
    public let scope: MemoryReadScope
    public let kind: MemoryKind
    public let query: String
    public let worldRevision: Int
    fileprivate let token: String
    fileprivate let offset: Int
    fileprivate let seenIDs: Set<String>
    func validate(scope: MemoryReadScope, kind: MemoryKind, query: String) throws {
        guard self.scope == scope else { throw APIFailure.accountChanged }
        try MemoryValidation.require(self.kind == kind && self.query == query && MemoryValidation.revision(worldRevision))
    }
}
public struct MemoryItemsPage: Equatable, Sendable {
    public let scope: MemoryReadScope
    public let items: [MemoryItem]
    public let worldRevision: Int
    public let nextCursor: MemoryPageCursor?
    public let hasMore: Bool
    public let searchScope: String
    static func decode(_ data: Data, scope: MemoryReadScope, kind: MemoryKind, query: String,
                       limit: Int, previous: MemoryPageCursor?) throws -> Self {
        struct Wire: Decodable { let items: [MemoryItem]; let worldRevision: Int; let nextCursor: String?; let hasMore: Bool; let searchScope: String }
        let wire: Wire = try MemoryValidation.decode(data)
        try MemoryValidation.require(MemoryValidation.revision(wire.worldRevision) && wire.searchScope == "account_snapshot" &&
            wire.items.count <= limit && Set(wire.items.map(\.id)).count == wire.items.count &&
            (wire.hasMore ? wire.nextCursor != nil && !wire.items.isEmpty : wire.nextCursor == nil))
        if let previous, previous.worldRevision != wire.worldRevision { throw APIFailure.server(status: 409, code: "MEMORY_REVISION_CHANGED") }
        var seen = previous?.seenIDs ?? []
        for item in wire.items {
            try item.validate(kind: kind)
            try MemoryValidation.require(seen.insert(item.id).inserted)
        }
        let offset = (previous?.offset ?? 0) + wire.items.count
        try MemoryValidation.require(offset <= 5_000)
        var next: MemoryPageCursor?
        if let token = wire.nextCursor {
            struct Cursor: Decodable { let ownerId: String; let kind: MemoryKind; let query: String; let worldRevision: Int; let offset: Int }
            try MemoryValidation.require(!token.isEmpty && token.utf8.count <= 512 && SharedValidation.matches(token, "^[A-Za-z0-9_-]+$"))
            let padded = token.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + String(repeating: "=", count: (4 - token.count % 4) % 4)
            guard let bytes = Data(base64Encoded: padded) else { throw APIFailure.invalidResponse }
            let value: Cursor = try MemoryValidation.decode(bytes)
            guard value.ownerId == scope.ownerId else { throw APIFailure.identityMismatch }
            try MemoryValidation.require(value.kind == kind && value.query == query && value.worldRevision == wire.worldRevision && value.offset == offset)
            next = MemoryPageCursor(scope: scope, kind: kind, query: query, worldRevision: wire.worldRevision,
                token: token, offset: offset, seenIDs: seen)
        }
        return .init(scope: scope, items: wire.items, worldRevision: wire.worldRevision, nextCursor: next,
            hasMore: wire.hasMore, searchScope: wire.searchScope)
    }
}
public struct MemoryActionAvailability: Decodable, Equatable, Sendable {
    public let available: Bool
    public let reasonCode: String?
    func validate() throws { try MemoryValidation.require(reasonCode.map(MemoryValidation.code) ?? true) }
}
public struct MemoryAvailableActions: Decodable, Equatable, Sendable {
    public let correct: MemoryActionAvailability
    public let mute: MemoryActionAvailability
    public let delete: MemoryActionAvailability
}
public struct MemoryItemDetail: Equatable, Sendable {
    public let scope: MemoryReadScope
    public let item: MemoryItem
    public let worldRevision: Int
    public let availableActions: MemoryAvailableActions
    static func decode(_ data: Data, scope: MemoryReadScope, kind: MemoryKind, itemID: String, expectedRevision: Int?) throws -> Self {
        struct Wire: Decodable { let item: MemoryItem; let worldRevision: Int; let availableActions: MemoryAvailableActions }
        let wire: Wire = try MemoryValidation.decode(data, maximum: 262_144)
        try wire.item.validate(kind: kind, itemID: itemID)
        try MemoryValidation.checkRevision(wire.worldRevision, expected: expectedRevision)
        try wire.availableActions.correct.validate(); try wire.availableActions.mute.validate(); try wire.availableActions.delete.validate()
        try MemoryValidation.require(!(kind == .entity && wire.availableActions.correct.available) &&
            !(wire.item.currentState != .current && (wire.availableActions.correct.available || wire.availableActions.mute.available)))
        return .init(scope: scope, item: wire.item, worldRevision: wire.worldRevision, availableActions: wire.availableActions)
    }
}
public struct MemorySourcePermissions: Decodable, Equatable, Sendable {
    public let allowLocalRead: Bool
    public let allowCloudRead: Bool
    public let allowInference: Bool
}
public struct MemorySource: Decodable, Equatable, Sendable {
    public let evidenceId: String
    public let relation: String
    public let currentnessState: String
    public let permissions: MemorySourcePermissions
    public let contentAvailable: Bool
    private let summaryValue: String?
    private let rawContentValue: String?
    public let rawContentTruncated: Bool
    public let recordedAt: String
    /// Source permission is not a model-destination grant. Local UI only sees locally readable content.
    public var summary: String? { permissions.allowLocalRead && contentAvailable ? summaryValue : nil }
    public var rawContent: String? { permissions.allowLocalRead && contentAvailable ? rawContentValue : nil }
    public var localContentWithheld: Bool { !permissions.allowLocalRead && contentAvailable }
    enum CodingKeys: String, CodingKey {
        case evidenceId, relation, currentnessState, permissions, contentAvailable, rawContentTruncated, recordedAt
        case summaryValue = "summary", rawContentValue = "rawContent"
    }
    func validate() throws {
        try MemoryValidation.require(MemoryValidation.itemID(evidenceId) && relation.utf16.count <= 64 && currentnessState.utf16.count <= 64 &&
            (summaryValue.map { $0.utf16.count <= 2_000 } ?? true) && (rawContentValue.map { $0.utf16.count <= 8_192 } ?? true) && MemoryValidation.time(recordedAt))
    }
}
public struct MemorySourcesSnapshot: Equatable, Sendable {
    public let scope: MemoryReadScope
    public let kind: MemoryKind
    public let itemId: String
    public let sources: [MemorySource]
    public let worldRevision: Int
    static func decode(_ data: Data, scope: MemoryReadScope, kind: MemoryKind, itemID: String, expectedRevision: Int?) throws -> Self {
        struct Wire: Decodable { let sources: [MemorySource]; let worldRevision: Int }
        let wire: Wire = try MemoryValidation.decode(data, maximum: 262_144)
        try MemoryValidation.checkRevision(wire.worldRevision, expected: expectedRevision)
        try MemoryValidation.require(wire.sources.count <= 200)
        for source in wire.sources { try source.validate() }
        return .init(scope: scope, kind: kind, itemId: itemID, sources: wire.sources, worldRevision: wire.worldRevision)
    }
}

enum MemoryValidation {
    static func revision(_ value: Int) -> Bool { value >= 0 && value <= SharedValidation.maximumSequence }
    static func time(_ value: String) -> Bool { value.utf16.count <= 64 }
    static func code(_ value: String) -> Bool { SharedValidation.matches(value, "^[A-Z][A-Z0-9_]{0,63}$") }
    static func itemID(_ value: String) -> Bool { value != "." && value != ".." && SharedValidation.matches(value, "^[A-Za-z0-9._:-]{1,512}$") }
    static func require(_ condition: Bool) throws { if !condition { throw APIFailure.invalidResponse } }
    static func decode<T: Decodable>(_ data: Data, maximum: Int = 1_048_576) throws -> T {
        guard data.count <= maximum else { throw APIFailure.responseTooLarge }
        do { return try JSONDecoder().decode(T.self, from: data) } catch { throw APIFailure.invalidResponse }
    }
    static func checkRevision(_ revision: Int, expected: Int?) throws {
        try require(Self.revision(revision) && (expected.map(Self.revision) ?? true))
        if let expected, expected != revision { throw APIFailure.server(status: 409, code: "MEMORY_REVISION_CHANGED") }
    }
    static func normalizedQuery(_ value: String) throws -> String {
        try require(value.utf16.count <= 120)
        // Match the publisher's ECMAScript NFKC / trim / default Unicode lowercase semantics.
        let trimScalars = [9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279]
        let trimSet = CharacterSet(charactersIn: String(String.UnicodeScalarView(trimScalars.compactMap(UnicodeScalar.init))))
        return value.precomposedStringWithCompatibilityMapping.trimmingCharacters(in: trimSet).lowercased()
    }
    static func queryPath(kind: MemoryKind, rawQuery: String, limit: Int, cursor: MemoryPageCursor?) throws -> String {
        try require((1...50).contains(limit))
        _ = try normalizedQuery(rawQuery)
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        guard let encoded = rawQuery.addingPercentEncoding(withAllowedCharacters: allowed) else { throw APIFailure.invalidResponse }
        return "/memory/items?kind=\(kind.rawValue)&query=\(encoded)&limit=\(limit)" + (cursor.map { "&after=\($0.token)" } ?? "")
    }
}
