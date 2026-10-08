import XCTest

final class IC2IconsUITests: XCTestCase {
    @MainActor func testLightIcons() async throws { try await capture(style: "Light") }
    @MainActor func testDarkIcons() async throws { try await capture(style: "Dark") }

    @MainActor private func capture(style: String) async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        for (port, fixture) in [(18764, "a4a"), (18765, "a4b")] {
            var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/personal/v1/test/reset")!)
            request.httpMethod = "POST"
            _ = try await URLSession.shared.data(for: request)
            app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "ic2-" + UUID().uuidString.prefix(8),
                "--\(fixture)-local-server", "--server-url", "http://localhost:\(port)"]
            app.launch()
            let row = app.descendants(matching: .any).matching(identifier: "conversationRow.session-fixture").firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 30))
            capture(app.screenshot(), "\(style)-sidebar")
            row.tap()
            if fixture == "a4a" {
                XCTAssertTrue(app.buttons["approveOnce.00000001-1111-4111-8111-111111111111"].waitForExistence(timeout: 20))
                capture(app.screenshot(), "\(style)-approval-composer")
            } else {
                XCTAssertTrue(app.buttons["memoryUsed.3"].waitForExistence(timeout: 20))
                capture(app.screenshot(), "\(style)-completed-composer")
                app.buttons["openConversationResources"].tap()
                XCTAssertTrue(app.buttons["resourceSource.tool:read"].waitForExistence(timeout: 10))
                XCTAssertTrue(app.buttons["resourceOutput.artifact-new"].exists)
                capture(app.screenshot(), "\(style)-outputs-sources")
            }
            app.terminate()
        }
        XCUIDevice.shared.press(.home)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if !springboard.icons["WeftMate"].isHittable { springboard.swipeLeft() }
        XCTAssertTrue(springboard.icons["WeftMate"].waitForExistence(timeout: 10))
        capture(springboard.screenshot(), "\(style)-home")
    }
    private func capture(_ screenshot: XCUIScreenshot, _ name: String) {
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = "IC2-" + name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
