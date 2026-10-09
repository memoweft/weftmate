import Foundation

public struct AppleSettingsCategory: Identifiable, Hashable, Sendable {
    public let id: String
    public let group: String
    public let name: String
    public let icon: String
    public let keywords: [String]
    public let desktopOnly: Bool
}

/// D31 taxonomy mirrors the shared settings registry; renderers only choose platform navigation.
public enum AppleSettingsRegistry {
    public static let categories: [AppleSettingsCategory] = [
        .init(id: "general", group: "设置", name: "常规", icon: "settings", keywords: ["开机", "自启", "托盘", "连接", "健康", "回复", "发送", "排队", "引导"], desktopOnly: false),
        .init(id: "appearance", group: "设置", name: "外观", icon: "palette", keywords: ["主题", "浅色", "深色", "颜色", "字号", "字体"], desktopOnly: false),
        .init(id: "account", group: "设置", name: "账户", icon: "account", keywords: ["邮箱", "密码", "退出", "注销"], desktopOnly: false),
        .init(id: "devices", group: "设置", name: "设备", icon: "desktop", keywords: ["连接", "配对", "添加", "待批准", "二维码"], desktopOnly: false),
        .init(id: "usage", group: "设置", name: "用量", icon: "chart", keywords: ["费用", "账单", "月度", "上限", "排行", "token"], desktopOnly: false),
        .init(id: "archived", group: "设置", name: "已归档", icon: "archive", keywords: ["对话", "恢复", "删除"], desktopOnly: false),
        .init(id: "models", group: "助手", name: "模型", icon: "model", keywords: ["主模型", "后台", "档案", "提供方", "API"], desktopOnly: false),
        .init(id: "approvals", group: "助手", name: "审批", icon: "approval", keywords: ["默认", "模式", "权限", "自动", "询问"], desktopOnly: false),
        .init(id: "memory", group: "助手", name: "记忆", icon: "memory", keywords: ["理解", "来源", "纠正", "管理"], desktopOnly: false),
        .init(id: "schedules", group: "助手", name: "提醒与定时任务", icon: "clock", keywords: ["提醒", "定时", "任务", "暂停", "恢复"], desktopOnly: false),
        .init(id: "system", group: "此电脑", name: "系统状态", icon: "tool", keywords: ["服务", "宿主", "重启", "修复"], desktopOnly: true),
        .init(id: "backups", group: "此电脑", name: "备份与恢复", icon: "archive", keywords: ["备份", "恢复", "自动", "保留"], desktopOnly: true),
        .init(id: "about", group: "关于", name: "关于", icon: "info", keywords: ["版本", "条款", "隐私", "反馈", "更新"], desktopOnly: false)
    ]
    public static func list(desktop: Bool, query: String = "") -> [AppleSettingsCategory] {
        let terms = query.lowercased().split(whereSeparator: \.isWhitespace)
        return categories.filter { category in
            (!category.desktopOnly || desktop) && terms.allSatisfy {
                ([category.name, category.group] + category.keywords).joined(separator: " ").lowercased().contains($0)
            }
        }
    }
    public static func category(_ id: String) -> AppleSettingsCategory? { categories.first { $0.id == id } }
}

public struct AppleSettingsRoute: Hashable, Sendable {
    public let categoryID: String
    public let sessionID: String?
    public init(categoryID: String, sessionID: String? = nil) {
        self.categoryID = categoryID
        self.sessionID = categoryID == "usage" ? sessionID : nil
    }
    public static func usage(sessionID: String?) -> Self { .init(categoryID: "usage", sessionID: sessionID) }
}

public struct ManagedSchedule: Decodable, Identifiable, Sendable {
    public let id: String; public let sessionId: String; public let text: String; public let kind: String
    public let state: String; public let timeZone: String; public let nextRunAt: String?
    public var identity: String { sessionId + "/" + id }
}
public struct ScheduleList: Decodable, Sendable { public let items: [ManagedSchedule] }
public enum ScheduleAction: String, Sendable { case pause, resume, run, delete }
public struct SettingsActionReply: Decodable, Sendable { public let ok: Bool? }
public struct BackupPreferences: Codable, Sendable {
    public var enabled: Bool; public var directory: String; public var dailyDays: Int; public var weeklyCopies: Int
}
public struct HostBackup: Decodable, Identifiable, Sendable {
    public let id: String; public let createdAt: String; public let reason: String; public let size: Int; public let verification: String
}
public struct HostBackups: Decodable, Sendable {
    public let settings: BackupPreferences; public let status: JSONValue; public let backups: [HostBackup]
    public let excludedCredentials: Bool; public let localUnencrypted: Bool
}
public struct BackupActionReply: Decodable, Sendable {
    public let state: String; public let restartsHost: Bool; public let requiresLogin: Bool
}

public struct BackgroundModelPreference: Decodable, Sendable { public let backgroundModelProfileId: String? }
public enum HostService: String, CaseIterable, Identifiable, Sendable {
    case model, host, memory
    public var id: String { rawValue }
    public var title: String { switch self { case .model: "模型服务"; case .host: "宿主"; case .memory: "记忆服务" } }
}
public struct HostServiceState: Decodable, Sendable {
    public let state: String; public let version: String?; public let lastError: String?; public let canRestart: Bool
    public var title: String {
        switch state {
        case "ready", "running", "online", "connected": "运行正常"
        case "unconfigured", "disabled": "尚未配置"
        case "starting", "restarting": "正在启动"
        case "unavailable", "error", "offline", "stopped": "暂不可用"
        default: "状态待确认"
        }
    }
}
public struct HostSystemSnapshot: Decodable, Sendable {
    public let model: HostServiceState; public let host: HostServiceState; public let memory: HostServiceState
    public func service(_ key: HostService) -> HostServiceState {
        switch key { case .model: model; case .host: host; case .memory: memory }
    }
}
