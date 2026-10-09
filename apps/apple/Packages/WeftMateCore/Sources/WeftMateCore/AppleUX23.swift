import Foundation

public struct DeepThinkingCapability: Codable, Equatable, Sendable { public let supported: Bool; public let effort: String? }
public struct SessionThinking: Codable, Equatable, Sendable { public let supported: Bool; public let enabled: Bool; public init(supported: Bool, enabled: Bool) { self.supported = supported; self.enabled = enabled } }

/// Every async result is tied to the account, host, device and selected conversation.
public struct AppleUXScope: Hashable, Sendable {
    public let epoch: UUID; public let host: String; public let device: String; public let conversation: String?
    public init(epoch: UUID, host: String, device: String, conversation: String? = nil) {
        self.epoch = epoch; self.host = host; self.device = device; self.conversation = conversation
    }
}
public struct ThinkingState: Sendable {
    public private(set) var confirmed: SessionThinking?
    public private(set) var pending = false
    private var scope: AppleUXScope?
    private var request: UUID?
    public init() {}
    public mutating func begin(scope: AppleUXScope) -> UUID {
        if self.scope != scope { confirmed = nil }
        self.scope = scope; let token = UUID(); request = token; pending = true; return token
    }
    @discardableResult public mutating func accept(_ value: SessionThinking, token: UUID, scope: AppleUXScope, current: AppleUXScope) -> Bool {
        guard scope == current, self.scope == scope, request == token else { return false }
        confirmed = value; pending = false; return true
    }
    public mutating func fail(token: UUID) { if request == token { pending = false } }
}
public enum ProjectRecentRows {
    public static func sorted(_ rows: [ConversationSummary]) -> [ConversationSummary] {
        rows.sorted { a,b in
            if a.updatedAt != b.updatedAt { return (a.updatedAt ?? "") > (b.updatedAt ?? "") }
            return a.id < b.id
        }
    }
    public static func preferenceKey(account: String, project: String) -> String {
        "weftmate.project.expanded." + Data(account.utf8).base64EncodedString() + "." + Data(project.utf8).base64EncodedString()
    }
    public static func expanded(account: String, project: String, defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: preferenceKey(account: account, project: project))
    }
    public static func save(_ expanded: Bool, account: String, project: String, defaults: UserDefaults = .standard) {
        defaults.set(expanded, forKey: preferenceKey(account: account, project: project))
    }
}
public enum AccountUsagePresentation {
    public static func month(at date: Date, timeZone: String) -> String {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: timeZone) ?? .current
        let c = calendar.dateComponents([.year,.month], from: date)
        return String(format: "%04d-%02d", c.year!, c.month!)
    }
    public static func matches(_ summary: UsageSummary, month: String, timeZone: String) -> Bool {
        summary.month == month && summary.timeZone == timeZone && summary.sessionId == nil
    }
    public static func text(_ summary: UsageSummary) -> String {
        let amount = String(format: "本月 ¥%.6f", summary.total.cost)
        guard let limit = summary.budget.effectiveLimit else { return amount + " · \(summary.total.requests) 次请求" }
        let remaining = limit > 0 ? max(0, min(1, 1 - summary.total.cost / limit)) : 0
        return amount + String(format: " · 剩余 %.0f%%", remaining * 100)
    }
}
public struct ComposerSubtask: Equatable, Identifiable, Sendable {
    public let id: String; public var name: String; public var state: String
    public let stepSeq: Int; public let startedAt: String?; public var endedAt: String?
    public var stateLabel: String { state == "completed" ? "完成" : state == "failed" ? "失败" : "进行中" }
    public var duration: String { duration(at: Date()) }
    public func duration(at now: Date) -> String {
        guard let startedAt, let start = Self.date(startedAt), let end = endedAt.flatMap(Self.date) ?? (state == "running" ? now : nil), end >= start else { return "未记录" }
        return String(format: state == "running" ? "已用 %.1f 秒" : "%.1f 秒", end.timeIntervalSince(start))
    }
    private static func date(_ value: String) -> Date? {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
public enum ComposerSubtasks {
    public static func merge(_ events: [TimelineEvent]) -> [ComposerSubtask] {
        var rows: [String: ComposerSubtask] = [:]
        var stepIDs: [String: String] = [:]
        for event in events.sorted(by: { $0.seq < $1.seq }) {
            if event.type == "subtask.updated", let id = event.data["id"]?.string, let state = event.data["state"]?.string, ["completed","failed"].contains(state), var row = rows[id] {
                row.state = state; row.endedAt = event.at; rows[id] = row
            } else if ["step.started","step.completed"].contains(event.type), let subtask = event.data["subtask"], let name = subtask["name"]?.string {
                let id = subtask["id"]?.string ?? event.data["stepId"]?.string ?? event.data["callId"]?.string ?? "step-\(event.seq)"
                let stepID = event.data["stepId"]?.string ?? event.data["callId"]?.string ?? id
                let priorID = stepIDs[stepID] ?? id
                var row = rows[id] ?? rows.removeValue(forKey: priorID) ?? .init(id: id, name: name, state: "running", stepSeq: event.seq, startedAt: event.type == "step.started" ? event.at : nil, endedAt: nil)
                if row.id != id { row = .init(id: id, name: name, state: row.state, stepSeq: row.stepSeq, startedAt: row.startedAt, endedAt: row.endedAt) }
                stepIDs[stepID] = id
                row.name = name
                if event.type == "step.completed", subtask["background"]?.bool != true {
                    row.state = event.data["state"]?.string == "failed" || event.data["isError"]?.bool == true ? "failed" : "completed"; row.endedAt = event.at
                }
                rows[id] = row
            }
        }
        return rows.values.sorted { $0.stepSeq < $1.stepSeq }
    }
}
