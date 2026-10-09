import Foundation

public enum MessageIntent: String, Codable, Sendable { case steer, queue }
public struct SessionArchiveResult: Decodable, Sendable { public let sessionId: String; public let archived: Bool }
public struct SessionDeleteResult: Decodable, Sendable {
    public let sessionId: String; public let deleted: Bool; public let forgetMemories: Bool; public let forgottenEvidenceCount: Int
}
public struct UsageTotals: Decodable, Equatable, Sendable {
    public let requests: Int; public let unknownRequests: Int; public let unpricedRequests: Int
    public let inputTokens: Int; public let cachedInputTokens: Int; public let outputTokens: Int; public let cost: Double
    public var tokenCount: Int { inputTokens + outputTokens }
    public var uncertaintyNotice: String? {
        guard unknownRequests + unpricedRequests > 0 else { return nil }
        return "\(unknownRequests) 次未报告完整用量，\(unpricedRequests) 次未定价；费用未估算。"
    }
}
public struct UsageGroup: Decodable, Identifiable, Sendable {
    public let day: String?; public let sessionId: String?; public let profileId: String?
    public let totals: UsageTotals
    public var id: String { day ?? profileId ?? sessionId ?? "background" }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        day = try c.decodeIfPresent(String.self, forKey: .day); sessionId = try c.decodeIfPresent(String.self, forKey: .sessionId)
        profileId = try c.decodeIfPresent(String.self, forKey: .profileId); totals = try UsageTotals(from: decoder)
    }
    private enum CodingKeys: String, CodingKey { case day, sessionId, profileId }
}
public struct UsageBudget: Decodable, Equatable, Sendable {
    public let monthlyLimit: Double?; public let effectiveLimit: Double?; public let temporaryLimit: Double?; public let state: String
    public var notice: String? {
        switch state {
        case "warning": return "本月费用已达到上限的 80%，请留意后续用量。"
        case "blocked": return "本月用量已达到上限，云端模型请求已暂停。请提高本月上限，或切换本地模型。"
        default: return nil
        }
    }
}
public struct UsageSummary: Decodable, Sendable {
    public let month: String; public let timeZone: String; public let sessionId: String?
    public let total: UsageTotals; public let days: [UsageGroup]; public let sessions: [UsageGroup]; public let models: [UsageGroup]
    public let budget: UsageBudget
}
public struct UsagePrice: Decodable, Sendable { public let cachedInput: Double; public let input: Double; public let output: Double }
public struct UsageModel: Decodable, Identifiable, Sendable {
    public let id: String; public let name: String; public let model: String; public let local: Bool; public let price: UsagePrice?
}
public struct UsageSettings: Decodable, Sendable {
    public let monthlyLimit: Double?; public let temporaryLimit: Double?; public let temporaryMonth: String?
    public let canManage: Bool; public let models: [UsageModel]; public let timeZone: String?
}

/// Projection only. Execution and order belong to the host's native inbox, never to a client scheduler.
public struct QueuedTask: Identifiable, Equatable, Sendable {
    public let id: String; public let receiptID: String?; public let text: String; public let seq: Int; public let position: Int
}
public enum TaskQueueProjection {
    public static func queued(events: [TimelineEvent], commands: [SharedCommandReceipt] = []) -> [QueuedTask] {
        var pending: [String: QueuedTask] = [:]
        for event in events.sorted(by: { $0.seq < $1.seq }) {
            let items: [[String: JSONValue]]
            if case .array(let tasks) = event.data["tasks"] { items = tasks.compactMap { if case .object(let data) = $0 { return data }; return nil } }
            else if case .object(let data) = event.data { items = [data] }
            else { items = [] }
            for (position, data) in items.enumerated() {
                let receipt = data["receiptId"]?.string
                let command = commands.first { $0.receiptId == receipt && receipt != nil }
                guard let id = command?.rootTaskId ?? command?.commandId ?? data["commandId"]?.string ?? data["taskId"]?.string else { continue }
                if event.type == "task.queued" {
                    pending[id] = .init(id: id, receiptID: receipt, text: data["text"]?.string ?? "新任务", seq: event.seq, position: position)
                } else if ["task.started", "task.ended", "user.message"].contains(event.type) {
                    pending = pending.filter { $0.key != id && !(receipt != nil && $0.value.receiptID == receipt) }
                }
            }
        }
        return pending.values.sorted { $0.seq == $1.seq ? $0.position < $1.position : $0.seq < $1.seq }
    }
}

public enum ReadableToolSummary {
    public static func text(tool: String, raw: String) -> String {
        if ["load_tools", "ask_user_question", "get_goal", "create_goal", "update_goal", "run_code", "weftmod", "weftmod_script", "todo", "todo_write", "enter_plan_mode", "exit_plan_mode"].contains(tool) { return OperationNames.tool(tool) }
        if let data = raw.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let description = object["description"] as? String, !description.isEmpty { return OperationNames.text(description) }
            var argument = object["arguments"] as? [String: Any] ?? object["parameters"] as? [String: Any] ?? object
            if let rawArguments = (object["arguments"] ?? object["parameters"]) as? String,
               let bytes = rawArguments.data(using: .utf8), let parsed = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] { argument = parsed }
            if let description = argument["description"] as? String, !description.isEmpty { return OperationNames.text(description) }
            let path = (argument["path"] ?? argument["file_path"] ?? argument["filePath"] ?? argument["fileName"]) as? String
            let name = path.map { URL(fileURLWithPath: $0).lastPathComponent }
            if let paths = argument["paths"] as? [String], !paths.isEmpty {
                return OperationNames.tool(tool).replacingOccurrences(of: "文件", with: "") + " \(paths.count) 个文件：" + paths.prefix(3).map { URL(fileURLWithPath: $0).lastPathComponent }.joined(separator: "、")
            }
            if let name {
                if tool.contains("write") || tool.contains("save") { return "写入文件 " + name }
                if tool.contains("edit") || tool.contains("patch") { return "修改文件 " + name }
                if tool.contains("delete") || tool.contains("remove") { return "删除文件 " + name }
                return "读取文件 " + name
            }
            if let url = argument["url"] as? String { return OperationNames.tool(tool) + " " + (URL(string: url)?.host ?? "") }
            if argument["command"] != nil || argument["code"] != nil { return "运行命令" }
            return OperationNames.tool(tool)
        }
        if raw.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("{") { return OperationNames.tool(tool) }
        return raw.isEmpty ? OperationNames.tool(tool) : OperationNames.text(raw)
    }
}

extension SessionApproval {
    private var cleanReason: String { reason.replacingOccurrences(of: "^\\[weftmate:[a-z,\\-]+\\]\\s*", with: "", options: .regularExpression) }
    public var readableSummary: String {
        if let range = cleanReason.range(of: "\n{") { return ReadableToolSummary.text(tool: toolName, raw: String(cleanReason[cleanReason.index(before: range.upperBound)...])) }
        return ReadableToolSummary.text(tool: toolName, raw: cleanReason)
    }
    public var readableRisk: String? {
        guard let range = cleanReason.range(of: "\n{") else { return nil }
        return OperationNames.text(String(cleanReason[..<range.lowerBound]))
    }
}
