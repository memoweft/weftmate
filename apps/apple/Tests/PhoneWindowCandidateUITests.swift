import XCTest

// APPLE-1's PhoneWindowUITests covers memory routing in the ordinary phone suite.
// This independent bundle verifies the installed candidate and real chat controller.
final class PhoneWindowInstallUITests: XCTestCase {
    private struct Traffic: Decodable, Sendable {
        let starts: [String]
        let completed: Int
        let aborted: Int
        let nonStreamRequests: Int
    }
    override func setUp() { super.setUp(); continueAfterFailure = false }

    @MainActor private func launch() throws -> XCUIApplication {
        let url = try XCTUnwrap(ProcessInfo.processInfo.environment["WEFTMATE_PHONE_WINDOW_MODEL_URL"])
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--phone-window-chat-fixture"]
        app.launchEnvironment["WEFTMATE_PHONE_WINDOW_MODEL_URL"] = url
        app.launch()
        XCTAssertTrue(app.buttons["phoneChat.send"].waitForExistence(timeout: 30))
        return app
    }
    @MainActor private func send(_ text: String, app: XCUIApplication) {
        let draft = app.descendants(matching: .any)["phoneChat.draft"].firstMatch
        draft.tap(); draft.typeText(text); app.buttons["phoneChat.send"].tap()
    }
    @MainActor private func text(_ value: String, app: XCUIApplication) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", value)).firstMatch
    }
    @MainActor private func capture(_ name: String, app: XCUIApplication) {
        let item = XCTAttachment(screenshot: app.screenshot()); item.name = name; item.lifetime = .keepAlways; add(item)
    }
    @MainActor private func report() async throws -> Traffic {
        let model = try XCTUnwrap(ProcessInfo.processInfo.environment["WEFTMATE_PHONE_WINDOW_MODEL_URL"])
        let origin = try XCTUnwrap(URL(string: model)?.deletingLastPathComponent())
        let (data, _) = try await URLSession.shared.data(from: origin.appendingPathComponent("report"))
        return try JSONDecoder().decode(Traffic.self, from: data)
    }
    @MainActor func testStopQueueAndHomeScreenRelaunchRetainCandidateData() async throws {
        let app = try launch(); defer { app.terminate() }
        let slow = "WINDOW-SLOW:" + UUID().uuidString, queued = "WINDOW-QUEUED:" + UUID().uuidString
        send(slow, app: app)
        XCTAssertTrue(text("Started:" + slow, app: app).waitForExistence(timeout: 15))
        send(queued, app: app)
        XCTAssertTrue(text(queued, app: app).waitForExistence(timeout: 10))
        let before = try await report()
        XCTAssertFalse(before.starts.contains(queued), "Queued work must not start before the active reply ends")
        capture("window-queued", app: app)
        app.buttons["phoneChat.stop"].tap()
        XCTAssertTrue(app.buttons["phoneChat.stop"].waitForNonExistence(timeout: 10))
        capture("window-stopped", app: app)
        app.terminate()
        // Same installed app, no test arguments or environment: equivalent to a manual reopen.
        app.launchArguments = []; app.launchEnvironment = [:]; app.launch()
        XCTAssertTrue(app.buttons["phoneChat.send"].waitForExistence(timeout: 30))
        XCTAssertTrue(text(queued, app: app).waitForExistence(timeout: 10))
        XCTAssertTrue(text("Started:" + slow, app: app).exists)
        XCTAssertFalse(app.buttons["phoneChat.stop"].exists)
        capture("window-manual-reopen", app: app)
        XCUIDevice.shared.press(.home); app.activate()
        XCTAssertTrue(app.buttons["phoneChat.send"].waitForExistence(timeout: 10))
        capture("window-foreground-resume", app: app)
    }
    @MainActor func testQueuedReplyStartsAfterActiveReplyCompletes() async throws {
        let app = try launch(); defer { app.terminate() }
        let slow = "WINDOW-SLOW:" + UUID().uuidString, queued = "WINDOW-QUEUED:" + UUID().uuidString
        send(slow, app: app)
        XCTAssertTrue(text("Started:" + slow, app: app).waitForExistence(timeout: 15))
        send(queued, app: app)
        let before = try await report()
        XCTAssertFalse(before.starts.contains(queued))
        let model = try XCTUnwrap(ProcessInfo.processInfo.environment["WEFTMATE_PHONE_WINDOW_MODEL_URL"])
        var url = try XCTUnwrap(URLComponents(string: URL(string: model)!.deletingLastPathComponent().appendingPathComponent("release").absoluteString))
        url.queryItems = [URLQueryItem(name: "marker", value: slow)]
        var request = URLRequest(url: try XCTUnwrap(url.url)); request.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertTrue(text("Done:" + queued, app: app).waitForExistence(timeout: 20))
        let after = try await report(), starts = after.starts
        XCTAssertEqual(starts.filter { $0 == slow }.count, 1)
        XCTAssertEqual(starts.filter { $0 == queued }.count, 1)
        capture("window-queue-completed", app: app)
    }
}
