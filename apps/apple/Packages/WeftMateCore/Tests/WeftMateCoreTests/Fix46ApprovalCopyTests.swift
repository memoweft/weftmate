import XCTest
@testable import WeftMateCore

final class Fix46ApprovalCopyTests: XCTestCase {
    func testCommonApprovalHeadlinesKeepRawContentOut() {
        let cases = [
            ("write", #"{"file_path":"C:/Downloads/report.md","content":"RAW_FILE_CONTENT"}"#, "写入 1 个文件：report.md"),
            ("pwsh", #"{"command":"Get-ChildItem C:/Downloads","description":"列出这个文件夹里的文件"}"#, "运行一条命令：列出这个文件夹里的文件"),
            ("list_directory", #"{"path":"C:/Downloads"}"#, "读取文件夹：Downloads"),
            ("web_fetch", #"{"url":"https://example.com/private?raw_token=123"}"#, "访问网页 example.com")
        ]
        for (tool, args, expected) in cases {
            XCTAssertEqual(ToolProgressSummary.approval(tool: tool, raw: "[weftmate:execute] 操作：\(tool)\n\(args)"), expected)
        }
        XCTAssertEqual(ToolProgressSummary.approval(tool: "pwsh", raw: "[weftmate:execute] pwsh\n{unfinished"), "运行一条命令")
    }
    func testRejectedStepDoesNotCountAsRetry() {
        let step: JSONValue = .object(["taskId": .string("t1"), "callId": .string("s1"), "stepId": .string("s1"),
            "state": .string("failed"), "toolName": .string("write"), "arguments": .object(["file_path": .string("report.md")])])
        let events = [
            TimelineEvent(seq: 1, type: "step.completed", data: step),
            TimelineEvent(seq: 2, type: "approval.requested", data: .object(["approvalId": .string("a1"), "callId": .string("s1")])),
            TimelineEvent(seq: 3, type: "approval.resolved", data: .object(["approvalId": .string("a1"), "outcome": .string("rejected")])),
            TimelineEvent(seq: 4, type: "task.ended", data: .object(["taskId": .string("t1"), "reason": .string("completed")]))
        ]
        let value = ReplyOutcome.classify(events: events, taskID: "t1")
        XCTAssertEqual(value.retries, 0)
        XCTAssertEqual(value.text, "你拒绝了写入 1 个文件：report.md，没有做")
    }
}
