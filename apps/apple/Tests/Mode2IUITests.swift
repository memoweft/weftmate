import XCTest

final class Mode2IUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    @MainActor private func capture(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "mode2i-" + name; shot.lifetime = .keepAlways; add(shot)
    }
    @MainActor private func connected(_ theme: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--apple-contract-fixture", "--mode2i-fixture", "--server-url", "https://a2-ui.unit.example",
                               "--ui-testing-namespace", "mode2i-" + UUID().uuidString, "--a5-theme", theme]
        app.launch(); return app
    }
    @MainActor func testWorkSelectionNormalStateScreenshots() throws {
        for theme in ["light","dark"] {
            let app=connected(theme)
            XCTAssertTrue(app.buttons["phone.sidebar"].waitForExistence(timeout:30))
            app.buttons["phone.sidebar"].tap();app.buttons["phone.mode.work"].tap();app.buttons["phone.sidebar.new"].tap()
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
            app.buttons["phone.sidebar"].tap()
            XCTAssertTrue(app.buttons["phone.mode.chat"].waitForExistence(timeout: 5))
            app.buttons["phone.mode.chat"].tap()
            XCTAssertTrue(app.buttons["computer.conversation.host-fixture|main"].exists)
            capture(theme + "-chat-list")
            app.buttons["phone.mode.work"].tap()
            XCTAssertTrue(app.buttons["computer.conversation.host-fixture|work"].waitForExistence(timeout: 5))
            XCTAssertFalse(app.buttons["computer.conversation.host-fixture|main"].exists)
            capture(theme + "-work-list")
            app.buttons["phone.sidebar.new"].tap()
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
            app.buttons["phone.sidebar"].tap(); app.buttons["phone.mode.chat"].tap()
            app.buttons["computer.conversation.host-fixture|main"].tap()
            XCTAssertTrue(app.buttons["phone.work.accept"].waitForExistence(timeout: 20))
            XCTAssertFalse(app.buttons["phone.work.accept"].isEnabled)
            capture(theme + "-switch-card")
            app.buttons["phone.work.project"].firstMatch.tap(); app.buttons["phone.work.project.project-a"].tap()
            app.buttons["phone.work.accept"].tap()
            XCTAssertTrue(app.staticTexts["请整理这份合成资料"].waitForExistence(timeout: 10))
            app.buttons["phone.sidebar"].tap()
            XCTAssertEqual(app.buttons["phone.mode.work"].value as? String, "已选择")
            XCTAssertTrue(app.buttons["computer.conversation.host-fixture|main"].waitForExistence(timeout: 5))
            capture(theme + "-converted-history-list")
            app.terminate()

            let rejected = connected(theme)
            XCTAssertTrue(rejected.buttons["phone.sidebar"].waitForExistence(timeout: 30))
            rejected.buttons["phone.sidebar"].tap(); rejected.buttons["phone.mode.chat"].tap()
            rejected.buttons["computer.conversation.host-fixture|main"].tap()
            XCTAssertTrue(rejected.buttons["phone.work.reject"].waitForExistence(timeout: 20))
            rejected.buttons["phone.work.reject"].tap()
            rejected.buttons["phone.sidebar"].tap()
            XCTAssertEqual(rejected.buttons["phone.mode.chat"].value as? String, "已选择")
            rejected.terminate()

            let local = XCUIApplication()
            local.launchArguments = ["--ui-testing", "--apple9-fixture", "--apple9-scene", "one", "--apple9-theme", theme,
                                     "--ui-testing-namespace", "mode2i-local-" + UUID().uuidString]
            local.launch()
            XCTAssertTrue(local.buttons["phoneChat.sidebar"].waitForExistence(timeout: 20))
            capture(theme + "-standalone-chat")
            local.buttons["phoneChat.sidebar"].tap(); local.buttons["phone.mode.work"].tap()
            XCTAssertTrue(local.staticTexts["连上电脑后可以让它动手"].waitForExistence(timeout: 5))
            XCTAssertFalse(local.buttons["phoneChat.new"].isEnabled)
            capture(theme + "-standalone-work-info")
            local.terminate()
        }
    }
}
