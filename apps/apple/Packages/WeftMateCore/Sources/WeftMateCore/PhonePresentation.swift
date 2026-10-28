import Foundation

/// Presentation only: no networking, navigation state or account mutation.
public enum PhoneTab: String, CaseIterable, Identifiable, Sendable {
    case chat, activity, health
    public var id: String { rawValue }
    public var title: String {
        switch self { case .chat: "聊天"; case .activity: "动态"; case .health: "健康" }
    }
    public var icon: String {
        switch self { case .chat: "chat"; case .activity: "bell"; case .health: "health" }
    }
}
/// One navigation configuration for local and computer-backed iPhone workspaces.
public enum PhoneSidebarDestination: String, CaseIterable, Identifiable, Sendable {
    case conversations = "shell.conversations", goals = "shell.goals", library = "shell.library"
    case memory = "shell.memory", projects = "shell.projects"
    public var id: String { rawValue }
    public var title: String {
        switch self { case .conversations: "全部对话"; case .goals: "目标与提醒"; case .library: "成果库"; case .memory: "记忆"; case .projects: "项目" }
    }
    public var icon: String {
        switch self { case .conversations: "list"; case .goals: "goal"; case .library: "outputs"; case .memory: "bookmark"; case .projects: "folder" }
    }
    public static let lasting: [Self] = [.goals, .library, .memory]
}

public enum PhoneDrawerGesture {
    public static func progress(open: Bool, translation: Double, width: Double) -> Double {
        min(1, max(0, (open ? 1 : 0) + translation / width))
    }
    public static func commits(open: Bool, translation: Double, predicted: Double, threshold: Double) -> Bool {
        open ? !(translation < -threshold || predicted < -threshold) : translation > threshold || predicted > threshold
    }
}
public enum PhonePresentation {
    public static func title(main: Bool, assistant: String = "WeftMate", conversation: String) -> String {
        let value = (main ? assistant : conversation).trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? (main ? "WeftMate" : "对话") : value
    }
    public static func controlState(selected: Bool, pressed: Bool, enabled: Bool) -> String {
        if !enabled { return "disabled" }
        if pressed { return "pressed" }
        return selected ? "selected" : "normal"
    }
    /// Fixed action budgets let the headline truncate while both decision buttons stay on one row.
    public static func approvalHeadlineWidth(width: Double, inset: Double, gap: Double, actionWidth: Double) -> Double {
        max(0, width - inset * 2 - gap * 2 - actionWidth * 2)
    }
    public static func tabWidth(width: Double, inset: Double, gap: Double) -> Double {
        max(0, (width - inset * 2 - gap * Double(PhoneTab.allCases.count - 1)) / Double(PhoneTab.allCases.count))
    }
}
