import XCTest
@testable import WeftMateCore

final class A13ConsistencyTests: XCTestCase {
    private func question(_ id: String, multiple: Bool = false) throws -> SessionQuestion {
        try JSONDecoder().decode(SessionQuestion.self, from: Data("{\"id\":\"\(id)\",\"question\":\"合成问题\",\"multiSelect\":\(multiple),\"options\":[{\"label\":\"简要\"},{\"label\":\"完整\"}]}".utf8))
    }
    func testDraftSingleMultipleOtherAndCompleteBatch() throws {
        let single = try question("one"), multiple = try question("two", multiple: true)
        var draft = QuestionBarDraft()
        XCTAssertFalse(draft.complete(single)); draft.select("简要", question: single)
        XCTAssertEqual(draft.answer(single).selected, ["简要"])
        draft.write("其他格式", question: single)
        XCTAssertEqual(draft.answer(single).selected, []); XCTAssertEqual(draft.answer(single).custom, "其他格式")
        draft.select("完整", question: single); XCTAssertNil(draft.answer(single).custom)
        draft.index += 1; draft.select("简要", question: multiple); draft.select("完整", question: multiple); draft.write("补充", question: multiple)
        XCTAssertEqual(draft.answer(multiple).selected, ["简要", "完整"]); XCTAssertEqual(draft.answer(multiple).custom, "补充")
        try QuestionAnswer(answers: [single, multiple].map(draft.answer)).validate(questions: [single, multiple])
        draft.select("简要", question: multiple); XCTAssertEqual(draft.answer(multiple).selected, ["完整"])
    }
    func testApprovalPriorityAndReceiptDisappearance() {
        XCTAssertFalse(QuestionBarDraft.visible(pending: true, registered: false, approvals: 1))
        XCTAssertTrue(QuestionBarDraft.visible(pending: true, registered: false, approvals: 0))
        XCTAssertFalse(QuestionBarDraft.visible(pending: true, registered: true, approvals: 0))
        XCTAssertFalse(QuestionBarDraft.visible(pending: false, registered: false, approvals: 0))
    }
    func testChineseLocalDeviceDates() {
        let shanghai = TimeZone(identifier: "Asia/Shanghai")!, losAngeles = TimeZone(identifier: "America/Los_Angeles")!
        XCTAssertEqual(DeviceDateText.timestamp("2050-10-31T16:01:00Z", timeZone: shanghai), "2050 年 11 月 1 日 00:01")
        XCTAssertEqual(DeviceDateText.timestamp("2050-11-01T01:01:00Z", timeZone: losAngeles), "2050 年 10 月 31 日 18:01")
        XCTAssertEqual(DeviceDateText.timestamp("invalid"), "未记录")
        XCTAssertEqual(DeviceDateText.month("2050-10"), "2050 年 10 月")
        XCTAssertEqual(DeviceDateText.month("2050-13"), "未记录")
        XCTAssertEqual(DeviceDateText.day("2050-10-09"), "2050 年 10 月 9 日")
        let now = ISO8601DateFormatter().date(from: "2050-01-31T23:00:00Z")!
        let choices = DeviceDateText.months(now: now, timeZone: shanghai)
        XCTAssertEqual(choices.count, 72); XCTAssertEqual(choices.first, "2050-12"); XCTAssertTrue(choices.contains("2050-02")); XCTAssertTrue(choices.contains("2050-01"))
        XCTAssertEqual(DeviceDateText.shiftYear("2050-02", by: -1), "2049-02")
        XCTAssertTrue(DeviceDateText.months(now: now, timeZone: shanghai, selected: "2040-10").contains("2040-10"))
    }
    func testAllNamesMatchUiCoreSource() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let source = try String(contentsOf: root.appendingPathComponent("src/ui-core/timeline-model.js"), encoding: .utf8)
        func table(_ name: String) throws -> [String: String] {
            let section = try XCTUnwrap(source.range(of: "const " + name + " = {"))
            let text = String(source[section.upperBound...].prefix { $0 != "}" })
            let regex = try NSRegularExpression(pattern: "([A-Za-z_][A-Za-z0-9_]*):\\s*'([^']*)'")
            return Dictionary(uniqueKeysWithValues: regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).map { (String(text[Range($0.range(at: 1), in: text)!]), String(text[Range($0.range(at: 2), in: text)!])) })
        }
        XCTAssertEqual(OperationNames.tools, try table("toolLabels")); XCTAssertEqual(OperationNames.fields, try table("fieldLabels"))
        XCTAssertEqual(OperationNames.tool("mcp__synthetic__unknown"), "扩展服务")
        XCTAssertEqual(ConversationSource(key: "file:read_file", kind: "file", name: "read_file", location: nil, url: nil, uses: []).displayName, "read_file")
        XCTAssertEqual(OperationNames.text("执行工具 ask_user_question"), "请求补充信息")
        XCTAssertEqual(OperationNames.text("调用 mcp__synthetic__extension"), "扩展服务")
        XCTAssertEqual(OperationNames.text("file_path"), "文件路径")
        XCTAssertTrue(APIFailure.server(status: 500, code: "mcp__synthetic__extension").errorDescription!.contains("扩展服务"))
        XCTAssertEqual(ToolStepDetail(raw: "read_file").output, "read_file")
    }
    func testNestedParametersTranslateAndLiteralContentStays() {
        let detail = ToolStepDetail(raw: #"{"arguments":{"file_path":"notes.md","unknown_field":{"toolName":"ask_user_question","multiSelect":true},"command":"npm test"}}"#)
        XCTAssertTrue(detail.readableText.contains("文件路径：notes.md"))
        XCTAssertTrue(detail.readableText.contains("操作：请求补充信息")); XCTAssertTrue(detail.readableText.contains("可多选")); XCTAssertTrue(detail.readableText.contains("附加信息")); XCTAssertTrue(detail.readableText.contains("npm test"))
        let approval = ToolStepDetail(raw: "[weftmate:execute] 影响合成目录。\n{\"toolName\":\"read_file\",\"file_path\":\"notes.md\"}")
        XCTAssertTrue(approval.readableText.contains("文件路径：notes.md")); XCTAssertTrue(approval.readableText.contains("操作：读取文件"))
        XCTAssertFalse(detail.readableText.contains("unknown_field")); XCTAssertFalse(detail.readableText.contains("toolName"))
    }
}
