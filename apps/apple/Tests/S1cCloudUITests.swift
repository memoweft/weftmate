import XCTest

/// Real cloud main/SQLite/file email and real isolated host; browser protocol interactions use a test driver.
final class S1cCloudUITests: XCTestCase {
    private let driver = "http://127.0.0.1:18765"
    @MainActor private func launch(systemBrowser: Bool = false) async throws -> XCUIApplication {
        let data: Data
        do { (data, _) = try await URLSession.shared.data(from: URL(string: driver + "/ready")!) }
        catch { throw XCTSkip("Start apps/apple/Tests/s1c_cloud_fixture.mjs first") }
        let ready = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "s1c-" + UUID().uuidString.prefix(8),
            "--server-url", ready["host"]!, "--s1c-cloud-url", ready["cloud"]!,
            "--s1c-browser-driver", driver + "/browser", "--s1c-qr-url", driver + "/pairing.png"]
        if systemBrowser { app.launchArguments.append("--s1c-system-browser") }
        app.launch()
        let entry = app.buttons["cloudLoginEntry"]
        XCTAssertTrue(entry.waitForExistence(timeout: 20)); entry.tap()
        guard app.descendants(matching: .any)["cloudPairingReady"].firstMatch.waitForExistence(timeout: 20) else {
            XCTFail("Synthetic QR image did not decode: " + app.debugDescription); throw NSError(domain: "S1cQR", code: 1)
        }
        app.buttons["cloudBrowserLogin"].tap()
        if systemBrowser { try await completeSystemBrowser(app) }
        guard app.descendants(matching: .any)["cloudWaiting"].firstMatch.waitForExistence(timeout: 30) else {
            XCTFail(app.debugDescription); throw NSError(domain: "S1cWaiting", code: 1)
        }
        return app
    }
    @MainActor func testRegistrationEmailCloudLoginPendingApprovalThenConversation() async throws {
        let app = try await launch()
        XCTAssertFalse(app.descendants(matching: .any)["conversationList"].firstMatch.exists)
        keep(app, "S1c-pending")
        let initialArguments = app.launchArguments
        let (pendingData, _) = try await URLSession.shared.data(from: URL(string: driver + "/pending")!)
        let pending = try XCTUnwrap(JSONSerialization.jsonObject(with: pendingData) as? [String: Any])
        let pendingDevices = try XCTUnwrap(pending["devices"] as? [[String: Any]])
        let id = try XCTUnwrap(pendingDevices.last?["id"] as? String)
        app.terminate()
        // A separately authenticated native local session approves the new installation.
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "s1c-trusted-" + UUID().uuidString.prefix(8),
            "--server-url", initialArguments[initialArguments.firstIndex(of: "--server-url")! + 1],
            "--s1c-browser-driver", driver + "/browser"]
        app.launch()
        XCTAssertTrue(app.textFields["username"].waitForExistence(timeout: 20))
        app.textFields["username"].tap(); app.textFields["username"].typeText("synthetic-local")
        app.secureTextFields["password"].tap(); app.secureTextFields["password"].typeText("synthetic local password only")
        let localLogin = app.buttons["loginButton"]
        if !localLogin.isHittable { app.swipeUp() }
        localLogin.tap()
        let passwordOffer = app.sheets.matching(NSPredicate(format: "label == %@", "保存密码？")).firstMatch
        if passwordOffer.waitForExistence(timeout: 4) {
            let later = passwordOffer.buttons.matching(NSPredicate(format: "label == %@", "以后")).firstMatch
            if later.exists { later.tap() }
        }
        let allow = app.buttons["cloudAllow." + id]
        XCTAssertTrue(allow.waitForExistence(timeout: 30), app.debugDescription)
        keep(app, "S1c-trusted-native-approval")
        allow.tap()
        let resolved = NSPredicate { _, _ in !allow.exists }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: resolved, object: allow)], timeout: 15), .completed)
        app.terminate()
        app.launchArguments = initialArguments
        app.launch() // Rotation/Keychain restore retries the pending host exchange.
        let row = app.descendants(matching: .any)["conversationRow.session-synthetic-cloud"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 30), app.debugDescription)
        row.tap()
        XCTAssertTrue(app.textFields["conversationDraft"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["Synthetic cloud conversation ready"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["服务器暂时无法完成操作，请稍后重试。"].exists)
        keep(app, "S1c-authorized-conversation")
        let (data, _) = try await URLSession.shared.data(from: URL(string: driver + "/report")!)
        let report = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(report["registered"] as? Bool, true); XCTAssertEqual(report["emailVerified"] as? Bool, true)
        XCTAssertGreaterThan(report["cloudDeviceConfirmed"] as? Int ?? 0, 0)
        XCTAssertEqual(report["pending"] as? Int, 0)
    }
    @MainActor func testSyntheticQRCodeRedeemsOneTimePairing() async throws {
        let app = try await launch()
        let redeem = app.buttons["cloudRedeem"]
        if !redeem.isHittable { app.swipeUp() }
        redeem.tap()
        XCTAssertTrue(app.descendants(matching: .any)["conversationRow.session-synthetic-cloud"].firstMatch.waitForExistence(timeout: 30), app.debugDescription)
        keep(app, "S1c-QR-authorized")
    }
    @MainActor func testSystemAuthenticationBrowserKeyBootstrapAndEmailConfirmation() async throws {
        let app = try await launch(systemBrowser: true)
        XCTAssertFalse(app.descendants(matching: .any)["conversationList"].firstMatch.exists)
        keep(app, "S1c-system-browser-pending")
        app.buttons["cloudCancel"].tap()
    }
    @MainActor private func completeSystemBrowser(_ app: XCUIApplication) async throws {
        var web = app.webViews.firstMatch
        if !web.waitForExistence(timeout: 12) {
            web = XCUIApplication(bundleIdentifier: "com.apple.SafariViewService").webViews.firstMatch
        }
        guard web.waitForExistence(timeout: 15) else { XCTFail(app.debugDescription); throw NSError(domain: "S1cBrowser", code: 1) }
        let email = web.textFields.firstMatch
        XCTAssertTrue(email.waitForExistence(timeout: 10)); email.tap(); email.typeText("s1c-synthetic@example.com")
        let password = web.secureTextFields.firstMatch
        XCTAssertTrue(password.exists)
        // Safari scrolls the focused email above its keyboard; expose the next HTML input before tapping.
        web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)).press(forDuration: 0.05,
            thenDragTo: web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1)))
        password.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        password.typeText("synthetic cloud password only")
        web.buttons["登录"].tap()
        let codeField = web.textFields.matching(NSPredicate(format: "label CONTAINS %@", "验证码")).firstMatch
        guard codeField.waitForExistence(timeout: 20) else { XCTFail(app.debugDescription); throw NSError(domain: "S1cBrowserOTP", code: 1) }
        let (data, _) = try await URLSession.shared.data(from: URL(string: driver + "/browser-code")!)
        let fields = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
        codeField.tap(); codeField.typeText(try XCTUnwrap(fields["code"]))
        web.buttons["确认登录"].tap()
    }
    @MainActor private func keep(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
