import Foundation
import WeftMateCore

struct ConversationAdoptionPresentation: Identifiable, Sendable {
    var id: String { record.intent.requestId }
    let record: LocalEndpointOperationRecord
    let note: String?
    let lookupNotFound: Bool
    let freshlyVerified: Bool

    var status: String {
        guard freshlyVerified else { return "本机保存的采用请求，尚未核对" }
        guard let receipt = record.receipt else {
            return record.state == .rejected ? "采用请求未受理" : "采用结果待核对"
        }
        if receipt.validationLevel == .rejectedCommandOnly { return "采用已被拒绝，当前绑定未确认" }
        switch receipt.projection.status {
        case .active: return "服务已确认原会话绑定"
        case .creating: return "原会话正在接通"
        case .uncertain: return "原会话接通结果待核对"
        case .unbound: return "原会话尚未绑定"
        }
    }
}
