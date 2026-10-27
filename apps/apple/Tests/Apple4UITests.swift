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
            let banner = XCUIApplication(bundleIdentifier: "com.apple.springboard").descendants(matching: .any)["NotificationShortLookView"]
            if banner.exists { XCTAssertTrue(banner.waitForNonExistence(timeout: 15)) }
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
            app.buttons["输出与来源"].firstMatch.tap()
            XCTAssertTrue(PhoneChatTestSupport.resourcesBack(app).waitForExistence(timeout:20))
            XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 10)); capture(app, theme, "sheet")
            PhoneChatTestSupport.returnFromResources(app)
            try choose(app, "stream")
            XCTAssertTrue(app.descendants(matching:.any).matching(NSPredicate(format:"label == %@ OR value == %@","这一段正在生成，文字正在继续。","这一段正在生成，文字正在继续。")).firstMatch.waitForExistence(timeout: 25)); capture(app, theme, "stream")
            for value in ["aligned", "warning"] {
                try choose(app, value)
                PhoneChatTestSupport.openPending(app)
                XCTAssertTrue(app.descendants(matching: .any)["approvalSecondOpinion"].waitForExistence(timeout: 20))
                let approve = app.buttons["approveOnce.apple3-" + value], reject = app.buttons["rejectApproval.apple3-" + value]
                XCTAssertTrue(approve.exists && reject.exists)
                XCTAssertGreaterThan(reject.frame.minY,approve.frame.minY)
                XCTAssertGreaterThanOrEqual(approve.frame.height, 44)
                capture(app, theme, value)
                app.buttons["phoneSheet.close"].tap()
            }
            try choose(app, "files")
            XCTAssertTrue(app.buttons["replyFiles.expand"].waitForExistence(timeout: 20))
            let fileMenu = app.buttons["replyFileMenu.10"]
            XCTAssertTrue(fileMenu.exists); XCTAssertGreaterThanOrEqual(fileMenu.frame.width, 44); XCTAssertGreaterThanOrEqual(fileMenu.frame.height, 44)
            capture(app, theme, "files-collapsed")
            try choose(app, "final")
            XCTAssertTrue(app.buttons["phone.sidebar"].waitForExistence(timeout: 20)); app.buttons["phone.sidebar"].tap()
            XCTAssertTrue(app.textFields["phone.sidebar.search"].waitForExistence(timeout: 10)); capture(app, theme, "sidebar")
            let sidebar = app.descendants(matching: .any)["phone.sidebar.panel"]
            sidebar.buttons["phone.sidebar.settings"].firstMatch.tap()
            XCTAssertTrue(app.buttons["settings.accountCard"].waitForExistence(timeout: 20)); capture(app, theme, "settings")
            app.buttons["closeAuxiliarySheetButton"].firstMatch.tap()
            for tab in ["chat", "activity", "health"] {
                let button = app.buttons["phone.tab." + tab]
                XCTAssertTrue(button.waitForExistence(timeout: 15)); button.tap()
                XCTAssertGreaterThanOrEqual(button.frame.width, 44)
                XCTAssertTrue(button.isSelected); capture(app, theme, "tab-" + tab)
            }
            app.terminate()
        }
    }
    @MainActor func testPanelAndSideChatPolishBatch() throws {
        let origin = ProcessInfo.processInfo.environment["WEFTMATE_APPLE3_ORIGIN"]!
        for theme in ["light", "dark"] {
            let app = XCUIApplication()
            app.launchArguments = ["--ui-testing", "--apple4-fixture", "--health4-render-only", "--a5-local-server", "--server-url", origin,
                "--ui-testing-namespace", "apple4-panels-" + UUID().uuidString, "--a5-theme", theme, theme]
            app.launch()
            XCTAssertTrue(app.buttons["mainChat.menu"].waitForExistence(timeout: 35))
            app.buttons["mainChat.menu"].tap(); app.buttons["输出与来源"].firstMatch.tap()
            XCTAssertTrue(PhoneChatTestSupport.resourcesBack(app).waitForExistence(timeout:20))
            XCTAssertTrue(app.navigationBars["对话中的内容"].exists)
            XCTAssertTrue(app.staticTexts["成果"].exists && app.staticTexts["来源"].exists && app.staticTexts["过程"].exists)
            capture(app, theme, "resources"); PhoneChatTestSupport.returnFromResources(app)
            app.buttons["phone.sidebar"].tap(); app.buttons["phone.sidebar.library"].tap(); capture(app, theme, "tab-resources")
            app.buttons["phone.tab.activity"].tap()
            XCTAssertTrue(app.staticTexts["每周的回顾会出现在这里。"].waitForExistence(timeout: 15)); capture(app, theme, "tab-activity")
            app.buttons["phone.tab.chat"].tap(); app.buttons["phone.tab.chat"].tap(); app.buttons["phone.sidebar"].tap()
            let sidebar = app.descendants(matching: .any)["phone.sidebar.panel"]
            sidebar.buttons["phone.sidebar.settings"].firstMatch.tap()
            XCTAssertTrue(app.buttons["settings.accountCard"].waitForExistence(timeout: 20))
            let logout = app.buttons["settings.logout"]
            for _ in 0..<8 where !logout.isHittable { app.swipeUp() }
            XCTAssertTrue(logout.isHittable); capture(app, theme, "settings-bottom")
            app.buttons["closeAuxiliarySheetButton"].firstMatch.tap()
            try choose(app, "side")
            XCTAssertTrue(app.staticTexts["可以先留出一段时间散步，再读几页书。"].waitForExistence(timeout: 25))
            XCTAssertTrue(app.buttons["sendButton"].exists)
            app.buttons["addAttachmentButton"].tap(); XCTAssertTrue(app.buttons["contextUsage"].waitForExistence(timeout:10)); app.coordinate(withNormalizedOffset:CGVector(dx:0.9,dy:0.3)).tap()
            capture(app, theme, "side-chat")
            app.buttons["conversationMenu"].tap(); app.buttons["openConversationResources"].tap()
            XCTAssertTrue(PhoneChatTestSupport.resourcesBack(app).waitForExistence(timeout: 20))
            XCTAssertTrue(app.navigationBars["对话中的内容"].exists); capture(app, theme, "side-sheet")
            PhoneChatTestSupport.returnFromResources(app); app.terminate()
        }
    }

}
