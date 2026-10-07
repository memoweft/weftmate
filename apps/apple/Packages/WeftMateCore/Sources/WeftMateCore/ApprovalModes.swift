import Foundation

public enum ApprovalMode: String, Codable, CaseIterable, Sendable, Identifiable {
    case auto, ask, acceptEdits = "accept-edits", plan, allowAll = "allow-all"
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .auto: "自动（推荐）"
        case .ask: "每次询问"
        case .acceptEdits: "自动接受文件修改"
        case .plan: "先出计划"
        case .allowAll: "全部允许"
        }
    }
    public var shortTitle: String { self == .auto ? "自动" : title }
    public var explanation: String {
        switch self {
        case .auto: "由 WeftMate 判断，有风险才问你"
        case .ask: "执行和修改前都先问"
        case .acceptEdits: "改文件直接做，其他照常询问"
        case .plan: "先给计划，你确认后再做"
        case .allowAll: "不再询问，危险操作也会直接执行"
        }
    }
    public static let allowAllWarning = "删除或覆盖文件、修改系统、安装软件、发送或发布内容、付款都可能直接执行，且可能无法撤销。"
}
public struct ApprovalModeSettings: Codable, Equatable, Sendable {
    public let mode: ApprovalMode
    public let allowedCategories: [String]?
}
public enum ApprovalDecisionScope: String, Codable, Sendable {
    case once, conversationCategory = "conversation-category"
}

public extension SessionApproval {
    var riskLabels: [String] { (riskCategories ?? []).map(Self.riskLabel) }
    static func riskLabel(_ category: String) -> String {
        switch category {
        case "delete": "删除文件"
        case "overwrite": "覆盖文件"
        case "system": "修改系统"
        case "install": "安装软件"
        case "external": "发送或发布"
        case "spend": "付款"
        case "execute": "运行脚本"
        default: "其他风险（\(category)）"
        }
    }
    var reversalNotice: String {
        let categories = riskCategories ?? []
        if categories.contains(where: { ["delete", "overwrite", "external", "spend"].contains($0) }) {
            return "可能无法撤销；请确认影响范围后再允许。"
        }
        return "能否撤销取决于具体操作；当前没有可保证的撤销方式。"
    }
    var decisionSummary: String {
        let action = riskLabels.isEmpty ? "操作" : riskLabels.joined(separator: "、")
        let label: String
        if status == .resolved {
            label = outcome == .allowedOnce ? "已允许" : outcome == .rejected ? "已拒绝" : "已处理"
        } else if status == .answered { label = "决定已登记" }
        else if status == .unavailable { label = "审批已失效" }
        else { label = "审批状态待核对" }
        let category = status == .resolved && outcome == .allowedOnce && decisionScope == "conversation-category" ? " · 本对话总是允许此类" : ""
        return label + " · " + action + category
    }
}
