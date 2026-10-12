import Foundation

public struct ReplyOutcome: Equatable, Sendable {
    public enum State: String, Sendable { case running, completed, interrupted, failed, ended }
    public let state: State
    public let retries: Int
    public var prominent: Bool { state == .failed }
    public var text: String {
        switch state {
        case .completed: retries > 0 ? "已完成 · 中途有 \(retries) 步重试" : "已完成"
        case .interrupted: "已中断"
        case .failed: "这轮未能完成，可以让我重试或补充说明。"
        case .running: retries > 0 ? "中途遇到问题，正在继续" : "正在处理…"
        case .ended: "已结束"
        }
    }
    public static func classify(events: [TimelineEvent], taskID: String) -> Self {
        let rows = events.filter { $0.data["taskId"]?.string == taskID || $0.data["completedStep"]?["taskId"]?.string == taskID || ($0.type == "turn.ended" && taskID == "turn-\($0.data["turn"]?.int ?? -1)") }
        let end = rows.last { $0.type == "task.ended" || $0.type == "turn.ended" }
        let failures = Set(rows.filter { row in
            let data = row.data["completedStep"] ?? row.data
            return data["state"]?.string == "failed" || data["jobState"]?.string == "failed" || row.type == "step.failed"
        }.map { ($0.data["completedStep"] ?? $0.data)["stepId"]?.string ?? String($0.seq) })
        let reason = end?.data["reason"]?.string ?? end?.data["reason"]?["kind"]?.string
        let state: State
        if ["aborted", "cancelled", "canceled", "stopped", "killed", "interrupted"].contains(reason ?? "") { state = .interrupted }
        else if reason == "completed" { state = .completed }
        else if ["error", "failed", "blocked"].contains(reason ?? "") { state = .failed }
        else if end != nil { state = .ended }
        else if rows.contains(where: { ["cancelled", "killed"].contains($0.data["state"]?.string ?? $0.data["jobState"]?.string ?? "") }) { state = .interrupted }
        else { state = .running }
        return .init(state: state, retries: failures.count)
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
            for row in rows {
                let data = row.data
                if ["source", "intermediate"].contains(data["role"]?.string ?? "") || ["superseded", "deleted", "replaced"].contains(data["state"]?.string ?? "") || data["supersededBy"] != nil || ["read", "move", "rename", "delete", "remove"].contains(data["operation"]?.string ?? data["action"]?.string ?? data["completedStep"]?["toolName"]?.string ?? "") { continue }
                guard let artifactID = data["artifactId"]?.string else { continue }
                let fileKey = data["filePath"]?.string ?? data["relativePath"]?.string ?? data["path"]?.string ?? artifactID
                if latest[fileKey] == nil { keys.append(fileKey) }; latest[fileKey] = row
            }
            let files = keys.compactMap { latest[$0] }
            return files.isEmpty ? nil : ReplyArtifactBundle(id:key,anchorSeq:anchor,files:files)
        }
    }
}
