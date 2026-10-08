import XCTest

/// No fake account endpoints: the runner launches cloud main, file mail and an isolated host.
final class LG2AccountUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    private var driver: String { ProcessInfo.processInfo.environment["WEFTMATE_LG2_DRIVER"]! }
    @MainActor private func get(_ path: String) async throws -> [String: String] {
        let (data, response) = try await URLSession.shared.data(from: URL(string: driver + path)!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw NSError(domain: "LG2Driver", code: 1) }
        return (try JSONSerialization.jsonObject(with: data) as? [String: String]) ?? [:]
    }
    @MainActor private func expect(_ element: XCUIElement, timeout: TimeInterval) throws {
        let found = element.waitForExistence(timeout: timeout)
        XCTAssertTrue(found, "Required account control is missing")
        guard found else { throw NSError(domain: "LG2UIExpectation", code: 1) }
    }
    @MainActor private func reveal(_ app: XCUIApplication, _ element: XCUIElement) {
        // Native Form virtualizes the newly added S1e rows; scroll by role/name until materialized.
        for up in [true, false] {
            for _ in 0..<6 {
                if element.exists && element.isHittable { return }
                if up { app.swipeUp() } else { app.swipeDown() }
            }
        }
    }
    @MainActor private func confirmIfNeeded(_ app: XCUIApplication) async throws {
        if app.textFields["accountCode"].waitForExistence(timeout: 5) {
            try fill(app, "accountCode", try await get("/code")["code"]!)
            try tap(app, "accountSubmit")
        }
    }
    @MainActor private func fill(_ app: XCUIApplication, _ id: String, _ value: String, secure: Bool = false) throws {
        let field = secure ? app.secureTextFields[id] : app.textFields[id]
        reveal(app, field)
        try expect(field, timeout: 15)
        field.tap(); field.typeText(value)
        if app.buttons["dismissAccountKeyboard"].exists { app.buttons["dismissAccountKeyboard"].tap() }
    }
    @MainActor private func tap(_ app: XCUIApplication, _ id: String) throws {
        let button = app.buttons[id]
        reveal(app, button)
        try expect(button, timeout: 15)
        button.tap()
    }
    @MainActor private func keep(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
    }
    @MainActor func testRealRegistrationApprovalConnectionRecoveryErrorAndLogout() async throws {
        let ready = try await get("/ready"), credentials = try await get("/credentials")
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "lg2-" + UUID().uuidString.prefix(8),
            "--lg2-cloud", "--server-url", ready["host"]!, "--s1c-cloud-url", ready["cloud"]!, "--s1c-qr-url", driver + "/pairing.png"]
        app.launch()
        try expect(app.staticTexts["登录 WeftMate"], timeout: 30)
        XCTAssertFalse(app.buttons["cloudScan"].exists)
        XCTAssertFalse(app.textFields["serverURL"].exists)
        keep(app, "ios-login")
        try fill(app, "accountEmail", credentials["email"]!)
        try fill(app, "accountPassword", UUID().uuidString, secure: true)
        try tap(app, "accountSubmit")
        try expect(app.staticTexts["邮箱或密码不对，请检查后重试。"], timeout: 20)
        keep(app, "ios-login-error")
        try tap(app, "accountRegistration")
        try tap(app, "《服务条款》")
        try expect(app.navigationBars["服务条款"], timeout: 10)
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "WeftMate 服务条款")).firstMatch.exists)
        try tap(app, "完成")
        try tap(app, "accountSubmit")
        try expect(app.textFields["accountCode"], timeout: 20)
        try fill(app, "accountCode", try await get("/code")["code"]!)
        try tap(app, "accountSubmit")
        try fill(app, "accountPassword", credentials["password"]!, secure: true)
        try fill(app, "accountRepeatedPassword", credentials["password"]!, secure: true)
        try tap(app, "accountSubmit")
        try expect(app.textFields["accountDeviceName"], timeout: 10)
        try tap(app, "accountSubmit")
        try expect(app.textFields["accountCode"], timeout: 20)
        try fill(app, "accountCode", try await get("/code")["code"]!)
        try tap(app, "accountSubmit")
        try expect(app.staticTexts["已登录 WeftMate"], timeout: 30)
        keep(app, "ios-registered")
        _ = try await get("/bootstrap")
        try tap(app, "设置 → 设备")
        try tap(app, "刷新设备")
        try expect(app.staticTexts["LG2 测试电脑"], timeout: 20)
        keep(app, "ios-devices")
        try tap(app, "connectHost." + ready["hostId"]!)
        try expect(app.descendants(matching: .any)["cloudPairingReady"].firstMatch, timeout: 30)
        try tap(app, "cloudRequestApproval")
        try expect(app.staticTexts["cloudWaiting"], timeout: 30)
        keep(app, "ios-waiting-approval")
        _ = try await get("/approve")
        try expect(app.descendants(matching: .any)["conversationList"].firstMatch, timeout: 30)
        keep(app, "ios-connected")
        // Keychain restore uses the same rotating family without asking for a password again.
        app.terminate(); app.launch()
        try expect(app.descendants(matching: .any)["conversationList"].firstMatch, timeout: 30)
        try tap(app, "phoneAccountMenu"); try tap(app, "phoneMenu.settings")
        try tap(app, "settingsCategory.account")
        try expect(app.staticTexts["signedInEmail"], timeout: 15)
        XCTAssertTrue(app.staticTexts["signedInEmail"].label.contains(credentials["email"]!))
        keep(app, "ios-account")
        try tap(app, "accountLogout")
        let logout = app.sheets.buttons.matching(NSPredicate(format: "label == %@ AND identifier != %@", "退出登录", "accountLogout")).firstMatch
        try expect(logout, timeout: 5); logout.tap()
        try expect(app.staticTexts["登录 WeftMate"], timeout: 30)
        try tap(app, "accountRecovery")
        // Successful logout retains only this form's email, never the password/code/ticket.
        if (app.textFields["accountEmail"].value as? String) != credentials["email"]! { try fill(app, "accountEmail", credentials["email"]!) }
        try tap(app, "accountSubmit")
        try fill(app, "accountCode", try await get("/code")["code"]!)
        try tap(app, "accountSubmit")
        try fill(app, "accountPassword", credentials["nextPassword"]!, secure: true)
        try fill(app, "accountRepeatedPassword", credentials["nextPassword"]!, secure: true)
        try tap(app, "accountSubmit")
        try expect(app.staticTexts["密码已更新，请登录。"], timeout: 20)
        XCTAssertEqual(app.textFields["accountEmail"].value as? String, credentials["email"]!)
        keep(app, "ios-password-recovered")
        try fill(app, "accountPassword", credentials["nextPassword"]!, secure: true)
        try tap(app, "accountSubmit")
        try await confirmIfNeeded(app)
        try expect(app.buttons["设置 → 账户"], timeout: 30)
        keep(app, "ios-recovered-login")
        app.terminate()
    }

    @MainActor func testRealAccountLifecycleOnFreshCloud() async throws {
        let ready = try await get("/ready"), credentials = try await get("/credentials")
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "lg2-life-" + UUID().uuidString.prefix(8),
            "--lg2-cloud", "--server-url", ready["host"]!, "--s1c-cloud-url", ready["cloud"]!]
        app.launch()
        try expect(app.staticTexts["登录 WeftMate"], timeout: 30)
        try tap(app, "accountRegistration")
        try fill(app, "accountEmail", credentials["email"]!)
        try tap(app, "accountSubmit")
        try fill(app, "accountCode", try await get("/code")["code"]!)
        try tap(app, "accountSubmit")
        try fill(app, "accountPassword", credentials["password"]!, secure: true)
        try fill(app, "accountRepeatedPassword", credentials["password"]!, secure: true)
        try tap(app, "accountSubmit"); try tap(app, "accountSubmit")
        try await confirmIfNeeded(app)
        try expect(app.buttons["设置 → 设备"], timeout: 30)
        _ = try await get("/bootstrap")
        // S1e was merged while this package was in progress: exercise the newly available UI.
        try tap(app, "设置 → 设备")
        try tap(app, "renameDevice." + ready["computerDeviceId"]!)
        let renamed = "LG2 已改名电脑"
        let name = app.alerts.textFields.firstMatch
        try expect(name, timeout: 10); name.tap()
        name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "LG2 测试电脑".count) + renamed)
        app.alerts.buttons["保存"].tap()
        try expect(app.staticTexts[renamed].firstMatch, timeout: 20)
        keep(app, "ios-device-renamed")
        try tap(app, "removeDevice." + ready["computerDeviceId"]!)
        app.sheets.buttons["移除设备"].firstMatch.tap()
        let removed = NSPredicate { _, _ in !app.buttons["removeDevice." + ready["computerDeviceId"]!].exists }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: removed, object: nil)], timeout: 20), .completed)
        try tap(app, "closeAuxiliarySheetButton")
        try tap(app, "设置 → 账户")
        try tap(app, "退出所有其他设备")
        app.sheets.buttons["退出其他设备"].firstMatch.tap()
        try expect(app.staticTexts["其他设备已退出。"], timeout: 20)
        let changedEmail = "lg2-renamed@example.com"
        try fill(app, "新邮箱", changedEmail)
        try tap(app, "发送新邮箱验证码")
        reveal(app, app.textFields["新邮箱验证码"])
        try expect(app.textFields["新邮箱验证码"], timeout: 20)
        try fill(app, "新邮箱验证码", try await get("/code")["code"]!)
        try tap(app, "确认换绑邮箱")
        try expect(app.staticTexts["邮箱已更新，请用新邮箱登录。"], timeout: 20)
        XCTAssertEqual(app.textFields["accountEmail"].value as? String, changedEmail)
        try fill(app, "accountPassword", credentials["password"]!, secure: true)
        try tap(app, "accountSubmit")
        try await confirmIfNeeded(app)
        try expect(app.buttons["设置 → 账户"], timeout: 30)
        try tap(app, "设置 → 账户")
        try fill(app, "输入密码确认注销", credentials["password"]!, secure: true)
        try tap(app, "注销账号")
        let delete = app.sheets.buttons["永久注销账号"].firstMatch
        try expect(delete, timeout: 10); delete.tap()
        try expect(app.staticTexts["账号已注销，本机对话与记忆保留。"], timeout: 30)
        keep(app, "ios-account-deleted")
        app.terminate()
    }
}
