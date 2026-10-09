import Foundation

public enum SessionMenuAction: String, CaseIterable, Sendable {
    case pin, unread, rename, fork, group, archive, delete
    public var shortcut: String? {
        switch self { case .pin: "p"; case .unread: "u"; case .rename: "r"; case .fork: "f"; case .group: nil; case .archive: "a"; case .delete: "d" }
    }
    public func title(for row: ConversationSummary) -> String {
        switch self { case .pin: row.pinned ? "取消置顶" : "置顶"; case .unread: row.unread ? "标记为已读" : "标记为未读"; case .rename: "重命名"; case .fork: "分叉"; case .group: "移至分组"; case .archive: row.archived ? "恢复" : "归档"; case .delete: "删除" }
    }
}
public struct SessionGroup: Codable, Identifiable, Equatable, Sendable { public let id: String; public let name: String
    public init(id: String, name: String) { self.id = id; self.name = name }
}
public struct SessionGroupsReply: Decodable, Sendable { public let groups: [SessionGroup] }
public struct SessionGroupReply: Decodable, Sendable { public let group: SessionGroup }
public struct SessionForkReply: Decodable, Sendable { public let sessionId: String; public let title: String }
public struct SessionMetadataReply: Decodable, Sendable { public let sessionId: String }
public struct SessionSidebarSection: Identifiable, Sendable {
    public let id: String; public let title: String; public let rows: [ConversationSummary]
}
public enum SessionSidebar {
    public static func sections(rows: [ConversationSummary], groups: [SessionGroup], query: String = "") -> [SessionSidebarSection] {
        let visible = rows.filter { !$0.archived && (query.isEmpty || $0.title.localizedCaseInsensitiveContains(query)) }
        var sections: [SessionSidebarSection] = []
        let pinned = visible.filter(\.pinned)
        if !pinned.isEmpty { sections.append(.init(id: "pinned", title: "置顶", rows: pinned)) }
        for group in groups {
            let members = visible.filter { !$0.pinned && $0.groupId == group.id }
            if !members.isEmpty { sections.append(.init(id: group.id, title: group.name, rows: members)) }
        }
        let known = Set(groups.map(\.id))
        let remaining = visible.filter { !$0.pinned && ($0.groupId.map { !known.contains($0) } ?? true) }
        if !remaining.isEmpty { sections.append(.init(id: "ungrouped", title: "未分组", rows: remaining)) }
        return sections
    }
}
public struct ForgetPreviewItem: Decodable, Identifiable, Equatable, Sendable {
    public let id: String; public let kind: MemoryKind; public let text: String; public let itemType: String?
    public var identity: String { kind.rawValue + ":" + id }
    public var typeLabel: String {
        switch itemType ?? kind.rawValue {
        case "entity": "人物与事物"; case "relationship": "关系"; case "event": "经历"; case "cognition": "理解"
        case "person": "人物"; case "evaluation": "评价"; case "decision": "决定"; case "preference": "偏好"; default: kind.rawValue
        }
    }
    public var summary: String { text + "（" + typeLabel + "）" }
}
public struct ForgetPreview: Decodable, Equatable, Sendable {
    public let ownerId: String?; public let worldRevision: Int; public let itemCount: Int
    public let evidenceCount: Int; public let evidenceIds: [String]; public let items: [ForgetPreviewItem]
    public var summary: String { "将忘掉 \(itemCount) 项记忆，清除 \(evidenceCount) 条来源。以下内容会一起忘掉：" }
    public var conversationSummary: String { "将一起忘掉 \(itemCount) 项记忆，清除 \(evidenceCount) 条来源。勾选删除原话也会清除其他对话里的对应片段。" }
    public func validate(ownerID: String, expectedRevision: Int? = nil) throws {
        guard ownerId == nil || ownerId == ownerID else { throw APIFailure.identityMismatch }
        guard worldRevision >= 0, itemCount == items.count, evidenceCount == evidenceIds.count,
              Set(evidenceIds).count == evidenceIds.count,
              Set(items.map(\.identity)).count == items.count else { throw APIFailure.invalidResponse }
        if let expectedRevision, expectedRevision != worldRevision { throw APIFailure.server(status: 409, code: "MEMORY_REVISION_CHANGED") }
    }
}
public struct ForgetConfirmationState: Sendable {
    public var preview: ForgetPreview?
    public var deleteConversationSnippets = false
    public init() {}
    public var canConfirm: Bool { preview != nil }
}
