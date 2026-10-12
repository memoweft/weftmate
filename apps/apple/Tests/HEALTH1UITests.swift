import XCTest

/// Writers live in this UI-test target only; the phone app always requests toShare: [].
final class HEALTH1UITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    private var driver: String { ProcessInfo.processInfo.environment["WEFTMATE_APPLE2_DRIVER"]! }
    @MainActor private func get(_ path: String) async throws -> [String: Any] {
        let (data, response) = try await URLSession.shared.data(from: URL(string: driver + path)!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    @MainActor private func tap(_ app: XCUIApplication, _ id: String) throws {
        let item = app.descendants(matching: .any).matching(identifier: id).firstMatch
        guard item.waitForExistence(timeout: 30) else {
            XCTFail("Missing control: " + id); throw NSError(domain: "HealthUITest", code: 1)
        }
        item.tap()
    }
    @MainActor private func fill(_ app: XCUIApplication, _ id: String, _ text: String) throws {
        try tap(app, id)
        app.descendants(matching: .any).matching(identifier: id).firstMatch.typeText(text)
        if app.buttons["dismissAccountKeyboard"].exists { app.buttons["dismissAccountKeyboard"].tap() }
    }
    @MainActor private func keep(_ app: XCUIApplication, _ name: String, _ theme: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = "health1-" + theme + "-" + name; a.lifetime = .keepAlways; add(a)
    }
    @MainActor private func authorize(_ app: XCUIApplication, theme: String, screenshot: Bool) async throws {
        // HealthKit may host the consent controls in SpringBoard's accessibility surface.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let surfaces = [app, springboard]
        let all = app.cells["UIA.Health.AuthSheet.AllCategoryButton"]
        let systemAll = springboard.cells["UIA.Health.AuthSheet.AllCategoryButton"]
        if all.waitForExistence(timeout: 20) {
            if screenshot { keep(app, "system-authorization", theme) }
            all.tap()
        } else if systemAll.waitForExistence(timeout: 5) {
            if screenshot { keep(app, "system-authorization", theme) }
            systemAll.tap()
        } else {
            XCTFail("Expected HealthKit consent after the user's action")
            throw NSError(domain: "HealthUITest", code: 2)
        }
        if screenshot {
            var exerciseDeclined = false
            for surface in surfaces {
                for label in ["Exercise Minutes", "Apple Exercise Time", "运动分钟", "锻炼分钟数", "体能训练时间"] {
                    let row = surface.switches.matching(NSPredicate(format: "label CONTAINS[c] %@", label)).firstMatch
                    if row.exists {
                        if row.value as? String == "1" { row.tap() }
                        XCTAssertEqual(row.value as? String, "0")
                        exerciseDeclined = true; break
                    }
                }
            }
            XCTAssertTrue(exerciseDeclined, "Exercise minutes remain ungranted in this fixture")
        }
        let allow = app.buttons["UIA.Health.Allow.Button"]
        if allow.waitForExistence(timeout: 10) { allow.tap(); return }
        let systemAllow = springboard.buttons["UIA.Health.Allow.Button"]
        guard systemAllow.waitForExistence(timeout: 5) else { throw NSError(domain: "HealthUITest", code: 3) }
        systemAllow.tap()
    }
    @MainActor private func seed(theme: String) async throws -> [XCUIApplication] {
        var apps: [XCUIApplication] = []
        for name in ["phone", "watch"] {
            let seeder = XCUIApplication(bundleIdentifier: "com.weftmate.apple.weftmatehealthseed" + name)
            seeder.launchArguments = ["--health1-synthetic"]; seeder.launch()
            try tap(seeder, "healthSeedWrite")
            try await authorize(seeder, theme: theme, screenshot: false)
            XCTAssertTrue(seeder.staticTexts["SAVED"].waitForExistence(timeout: 30))
            apps.append(seeder)
        }
        return apps
    }
    @MainActor func testLightDailyHealth() async throws { try await journey("light") }
    @MainActor func testDarkDailyHealth() async throws { try await journey("dark") }
    @MainActor private func journey(_ theme: String) async throws {
        let seeders = try await seed(theme: theme)
        let ready = try await get("/ready"), credentials = try await get("/credentials")
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "health1-" + UUID().uuidString,
            "--lg2-cloud", "--server-url", ready["host"] as! String, "--s1c-cloud-url", ready["cloud"] as! String, "--a5-theme", theme]
        app.launch()
        try tap(app, "openAccountLogin")
        try fill(app, "accountEmail", credentials["email"] as! String)
        try fill(app, "accountPassword", credentials["password"] as! String)
        try tap(app, "accountSubmit")
        XCTAssertTrue(app.textFields["accountCode"].waitForExistence(timeout: 30))
        try fill(app, "accountCode", try await get("/code")["code"] as! String)
        try tap(app, "accountSubmit")
        XCTAssertTrue(app.buttons["mainChat.sideList"].waitForExistence(timeout: 40))
        // The permission sheet did not appear during launch or login.
        try tap(app, "phoneAccountMenu"); try tap(app, "phoneMenu.activity")
        XCTAssertTrue(app.buttons["dailyHealthHintConnect"].waitForExistence(timeout: 30))
        keep(app, "weekly-hint", theme)
        if theme == "light" {
        try tap(app, "dailyHealthHintDismiss")
        XCTAssertFalse(app.buttons["dailyHealthHintConnect"].exists)
        try tap(app, "closeAuxiliarySheetButton")
        try tap(app, "phoneAccountMenu"); try tap(app, "phoneMenu.activity")
        XCTAssertFalse(app.buttons["dailyHealthHintConnect"].exists)
        }
        try tap(app, "closeAuxiliarySheetButton")
        try tap(app, "phoneAccountMenu"); try tap(app, "phoneMenu.settings")
        try tap(app, "settingsCategory.general")
        XCTAssertTrue(app.buttons["dailyHealthConnect"].waitForExistence(timeout: 20))
        keep(app, "settings-disconnected", theme)
        _ = try await get("/health1/offline")
        if theme == "dark" {
            try tap(app, "closeAuxiliarySheetButton")
            try tap(app, "phoneAccountMenu"); try tap(app, "phoneMenu.activity")
            try tap(app, "dailyHealthHintConnect")
        } else { try tap(app, "dailyHealthConnect") }
        try await authorize(app, theme: theme, screenshot: true)
        if theme == "dark" {
            try tap(app, "closeAuxiliarySheetButton")
            try tap(app, "phoneAccountMenu"); try tap(app, "phoneMenu.settings")
            try tap(app, "settingsCategory.general")
        }
        XCTAssertTrue(app.switches["dailyHealthToggle"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.alerts.firstMatch.exists)
        _ = try await get("/health1/online")
        XCUIDevice.shared.press(.home); app.activate()
        var report: [String: Any] = [:]
        for _ in 0..<120 {
            report = try await get("/health1/report")
            if (report["available"] as? Int ?? 0) >= 7 { break }
            try await Task.sleep(for: .milliseconds(250))
        }
        XCTAssertEqual(report["available"] as? Int, 7)
        XCTAssertEqual(report["contractOnly"] as? Bool, true)
        let sent = report["sent"] as! [[String: Any]]
        let seeded = sent.filter { ($0["health"] as? [String: Any])?["steps"] as? Int == 1234 }
        XCTAssertEqual(seeded.count, 3)
        for value in seeded {
            let h = value["health"] as! [String: Any]
            XCTAssertEqual(h["sleepMinutes"] as? Double, 480)
            XCTAssertEqual(h["restingHeartRateBpm"] as? Double, 63)
            XCTAssertTrue(h["exerciseMinutes"] is NSNull)
            let workouts = h["workouts"] as! [[String: Any]]
            XCTAssertEqual(workouts.first?["type"] as? String, "步行")
            XCTAssertEqual(workouts.first?["minutes"] as? Double, 30)
        }
        let items = report["items"] as! [[String: Any]]
        for day in seeded {
            let stored = items.first { $0["day"] as? String == day["day"] as? String }
            XCTAssertNotNil(stored)
            XCTAssertEqual((stored?["health"] as? [String: Any])?["sleepMinutes"] as? Double, 480)
        }
        keep(app, "settings-connected", theme)
        let count = report["requests"] as! Int
        XCUIDevice.shared.press(.home); app.activate()
        try await Task.sleep(for: .seconds(3))
        let unchanged = try await get("/health1/report")
        XCTAssertEqual(unchanged["requests"] as? Int, count)
        _ = try await get("/health1/offline")
        try tap(app, "dailyHealthToggle")
        XCTAssertFalse(app.alerts.firstMatch.exists)
        _ = try await get("/health1/online")
        XCUIDevice.shared.press(.home); app.activate()
        for _ in 0..<120 {
            report = try await get("/health1/report")
            if (report["unavailable"] as? Int ?? 0) >= 7 { break }
            try await Task.sleep(for: .milliseconds(250))
        }
        XCTAssertEqual(report["unavailable"] as? Int, 7)
        XCTAssertTrue((report["items"] as! [[String: Any]]).filter { seeded.map { $0["day"] as! String }.contains($0["day"] as! String) }.allSatisfy { ($0["health"] as! [String: Any])["status"] as? String == "unavailable" })
        keep(app, "settings-disabled", theme)
        app.terminate()
        for seeder in seeders {
            seeder.activate(); try tap(seeder, "healthSeedDelete")
            XCTAssertTrue(seeder.staticTexts["CLEAN"].waitForExistence(timeout: 20)); seeder.terminate()
        }
    }
}
