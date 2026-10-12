import XCTest

/// AUTH-1 replaces the former browser/QR/approval journey. Cryptographic rejection
/// cases remain in CloudAuthTests/CloudTokenTests; live login is in APPLE2LoginUITests.
final class S1cCloudUITests: XCTestCase {
    @MainActor private func launch() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "apple2-entry-" + UUID().uuidString,
            "--a5-theme", "light"]
        app.launch()
        return app
    }
    @MainActor func testLocalEntryDoesNotRequirePasswordOrDeviceApproval() {
        let app = launch(); defer { app.terminate() }
        XCTAssertTrue(app.buttons["openAccountLogin"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "localDraft").firstMatch.exists)
        XCTAssertFalse(app.secureTextFields["accountPassword"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["cloudWaiting"].firstMatch.exists)
        XCTAssertFalse(app.buttons["cloudScan"].exists)
    }
    @MainActor func testLoginOffersPasswordAndEmailCodeWithoutPairing() {
        let app = launch(); defer { app.terminate() }
        XCTAssertTrue(app.buttons["openAccountLogin"].waitForExistence(timeout: 30)); app.buttons["openAccountLogin"].tap()
        XCTAssertTrue(app.secureTextFields["accountPassword"].waitForExistence(timeout: 10))
        app.buttons["验证码登录"].tap()
        XCTAssertFalse(app.secureTextFields["accountPassword"].exists)
        XCTAssertTrue(app.buttons["accountSubmit"].label.contains("发送验证码"))
        XCTAssertFalse(app.buttons["cloudRequestApproval"].exists)
        XCTAssertFalse(app.textFields["cloudPairingText"].exists)
        XCTAssertFalse(app.webViews.firstMatch.exists)
    }
    @MainActor func testCancelLoginReturnsToLocalWorkspace() {
        let app = launch(); defer { app.terminate() }
        XCTAssertTrue(app.buttons["openAccountLogin"].waitForExistence(timeout: 30)); app.buttons["openAccountLogin"].tap()
        XCTAssertTrue(app.textFields["accountEmail"].waitForExistence(timeout: 10))
        app.buttons["稍后再说"].tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "localDraft").firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.textFields["accountEmail"].exists)
    }
}
