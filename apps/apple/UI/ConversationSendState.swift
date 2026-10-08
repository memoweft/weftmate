import Foundation
import WeftMateCore

struct BoundConversationTarget: Equatable, Sendable {
    let sessionID: String
    let modelProfileID: String
    let modelName: String
}

struct ConversationCommandPresentation: Identifiable, Sendable {
    var id: String { record.intent.requestId }
    let record: LocalCommandRecord
    let receipt: SharedCommandReceipt?
    let progress: SharedTurnProgress?
    let note: String?
    let lookupNotFound: Bool
    var observationPaused = false

    var status: String {
        observationPaused ? "上次状态：" + lastObservedStatus : lastObservedStatus
    }

    private var lastObservedStatus: String {
        if receipt?.taskAction == "supplement" { return "已补充到当前任务" }
        if let progress {
            switch progress {
            case .pending: return "服务端排队中"
            case .accepted: return "已受理，等待回合"
            case .running: return "正在生成"
            case .completed: return "本回合已完成"
            case .aborted: return "本回合已中止"
            case .failed: return "本回合出错"
            case .blocked: return "本回合受阻"
            case .unknown: return "回合状态待核对"
            }
        }
        switch receipt?.state {
        case .pending, .dispatching: return "服务端排队中"
        case .acceptedByDSH, .acceptedByHost, .observed: return "已受理，等待回合"
        case .uncertain: return "受理结果待核对"
        case .rejected: return "请求未受理"
        case nil:
            switch record.state {
            case .queued: return lookupNotFound ? "尚未受理，可继续原请求" : "已保存到本机，待核对"
            case .accepted: return "已受理，回合结束待核对"
            case .uncertain: return "受理结果待核对"
            case .rejected: return "请求未受理"
            }
        }
    }

    var ended: Bool {
        guard let progress else { return record.state == .rejected }
        return [.completed, .aborted, .failed, .blocked].contains(progress)
    }
}

struct ConversationPollingPolicy {
    private(set) var quietPolls = 0
    mutating func delayNanoseconds(madeProgress: Bool) -> UInt64 {
        quietPolls = madeProgress ? 0 : min(quietPolls + 1, 9)
        return UInt64(2 + quietPolls * 2) * 1_000_000_000
    }
    static func remainsVisible(ownerMatches: Bool, selectedMatches: Bool, foreground: Bool, cancelled: Bool) -> Bool {
        ownerMatches && selectedMatches && foreground && !cancelled
    }
}
