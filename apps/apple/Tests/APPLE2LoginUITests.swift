import XCTest

/// Real cloud/provider + private file mail + isolated host. See runner for routing boundary.
final class APPLE2LoginUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    private var driver: String { ProcessInfo.processInfo.environment["WEFTMATE_APPLE2_DRIVER"]! }
    @MainActor private func get(_ path: String) async throws -> [String: String] {
        let (data, response) = try await URLSession.shared.data(from: URL(string: driver + path)!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw NSError(domain: "SyntheticDriver", code: 1) }
        return (try JSONSerialization.jsonObject(with: data) as? [String: String]) ?? [:]
    }
    @MainActor private func expect(_ element: XCUIElement, _ timeout: TimeInterval = 25) throws {
        guard element.waitForExistence(timeout: timeout) else {
            XCTFail("Required native account control: " + element.identifier)
            throw NSError(domain: "Apple2UI", code: 1)
        }
    }
    @MainActor private func tap(_ app: XCUIApplication, _ id: String) throws {
        let button = id == "newDeviceOpen" ? app.buttons.matching(NSPredicate(format: "label == %@", "查看设备")).firstMatch : app.buttons.matching(identifier: id).firstMatch
        if id.hasPrefix("settingsCategory.") {
            for _ in 0..<8 { if button.exists && button.isHittable { break }; app.swipeUp() }
        }
        try expect(button)
        for _ in 0..<4 { if button.isHittable { break }; app.swipeUp() }
        button.tap()
    }
    @MainActor private func fill(_ app: XCUIApplication, _ id: String, _ text: String, secure: Bool = false) throws {
        let field = secure ? app.secureTextFields[id] : app.descendants(matching: .any).matching(identifier: id).firstMatch; try expect(field)
        field.tap()
        if let old = field.value as? String, !old.isEmpty, old != field.placeholderValue {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count))
        }
        field.typeText(text)
        if app.buttons["dismissAccountKeyboard"].exists { app.buttons["dismissAccountKeyboard"].tap() }
        else if id == "localDraft" { app.swipeDown() }
    }
    @MainActor private func keep(_ app: XCUIApplication, _ name: String, _ theme: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "apple2-" + theme + "-" + name; image.lifetime = .keepAlways; add(image)
    }
    @MainActor func testLightPasswordLoginFirst() async throws { try await journey("light", password: true) }
    @MainActor func testDarkPasswordLoginFirst() async throws { try await journey("dark", password: true) }
    @MainActor func testLightCodeLoginFirst() async throws { try await journey("light", password: false) }
    @MainActor func testDarkCodeLoginFirst() async throws { try await journey("dark", password: false) }
    @MainActor private func journey(_ theme: String, password: Bool) async throws {
        let ready = try await get("/ready"), credentials = try await get("/credentials")
        let app = XCUIApplication()
        func launch(_ suffix: String) {
            app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "apple2-" + suffix + "-" + UUID().uuidString.prefix(8),
                "--lg2-cloud", "--server-url", ready["host"]!, "--s1c-cloud-url", ready["cloud"]!, "--a5-theme", theme]
            app.launch()
        }
        if password {
        launch("password")
        try expect(app.descendants(matching: .any).matching(identifier: "localDraft").firstMatch, 40)
        XCTAssertFalse(app.textFields["accountPassword"].exists)
        try fill(app, "localDraft", "合成本机笔记")
        try tap(app, "saveLocalNote")
        try expect(app.staticTexts["合成本机笔记"])
        keep(app, "local-no-login", theme)
        try tap(app, "openAccountLogin")
        try expect(app.textFields["accountEmail"])
        keep(app, "password-login", theme)
        try fill(app, "accountEmail", credentials["email"]!)
        try fill(app, "accountPassword", "synthetic-wrong-password", secure: true)
        try tap(app, "accountSubmit")
        try expect(app.staticTexts["邮箱或密码不对，请检查后重试。"])
        keep(app, "password-error", theme)
        try fill(app, "accountPassword", credentials["password"]!, secure: true)
        try tap(app, "accountSubmit")
        try expect(app.textFields["accountCode"])
        keep(app, "new-device-code", theme)
        try fill(app, "accountCode", "000000")
        try tap(app, "accountSubmit")
        try expect(app.staticTexts["验证码不对，请检查邮件中的 6 位数字。"])
        keep(app, "code-error", theme)
        try fill(app, "accountCode", try await get("/code")["code"]!)
        try tap(app, "accountSubmit")
        try expect(app.buttons["mainChat.sideList"], 40)
        XCTAssertFalse(app.staticTexts["cloudWaiting"].exists)
        keep(app, "password-connected", theme)
        _ = try await get("/new-device")
        try expect(app.buttons.matching(NSPredicate(format: "label == %@", "查看设备")).firstMatch, 45)
        keep(app, "new-device-notice", theme)
        try tap(app, "newDeviceOpen")
        try expect(app.buttons["刷新设备"])
        try expect(app.staticTexts["已登录的设备"])
        keep(app, "devices", theme)
        try expect(app.buttons["removeDevice.synthetic-new-phone"])
        try tap(app, "removeDevice.synthetic-new-phone")
        try tap(app, "将设备下线")
        let removed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.buttons["removeDevice.synthetic-new-phone"])
        XCTAssertEqual(XCTWaiter.wait(for: [removed], timeout: 20), .completed)
        try tap(app, "完成")
        try tap(app, "phoneAccountMenu"); try tap(app, "phoneMenu.settings")
        try tap(app, "settingsCategory.about")
        try expect(app.staticTexts["aboutNativeVersion"])
        keep(app, "about", theme)
        app.terminate(); return
        }
        _ = try await get("/offline")
        launch("code")
        try tap(app, "openAccountLogin")
        try tap(app, "验证码登录")
        XCTAssertFalse(app.secureTextFields["accountPassword"].exists)
        keep(app, "email-code-login", theme)
        try fill(app, "accountEmail", credentials["email"]!)
        try tap(app, "accountSubmit")
        try expect(app.textFields["accountCode"])
        keep(app, "email-code-step", theme)
        _ = try await get("/expire-code")
        try fill(app, "accountCode", try await get("/code")["code"]!)
        try tap(app, "accountSubmit")
        try expect(app.staticTexts["验证码不对、已过期或尝试次数已用完，请重新发送验证码。"])
        keep(app, "expired-code", theme)
        let resend = app.buttons["重新发送验证码"]
        try expect(resend, 65); resend.tap()
        let readyForCode = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: app.textFields["accountCode"])
        XCTAssertEqual(XCTWaiter.wait(for: [readyForCode], timeout: 20), .completed)
        keep(app, "code-resent", theme)
        try fill(app, "accountCode", try await get("/code")["code"]!)
        try tap(app, "accountSubmit")
        try expect(app.buttons["retryComputer"], 40)
        XCTAssertFalse(app.secureTextFields["accountPassword"].exists)
        keep(app, "computer-offline", theme)
        _ = try await get("/online")
        try tap(app, "retryComputer")
        try expect(app.buttons["mainChat.sideList"], 40)
        keep(app, "email-code-connected", theme)
        try tap(app, "mainChat.sideList")
        let cachedRow = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "conversationRow.", "合成对话")).firstMatch
        try expect(cachedRow); cachedRow.tap()
        try expect(app.staticTexts["这是一条已保存在手机上的合成内容。"])
        keep(app, "cached-content", theme)
        _ = try await get("/expire-session")
        try tap(app, "refreshHistoryButton")
        try expect(app.buttons["expiredLogin"], 45)
        XCTAssertTrue(app.staticTexts["这是一条已保存在手机上的合成内容。"].exists)
        XCTAssertFalse(app.textFields["accountEmail"].exists)
        keep(app, "expired-local-content", theme)
        try tap(app, "expiredLogin")
        try expect(app.textFields["accountEmail"])
        keep(app, "server-relogin", theme)
        try tap(app, "稍后再说")
        XCTAssertTrue(app.staticTexts["这是一条已保存在手机上的合成内容。"].exists)
        app.terminate()
    }
}
