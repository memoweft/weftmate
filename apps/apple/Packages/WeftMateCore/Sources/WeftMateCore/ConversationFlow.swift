import Foundation

public struct ConversationContextUsage: Codable, Equatable, Sendable {
    public let usedTokens: Int
    public let contextWindow: Int?
    public init(usedTokens: Int, contextWindow: Int?) {
        self.usedTokens = max(0, usedTokens)
        self.contextWindow = contextWindow.flatMap { $0 > 0 ? $0 : nil }
    }
    public var fraction: Double? { contextWindow.map { Double(usedTokens) / Double($0) } }
    public var warning: Bool { (fraction ?? 0) >= 0.8 }
    public var label: String {
        func tokens(_ count: Int) -> String { String(format: "%.1fk", Double(count) / 1000) }
        guard let contextWindow, let fraction else { return "背景信息窗口：已用 \(tokens(usedTokens)) 标记" }
        return "背景信息窗口：\(Int((fraction * 100).rounded()))% 已用 / 已用 \(tokens(usedTokens)) 标记，共 \(tokens(contextWindow))"
    }
}
public struct ConversationProcessing: Codable, Equatable, Sendable {
    public let phase: String
    public let modelName: String?
    public let ahead: Int?
    public init(phase: String, modelName: String? = nil, ahead: Int? = nil) { self.phase = phase; self.modelName = modelName; self.ahead = ahead }
    public var label: String {
        switch phase {
        case "memory": return "正在读取记忆…"
        case "queued": return ahead.map { "排队中，前面还有 \($0) 个请求…" } ?? "排队中…"
        case "loading": return "正在加载模型" + (modelName.map { " " + $0 } ?? "") + "…"
        case "reasoning": return "正在思考…"
        default: return "等待回复…"
        }
    }
    public static func visible(events: [TimelineEvent], running: Bool, phase: String?) -> Bool {
        guard running, phase != "answering" else { return false }
        let start = events.lastIndex { $0.type == "turn.started" || $0.type == "task.started" }
        let current = start.map { Array(events.suffix(from: $0)) } ?? events
        return !current.contains { $0.type == "assistant.message" || $0.type == "step.started" || $0.type == "step.completed" }
    }
}
public enum ComposerAction: Equatable, Sendable {
    case send, stop
    public static func resolve(running: Bool, text: String, attachments: Bool = false) -> Self {
        running && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !attachments ? .stop : .send
    }
}
/// User movement owns follow mode; layout growth alone never opts the reader out.
public struct ConversationFollowState: Equatable, Sendable {
    public private(set) var following = true
    public private(set) var hasNewContent = false
    public init() {}
    public mutating func userScrolled(distanceFromBottom: Double) { following = distanceFromBottom <= 48; if following { hasNewContent = false } }
    @discardableResult public mutating func contentChanged() -> Bool { if !following { hasNewContent = true }; return following }
    public mutating func returnToBottom() { following = true; hasNewContent = false }
}
public enum ToolProgressSummary {
    public static func approval(tool: String, raw: String) -> String {
        let name = tool.replacingOccurrences(of: "^mcp__.+?__", with: "", options: .regularExpression)
        let json = raw.range(of: "\n{").map { String(raw[raw.index(after: $0.lowerBound)...]) } ?? raw
        var args: [String: Any] = [:]
        if let bytes = json.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] {
            args = object["arguments"] as? [String: Any] ?? object["parameters"] as? [String: Any] ?? object
            if let text = (object["arguments"] ?? object["parameters"]) as? String, let data = text.data(using: .utf8),
               let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { args = parsed }
        }
        if ["shell", "bash", "pwsh", "powershell", "exec_command", "run_command", "command"].contains(name) || args["command"] != nil || args["cmd"] != nil {
            var description = (args["description"] as? String ?? "").components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
            let command = (args["command"] ?? args["cmd"] ?? args["script"]) as? String ?? ""
            if description.isEmpty && command.range(of: "^\\s*(Get-ChildItem|ls|dir)(\\s|$)", options: [.regularExpression, .caseInsensitive]) != nil { description = "列出这个文件夹里的文件" }
            return "运行一条命令" + (description.isEmpty || description.range(of: "[{}\\[\\]]|weftmate:|\\b(pwsh|powershell|Get-ChildItem)\\b", options: .regularExpression) != nil ? "" : "：" + String(description.prefix(180)))
        }
        if ["list_directory", "read_directory", "list_dir", "ls"].contains(name) {
            let path = (args["path"] ?? args["directory"] ?? args["file_path"]) as? String ?? ""
            let folder = path.replacingOccurrences(of: "\\", with: "/").split(separator: "/").last.map(String.init) ?? ""
            return "读取文件夹" + (folder.isEmpty ? "" : "：" + folder)
        }
        if let url = args["url"] as? String { return "访问网页 " + (URL(string: url)?.host ?? "") }
        if let path = (args["file_path"] ?? args["filePath"] ?? args["path"]) as? String {
            let file = path.replacingOccurrences(of: "\\", with: "/").split(separator: "/").last.map(String.init) ?? ""
            let verb = name.range(of: "write|save|create_file", options: .regularExpression) != nil ? "写入"
                : name.range(of: "edit|patch|modify", options: .regularExpression) != nil ? "修改"
                : name.range(of: "delete|remove", options: .regularExpression) != nil ? "删除" : "读取"
            return verb + " 1 个文件：" + file
        }
        if !args.isEmpty { return readable(tool: name, raw: json) }
        return OperationNames.tool(name)
    }
    public static func readable(tool: String, raw: String) -> String {
        if tool == "health_query" { return "查询健康数据" }
        if ["load_tools", "ask_user_question", "get_goal", "create_goal", "update_goal", "run_code", "weftmod", "weftmod_script", "todo", "todo_write", "enter_plan_mode", "exit_plan_mode"].contains(tool) { return OperationNames.tool(tool) }
        if let bytes = raw.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] {
            var args = object["arguments"] as? [String: Any] ?? object["parameters"] as? [String: Any] ?? object
            if let text = (object["arguments"] ?? object["parameters"]) as? String, let bytes = text.data(using: .utf8),
               let parsed = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] { args = parsed }
            if let command = (args["command"] ?? args["cmd"]) as? String { return "运行命令：" + String(command.prefix(180)) }
            if let query = (args["query"] ?? args["pattern"] ?? args["glob"]) as? String { return "搜索 " + String(query.prefix(180)) }
        }
        return ReadableToolSummary.text(tool: tool, raw: raw)
    }

    public static func text(_ entry: TimelineEntry) -> String {
        let refused = entry.steps.filter { $0.decision == "已拒绝" }
        if !refused.isEmpty { return refused.map { "你拒绝了" + OperationNames.tool($0.data["toolName"]?.string ?? "") + "，没有做" }.joined(separator: "；") }
        if let index = entry.steps.firstIndex(where: { $0.effectiveState == "failed" }) { return "第 \(entry.steps[index].ordinal) 步失败" }
        if entry.stopped || entry.steps.contains(where: { $0.effectiveState == "cancelled" }) { return "已停止 · " + counts(entry.steps) }
        if entry.running, let step = entry.steps.last(where: \.running) { return "正在" + step.summary + "…" }
        return counts(entry.steps)
    }
    public static func counts(_ steps: [TimelineStep]) -> String {
        var kinds: [String] = [], counts: [String: Int] = [:]
        for step in steps where step.decision != "已拒绝" {
            let tool = (step.data["toolName"]?.string ?? "").lowercased()
            let kind: String
            switch tool {
            case "health_query": kind = "health"
            case "shell", "bash", "exec", "exec_command", "run_command", "pwsh", "powershell": kind = "command"
            case "read", "read_file": kind = "read"
            case "write", "edit", "write_file", "edit_file": kind = "write"
            case "search", "grep", "glob", "web_search": kind = "search"
            default: kind = "other"
            }
            if counts[kind] == nil { kinds.append(kind) }; let count: Int
            if ["read", "write"].contains(kind), let match = step.summary.range(of: "[0-9]+(?= 个文件)", options: .regularExpression) { count = Int(step.summary[match]) ?? 1 }
            else { count = 1 }
            counts[kind, default: 0] += count
        }
        return kinds.map { kind in
            let count = counts[kind]!
            switch kind {
            case "health": return count == 1 ? "查了健康数据" : "查了 \(count) 次健康数据"
            case "command": return "已运行 \(count) 个命令"
            case "read": return "读取了 \(count) 个文件"
            case "write": return "修改了 \(count) 个文件"
            case "search": return "搜索了 \(count) 次"
            default: return "执行了 \(count) 个工具步骤"
            }
        }.joined(separator: "、")
    }
}
