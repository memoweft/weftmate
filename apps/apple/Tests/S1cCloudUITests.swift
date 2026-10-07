import XCTest

/// Real cloud main/SQLite/file email and real isolated host; browser protocol interactions use a test driver.
final class S1cCloudUITests: XCTestCase {
    private let driver = "http://127.0.0.1:18765"
    @MainActor private func launch() async throws -> XCUIApplication {
        let data: Data
        do { (data, _) = try await URLSession.shared.data(from: URL(string: driver + "/ready")!) }
        catch { throw XCTSkip("Start apps/apple/Tests/s1c_cloud_fixture.mjs first") }
        let ready = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "s1c-" + UUID().uuidString.prefix(8),
            "--server-url", ready["host"]!, "--s1c-cloud-url", ready["cloud"]!,
            "--s1c-browser-driver", driver + "/browser", "--s1c-qr-url", driver + "/pairing.png"]
        app.launch()
        let entry = app.buttons["cloudLoginEntry"]
        XCTAssertTrue(entry.waitForExistence(timeout: 20)); entry.tap()
        guard app.descendants(matching: .any)["cloudPairingReady"].firstMatch.waitForExistence(timeout: 20) else {
            XCTFail("Synthetic QR image did not decode: " + app.debugDescription); throw NSError(domain: "S1cQR", code: 1)
        }
        app.buttons["cloudBrowserLogin"].tap()
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
    @MainActor private func keep(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
