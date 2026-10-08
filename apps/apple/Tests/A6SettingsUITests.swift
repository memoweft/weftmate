import XCTest

final class A6SettingsUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    private var driver: String { ProcessInfo.processInfo.environment["WEFTMATE_A5_DRIVER"]! }
    @MainActor private func get(_ path: String) async throws -> [String: Any] {
        let (data, response) = try await URLSession.shared.data(from: URL(string: driver + path)!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw NSError(domain: "A6Driver", code: 1) }
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    @MainActor private func expect(_ element: XCUIElement) throws {
        XCTAssertTrue(element.exists || element.waitForExistence(timeout: 30), "Missing required native control")
        if !element.exists { throw NSError(domain: "A6UI", code: 1) }
    }
    @MainActor private func tap(_ app: XCUIApplication, _ name: String) throws {
        let element = app.buttons[name]; try expect(element); element.tap()
    }
    @MainActor private func fill(_ app: XCUIApplication, _ name: String, _ value: String, secure: Bool = false) throws {
        let field = secure ? app.secureTextFields[name] : app.textFields[name]
        try expect(field); field.tap(); field.typeText(value)
    }
    @MainActor private func reveal(_ app: XCUIApplication, _ element: XCUIElement) {
        for up in [true, false] {
            for _ in 0..<6 {
                if element.exists && element.isHittable { return }
                if up { app.swipeUp() } else { app.swipeDown() }
            }
        }
    }
    @MainActor private func keep(_ app: XCUIApplication, _ scene: String, _ theme: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "review-iphone-" + scene + "-" + theme
        image.lifetime = .keepAlways; add(image)
    }
    @MainActor private func launch(_ theme: String) async throws -> (XCUIApplication, [String: Any]) {
        let ready = try await get("/ready"), credentials = try await get("/credentials")
        let app = XCUIApplication()
        let namespace = "a6-" + UUID().uuidString.prefix(8)
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", namespace, "--server-url", ready["host"] as! String,
                               "--s1c-cloud-url", ready["cloud"] as! String, "--s1c-qr-url", driver + "/pairing.png", "--lg2-cloud", "--a5-theme", theme]
        app.launch()
        try fill(app, "accountEmail", credentials["email"] as! String)
        try tap(app, "accountRegistration"); try tap(app, "accountSubmit")
        try expect(app.textFields["accountCode"])
        try fill(app, "accountCode", try await get("/code")["code"] as! String); try tap(app, "accountSubmit")
        try fill(app, "accountPassword", credentials["password"] as! String, secure: true)
        try fill(app, "accountRepeatedPassword", credentials["password"] as! String, secure: true); try tap(app, "accountSubmit")
        try expect(app.textFields["accountDeviceName"]); try tap(app, "accountSubmit")
        try expect(app.textFields["accountCode"])
        try fill(app, "accountCode", try await get("/code")["code"] as! String); try tap(app, "accountSubmit")
        try expect(app.staticTexts["已登录 WeftMate"]); _ = try await get("/bootstrap")
        try tap(app, "设置 → 设备"); try tap(app, "刷新设备")
        try tap(app, "connectHost." + (ready["hostId"] as! String))
        try expect(app.descendants(matching: .any)["cloudPairingReady"].firstMatch)
        try tap(app, "cloudRequestApproval"); try expect(app.staticTexts["cloudWaiting"]); _ = try await get("/approve")
        try expect(app.descendants(matching: .any)["conversationList"].firstMatch)
        return (app, try await get("/a5/ids"))
    }
    @MainActor private func openSettings(_ app: XCUIApplication) throws {
        try tap(app, "phoneAccountMenu"); try tap(app, "phoneMenu.settings")
        try expect(app.navigationBars["设置"])
    }
    @MainActor @discardableResult private func category(_ app: XCUIApplication, _ id: String) throws -> CGRect {
        let row = app.buttons["settingsCategory." + id]
        let search = app.searchFields["搜索设置"]
        for _ in 0..<6 {
            let coveredBySearch = row.exists && search.exists && row.frame.intersects(search.frame)
            if row.exists && row.isHittable && !coveredBySearch { break }
            app.swipeUp()
        }
        try expect(row)
        let frame = row.frame
        row.tap()
        return frame
    }
    @MainActor private func back(_ app: XCUIApplication) throws {
        let button = app.navigationBars.buttons["设置"].firstMatch; try expect(button); button.tap()
    }
    @MainActor func testLightSettingsReachabilitySearchDeepLinkAndDeviceOperation() async throws {
        let (app, ids) = try await launch("light")
        defer { app.terminate() }
        try openSettings(app)
        XCTAssertFalse(app.buttons["settingsCategory.system"].exists)
        XCTAssertFalse(app.buttons["settingsCategory.backups"].exists)
        for id in ["general", "appearance", "account", "devices", "usage", "models", "approvals", "memory", "schedules", "about"] {
            let listFrame = try category(app, id)
            try expect(app.descendants(matching: .any)["settingsPage." + id].firstMatch)
            if id == "appearance" { try expect(app.segmentedControls["appearancePicker"]); keep(app, "appearance", "light") }
            if id == "usage" { try expect(app.staticTexts["usageTotalCost"]); keep(app, "usage", "light") }
            if id == "account" { try expect(app.staticTexts["signedInEmail"]); reveal(app, app.buttons["accountLogout"]); try expect(app.buttons["accountLogout"]) }
            if id == "devices" {
                let rename = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "renameDevice.")).firstMatch
                reveal(app, rename); try expect(rename); rename.tap()
                let name = app.alerts.textFields.firstMatch; try expect(name); name.tap()
                name.typeText(" 合成改名")
                app.alerts.buttons["保存"].tap()
                try expect(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "合成改名")).firstMatch)
            }
            try back(app)
            if id == "about" { XCTAssertEqual(app.buttons["settingsCategory.about"].frame.minY, listFrame.minY, accuracy: 2, "Returning must retain the list position") }
            app.swipeDown()
        }
        let search = app.searchFields["搜索设置"]
        // Pull the native list down to reveal its searchable field.
        for _ in 0..<3 { if search.isHittable { break }; app.swipeDown() }
        try expect(search); search.tap(); search.typeText("月度 上限")
        XCTAssertTrue(app.buttons["settingsCategory.usage"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["settingsCategory.account"].exists)
        app.buttons["settingsCategory.usage"].tap(); try expect(app.staticTexts["usageTotalCost"])
        try back(app)
        XCTAssertEqual(search.value as? String, "月度 上限")
        try tap(app, "closeAuxiliarySheetButton")
        let row = app.descendants(matching: .any)["conversationRow." + (ids["review"] as! String)].firstMatch
        try expect(row); row.tap()
        try tap(app, "对话菜单"); try tap(app, "conversationUsage")
        try expect(app.staticTexts["usageSessionFocus"])
        XCTAssertTrue(app.staticTexts["usageSessionFocus"].label.contains("整理项目资料"))
        try expect(app.staticTexts["usageTotalCost"])
        _ = try await get("/a5/report")
    }
    @MainActor func testDarkSettingsReview() async throws {
        let (app, _) = try await launch("dark")
        defer { app.terminate() }
        try openSettings(app); try category(app, "appearance")
        try expect(app.segmentedControls["appearancePicker"]); keep(app, "appearance", "dark")
        try back(app); try category(app, "usage"); try expect(app.staticTexts["usageTotalCost"]); keep(app, "usage", "dark")
    }
}
