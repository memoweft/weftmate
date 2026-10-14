import Foundation

public struct ReplyOutcome: Equatable, Sendable {
    public enum State: String, Sendable { case running, completed, interrupted, failed, ended }
    public let state: State
    public let retries: Int
    public var rejectedSummaries: [String] = []
    public var endReasonKind: String? = nil
    public var prominent: Bool { state == .failed }
    public var text: String {
        guard !rejectedSummaries.isEmpty else { return statusText }
        let refusal = rejectedSummaries.map { "你拒绝了" + $0 + "，没有做" }.joined(separator: "；")
        return state == .completed && retries == 0 ? refusal : refusal + "。" + statusText
    }
    private var statusText: String {
        switch state {
        case .completed: retries > 0 ? "已完成 · 中途有 \(retries) 步重试" : "已完成"
        case .interrupted: "已中断"
        case .failed: endReasonKind == "max-tokens" ? "回复未完成：内容超出了本次可回复的长度，可以让我接着做。" : "这轮未能完成，可以让我重试或补充说明。"
        case .running: retries > 0 ? "中途遇到问题，正在继续" : "正在处理…"
        case .ended: "已结束"
        }
    }
    public static func classify(events: [TimelineEvent], taskID: String) -> Self {
        let rows = events.filter { $0.data["taskId"]?.string == taskID || $0.data["completedStep"]?["taskId"]?.string == taskID || ($0.type == "turn.ended" && taskID == "turn-\($0.data["turn"]?.int ?? -1)") }
        let end = rows.last { $0.type == "task.ended" || $0.type == "turn.ended" }
        let requests = events.filter { $0.type == "approval.requested" }
        let refused = events.filter { $0.type == "approval.resolved" && $0.data["outcome"]?.string == "rejected" }.map { event -> [String: JSONValue] in
            let request = requests.first { $0.data["approvalId"] == event.data["approvalId"] }
            var fields: [String: JSONValue] = [:]
            if let request, case .object(let values) = request.data { fields = values }
            if case .object(let values) = event.data { fields.merge(values) { _, new in new } }
            return fields
        }
        let rejected = rows.filter { row in
            let data = row.data["completedStep"] ?? row.data
            return row.type.hasPrefix("step.") && refused.contains { receipt in
                let call = receipt["callId"]?.string ?? receipt["stepId"]?.string
                return call != nil && (call == data["callId"]?.string || call == data["stepId"]?.string)
            }
        }
        let rejectedIDs = Set(rejected.compactMap { ($0.data["completedStep"] ?? $0.data)["stepId"]?.string })
        let failures = Set(rows.filter { row in
            let data = row.data["completedStep"] ?? row.data
            return !rejectedIDs.contains(data["stepId"]?.string ?? "") && (data["state"]?.string == "failed" || data["jobState"]?.string == "failed" || row.type == "step.failed")
        }.map { ($0.data["completedStep"] ?? $0.data)["stepId"]?.string ?? String($0.seq) })
        let reason = end?.data["reason"]?.string ?? end?.data["reason"]?["kind"]?.string
        let state: State
        if ["aborted", "cancelled", "canceled", "stopped", "killed", "interrupted"].contains(reason ?? "") { state = .interrupted }
        else if reason == "completed" { state = .completed }
        else if ["error", "failed", "blocked"].contains(reason ?? "") { state = .failed }
        else if end != nil { state = .ended }
        else if rows.contains(where: { ["cancelled", "killed"].contains($0.data["state"]?.string ?? $0.data["jobState"]?.string ?? "") }) { state = .interrupted }
        else { state = .running }
        var summaries: [String] = []
        for row in rejected {
            let data = row.data["completedStep"] ?? row.data
            let tool = data["toolName"]?.string ?? ""
            let bytes = try? JSONEncoder().encode(data["arguments"] ?? .object([:]))
            let summary = ToolProgressSummary.approval(tool: tool, raw: data["arguments"]?.string ?? bytes.flatMap { String(data: $0, encoding: .utf8) } ?? "")
            if !summaries.contains(summary) { summaries.append(summary) }
        }
        return .init(state: state, retries: failures.count, rejectedSummaries: summaries, endReasonKind: end?.data["endReasonKind"]?.string)
    }
}
public struct ReplyArtifactBundle: Equatable, Sendable, Identifiable {
    public let id: String
    public let anchorSeq: Int
    public let files: [TimelineEvent]
    public func visible(expanded: Bool) -> [TimelineEvent] { expanded ? files : Array(files.prefix(3)) }
}
public enum ReplyArtifacts {
    public static func bundles(_ events: [TimelineEvent]) -> [ReplyArtifactBundle] {
        var turn = "unknown", groups: [String:[TimelineEvent]] = [:], order: [String] = []
        for event in events.sorted(by: { $0.seq < $1.seq }) {
            if event.type == "user.message" || event.type == "turn.started" { turn = "turn-\(event.data["turn"]?.int ?? event.seq)" }
            guard event.type == "artifact.created" else { continue }
            let key = event.data["completedStep"]?["taskId"]?.string ?? event.data["taskId"]?.string ?? turn
            if groups[key] == nil { order.append(key) }
            groups[key, default: []].append(event)
        }
        return order.compactMap { key in
            guard let rows = groups[key], let anchor = rows.last?.seq else { return nil }
            var latest: [String:TimelineEvent] = [:], keys: [String] = []
            let expandedRows = rows.flatMap { row -> [TimelineEvent] in
                guard case .array(let files) = row.data["artifacts"] else { return [row] }
                return files.map { TimelineEvent(seq:row.seq,type:row.type,at:row.at,data:$0) }
            }
            for row in expandedRows {
                let data = row.data
                if ["source", "intermediate"].contains(data["role"]?.string ?? "") || ["superseded", "deleted", "replaced"].contains(data["state"]?.string ?? "") || data["supersededBy"]?.string.map({ !$0.isEmpty }) == true || ["read", "move", "rename", "delete", "remove"].contains(data["operation"]?.string ?? data["action"]?.string ?? data["completedStep"]?["toolName"]?.string ?? "") { continue }
                guard let artifactID = data["artifactId"]?.string else { continue }
                let fileKey = data["filePath"]?.string ?? data["relativePath"]?.string ?? data["path"]?.string ?? artifactID
                if latest[fileKey] == nil { keys.append(fileKey) }; latest[fileKey] = row
            }
            let files = keys.compactMap { latest[$0] }
            return files.isEmpty ? nil : ReplyArtifactBundle(id:key,anchorSeq:anchor,files:files)
        }
    }
}
