import XCTest

final class A8ConversationFlowUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    private var driver: String { ProcessInfo.processInfo.environment["WEFTMATE_A5_DRIVER"]! }
    @MainActor private func get(_ path: String) async throws -> [String: Any] {
        let (data, response) = try await URLSession.shared.data(from: URL(string: driver + path)!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    @MainActor private func expect(_ item: XCUIElement) throws {
        guard item.waitForExistence(timeout: 30) else { throw NSError(domain: "A8UI.Missing." + item.identifier, code: 1) }
    }
    @MainActor private func tap(_ item: XCUIElement) throws { try expect(item); item.tap() }
    @MainActor private func waitGone(_ item: XCUIElement) async {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: item)
        let result = await XCTWaiter.fulfillment(of: [expectation], timeout: 30)
        XCTAssertEqual(result, .completed)
    }
    @MainActor private func keep(_ app: XCUIApplication, _ scene: String, _ theme: String, review: Bool = false) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = (review ? "review" : "a8") + "-iphone-" + scene + "-" + theme
        image.lifetime = .keepAlways; add(image)
    }
    @MainActor private func matching(_ app: XCUIApplication, _ prefix: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", prefix)).firstMatch
    }
    @MainActor func testLightConversationFlow() async throws { try await run("light") }
    @MainActor func testDarkConversationFlow() async throws { try await run("dark") }
    @MainActor private func run(_ theme: String) async throws {
        _ = try await get("/a5/setup"); _ = try await get("/bootstrap"); _ = try await get("/a8/prepare")
        let ready = try await get("/ready"), ids = try await get("/a5/ids")
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "a8-" + UUID().uuidString.prefix(8), "--a5-local-server", "--a5-theme", theme, "--server-url", ready["host"] as! String]
        app.launch(); defer { app.terminate() }
        let row = app.descendants(matching: .any).matching(identifier: "conversationRow." + (ids["review"] as! String)).firstMatch
        try tap(row); try expect(app.staticTexts["processingLine"])
        XCTAssertTrue(app.staticTexts["processingLine"].label.contains("正在加载模型 Synthetic Muse"))
        XCTAssertEqual(app.buttons["sendButton"].label, "停止")
        XCTAssertFalse(app.segmentedControls["sendIntent"].exists)
        try expect(app.buttons["contextUsage"]); XCTAssertTrue(app.buttons["contextUsage"].label.contains("86%"))
        try tap(app.buttons["contextUsage"]); try expect(app.staticTexts["背景信息窗口：86% 已用 / 已用 713.1k 标记，共 828.0k"])
        keep(app, "composer-context", theme, review: true); try tap(app.buttons["contextUsage"])
        keep(app, "loading", theme)
        _ = try await get("/a8/queued"); try await Task.sleep(for: .seconds(5)); XCTAssertTrue(app.staticTexts["processingLine"].label.contains("排队中"))
        _ = try await get("/a8/reasoning"); try await Task.sleep(for: .seconds(5)); XCTAssertTrue(app.staticTexts["processingLine"].label.contains("正在思考"))
        _ = try await get("/a8/tools"); try await waitGone(app.staticTexts["processingLine"])
        let group = matching(app, "executionBlock."); try expect(group); XCTAssertEqual(group.value as? String, "已收起")
        try expect(app.staticTexts["资料已经核对，接下来搜索并运行检查。"])
        keep(app, "conversation", theme, review: true)
        try tap(group); XCTAssertEqual(group.value as? String, "已展开")
        let first = matching(app, "executionStep."); try tap(first)
        try expect(app.buttons["复制"]); keep(app, "expanded", theme)
        try tap(first)
        _ = try await get("/a8/approvals")
        try expect(app.staticTexts["还有 1 个待批准"]); try expect(app.descendants(matching: .any)["approvalBar"])
        XCTAssertEqual(group.value as? String, "已展开")
        try tap(group)
        try expect(matching(app, "approveOnce.")); keep(app, "approval", theme, review: true)
        let approve = matching(app, "approveOnce."); let previousID = approve.identifier
        try tap(approve); try await waitGone(app.buttons[previousID])
        XCTAssertTrue(matching(app, "rejectApproval.").exists)
        try tap(matching(app, "rejectApproval.")); try await waitGone(app.descendants(matching: .any)["approvalBar"])
        let approvalGroup = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "executionBlock.")).allElementsBoundByIndex.last!
        if approvalGroup.value as? String == "已收起" { try tap(approvalGroup) }
        try expect(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "已批准")).firstMatch)
        try expect(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "已拒绝")).firstMatch)
        keep(app, "decisions", theme)
        _ = try await get("/a8/artifact"); _ = try await get("/a8/failure")
        let failed = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "失败")).firstMatch
        try expect(failed)
        XCTAssertEqual(failed.value as? String, "已展开")
        let artifact = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "artifactCard.")).firstMatch
        try expect(artifact); keep(app, "failure", theme)
        try tap(app.buttons["openConversationResources"]); try expect(app.staticTexts["合成报告.md"])
        keep(app, "outputs-sources", theme, review: true); try tap(app.buttons["closeResourcesPanel"])
        _ = try await get("/a8/history"); try await Task.sleep(for: .seconds(5))
        app.swipeDown(); app.swipeDown()
        try expect(app.buttons["returnToBottom"])
        _ = try await get("/a8/append"); try await Task.sleep(for: .seconds(5))
        XCTAssertTrue(app.buttons["returnToBottom"].exists); keep(app, "history", theme)
        try tap(app.buttons["returnToBottom"]); try await waitGone(app.buttons["returnToBottom"])
        _ = try await get("/a8/unknown"); try await Task.sleep(for: .seconds(5))
        XCTAssertEqual(app.buttons["contextUsage"].label, "背景信息窗口：已用 1.2k 标记")
        let draft = app.textFields["conversationDraft"]; try tap(draft); draft.typeText("保持运行，排队合成后续目标")
        XCTAssertEqual(app.buttons["sendButton"].label, "发送")
        try tap(app.buttons["sendButton"]); try expect(app.staticTexts["保持运行，排队合成后续目标"])
        try await Task.sleep(for: .seconds(5))
        let report = try await get("/a5/report"), operations = report["operations"] as! [[String: Any]]
        XCTAssertTrue(operations.contains { $0["kind"] as? String == "send" && $0["text"] as? String == "保持运行，排队合成后续目标" && $0["mode"] as? String == "queue" })
        keep(app, "queued-send", theme)
        // Stop uses the same primary button once the accepted draft clears.
        let empty = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "停止"), object: app.buttons["sendButton"])
        let cleared = await XCTWaiter.fulfillment(of: [empty], timeout: 30); XCTAssertEqual(cleared, .completed)
        try tap(app.buttons["sendButton"])
        try await Task.sleep(for: .seconds(5)); keep(app, "stopped", theme)
        try tap(app.navigationBars.buttons.firstMatch)
        try tap(app.descendants(matching: .any).matching(identifier: "conversationRow." + (ids["queue"] as! String)).firstMatch)
        let plainDraft = app.textFields["conversationDraft"]; try tap(plainDraft); plainDraft.typeText("合成纯文字问候")
        XCTAssertEqual(app.buttons["sendButton"].label, "发送")
        try tap(app.buttons["sendButton"]); try expect(app.staticTexts["合成纯文字问候"])
        try expect(app.staticTexts["合成任务完成。"])
        XCTAssertFalse(matching(app, "stopTask.").exists)
        XCTAssertFalse(matching(app, "executionBlock.").exists); XCTAssertFalse(app.staticTexts["processingLine"].exists)
        keep(app, "pure-text", theme)
    }
}
