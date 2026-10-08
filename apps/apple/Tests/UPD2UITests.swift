import XCTest

final class UPD2UITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    @MainActor private func launch(incompatible: Bool = false, feed: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "upd2-" + UUID().uuidString.prefix(8),
                               "--apple-contract-fixture", "--upd2-about", "--server-url", "https://a2-ui.unit.example", "--s1c-cloud-url", "https://cloud.example.com"]
        if incompatible { app.launchArguments += ["--upd2-incompatible"] }
        if feed {
            let env = ProcessInfo.processInfo.environment
            app.launchArguments += ["--upd2-feed", env["WEFTMATE_UPD2_FEED"]!, "--upd2-public-key", env["WEFTMATE_UPD2_PUBLIC_KEY"]!]
        }
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["conversationList"].firstMatch.waitForExistence(timeout: 30))
        #if os(macOS)
        app.typeKey(",", modifierFlags: .command)
        XCTAssertTrue(app.buttons["settingsCategory.about"].waitForExistence(timeout: 10))
        app.buttons["settingsCategory.about"].tap()
        #else
        app.buttons["phoneAccountMenu"].tap(); app.buttons["phoneMenu.settings"].tap()
        let row = app.buttons["settingsCategory.about"], search = app.searchFields["搜索设置"]
        for _ in 0..<6 {
            let covered = row.exists && search.exists && row.frame.intersects(search.frame)
            if row.exists && row.isHittable && !covered { break }
            app.swipeUp()
        }
        row.tap()
        #endif
        XCTAssertTrue(app.descendants(matching: .any)["aboutHostLayer.mobile-ui"].firstMatch.waitForExistence(timeout: 10))
        return app
    }
    @MainActor private func keep(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
    }
    @MainActor func testAboutVersionsAndUnconfiguredSource() {
        let app = launch(); defer { app.terminate() }
        XCTAssertTrue(app.staticTexts["aboutNativeVersion"].label.contains("0.1.0 / 11"))
        XCTAssertTrue(app.staticTexts["0.3.0"].exists)
        XCTAssertTrue(app.staticTexts["0.9.0"].exists)
        #if os(macOS)
        XCTAssertTrue(app.staticTexts["aboutUpdateStatus"].label.contains("未配置更新源"))
        app.buttons["openUpdatesButton"].tap()
        XCTAssertTrue(app.staticTexts["aboutUpdateStatus"].label.contains("未配置更新源"))
        #endif
        keep(app, "upd2-about-versions")
    }
    @MainActor func testAboutCompatibilityPrompt() {
        let app = launch(incompatible: true); defer { app.terminate() }
        let notice = app.descendants(matching: .any)["aboutCompatibilityNotice"].firstMatch
        XCTAssertTrue(notice.waitForExistence(timeout: 10))
        #if os(iOS)
        for _ in 0..<3 { if notice.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "TestFlight")).firstMatch.exists)
        #endif
        keep(app, "upd2-about-compatibility")
    }
    #if os(macOS)
    @MainActor func testSignedLocalFeedDetectsV2() throws {
        guard ProcessInfo.processInfo.environment["WEFTMATE_UPD2_FEED"] != nil else { throw XCTSkip("Start Scripts/upd2_fixture.mjs and pass its public feed configuration.") }
        let app = launch(feed: true); defer { app.terminate() }
        app.buttons["openUpdatesButton"].tap()
        let status = app.staticTexts["aboutUpdateStatus"]
        let available = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "有新版本 0.2.0 / 12"), object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [available], timeout: 25), .completed)
        XCTAssertTrue(app.links["aboutDownloadPage"].exists)
        keep(app, "upd2-mac-v2-detected")
    }
    #endif
}
