import XCTest

final class A4aApprovalUITests: XCTestCase {
    private let base = "http://127.0.0.1:18764/personal/v1"
    @MainActor private func launch() async throws -> XCUIApplication {
        continueAfterFailure = false
        var request = URLRequest(url: URL(string: base + "/test/reset")!)
        request.httpMethod = "POST"
        _ = try await URLSession.shared.data(for: request)
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "a4a-" + UUID().uuidString.prefix(8),
            "--a4a-local-server", "--server-url", "http://localhost:18764"]
        app.launch()
        XCTAssertTrue(element(app, "conversationRow.session-fixture").waitForExistence(timeout: 30))
        return app
    }
    @MainActor func testFiveModesWarningPersistenceConversationIsolationAndDefault() async throws {
        let app = try await launch()
        activate(element(app, "conversationRow.session-fixture"))
        let mode = app.buttons["approvalMode"]
        XCTAssertTrue(mode.waitForExistence(timeout: 20)); waitValue(mode, "auto")
        activate(mode)
        let menuTree = XCTAttachment(string: app.debugDescription); menuTree.name = "A4a-mode-accessibility"; menuTree.lifetime = .keepAlways; add(menuTree)
        for name in ["auto", "ask", "accept-edits", "plan", "allow-all"] {
            XCTAssertTrue(app.buttons["approvalModeOption." + name].waitForExistence(timeout: 5))
        }
        XCTAssertEqual(app.buttons["approvalModeOption.auto"].value as? String, "已选择")
        screenshot(app, "01-mode-menu")
        activate(app.buttons["approvalModeOption.ask"]); waitValue(mode, "ask")
        for name in ["accept-edits", "plan"] {
            activate(mode); activate(app.buttons["approvalModeOption." + name]); waitValue(mode, name)
        }
        activate(mode); activate(app.buttons["approvalModeOption.allow-all"])
        XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.alerts.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "付款")).firstMatch.exists)
        screenshot(app, "02-allow-all-warning")
        activate(app.alerts.buttons["取消"]); waitValue(mode, "plan")
        let cancelled = try await report()
        let requests = try XCTUnwrap(cancelled["requests"] as? [[String: Any]])
        XCTAssertFalse(requests.contains { ($0["method"] as? String) == "PATCH" && ($0["body"] as? [String: String])?["mode"] == "allow-all" })
        activate(mode); activate(app.buttons["approvalModeOption.allow-all"])
        activate(app.alerts.buttons["仍然全部允许"].firstMatch); waitValue(mode, "allow-all")
        activate(mode); activate(app.buttons["approvalModeOption.ask"]); waitValue(mode, "ask")
        backToList(app)
        activate(element(app, "conversationRow.session-other")); waitValue(app.buttons["approvalMode"], "auto")
        backToList(app)
        openSettings(app)
        let defaultMode = app.buttons["defaultApprovalMode"]
        XCTAssertTrue(defaultMode.waitForExistence(timeout: 10)); waitValue(defaultMode, "auto")
        activate(defaultMode); activate(app.buttons["approvalModeOption.accept-edits"]); waitValue(defaultMode, "accept-edits")
        screenshot(app, "03-account-default")
        #if !os(macOS)
        activate(app.buttons["closeAuxiliarySheetButton"])
        #endif
        activate(element(app, "conversationRow.session-fixture")); waitValue(app.buttons["approvalMode"], "ask")
        // Reopening the real app reads the host-persisted mode and account default again.
        app.terminate(); app.launch()
        activate(element(app, "conversationRow.session-fixture")); waitValue(app.buttons["approvalMode"], "ask")
        let saved = try await report()
        XCTAssertEqual(saved["default"] as? String, "accept-edits")
        XCTAssertEqual((saved["modes"] as? [String: String])?["session-fixture"], "ask")
        XCTAssertEqual((saved["modes"] as? [String: String])?["session-other"], "auto")
    }
    @MainActor func testThreeApprovalButtonsRiskAndHumanResolvedRows() async throws {
        let app = try await launch()
        activate(element(app, "conversationRow.session-fixture"))
        let ids = (1...3).map { String(format: "%08d-1111-4111-8111-111111111111", $0) }
        let once = app.buttons["approveOnce." + ids[0]]
        XCTAssertTrue(once.waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["approveCategory." + ids[0]].isEnabled)
        XCTAssertTrue(app.buttons["rejectApproval." + ids[0]].exists)
        screenshot(app, "04-approval-three-buttons")
        activate(once)
        let category = app.buttons["approveCategory." + ids[1]]
        XCTAssertTrue(category.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["已允许 · 运行脚本"].exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "可能无法撤销")).firstMatch.exists)
        screenshot(app, "05-delete-risk")
        activate(category)
        let reject = app.buttons["rejectApproval." + ids[2]]
        XCTAssertTrue(reject.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["已允许 · 删除文件、覆盖文件 · 本对话总是允许此类"].exists)
        activate(reject)
        XCTAssertTrue(app.staticTexts["已拒绝 · 发送或发布、付款"].waitForExistence(timeout: 20))
        screenshot(app, "06-processed-rows")
        let data = try await report()
        let decisions = try XCTUnwrap(data["decisions"] as? [String: [String: String]])
        XCTAssertEqual(decisions[ids[0]]?["scope"], "once")
        XCTAssertEqual(decisions[ids[1]]?["scope"], "conversation-category")
        XCTAssertEqual(decisions[ids[2]]?["outcome"], "rejected"); XCTAssertNil(decisions[ids[2]]?["scope"])
        XCTAssertEqual(data["allowedCategories"] as? [String], ["delete", "overwrite"])
        let requests = try XCTUnwrap(data["requests"] as? [[String: Any]])
        XCTAssertEqual(requests.filter { ($0["method"] as? String) == "POST" && ($0["path"] as? String)?.contains("/approvals/") == true }.count, 3)
    }
    @MainActor private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }
    @MainActor private func activate(_ element: XCUIElement) {
        XCTAssertTrue(element.waitForExistence(timeout: 15))
        #if os(macOS)
        element.click()
        #else
        element.tap()
        #endif
    }
    @MainActor private func backToList(_ app: XCUIApplication) {
        #if !os(macOS)
        activate(app.navigationBars.buttons["对话"])
        #endif
    }
    @MainActor private func openSettings(_ app: XCUIApplication) {
        #if os(macOS)
        activate(element(app, "settingsNavigation"))
        #else
        activate(app.buttons["phoneAccountMenu"]); activate(app.buttons["phoneMenu.settings"])
        #endif
    }
    @MainActor private func waitValue(_ element: XCUIElement, _ value: String) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 15), .completed)
    }
    @MainActor private func report() async throws -> [String: Any] {
        let (data, _) = try await URLSession.shared.data(from: URL(string: base + "/test/report")!)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
    @MainActor private func screenshot(_ app: XCUIApplication, _ name: String) {
        #if os(macOS)
        let attachment = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
        attachment.name = "A4a-mac-" + name
        #else
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "A4a-ios-" + name
        #endif
        attachment.lifetime = .keepAlways; add(attachment)
    }
}
