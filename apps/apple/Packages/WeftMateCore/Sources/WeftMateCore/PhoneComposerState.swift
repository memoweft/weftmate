import Foundation

/// One policy for main chat and side chats; keyboard and focus transitions are independent.
public struct PhoneComposerState: Equatable, Sendable {
    public var focused: Bool
    public var draft: String
    public var attachmentCount: Int
    public var keyboardVisible: Bool
    public var reduceMotion: Bool
    public init(focused: Bool = false, draft: String = "", attachmentCount: Int = 0, keyboardVisible: Bool = false, reduceMotion: Bool = false) {
        self.focused = focused; self.draft = draft; self.attachmentCount = attachmentCount
        self.keyboardVisible = keyboardVisible; self.reduceMotion = reduceMotion
    }
    public var expanded: Bool { focused || !draft.isEmpty || attachmentCount > 0 }
    public var showsNavigation: Bool { !keyboardVisible }
    public var animates: Bool { !reduceMotion }
    public var maximumLines: Int { expanded ? (attachmentCount > 0 ? 3 : 6) : 1 }
}

public enum PhoneComposerPrimaryAction: Equatable, Sendable {
    case voice, send, stop
    public static func resolve(running: Bool, draft: String, attachmentCount: Int) -> Self {
        if running && draft.isEmpty && attachmentCount == 0 { return .stop }
        return draft.isEmpty && attachmentCount == 0 ? .voice : .send
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
