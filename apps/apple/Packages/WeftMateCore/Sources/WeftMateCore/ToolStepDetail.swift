import Foundation

/// Presentation of the existing timeline detail envelope. Transport metadata stays in raw data.
public struct ToolStepDetail: Equatable, Sendable {
    public struct Parameter: Equatable, Sendable, Identifiable {
        public let name: String
        public let value: String
        public let id: String
    }
    public let parameters: [Parameter]
    public let output: String
    public let error: String?
    public let raw: String
    public let truncated: Bool
    public var outputPreview: String { String(output.split(separator: "\n", omittingEmptySubsequences: false).prefix(8).joined(separator: "\n").prefix(1200)) }
    public var hasFullOutput: Bool { outputPreview != output }
    public var readableText: String {
        [parameters.isEmpty ? nil : "参数\n" + parameters.map { $0.name + "：" + $0.value }.joined(separator: "\n"),
         error.map { "错误\n" + $0 }, output.isEmpty ? nil : "输出\n" + output,
         truncated ? "内容已截断" : nil].compactMap { $0 }.joined(separator: "\n\n")
    }
    public init(raw: String, truncated: Bool = false, failed: Bool = false) {
        self.raw = raw; self.truncated = truncated
        guard let bytes = raw.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else {
            let structured = raw.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("{") || raw.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("[")
            let text: String
            if let range = raw.range(of: "\n{"), let bytes = String(raw[raw.index(before: range.upperBound)...]).data(using: .utf8), (try? JSONSerialization.jsonObject(with: bytes)) != nil {
                let prefix = String(raw[..<range.lowerBound]).replacingOccurrences(of: "^\\[weftmate:[a-z,\\-]+\\]\\s*", with: "", options: .regularExpression)
                text = OperationNames.text(prefix) + "\n" + ToolStepDetail(raw: String(raw[raw.index(before: range.upperBound)...])).readableText
            } else { text = structured ? "内容无法完整解析，请查看原始数据。" : (failed ? OperationNames.text(raw) : raw) }
            parameters = []; output = failed ? "" : text; error = failed ? text : nil; return
        }
        var args = (object["arguments"] ?? object["parameters"]) as? [String: Any] ?? (object["output"] == nil && object["result"] == nil && object["error"] == nil ? object : [:])
        if let string = (object["arguments"] ?? object["parameters"]) as? String {
            if let bytes = string.data(using: .utf8), let parsed = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] { args = parsed }
            else { args = ["arguments": string] }
        }
        parameters = args.keys.sorted().enumerated().map { index, key in
            .init(name: OperationNames.field(key, index: index), value: ["tool", "toolName"].contains(key) ? OperationNames.tool(String(describing: args[key]!)) : Self.value(args[key]!), id: key)
        }
        var texts: [String] = [], errors: [String] = []
        func collect(_ item: Any, isError: Bool = false) {
            if let string = item as? String { if isError { errors.append(string) } else { texts.append(string) }; return }
            if let array = item as? [Any] { for child in array { collect(child, isError: isError) }; return }
            guard let object = item as? [String: Any] else { return }
            let bad = isError || object["isError"] as? Bool == true
            if object["type"] as? String == "text", let text = object["text"] as? String { collect(text, isError: bad) }
            else if let content = object["content"] { collect(content, isError: bad) }
            else if let message = object["message"] as? String { collect(message, isError: bad) }
        }
        if let value = object["output"] ?? object["result"] { collect(value, isError: failed || object["isError"] as? Bool == true) }
        if let value = object["error"] { collect(value, isError: true) }
        output = texts.filter { !$0.isEmpty }.joined(separator: "\n")
        error = errors.isEmpty ? (failed ? "步骤失败，未返回错误信息。" : nil) : OperationNames.text(errors.joined(separator: "\n"))
    }
    private static func value(_ value: Any) -> String {
        if let string = value as? String { return string }
        if value is NSNull { return "空" }
        if let array = value as? [Any] { return array.map(Self.value).joined(separator: "、") }
        if let object = value as? [String: Any] { return object.keys.sorted().enumerated().map { OperationNames.field($0.element, index: $0.offset) + "：" + (["tool", "toolName"].contains($0.element) ? OperationNames.tool(String(describing: object[$0.element]!)) : Self.value(object[$0.element]!)) }.joined(separator: "\n") }
        return String(describing: value)
    }
}
