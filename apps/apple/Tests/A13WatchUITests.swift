import XCTest

final class A13WatchUITests: XCTestCase {
    @MainActor private func get(_ path: String) async throws -> [String: Any] {
        let driver = ProcessInfo.processInfo.environment["WEFTMATE_A12_DRIVER"]!
        let (data, response) = try await URLSession.shared.data(from: URL(string: driver + path)!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    @MainActor func testChineseApprovalDescription() async throws {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = ["--a12-live-evidence"]; app.launch(); defer { app.terminate() }
        let row = try await get("/approve/start")
        let headline = "要运行命令：rm " + (row["filename"] as! String)
        let element = app.staticTexts[headline]
        let e = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true"), object: element)
        let status = await XCTWaiter.fulfillment(of: [e], timeout: 90); XCTAssertEqual(status, .completed)
        XCTAssertTrue(app.buttons["批准"].exists); XCTAssertFalse(headline.contains("shell"))
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "a13-watch-approval"; screenshot.lifetime = .keepAlways; add(screenshot)
        let snapshot = app.debugDescription, regex = try! NSRegularExpression(pattern: "label: '([^']*)'")
        let text = regex.matches(in: snapshot, range: NSRange(snapshot.startIndex..., in: snapshot)).map { String(snapshot[Range($0.range(at: 1), in: snapshot)!]) }
        let copy = XCTAttachment(string: Array(Set(text)).sorted().joined(separator: "\n")); copy.name = "a13-watch-text"; copy.lifetime = .keepAlways; add(copy)
    }
    @MainActor func testNightlyLightApproval() async throws { try await nightlyApproval("light") }
    @MainActor func testNightlyDarkApproval() async throws { try await nightlyApproval("dark") }
    @MainActor private func nightlyApproval(_ theme: String) async throws {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = ["--a12-live-evidence", "-AppleInterfaceStyle", theme == "light" ? "Light" : "Dark"]
        app.launch(); defer { app.terminate() }
        let row = try await get("/approve/start")
        let headline = app.staticTexts["要运行命令：rm " + (row["filename"] as! String)]
        let wait = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true"), object: headline)
        let result = await XCTWaiter.fulfillment(of: [wait], timeout: 90)
        XCTAssertEqual(result, .completed)
        guard result == .completed else { throw NSError(domain: "NightlyWatch", code: 1) }
        XCTAssertTrue(app.buttons["批准"].exists)
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "review-watch-approval-" + theme; image.lifetime = .keepAlways; add(image)
        let meta = XCTAttachment(string: ISO8601DateFormatter().string(from: Date())); meta.name = "nightly-time-watch-approval-" + theme; meta.lifetime = .keepAlways; add(meta)
    }
}
