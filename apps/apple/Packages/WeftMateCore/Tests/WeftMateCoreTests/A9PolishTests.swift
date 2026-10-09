import Foundation
import Testing
@testable import WeftMateCore

@Suite struct A9PolishTests {
    @Test func parametersNestedOutputAndRaw() {
        let raw = #"{"arguments":"{\"path\":\"notes.md\",\"command\":\"cat notes.md\",\"query\":\"合成计划\"}","output":[{"type":"tool-result","toolCallId":"synthetic","isError":false,"content":[{"type":"text","text":"第一行\n第二行"}]}]}"#
        let value = ToolStepDetail(raw: raw)
        #expect(value.parameters.map(\.name) == ["命令", "路径", "查询"])
        #expect(value.parameters.map(\.value) == ["cat notes.md", "notes.md", "合成计划"])
        #expect(value.output == "第一行\n第二行" && value.error == nil)
        #expect(value.raw == raw)
        #expect(!value.readableText.contains("toolCallId") && !value.readableText.contains("isError"))
    }
    @Test func objectArgumentsPlainTextAndFailedResults() {
        let value = ToolStepDetail(raw: #"{"arguments":{"paths":["one.md","two.md"],"cwd":"/synthetic"},"output":[{"type":"tool-result","isError":true,"content":[{"type":"text","text":"文件不存在"}]}]}"#)
        #expect(value.parameters.map(\.value) == ["/synthetic", "one.md、two.md"])
        #expect(value.error == "文件不存在" && value.output.isEmpty)
        #expect(ToolStepDetail(raw: "合成正文").output == "合成正文")
        #expect(ToolStepDetail(raw: "合成错误", failed: true).error == "合成错误")
        #expect(ToolStepDetail(raw: #"{"error":{"message":"拒绝访问"}}"#).error == "拒绝访问")
    }
    @Test func outputPreviewAndTruncationPreserveFullText() throws {
        let body = (1...20).map { "第\($0)行" }.joined(separator: "\n")
        let raw = String(data: try JSONSerialization.data(withJSONObject: ["output": body]), encoding: .utf8)!
        let value = ToolStepDetail(raw: raw, truncated: true)
        #expect(value.hasFullOutput && value.output == body && value.outputPreview.split(separator: "\n").count == 8)
        #expect(value.raw == raw && value.readableText.contains("内容已截断"))
        #expect(ToolStepDetail(raw: #"{"arguments":"not json"}"#).parameters.first?.value == "not json")
        let incomplete = ToolStepDetail(raw: #"{"arguments": "# , truncated: true)
        #expect(!incomplete.output.contains("arguments") && incomplete.raw.contains("arguments"))
    }
    @Test func devicePreferenceReloadAndAccountIsolation() throws {
        let namespace = "a9-test-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: namespace)!
        defer { defaults.removePersistentDomain(forName: namespace) }
        let a = try LocalAccountScope(server: ServerConfiguration(input: "https://one.example.com"), ownerId: "synthetic-a")
        let b = try LocalAccountScope(server: ServerConfiguration(input: "https://one.example.com"), ownerId: "synthetic-b")
        let otherHost = try LocalAccountScope(server: ServerConfiguration(input: "https://two.example.com"), ownerId: "synthetic-a")
        let preferences = RunningMessagePreferences(defaults: defaults)
        #expect(preferences.read(account: a) == .queue)
        preferences.write(.steer, account: a)
        #expect(RunningMessagePreferences(defaults: UserDefaults(suiteName: namespace)!).read(account: a) == .steer)
        #expect(preferences.read(account: b) == .queue && preferences.read(account: otherHost) == .queue)
        #expect(RunningMessageMode.steer.intent(running: true) == .steer)
        #expect(RunningMessageMode.steer.intent(running: false) == .queue)
        #expect(RunningMessageMode.queue.intent(running: true) == .queue)
        preferences.write(.queue, account: a)
        #expect(preferences.read(account: a) == .queue)
        #expect(AppleSettingsRegistry.list(desktop: false, query: "引导").map(\.id) == ["general"])
    }
    @Test func watchAndComposerApprovalShareToolAndObject() throws {
        let fields: [String: Any] = ["approvalId": "synthetic-approval", "sessionId": "synthetic-session", "taskId": "turn-1", "sourceCommandId": "synthetic-command", "sourceReceiptId": "synthetic-receipt", "turn": 1, "callId": "synthetic-call", "rootCallId": "synthetic-call", "toolName": "shell", "reason": "[weftmate:execute] 合成测试目录。\n{\"command\":\"npm test\"}", "createdAt": "2026-10-09T00:00:00Z", "status": "pending"]
        let approval = try JSONDecoder().decode(SessionApproval.self, from: JSONSerialization.data(withJSONObject: fields))
        #expect(approval.actionHeadline == "要运行命令：npm test")
        let watch = WatchApproval(id: approval.id, summary: approval.actionHeadline)
        #expect(watch.summary == approval.actionHeadline)
    }

}
