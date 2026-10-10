import XCTest

final class A7SessionMenuUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    private var driver: String { ProcessInfo.processInfo.environment["WEFTMATE_A5_DRIVER"]! }
    @MainActor private func get(_ path: String) async throws -> [String: Any] {
        let (data, response) = try await URLSession.shared.data(from: URL(string: driver + path)!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    @MainActor private func expect(_ item: XCUIElement) throws {
        guard item.waitForExistence(timeout: 30) else { throw NSError(domain: "A7UI.Missing." + item.identifier, code: 1) }
    }
    @MainActor private func tap(_ app: XCUIApplication, _ name: String) throws {
        let button = app.buttons[name]; try expect(button)
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true AND hittable == true"), object: button)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed); button.tap()
    }
    @MainActor private func row(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "conversationRow." + id).firstMatch
    }
    @MainActor private func menu(_ app: XCUIApplication, _ id: String) throws {
        let item = row(app, id); try expect(item); item.press(forDuration: 1.2)
        try expect(app.buttons["sessionAction.delete"])
    }
    @MainActor private func keep(_ app: XCUIApplication, _ scene: String, _ theme: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "review-iphone-" + scene + "-" + theme
        image.lifetime = .keepAlways; add(image)
    }
    @MainActor private func back(_ app: XCUIApplication) throws {
        let item = app.navigationBars.buttons.firstMatch; try expect(item); item.tap()
    }
    @MainActor private func launch(_ theme: String) async throws -> (XCUIApplication, [String: Any]) {
        _ = try await get("/a5/setup"); _ = try await get("/bootstrap")
        let ready = try await get("/ready"), ids = try await get("/a5/ids")
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "a7-" + UUID().uuidString.prefix(8), "--a5-local-server", "--a5-theme", theme, "--server-url", ready["host"] as! String]
        app.launch()
        let sideList = app.descendants(matching: .any).matching(identifier: "mainChat.sideList").firstMatch
        XCTAssertTrue(sideList.waitForExistence(timeout: 30)); sideList.tap()
        try expect(app.descendants(matching: .any)["conversationList"].firstMatch)
        return (app, ids)
    }
    @MainActor func testLightMenuArchiveAndForget() async throws { try await run("light") }
    @MainActor func testDarkMenuArchiveAndForget() async throws { try await run("dark") }
    @MainActor private func run(_ theme: String) async throws {
        let (app, ids) = try await launch(theme); defer { app.terminate() }
        let chatIDs = ids["chatIDs"] as! [String:String]
        let id = chatIDs["deletion"]!, forgetID = chatIDs["forget"]!
        try menu(app, id)
        for name in ["sessionAction.pin", "sessionAction.unread", "sessionAction.rename", "sessionAction.fork", "移至分组", "sessionAction.archive", "sessionAction.delete"] { try expect(app.buttons[name]) }
        keep(app, "session-menu", theme)
        try tap(app, "sessionAction.pin")
        try menu(app, id); XCTAssertTrue(app.buttons["取消置顶"].exists); try tap(app, "sessionAction.pin")
        try menu(app, id); try tap(app, "sessionAction.unread")
        try menu(app, id); XCTAssertTrue(app.buttons["标记为已读"].exists); try tap(app, "sessionAction.unread")
        try menu(app, id); try tap(app, "sessionAction.rename")
        let title = app.textFields["sessionRename." + id]; try expect(title); title.tap()
        title.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (title.value as? String ?? "").count) + "蓝色纸鹤资料")
        try tap(app, "保存"); try expect(app.staticTexts["蓝色纸鹤资料"])
        try menu(app, id); try tap(app, "移至分组"); try tap(app, "新建分组…")
        let group = app.textFields["sessionGroupName"]; try expect(group); group.tap(); group.typeText("合成计划")
        try tap(app, "创建并移入"); try expect(app.staticTexts["合成计划"])
        try menu(app, id); try tap(app, "移至分组"); try tap(app, "移出分组")
        try menu(app, id); try tap(app, "移至分组"); try tap(app, "合成计划")
        try menu(app, id); try tap(app, "sessionAction.fork")
        try expect(app.navigationBars["蓝色纸鹤资料（分叉）"])
        let draft = app.textFields["conversationDraft"]; try expect(draft); draft.tap(); draft.typeText("继续合成分叉")
        try tap(app, "sendButton"); try expect(app.staticTexts["继续合成分叉"])
        try back(app)
        // The same actions are reachable through a left swipe.
        let swiped = row(app, id); try expect(swiped); swiped.swipeLeft(); try tap(app, "对话操作")
        let grabber = app.buttons["表单控制柄"].firstMatch; try expect(grabber)
        grabber.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)))
        try expect(app.buttons["sessionAction.archive"]); keep(app, "swipe-actions-expanded", theme)
        try tap(app, "sessionAction.archive")
        try menu(app, forgetID); try tap(app, "sessionAction.archive")
        try tap(app, "phoneAccountMenu"); try tap(app, "phoneMenu.settings"); try tap(app, "settingsCategory.archived")
        let search = app.textFields["archivedSearch"]; try expect(search); search.tap(); search.typeText("蓝色纸鹤")
        try expect(app.buttons["restoreArchived." + id]); XCTAssertFalse(app.buttons["restoreArchived." + forgetID].exists)
        keep(app, "archived", theme)
        try tap(app, "openArchived." + id)
        try expect(app.navigationBars["蓝色纸鹤资料"])
        try expect(app.buttons["sendButton"]); XCTAssertFalse(app.buttons["sendButton"].isEnabled)
        keep(app, "archived-read-only", theme)
        try back(app)
        try tap(app, "phoneAccountMenu"); try tap(app, "phoneMenu.settings"); try tap(app, "settingsCategory.archived")
        let reopenedSearch = app.textFields["archivedSearch"]; try expect(reopenedSearch); reopenedSearch.tap(); reopenedSearch.typeText("蓝色纸鹤")
        try tap(app, "restoreArchived." + id)
        reopenedSearch.tap(); reopenedSearch.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 4))
        try tap(app, "archivedActions." + forgetID); keep(app, "archived-menu", theme)
        try tap(app, "deleteArchived." + forgetID)
        let choice = app.buttons["forgetConversationMemories"]; try expect(choice); XCTAssertEqual(choice.value as? String, "未勾选")
        choice.tap(); try expect(app.staticTexts["forgetPreviewSummary"])
        try expect(app.staticTexts["合成人物蓝色纸鹤（人物）"])
        let snippets = app.buttons["deleteConversationSnippets"]; try expect(snippets); XCTAssertEqual(snippets.value as? String, "未勾选")
        keep(app, "conversation-forget", theme); try tap(app, "confirmDeleteConversation")
        try expect(app.staticTexts["没有已归档对话。"])
        try tap(app, "完成")
        try tap(app, "phoneAccountMenu"); try tap(app, "phoneMenu.memory")
        try tap(app, "memoryItem.memory-synthetic"); try tap(app, "deleteMemoryButton")
        try expect(app.staticTexts["forgetPreviewSummary"]); try expect(app.staticTexts["合成资料协作关系（关系）"])
        XCTAssertEqual(app.buttons["deleteConversationSnippets"].value as? String, "未勾选")
        keep(app, "memory-forget", theme); try tap(app, "deleteConversationSnippets")
        XCTAssertEqual(app.buttons["deleteConversationSnippets"].value as? String, "已勾选")
        try tap(app, "confirmForgetMemory")
        let finished = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.buttons["confirmForgetMemory"])
        let finishedResult = await XCTWaiter.fulfillment(of: [finished], timeout: 30); XCTAssertEqual(finishedResult, .completed)
        let report = try await get("/a5/report")
        XCTAssertTrue((report["operations"] as! [[String: Any]]).contains { $0["kind"] as? String == "fork" })
        XCTAssertTrue((report["memoryDeletes"] as! [[String: Any]]).contains { ($0["command"] as? [String: Any])?["deleteConversationSnippets"] as? Bool == true })
    }
}
