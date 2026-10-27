import Foundation

public enum PhoneComposerPrimaryAction: Equatable, Sendable {
    case voice, send, stop
    public static func resolve(running: Bool, draft: String, attachmentCount: Int) -> Self {
        let empty = draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && attachmentCount == 0
        if running && empty { return .stop }
        return empty ? .voice : .send
    }
}
public enum PhoneApprovalChoice: String, CaseIterable, Sendable {
    case once, category, reject
    public var title: String { switch self { case .once: "仅这一次"; case .category: "以后这类都允许"; case .reject: "拒绝" } }
    public var outcome: ApprovalDecisionOutcome { self == .reject ? .rejected : .allowedOnce }
    public func scope(global: Bool) -> ApprovalDecisionScope? {
        switch self { case .once: .once; case .category: global ? .globalCategory : .conversationCategory; case .reject: nil }
    }
}

public enum PhoneDecisionReceiptPolicy {
    public static func approval(status: SessionInteractionStatus, summary: String, registered: Bool, savedOutcome: ApprovalDecisionOutcome?) -> String? {
        if status == .answered || status.isTerminal { return summary }
        guard registered,let savedOutcome else { return nil }
        return savedOutcome == .rejected ? "已拒绝 · 等待电脑确认" : "已允许 · 等待电脑确认"
    }
}
