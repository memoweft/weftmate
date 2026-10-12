import Foundation

/// Presentation only: no networking, navigation state or account mutation.
public enum PhoneTab: String, CaseIterable, Identifiable, Sendable {
    case chat, activity, health, goals, resources
    public var id: String { rawValue }
    public var title: String {
        switch self { case .chat: "聊天"; case .activity: "动态"; case .health: "健康"; case .goals: "目标"; case .resources: "成果库" }
    }
    public var icon: String {
        switch self { case .chat: "chat"; case .activity: "bell"; case .health: "health"; case .goals: "plan"; case .resources: "outputs" }
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
