import XCTest

final class A12WatchLiveUITests: XCTestCase {
    @MainActor private func get(_ path: String) async throws -> [String: Any] {
        let driver = ProcessInfo.processInfo.environment["WEFTMATE_A12_DRIVER"]!
        let (data, response) = try await URLSession.shared.data(from: URL(string: driver + path)!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    @MainActor private func wait(_ element: XCUIElement, enabled: Bool = false) throws {
        let predicate = NSPredicate(format: enabled ? "exists == true AND enabled == true" : "exists == true")
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 90), .completed)
    }
    @MainActor func testRealPairedPhoneApprovalAndRejection() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--a12-live-evidence"]
        app.launch()
        let approval = try await get("/approve/start")
        let headline = "要运行命令：rm " + (approval["filename"] as! String)
        try wait(app.staticTexts[headline])
        try wait(app.buttons["批准"], enabled: true)
        _ = try await get("/capture/approve-pending")
        app.buttons["批准"].tap()
        try wait(app.descendants(matching: .any)["watchCompletion"])
        try wait(app.buttons["刷新"], enabled: true)
        XCTAssertFalse(app.buttons["批准"].exists)
        _ = try await get("/capture/approve-ended")
        let rejection = try await get("/reject/start")
        try wait(app.staticTexts["要运行命令：rm " + (rejection["filename"] as! String)])
        try wait(app.buttons["拒绝"], enabled: true)
        _ = try await get("/capture/reject-pending")
        app.buttons["拒绝"].tap()
        try wait(app.staticTexts["watchStopped"])
        try wait(app.buttons["刷新"], enabled: true)
        XCTAssertFalse(app.buttons["拒绝"].exists)
        _ = try await get("/capture/reject-ended")
        let report = try await get("/report")
        let rows = report["scenarios"] as! [[String: Any]]
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0]["outcome"] as? String, "allowed-once")
        XCTAssertEqual(rows[0]["fileExists"] as? Bool, false)
        XCTAssertEqual(rows[1]["outcome"] as? String, "rejected")
        XCTAssertEqual(rows[1]["fileExists"] as? Bool, true)
        let posts = report["approvalHTTP"] as! [[String: Any]]
        XCTAssertEqual(posts.count, 2)
        XCTAssertTrue(posts.allSatisfy { $0["status"] as? Int == 200 })
        let attachment = XCTAttachment(string: String(data: try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
        attachment.name = "A12-host-receipts"; attachment.lifetime = .keepAlways; add(attachment)
    }
}
