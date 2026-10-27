import Foundation

public enum ConversationMode: String, Codable, CaseIterable, Sendable {
    case chat, work
    public var title: String { self == .chat ? "对话" : "工作" }
    public var icon: String { self == .chat ? "chat" : "folder" }
}

public struct WorkDirectory: Codable, Equatable, Sendable {
    public let projectId: String?
    public let name: String?
    public let pathHint: String?
}

public enum WorkAndChat {
    public static let switchPrompt = "这件事需要在电脑上做。要切换到工作吗？"
    public static let noComputer = "连上电脑后可以让它动手"
    public static func mode(_ row: ConversationSummary) -> ConversationMode {
        // A read-only phone record never becomes executable by its placement in a list.
        if row.sessionId == nil && row.chatId == nil { return .chat }
        return row.mode ?? (row.projectId == nil ? .chat : .work)
    }
    public static func canCreateWork(connected: Bool, taskAvailable: Bool?) -> Bool {
        connected && taskAvailable != false
    }
    public static func offlineWorkAvailable(snapshot: OfflineSnapshot?, authorization: OfflineAuthorization?, authenticated: Bool) -> Bool {
        guard authenticated,let snapshot,let authorization,snapshot.taskRecipient != nil else { return false }
        return authorization.supportsTasks && authorization.authorized && authorization.hostId == snapshot.control.hostId &&
            authorization.accountId == snapshot.control.accountId && authorization.generation == snapshot.generation
    }
    public static func subtitle(_ row: ConversationSummary, computer: String) -> String {
        mode(row) == .work ? computer + " · " + (row.workDirectory?.name ?? row.projectName ?? "请选择项目或文件夹") : "由 " + computer + " 回答"
    }
    public static func switchDecision(scope: SessionInteractionScope, approval: SessionApproval,
                                      capabilities: ChatCapabilities, project: Project?, accept: Bool,
                                      requestID: String, proposalTask: TaskSnapshot? = nil) throws -> ApprovalDecisionIntent {
        guard capabilities.supports("workAndChat"), approval.isWorkSwitch else { throw APIFailure.platformCapabilityUnavailable }
        if accept {
            // preview.19 resumes the suspended tool in the original chat. Never approve that path.
            guard let proposalTask, isEndedProposal(approval: approval, task: proposalTask) else { throw APIFailure.platformCapabilityUnavailable }
            guard let project, !project.revoked else { throw APIFailure.server(status: 409, code: "PROJECT_NOT_SELECTED") }
            return try .init(scope: scope, approval: approval, outcome: .allowedOnce, requestID: requestID, workProjectId: project.id)
        }
        return try .init(scope: scope, approval: approval, outcome: .rejected, requestID: requestID)
    }
    public static func proposalText(approval: SessionApproval, task: TaskSnapshot) throws -> String {
        guard approval.isWorkSwitch, task.taskId == approval.sourceCommandId, task.sessionId == approval.sessionId,
              task.source.receiptId == approval.sourceReceiptId, !task.sourceText.isEmpty else { throw APIFailure.identityMismatch }
        return task.sourceText
    }
    public static func isEndedProposal(approval: SessionApproval, task: TaskSnapshot) -> Bool {
        (try? proposalText(approval: approval, task: task)) != nil &&
            task.replyEvidence.status == .completed && task.replyEvidence.turn == approval.turn
    }
    public static func proposedCallIDs(events: [TimelineEvent], approvals: [SessionApproval]) -> Set<String> {
        let approvals = approvals.filter(\.isWorkSwitch).flatMap { [$0.callId, $0.rootCallId].compactMap { $0 } }
        let events = events.filter { $0.type == "approval.requested" && $0.data["summary"]?.string?.hasPrefix("[weftmate:work-switch]") == true }
            .compactMap { $0.data["stepId"]?.string }
        return Set(approvals + events)
    }
    public static func showsChatEvent(type: String, data: JSONValue, proposedCalls: Set<String>) -> Bool {
        if type == "assistant.message", !proposedCalls.isEmpty, data["text"]?.string == switchPrompt { return false }
        guard type.hasPrefix("step.") else { return true }
        return ![data["callId"]?.string, data["stepId"]?.string].compactMap { $0 }.contains { proposedCalls.contains($0) }
    }
    public static func sections(rows: [ConversationSummary], groups: [SessionGroup], mode: ConversationMode,
                                query: String = "", archived: Bool = false) -> [SessionSidebarSection] {
        let visible = rows.filter { self.mode($0) == mode && $0.archived == archived && (query.isEmpty || $0.title.localizedCaseInsensitiveContains(query)) }
        if mode == .chat {
            // Reuse existing pin/group ordering, including the former main chat as an ordinary row.
            return SessionSidebar.sections(rows: visible.map { row in
                .init(id: row.id, title: row.title, conversationId: row.conversationId, sessionId: row.sessionId,
                      running: row.running, sendAvailable: row.sendAvailable, originalModelLabel: row.originalModelLabel,
                      pinned: row.pinned, unread: row.unread, groupId: row.groupId)
            }, groups: groups).map { section in
                .init(id: section.id, title: section.title, rows: section.rows.compactMap { item in visible.first { $0.id == item.id } })
            }
        }
        let grouped = Dictionary(grouping: visible) { $0.projectId ?? $0.workDirectory?.projectId ?? "removed" }
        return grouped.keys.sorted().map { key in
            let members = grouped[key]!.sorted { $0.pinned && !$1.pinned }
            return .init(id: key, title: members.first?.workDirectory?.name ?? members.first?.projectName ?? "需要选择文件夹", rows: members)
        }
    }
}
