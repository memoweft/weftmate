import Foundation
import WeftMateCore

enum TaskPresentation {
    static func commandTitle(_ row: TaskCommandRecord) -> String {
        if row.taskAction == "supplement" { return "补充" }
        if row.taskAction == "resume" { return "恢复" }
        return row.kind == .openApp ? "打开应用" : "执行步骤"
    }
    static func needsObservation(_ task: TaskSnapshot) -> Bool {
        if [.requested, .cancelRequested, .unconfirmed].contains(task.control.stopStatus) { return true }
        if task.source.state == .rejected { return false }
        if [.waiting, .streaming, .unconfirmed].contains(task.replyEvidence.status) { return true }
        return (task.steps + task.artifacts).contains { [.pending, .dispatching, .acceptedByDSH, .acceptedByHost, .uncertain].contains($0.state) }
    }
    static func replyLabel(_ state: TaskReplyStatus) -> String {
        switch state {
        case .waiting: "等待回复"
        case .streaming: "正在回复"
        case .completed: "回复已结束"
        case .aborted: "回复已中止"
        case .blocked: "回复需要处理"
        case .failed: "回复失败"
        case .unconfirmed: "回复结果待核对"
        }
    }
    static func controlLabel(_ control: TaskControlSnapshot) -> String {
        if let status = control.stopStatus {
            switch status {
            case .requested: return "已请求停止，等待执行回执。"
            case .cancelRequested: return "正在请求取消，尚未确认停止。"
            case .unconfirmed: return "停止结果仍待核对。"
            case .stopped: return "服务已确认停止。"
            case .completed: return "服务已确认任务结束。"
            }
        }
        return control.state == .uncertain ? "任务状态待核对。" : "任务处于服务记录的活动状态。"
    }
    static func commandLabel(_ row: TaskCommandRecord) -> String {
        if row.hasUnknownState { return "状态待核对" }
        return switch row.state {
        case .pending: "等待派发"
        case .dispatching: "正在派发"
        case .acceptedByDSH: "执行端已受理"
        case .acceptedByHost: "宿主已受理"
        case .observed: "服务已记录观察回执"
        case .uncertain: "执行结果待核对"
        case .rejected: "未受理"
        }
    }
}

