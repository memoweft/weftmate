import XCTest

final class Apple4UITests: XCTestCase {
    @MainActor private func choose(_ app: XCUIApplication, _ value: String) throws {
        let menu = app.buttons["apple4.scenarios"]
        XCTAssertTrue(menu.waitForExistence(timeout: 15)); menu.tap()
        let option = app.buttons[value].firstMatch
        guard option.waitForExistence(timeout: 10) else { throw NSError(domain: "Apple4UI", code: 1) }
        option.tap()
    }
    @MainActor private func capture(_ app: XCUIApplication, _ theme: String, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "apple4-" + theme + "-" + name; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testSmallScreenRefreshBatch() throws {
        let origin = ProcessInfo.processInfo.environment["WEFTMATE_APPLE3_ORIGIN"]!
        for theme in ["light", "dark"] {
            let app = XCUIApplication()
            app.launchArguments = ["--ui-testing", "--apple4-fixture", "--health4-render-only", "--a5-local-server", "--server-url", origin,
                "--ui-testing-namespace", "apple4-" + UUID().uuidString, "--a5-theme", theme, theme]
            app.launch()
            XCTAssertTrue(app.staticTexts["这一段正在生成，这是最终完整回复。"].waitForExistence(timeout: 35))
            XCTAssertTrue(app.buttons["mainChat.plus"].frame.width >= 44)
            capture(app, theme, "content")
            try choose(app, "empty")
            XCTAssertTrue(app.staticTexts["从这里开始"].waitForExistence(timeout: 20)); capture(app, theme, "empty")
            let draft = app.descendants(matching: .any)["mainChat.draft"]
            XCTAssertTrue(draft.waitForExistence(timeout: 10)); draft.tap()
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10)); capture(app, theme, "composer-focus")
            app.buttons["mainChat.menu"].tap()
            XCTAssertTrue(app.buttons["mainChat.date"].waitForExistence(timeout: 10)); capture(app, theme, "overflow-menu")
            // Opening a sheet dismisses the native menu and keyboard without global simulator settings.
            app.buttons["mainChat.resources"].tap()
            XCTAssertTrue(app.buttons["phoneSheet.close"].waitForExistence(timeout: 20)); capture(app, theme, "sheet")
            app.buttons["phoneSheet.close"].tap()
            try choose(app, "stream")
            XCTAssertTrue(app.staticTexts["这一段正在生成，文字正在继续。"].waitForExistence(timeout: 25)); capture(app, theme, "stream")
            for value in ["aligned", "warning"] {
                try choose(app, value)
                XCTAssertTrue(app.descendants(matching: .any)["approvalSecondOpinion"].waitForExistence(timeout: 20))
                let approve = app.buttons["approveOnce.apple3-" + value], reject = app.buttons["rejectApproval.apple3-" + value]
                XCTAssertTrue(approve.exists && reject.exists)
                XCTAssertEqual(approve.frame.minY, reject.frame.minY, accuracy: 1)
                XCTAssertGreaterThanOrEqual(approve.frame.height, 44)
                capture(app, theme, value)
            }
            try choose(app, "final")
            XCTAssertTrue(app.buttons["phone.sidebar"].waitForExistence(timeout: 20)); app.buttons["phone.sidebar"].tap()
            XCTAssertTrue(app.textFields["phone.sidebar.search"].waitForExistence(timeout: 10)); capture(app, theme, "sidebar")
            app.buttons["phoneAccountMenu"].firstMatch.tap()
            XCTAssertTrue(app.buttons["settings.accountCard"].waitForExistence(timeout: 20)); capture(app, theme, "settings")
            app.buttons["closeAuxiliarySheetButton"].firstMatch.tap()
            app.buttons["phone.sidebar.close"].tap()
            for tab in ["chat", "activity", "health", "goals", "resources"] {
                let button = app.buttons["phone.tab." + tab]
                XCTAssertTrue(button.waitForExistence(timeout: 15)); button.tap()
                XCTAssertGreaterThanOrEqual(button.frame.width, 44)
                XCTAssertTrue(button.isSelected); capture(app, theme, "tab-" + tab)
            }
            app.terminate()
        }
    }
}
