import XCTest

/// Synthetic phone identity only; these tests never submit credentials or account changes.
final class IOSUISettingsUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    @MainActor private func control(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }
    @MainActor private func tap(_ app: XCUIApplication, _ id: String) {
        let item = control(app, id)
        _ = item.waitForExistence(timeout: 3)
        for _ in 0..<8 {
            if item.exists && item.isHittable { break }
            app.coordinate(withNormalizedOffset:CGVector(dx:0.98,dy:0.78)).press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:CGVector(dx:0.98,dy:0.28)))
        }
        XCTAssertTrue(item.waitForExistence(timeout:20),id)
        XCTAssertTrue(item.isHittable,id)
        item.tap()
    }
    @MainActor private func shot(_ app: XCUIApplication, _ page: String, _ theme: String) {
        Thread.sleep(forTimeInterval:1)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = page + "-" + theme
        attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor private func launch(_ theme: String, preview: Bool = true, authPage: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--apple11-fixture", "--ios-ui-shell-fixture", "--health4-render-only", "--ui-testing-namespace", "ios-ui-4-" + UUID().uuidString, "--a5-theme", theme]
        if preview { app.launchArguments.append("--ios-ui-settings-preview") }
        if theme == "dark" { app.launchArguments.append("--apple11-dark") }
        if let authPage { app.launchArguments += ["--ios-ui-auth-page", authPage] }
        app.launch()
        let sidebar = control(app, "phoneChat.sidebar")
        XCTAssertTrue(sidebar.waitForExistence(timeout: 30)); sidebar.tap()
        tap(app, "phone.sidebar.settings")
        XCTAssertTrue(control(app, "settings.accountCard").waitForExistence(timeout: 20))
        return app
    }
    @MainActor private func category(_ app: XCUIApplication, _ id: String, query: String) {
        let search = app.textFields["settingsSearch"]
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        if control(app, "settings.clearSearch").exists { tap(app, "settings.clearSearch") }
        search.tap(); search.typeText(query + "\n")
        tap(app, "settingsCategory." + id)
        XCTAssertTrue(control(app, "settingsPage." + id).waitForExistence(timeout: 10))
    }
    @MainActor func testSettingsSystemAndAppearanceAreReachableInBothThemes() {
        for theme in ["light", "dark"] {
            let app = launch(theme)
            shot(app, "settings", theme)
            category(app, "system", query: "系统")
            shot(app, "system", theme)
            XCTAssertTrue(control(app,"settings.system.connection").label.contains("还没连接电脑"))
            XCTAssertFalse(app.buttons["重启修复"].exists)
            app.navigationBars.buttons.firstMatch.tap()
            category(app, "appearance", query: "外观")
            shot(app, "appearance", theme)
            XCTAssertTrue(control(app, "settings.reduceMotion").exists)
            app.terminate()
        }
    }
    @MainActor func testGeneralModelEditorAndOfflineSettingsKeepTheirRoutes() {
        for theme in ["light", "dark"] {
            let app = launch(theme)
            for (id, query) in [("general", "常规"), ("models", "模型"), ("usage", "用量"), ("approvals", "审批"), ("archived", "已归档")] {
                category(app, id, query: query)
                shot(app, id, theme)
                if id == "models" {
                    tap(app, "modelServices.new"); shot(app, "model-edit", theme)
                    XCTAssertTrue(control(app, "modelServices.address").exists)
                    app.navigationBars.buttons.firstMatch.tap()
                }
                app.navigationBars.buttons.firstMatch.tap()
            }
            app.terminate()
        }
    }
    @MainActor func testAccountPushesFormsAndKeepsDestructiveActionsBehindConfirmation() {
        for theme in ["light", "dark"] {
            let app = launch(theme)
            tap(app, "settings.accountCard"); shot(app, "account", theme)
            tap(app, "account.changeEmail"); shot(app, "change-email", theme)
            XCTAssertFalse(app.buttons["account.confirmEmail"].isEnabled)
            app.navigationBars.buttons.firstMatch.tap()
            tap(app, "account.changePassword"); shot(app, "change-password", theme)
            XCTAssertFalse(app.buttons["account.savePassword"].isEnabled)
            app.navigationBars.buttons.firstMatch.tap()
            tap(app, "account.logoutOthers")
            XCTAssertTrue(app.buttons["取消"].waitForExistence(timeout: 10)); app.buttons["取消"].tap()
            app.terminate()
        }
    }
    @MainActor func testDevicesUseAnchoredMenuAndManualPairingRejectsInvalidCode() {
        for theme in ["light", "dark"] {
            let app = launch(theme)
            category(app, "devices", query: "设备"); shot(app, "devices", theme)
            tap(app, "computer.actions.preview-computer")
            XCTAssertTrue(app.buttons["computer.rename.preview-computer"].waitForExistence(timeout: 10))
            XCTAssertTrue(app.buttons["computer.remove.preview-computer"].exists)
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.2)).tap()
            tap(app, "devices.addComputer"); shot(app, "pairing", theme)
            tap(app, "pairing.manual")
            let code = app.textFields["cloudPairingText"].exists ? app.textFields["cloudPairingText"] : app.textViews["cloudPairingText"]
            XCTAssertTrue(code.waitForExistence(timeout: 10)); code.tap(); code.typeText("invalid-synthetic-code")
            tap(app, "pairing.preview")
            XCTAssertFalse(control(app, "pairing.confirmPage").exists)
            XCTAssertTrue(app.staticTexts["配对码无效或不属于这个账号的电脑。请在电脑上重新生成后重试。"].exists)
            app.terminate()
        }
    }
    @MainActor func testLoginRegistrationRecoveryAndVerificationHaveSeparatePages() {
        for theme in ["light", "dark"] {
            for page in ["login", "register", "recovery", "verify"] {
                let app = launch(theme, preview: false, authPage: page)
                tap(app, "settings.accountCard"); shot(app, page, theme)
                XCTAssertTrue(control(app, "authRoot").waitForExistence(timeout: 10))
                if page == "verify" {
                    XCTAssertTrue(app.textFields["accountCode"].exists)
                    XCTAssertFalse(app.buttons["accountSubmit"].isEnabled)
                    XCTAssertTrue(app.buttons["accountResend"].exists)
                    XCTAssertFalse(app.buttons["accountResend"].isEnabled)
                }
                app.terminate()
            }
        }
    }
    @MainActor func testAboutLegalAndLogPreviewUseTheSettingsStack() {
        for theme in ["light","dark"] {
            let app = launch(theme)
            category(app, "about", query: "关于"); shot(app, "about", theme)
            tap(app, "settings.legal"); shot(app, "legal", theme)
            app.buttons["服务条款"].tap()
            XCTAssertTrue(app.navigationBars["服务条款"].waitForExistence(timeout: 10))
            app.navigationBars.buttons.firstMatch.tap(); app.navigationBars.buttons.firstMatch.tap()
            tap(app, "openRunLog"); shot(app, "diagnostics", theme)
            XCTAssertTrue(control(app, "runLog.recording").exists)
            tap(app, "runLog.clear")
            XCTAssertTrue(app.buttons["runLog.confirmClear"].waitForExistence(timeout: 10))
            app.buttons["取消"].tap()
            app.terminate()
        }
    }
}
