import XCTest

final class Mode2IUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    @MainActor private func capture(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "mode2i-" + name; shot.lifetime = .keepAlways; add(shot)
    }
    @MainActor private func openSidebar(_ app: XCUIApplication) throws {
        let query=app.buttons.matching(identifier:"phone.sidebar")
        let predicate=NSPredicate { _,_ in query.allElementsBoundByIndex.contains { $0.isHittable } }
        XCTAssertEqual(XCTWaiter.wait(for:[XCTNSPredicateExpectation(predicate:predicate,object:app)],timeout:10),.completed)
        let button=try XCTUnwrap(query.allElementsBoundByIndex.first { $0.isHittable })
        button.tap()
    }
    @MainActor private func openDirectory(_ app: XCUIApplication) throws {
        try openSidebar(app)
        app.buttons["phone.sidebar.conversations"].tap()
        XCTAssertTrue(app.buttons["phone.mode.chat"].waitForExistence(timeout: 10))
    }
    @MainActor private func createWork(_ app: XCUIApplication) throws {
        try openSidebar(app)
        app.buttons["phone.sidebar.new"].tap(); app.buttons["phone.sidebar.newWork"].tap()
    }
    @MainActor private func connected(_ theme: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--apple-contract-fixture", "--mode2i-fixture", "--health4-render-only", "--server-url", "https://a2-ui.unit.example",
                               "--ui-testing-namespace", "mode2i-" + UUID().uuidString, "--a5-theme", theme]
        app.launch(); return app
    }
    @MainActor func testFix4ActualDisconnectedChatOffersOfflineWork() throws {
        let app=XCUIApplication()
        app.launchArguments=["--ui-testing","--apple-contract-fixture","--mode2i-fixture","--mode2i-offline","--server-url","https://a2-ui.unit.example","--ui-testing-namespace","mode2i-fix4-"+UUID().uuidString]
        app.launch()
        XCTAssertTrue(app.otherElements["offlineChat"].waitForExistence(timeout:30))
        XCTAssertTrue(app.buttons["offlineWork.open"].waitForExistence(timeout:5))
        app.buttons["offlineWork.open"].tap()
        XCTAssertTrue(app.descendants(matching:.any).matching(identifier:"phone.work.offline").firstMatch.waitForExistence(timeout:5))
        XCTAssertTrue(app.buttons["选择工作对话"].exists)
        XCTAssertTrue(app.buttons["phoneSheet.close"].exists)
        app.terminate()
    }
    @MainActor func testHealthDetailSurvivesTabSwitchAndReselectReturnsToRoot() throws {
        let app = connected("light"); defer { app.terminate() }
        XCTAssertTrue(app.buttons["phone.tab.health"].waitForExistence(timeout: 30))
        app.buttons["phone.tab.health"].tap()
        let score = app.buttons["health.score.sleep"]
        XCTAssertTrue(score.waitForExistence(timeout: 20))
        for _ in 0..<4 where !score.isHittable { app.swipeUp() }
        score.tap()
        let range = app.segmentedControls["health.range"]
        XCTAssertTrue(range.waitForExistence(timeout: 10))
        range.buttons["14 天"].tap()
        app.buttons["phone.tab.chat"].tap()
        let draft = app.descendants(matching: .any).matching(identifier: "phone.new.text").firstMatch
        XCTAssertTrue(draft.waitForExistence(timeout: 10))
        XCTAssertTrue(draft.isHittable, "The active chat must receive touches above the retained health stack")
        draft.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        // Isolate navigation/input ownership from the system IME; Chinese input is also covered by the standalone shell journey.
        let expectedDraft = "709-health-draft"
        draft.typeText(expectedDraft)
        let entered = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", expectedDraft), object: draft)
        XCTAssertEqual(XCTWaiter.wait(for: [entered], timeout: 10), .completed, "Verify committed input before testing tab retention")
        try openSidebar(app); app.buttons["phone.sidebar.close"].tap()
        XCTAssertTrue(app.buttons["phone.tab.health"].waitForExistence(timeout: 10))
        app.buttons["phone.tab.health"].tap()
        XCTAssertTrue(range.waitForExistence(timeout: 10))
        XCTAssertTrue(range.buttons["14 天"].isSelected, "Health detail selection must survive a tab switch")
        app.buttons["phone.tab.health"].tap()
        XCTAssertFalse(range.exists)
        XCTAssertTrue(app.buttons["health.ask"].waitForExistence(timeout: 10))
        app.buttons["phone.tab.chat"].tap()
        XCTAssertTrue(draft.waitForExistence(timeout: 10))
        XCTAssertEqual(draft.value as? String, expectedDraft)
    }
    @MainActor func testFix5HealthFollowupPopulatesNewChatInput() throws {
        let app=connected("light")
        XCTAssertTrue(app.descendants(matching:.any).matching(identifier:"phone.new.text").firstMatch.waitForExistence(timeout:30))
        app.buttons["phone.tab.health"].tap()
        XCTAssertTrue(app.buttons["health.ask"].waitForExistence(timeout:20))
        app.buttons["health.ask"].tap()
        let input=app.descendants(matching:.any).matching(identifier:"phone.new.text").firstMatch
        XCTAssertTrue(input.waitForExistence(timeout:10))
        XCTAssertEqual(input.value as? String,"合成健康追问内容")
        app.terminate()
    }
    @MainActor func testWorkSelectionNormalStateScreenshots() throws {
        for theme in ["light","dark"] {
            let app=connected(theme)
            XCTAssertTrue(app.buttons["phone.sidebar"].waitForExistence(timeout:30))
            try createWork(app)
            XCTAssertTrue(app.buttons["phone.work.project"].waitForExistence(timeout:5))
            let mode=app.buttons["defaultApprovalMode"]
            XCTAssertEqual(mode.value as? String,"每次询问")
            XCTAssertFalse(app.staticTexts["审批模式未能核对，请重新连接后读取。"].exists)
            app.buttons["phone.work.project"].tap();app.buttons["phone.work.project.project-b"].tap()
            capture(theme+"-work-selection")
            app.buttons["phone.work.computer"].tap()
            XCTAssertTrue(app.buttons["随身电脑"].exists)
            XCTAssertFalse(app.buttons["备用电脑 · 不在线"].isEnabled)
            capture(theme+"-computer-choice")
            app.terminate()
        }
    }
    @MainActor func testModesCreationSwitchAndStandaloneScreens() throws {
        for theme in ["light", "dark"] {
            let app = connected(theme)
            XCTAssertTrue(app.descendants(matching:.any).matching(identifier:"phone.new.text").firstMatch.waitForExistence(timeout: 30))
            capture(theme + "-new-chat")
            try openDirectory(app)
            XCTAssertTrue(app.buttons["phone.mode.chat"].waitForExistence(timeout: 5))
            app.buttons["phone.mode.chat"].tap()
            XCTAssertTrue(app.buttons["computer.conversation.host-fixture|main"].exists)
            capture(theme + "-chat-list")
            app.buttons["phone.mode.work"].tap()
            XCTAssertTrue(app.buttons["computer.conversation.host-fixture|work"].waitForExistence(timeout: 5))
            XCTAssertFalse(app.buttons["computer.conversation.host-fixture|main"].exists)
            capture(theme + "-work-list")
            try createWork(app)
            XCTAssertTrue(app.buttons["phone.work.project"].waitForExistence(timeout: 5))
            XCTAssertTrue(app.buttons["phone.work.computer"].exists)
            app.buttons["phone.work.computer"].tap()
            XCTAssertTrue(app.buttons["随身电脑"].exists)
            XCTAssertFalse(app.buttons["备用电脑 · 不在线"].isEnabled)
            capture(theme+"-computer-choice")
            app.buttons["工作电脑"].tap()
            XCTAssertFalse(app.buttons["phone.new.send"].isEnabled)
            app.buttons["phone.work.project"].tap()
            app.buttons["phone.work.project.project-b"].tap()
            capture(theme + "-work-selection")
            app.descendants(matching:.any).matching(identifier:"phone.new.text").firstMatch.tap(); app.descendants(matching:.any).matching(identifier:"phone.new.text").firstMatch.typeText("整理合成周报")
            app.buttons["phone.new.send"].tap()
            XCTAssertTrue(app.descendants(matching:.any).matching(identifier:"mainChat.draft").firstMatch.waitForExistence(timeout: 20))
            capture(theme + "-created-work")
            try openDirectory(app); app.buttons["phone.mode.chat"].tap()
            app.buttons["computer.conversation.host-fixture|main"].tap()
            XCTAssertTrue(app.buttons["phone.work.accept"].waitForExistence(timeout: 20))
            XCTAssertFalse(app.buttons["phone.work.accept"].isEnabled)
            capture(theme + "-switch-card")
            app.buttons["phone.work.project"].firstMatch.tap(); app.buttons["phone.work.project.project-a"].tap()
            app.buttons["phone.work.accept"].tap()
            // Synthetic history is intentionally dated; older days start collapsed.
            let history = app.buttons["mainChat.day.2026-10-14"]
            XCTAssertTrue(history.waitForExistence(timeout: 10))
            if history.value as? String == "已折叠" { history.tap() }
            XCTAssertTrue(app.staticTexts["请整理这份合成资料"].waitForExistence(timeout: 10))
            try openDirectory(app)
            XCTAssertEqual(app.buttons["phone.mode.work"].value as? String, "已选择")
            XCTAssertTrue(app.buttons["computer.conversation.host-fixture|main"].waitForExistence(timeout: 5))
            capture(theme + "-converted-history-list")
            app.terminate()

            let rejected = connected(theme)
            XCTAssertTrue(rejected.buttons["phone.sidebar"].waitForExistence(timeout: 30))
            try openDirectory(rejected); rejected.buttons["phone.mode.chat"].tap()
            rejected.buttons["computer.conversation.host-fixture|main"].tap()
            XCTAssertTrue(rejected.buttons["phone.work.reject"].waitForExistence(timeout: 20))
            rejected.buttons["phone.work.reject"].tap()
            try openDirectory(rejected)
            XCTAssertEqual(rejected.buttons["phone.mode.chat"].value as? String, "已选择")
            rejected.terminate()

            let local = XCUIApplication()
            local.launchArguments = ["--ui-testing", "--apple9-fixture", "--apple9-scene", "one", "--apple9-theme", theme,
                                     "--ui-testing-namespace", "mode2i-local-" + UUID().uuidString]
            local.launch()
            XCTAssertTrue(local.buttons["phoneChat.sidebar"].waitForExistence(timeout: 20))
            capture(theme + "-standalone-chat")
            local.buttons["phoneChat.sidebar"].tap(); local.buttons["phone.sidebar.new"].tap(); local.buttons["phone.sidebar.newWork"].tap()
            XCTAssertTrue(local.staticTexts["连上电脑后可以让它动手"].waitForExistence(timeout: 5))
            XCTAssertTrue(local.buttons["phone.back"].exists)
            capture(theme + "-standalone-work-info")
            local.terminate()
        }
    }
}
