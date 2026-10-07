import Foundation

/// Only root-message metadata for the explicitly selected session is exposed to the directory UI.
public struct TaskRootCommandMetadata: Equatable, Sendable, Identifiable {
    public var id: String { commandId }
    public let commandId: String
    public let requestId: String
    public let targetDeviceId: String
    public let sessionId: String
    public let state: SharedCommandState
    public let createdAt: String
    public let updatedAt: String
    public let receiptId: String?
    public let taskLabel: String?
}
public struct TaskCommandPageCursor: Equatable, Sendable {
    public let scope: TaskReadScope
    public let sessionId: String
    fileprivate let before: String
    fileprivate let boundaryCreatedAt: String
    fileprivate let seenIDs: Set<String>
    func validate(scope: TaskReadScope, sessionID: String) throws {
        guard self.scope == scope else { throw APIFailure.accountChanged }
        try SharedValidation.require(sessionId == sessionID && SharedValidation.id(before) && seenIDs.contains(before))
    }
    var beforeID: String { before }
}
public struct TaskCommandPage: Equatable, Sendable {
    public let scope: TaskReadScope
    public let sessionId: String
    public let rootCommands: [TaskRootCommandMetadata]
    public let scannedCount: Int
    public let unsupportedRootCount: Int
    public let nextCursor: TaskCommandPageCursor?
    public let hasMore: Bool
    static func decode(_ data: Data, scope: TaskReadScope, sessionID: String, limit: Int,
                       previous: TaskCommandPageCursor?) throws -> Self {
        try SharedValidation.require(SharedValidation.id(sessionID) && (1...100).contains(limit))
        try previous?.validate(scope: scope, sessionID: sessionID)
        struct Wire: Decodable { let commands: [CommandMetadataWire]; let nextBefore: String?; let hasMore: Bool }
        let wire: Wire = try MemoryValidation.decode(data)
        try SharedValidation.require(wire.commands.count <= limit &&
            (wire.hasMore ? !wire.commands.isEmpty && wire.nextBefore == wire.commands.last?.commandId : wire.nextBefore == nil))
        var seen = previous?.seenIDs ?? []
        var priorID = previous?.before
        var priorTime = previous?.boundaryCreatedAt
        var roots: [TaskRootCommandMetadata] = [], unsupported = 0
        for command in wire.commands {
            try command.validateBase()
            try SharedValidation.require(seen.insert(command.commandId).inserted && seen.count <= 5_000)
            if let priorID, let priorTime {
                let timeOrder = metadataCompare(priorTime, command.createdAt)
                try SharedValidation.require(timeOrder == .orderedDescending ||
                    (timeOrder == .orderedSame && metadataCompare(priorID, command.commandId) == .orderedDescending))
            }
            priorID = command.commandId; priorTime = command.createdAt
            guard command.kind == "session.message", command.targetDeviceId == scope.hostId,
                  command.sessionId == sessionID, command.rootTaskId == nil else { continue }
            try command.validateRoot()
            guard let state = SharedCommandState(rawValue: command.state) else { unsupported += 1; continue }
            // Host/observed states describe tools, not supported root message receipts.
            guard state != .acceptedByHost && state != .observed else { unsupported += 1; continue }
            roots.append(.init(commandId: command.commandId, requestId: command.requestId, targetDeviceId: command.targetDeviceId,
                sessionId: sessionID, state: state, createdAt: command.createdAt, updatedAt: command.updatedAt,
                receiptId: command.receiptId, taskLabel: command.taskLabel))
        }
        let next: TaskCommandPageCursor?
        if let before = wire.nextBefore, let boundary = wire.commands.last {
            next = TaskCommandPageCursor(scope: scope, sessionId: sessionID, before: before, boundaryCreatedAt: boundary.createdAt, seenIDs: seen)
        } else { next = nil }
        return .init(scope: scope, sessionId: sessionID, rootCommands: roots, scannedCount: wire.commands.count,
            unsupportedRootCount: unsupported, nextCursor: next, hasMore: wire.hasMore)
    }
}

private struct CommandMetadataWire: Decodable {
    let commandId: String
    let requestId: String
    let targetDeviceId: String
    let kind: String
    let state: String
    let createdAt: String
    let updatedAt: String
    let sessionId: String?
    let rootTaskId: String?
    let taskAction: String?
    let receiptId: String?
    let taskLabel: String?
    enum CodingKeys: String, CodingKey { case commandId, requestId, targetDeviceId, kind, state, createdAt, updatedAt, sessionId, rootTaskId, taskAction, receiptId, taskLabel }
    init(from decoder: any Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        commandId = try box.decode(String.self, forKey: .commandId); requestId = try box.decode(String.self, forKey: .requestId)
        targetDeviceId = try box.decode(String.self, forKey: .targetDeviceId); kind = try box.decode(String.self, forKey: .kind)
        state = try box.decode(String.self, forKey: .state); createdAt = try box.decode(String.self, forKey: .createdAt); updatedAt = try box.decode(String.self, forKey: .updatedAt)
        // Unknown tool metadata is pagination identity only. Its evolving detail/verification schema is not parsed.
        if kind == "session.message" {
            sessionId = try box.decodeIfPresent(String.self, forKey: .sessionId); rootTaskId = try box.decodeIfPresent(String.self, forKey: .rootTaskId)
            taskAction = try box.decodeIfPresent(String.self, forKey: .taskAction); receiptId = try box.decodeIfPresent(String.self, forKey: .receiptId)
            taskLabel = try box.decodeIfPresent(String.self, forKey: .taskLabel)
        } else { sessionId = nil; rootTaskId = nil; taskAction = nil; receiptId = nil; taskLabel = nil }
    }
    func validateBase() throws {
        try SharedValidation.require(SharedValidation.id(commandId) && SharedValidation.request(requestId) && SharedValidation.id(targetDeviceId) &&
            SharedValidation.matches(kind, "^[A-Za-z][A-Za-z0-9._:-]{0,127}$") && SharedValidation.matches(state, "^[A-Za-z][A-Za-z0-9_]{0,63}$") &&
            validMetadataTime(createdAt) && validMetadataTime(updatedAt))
        if kind == "session.message" {
            try SharedValidation.require((sessionId.map(SharedValidation.id) ?? true) && (rootTaskId.map(SharedValidation.id) ?? true))
        }
    }
    func validateRoot() throws {
        try SharedValidation.require(taskAction == nil && (receiptId.map(SharedValidation.receipt) ?? true) &&
            (taskLabel.map { $0.count <= 73 } ?? true))
    }
}
private func metadataCompare(_ left: String, _ right: String) -> ComparisonResult {
    // Current command IDs/UTC timestamps are ASCII; the publisher uses default localeCompare descending.
    left.compare(right, options: [], range: nil, locale: Locale(identifier: "en_US"))
}
private func validMetadataTime(_ value: String) -> Bool {
    guard MemoryValidation.time(value), value.contains("T") else { return false }
    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if formatter.date(from: value) != nil { return true }
    formatter.formatOptions = [.withInternetDateTime]; return formatter.date(from: value) != nil
}
