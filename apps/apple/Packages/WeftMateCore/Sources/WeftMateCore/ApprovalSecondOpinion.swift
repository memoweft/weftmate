import Foundation

public struct ApprovalSecondOpinion: Codable, Equatable, Sendable {
    public let alignment: String
    public let externalInfluence: String
    public let reason: String
    public var recommendsRejection: Bool { alignment == "对不上" || externalInfluence == "有" }
    public var text: String {
        if alignment == "对得上" && externalInfluence != "有" { return "另一个模型看过：和你的要求一致" }
        let label = recommendsRejection ? "另一个模型提醒" : "另一个模型拿不准"
        return label + "：" + reason.replacingOccurrences(of: "\n", with: " ")
    }
}
