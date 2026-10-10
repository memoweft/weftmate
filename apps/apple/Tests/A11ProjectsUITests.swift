import XCTest

final class A11ProjectsUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    @MainActor private func get(_ path: String) async throws -> [String: Any] {
        let driver = ProcessInfo.processInfo.environment["WEFTMATE_A11_DRIVER"]!
        let (data, response) = try await URLSession.shared.data(from: URL(string: driver + path)!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    @MainActor private func expect(_ item: XCUIElement) throws {
        guard item.waitForExistence(timeout: 30) else { throw NSError(domain: "A11UI.Missing." + item.identifier, code: 1) }
    }
    @MainActor private func tap(_ app: XCUIApplication, _ id: String) throws {
        let item = app.buttons[id]; try expect(item)
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true AND hittable == true"), object: item)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed); item.tap()
    }
    @MainActor private func keep(_ app: XCUIApplication, _ scene: String, _ theme: String) {
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "a11-iphone-" + scene + "-" + theme
        shot.lifetime = .keepAlways; add(shot)
    }
    @MainActor private func row(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "conversationRow." + id).firstMatch
    }
    @MainActor private func back(_ app: XCUIApplication) throws {
        let button = app.navigationBars.buttons.firstMatch; try expect(button); button.tap()
    }
    @MainActor func testLightProjectsAndRestrictedSession() async throws { try await run("light") }
    @MainActor func testDarkProjectsAndRestrictedSession() async throws { try await run("dark") }
    @MainActor private func run(_ theme: String) async throws {
        let ready = try await get("/ready")
        let projectID = ready["projectId"] as! String, ordinaryID = ready["ordinaryId"] as! String, restrictedID = ready["restrictedId"] as! String
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "a11-" + UUID().uuidString.prefix(8), "--a5-local-server", "--a5-theme", theme, "--server-url", ready["host"] as! String]
        app.launch(); defer { app.terminate() }
        #if os(iOS)
        let sideList = app.descendants(matching: .any).matching(identifier: "mainChat.sideList").firstMatch
        XCTAssertTrue(sideList.waitForExistence(timeout: 30)); sideList.tap()
        #endif
        try expect(app.buttons["projectToggle." + projectID])
        XCTAssertFalse(app.buttons["newProject"].exists)
        XCTAssertFalse(app.buttons["projectSettings." + projectID].exists)
        keep(app, "projects-list", theme)
        try tap(app, "projectToggle." + projectID)
        XCTAssertEqual(app.buttons["projectToggle." + projectID].value as? String, "已折叠")
        XCTAssertFalse(row(app, ready["projectChatId"] as! String).exists)
        try tap(app, "projectToggle." + projectID)
        try expect(row(app, ready["projectChatId"] as! String))
        try tap(app, "projectNewConversation." + projectID)
        try expect(app.buttons["projectStartConversation"])
        keep(app, "project-new-conversation", theme)
        try tap(app, "projectStartConversation")
        try expect(app.textFields["conversationDraft"])
        let draft = app.textFields["conversationDraft"]; draft.tap(); draft.typeText("A11 合成项目消息")
        try tap(app, "sendButton")
        try expect(app.staticTexts["A11 合成项目消息"])
        try expect(app.staticTexts["合成任务完成。"])
        keep(app, "project-sent", theme)
        try back(app)
        let ordinary = row(app, ready["ordinaryChatId"] as! String); try expect(ordinary); ordinary.press(forDuration: 1.2)
        try tap(app, "sessionAction.project")
        try expect(app.buttons["sessionProject." + projectID])
        keep(app, "move-project", theme)
        try tap(app, "sessionProject." + projectID)
        let moveDone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.buttons["sessionAction.project"])
        XCTAssertEqual(XCTWaiter.wait(for: [moveDone], timeout: 30), .completed)
        let moved = row(app, ready["ordinaryChatId"] as! String); try expect(moved); moved.tap()
        try expect(app.staticTexts["projectNotice"])
        XCTAssertTrue(app.staticTexts["projectNotice"].label.contains("下一回合"))
        keep(app, "project-moved", theme)
        try back(app)
        let restricted = row(app, ready["restrictedChatId"] as! String); try expect(restricted); restricted.tap()
        try expect(app.staticTexts["restrictedSessionNotice"])
        XCTAssertEqual(app.staticTexts["restrictedSessionNotice"].label, "这台电脑已有执行账号。当前账号仅可聊天，不能操作电脑或读取原账号资料；请在电脑退出后登录原账号。")
        XCTAssertFalse(app.descendants(matching: .any)["approvalBar"].exists)
        XCTAssertFalse(app.buttons["停止"].exists)
        XCTAssertFalse(app.buttons["approvalMode"].exists)
        keep(app, "restricted-session", theme)
        // Still send and reconcile the original message receipt in a restricted session.
        let chat = app.textFields["conversationDraft"]; chat.tap(); chat.typeText("A11 合成受限聊天")
        try tap(app, "sendButton")
        try expect(app.staticTexts["A11 合成受限聊天"])
        try expect(app.staticTexts["合成任务完成。"])
        try expect(app.staticTexts["restrictedSessionNotice"])
        XCTAssertFalse(app.buttons["停止"].exists)
        keep(app, "restricted-sent", theme)
        let report = try await get("/report")
        let sends = (report["operations"] as! [[String: Any]]).filter { $0["kind"] as? String == "send" && $0["text"] as? String == "A11 合成项目消息" }
        XCTAssertEqual(sends.count, 1)
        let sessions = report["sessions"] as! [[String: Any]]
        XCTAssertTrue(sessions.contains { $0["sessionId"] as? String == ordinaryID && $0["projectId"] as? String == projectID })
        let traffic = report["traffic"] as! [[String: Any]]
        let forbidden = traffic.filter { row in
            let p = row["path"] as! String
            return p.contains("/sessions/" + restrictedID + "/") && ["approvals", "questions", "commands", "approval-mode"].contains(p.split(separator: "/").last.map(String.init) ?? "")
        }
        XCTAssertTrue(forbidden.isEmpty, "Restricted session fetched task/approval data")
    }
}
