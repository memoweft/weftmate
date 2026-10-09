import Foundation

public enum RunningMessageMode: String, CaseIterable, Sendable, Identifiable {
    case queue, steer
    public var id: String { rawValue }
    public var title: String { self == .queue ? "排队" : "引导" }
    public var explanation: String { self == .queue ? "等当前回复结束后作为下一条处理。" : "插入当前回复，引导它调整方向。" }
    public func intent(running: Bool) -> MessageIntent { running && self == .steer ? .steer : .queue }
}

/// Device-local preference keyed by the existing authenticated account scope.
public struct RunningMessagePreferences {
    private let defaults: UserDefaults
    public init(defaults: UserDefaults) { self.defaults = defaults }
    public func read(account: LocalAccountScope) -> RunningMessageMode {
        defaults.string(forKey: key(account)).flatMap(RunningMessageMode.init(rawValue:)) ?? .queue
    }
    public func write(_ value: RunningMessageMode, account: LocalAccountScope) { defaults.set(value.rawValue, forKey: key(account)) }
    private func key(_ account: LocalAccountScope) -> String { "runningMessageMode." + account.cacheKey }
}

extension SessionApproval {
    public var actionHeadline: String {
        if let range = reason.range(of: "\n{") {
            return "要" + ToolProgressSummary.readable(tool: toolName, raw: String(reason[reason.index(before: range.upperBound)...]))
        }
        return readableSummary
    }
}
