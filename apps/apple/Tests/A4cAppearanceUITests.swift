import XCTest

final class A4cAppearanceUITests: XCTestCase {
    @MainActor func testLightAppearance() async throws { try await capture(style: "light") }
    @MainActor func testAccessibilityAppearance() async throws { try await capture(style: "accessibility") }
    @MainActor func testDarkAppearance() async throws { try await capture(style: "dark") }

    @MainActor private func capture(style: String) async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        for scenario in ["running", "completed", "approval"] {
            let port = scenario == "approval" ? 18764 : 18766
            try await post(port: port, path: "reset")
            if scenario != "approval" { try await post(port: port, path: "scenario", body: ["scenario": scenario, "mode": style == "accessibility" && scenario == "running" ? "accept-edits" : "auto"]) }
            app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "a4c-" + UUID().uuidString.prefix(8),
                scenario == "approval" ? "--a4a-local-server" : "--a4b-local-server", "--server-url", "http://localhost:\(port)"]
            app.launch()
            let row = app.descendants(matching: .any).matching(identifier: "conversationRow.session-fixture").firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 30))
            if scenario == "running" {
                XCTAssertFalse(app.descendants(matching: .any)["spiritNavigation"].exists)
                screenshot(app, "\(style)-list")
            }
            row.tap()
            let draft = app.textFields["conversationDraft"]
            XCTAssertTrue(draft.waitForExistence(timeout: 20))
            XCTAssertEqual(draft.placeholderValue, "向 WeftMate 说说你的目标")
            XCTAssertFalse(app.staticTexts["本账户的本机草稿"].exists)
            assertComposerFits(app)
            if scenario == "running" {
                XCTAssertTrue(app.buttons["executionBlock.3"].waitForExistence(timeout: 20))
                XCTAssertEqual(app.buttons["executionBlock.3"].value as? String, "已收起")
            } else if scenario == "completed" {
                XCTAssertTrue(app.buttons["memoryUsed.3"].waitForExistence(timeout: 20))
            } else {
                XCTAssertTrue(app.buttons["approveOnce.00000001-1111-4111-8111-111111111111"].waitForExistence(timeout: 20))
                XCTAssertTrue(app.buttons["approveCategory.00000001-1111-4111-8111-111111111111"].isEnabled)
                XCTAssertTrue(app.buttons["rejectApproval.00000001-1111-4111-8111-111111111111"].isEnabled)
            }
            screenshot(app, "\(style)-\(scenario)")
            if style == "accessibility", scenario == "running" {
                app.buttons["approvalMode"].tap()
                let menu = app.scrollViews["approvalModeMenu"]
                XCTAssertTrue(menu.waitForExistence(timeout: 10))
                menu.swipeUp()
                XCTAssertTrue(app.buttons["approvalModeOption.allow-all"].isHittable)
                screenshot(app, "accessibility-modes")
                app.terminate(); continue
            }
            if scenario == "completed" {
                draft.tap(); draft.typeText("Continue with the next step")
                XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
                XCTAssertLessThanOrEqual(app.buttons["sendButton"].frame.maxY, app.keyboards.firstMatch.frame.minY)
                screenshot(app, "\(style)-keyboard")
                app.buttons["openConversationResources"].tap()
                XCTAssertTrue(app.buttons["resourceSource.tool:read"].waitForExistence(timeout: 10))
                XCTAssertTrue(app.buttons["resourceOutput.artifact-new"].exists)
                screenshot(app, "\(style)-outputs-sources")
                app.buttons["resourceSource.tool:read"].tap()
                XCTAssertTrue(app.staticTexts["调用 2 次"].waitForExistence(timeout: 10))
                screenshot(app, "\(style)-source")
                app.buttons["closeResourcesPanel"].tap()
                XCTAssertTrue(draft.waitForExistence(timeout: 10))
                XCTAssertEqual(draft.value as? String, "Continue with the next step")
                app.buttons["previewArtifact.2"].tap()
                XCTAssertTrue(app.descendants(matching: .any)["attachmentTextContent"].waitForExistence(timeout: 10))
                screenshot(app, "\(style)-output")
            }
            app.terminate()
        }
    }

    @MainActor func testAppearanceChoicePersistsAndFollowsSystem() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "a4c-preferences-" + UUID().uuidString.prefix(8),
            "--a4b-local-server", "--server-url", "http://localhost:18766"]
        app.launch()
        try await openSettings(app)
        choose("深色", app: app)
        screenshot(app, "appearance-dark-override")
        app.terminate(); app.launch()
        try await openSettings(app)
        XCTAssertEqual(app.segmentedControls["appearancePicker"].buttons["深色"].value as? String, "1")
        choose("浅色", app: app)
        screenshot(app, "appearance-light-override")
        choose("跟随系统", app: app)
        screenshot(app, "appearance-system")
    }
    @MainActor private func openSettings(_ app: XCUIApplication) async throws {
        XCTAssertTrue(app.buttons["phoneAccountMenu"].waitForExistence(timeout: 30)); app.buttons["phoneAccountMenu"].tap()
        let settings = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@ OR label == %@", "phoneMenu.settings", "设置")).firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 5)); settings.tap()
        XCTAssertTrue(app.buttons["settingsCategory.appearance"].waitForExistence(timeout: 5)); app.buttons["settingsCategory.appearance"].tap()
        let picker = app.descendants(matching: .any).matching(identifier: "appearancePicker").firstMatch
        for _ in 0..<6 { if picker.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(picker.isHittable)
    }
    @MainActor private func choose(_ title: String, app: XCUIApplication) {
        app.segmentedControls["appearancePicker"].buttons[title].tap()
    }
    @MainActor private func assertComposerFits(_ app: XCUIApplication) {
        let bounds = app.windows.firstMatch.frame
        for id in ["sendButton", "approvalMode"] {
            let control = app.buttons[id]
            XCTAssertGreaterThanOrEqual(control.frame.minX, bounds.minX, id)
            XCTAssertLessThanOrEqual(control.frame.maxX, bounds.maxX, id)
            XCTAssertLessThanOrEqual(control.frame.maxY, bounds.maxY, id)
        }
    }
    @MainActor private func post(port: Int, path: String, body: [String: String] = [:]) async throws {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/personal/v1/test/\(path)")!)
        request.httpMethod = "POST"; request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
    }
    @MainActor private func screenshot(_ app: XCUIApplication, _ name: String) {
        // Let native glass / text editing decoration settle before comparing pixels.
        // The app is a separate process; test assertions and capture pixels are unchanged.
        Thread.sleep(forTimeInterval: 2)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "A4c-" + name
        attachment.lifetime = .keepAlways; add(attachment)
    }
}
