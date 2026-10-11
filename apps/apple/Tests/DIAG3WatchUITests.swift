import XCTest
final class DIAG3WatchUITests: XCTestCase {
    @MainActor func testForcedTerminationMarker() {
        continueAfterFailure = false
        let namespace = "diag3-watch-" + UUID().uuidString
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ic2-icons-fixture", "--ui-testing-namespace", namespace, "--diag3-check-marker"]
        app.launch(); XCTAssertTrue(app.buttons["watchApprove"].waitForExistence(timeout: 30))
        // A test-only AX value reports actual persisted log state; no Watch UI is added in Release.
        let marker = app.descendants(matching: .any).matching(identifier: "diag3WatchMarker").firstMatch
        XCTAssertTrue(marker.waitForExistence(timeout: 20)); XCTAssertEqual(marker.value as? String, "clean")
        app.terminate(); app.launch()
        XCTAssertTrue(marker.waitForExistence(timeout: 20))
        let saved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == 'unclean'"), object: marker)
        XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 20), .completed)
        app.terminate()
    }
}
