import XCTest

final class A14OfflineUITests: XCTestCase {
    @MainActor private func get(_ path: String) async throws -> [String: Any] {
        let driver = ProcessInfo.processInfo.environment["WEFTMATE_A14_DRIVER"]!
        let (data, response) = try await URLSession.shared.data(from: URL(string: driver + path)!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    @MainActor private func wait(_ predicate: @escaping () -> Bool, _ note: String) async throws {
        for _ in 0..<150 { if predicate() { return }; try await Task.sleep(for: .milliseconds(200)) }
        let debug = XCTAttachment(string: XCUIApplication().debugDescription); debug.name = "a14-failure-ui"; debug.lifetime = .keepAlways; add(debug)
        XCTFail(note); throw NSError(domain: "A14", code: 1)
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "a14-iphone-" + name; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testOfflineRoundtripAndForget() async throws {
        continueAfterFailure = false
        let ready = try await get("/ready"), driver = ProcessInfo.processInfo.environment["WEFTMATE_A14_DRIVER"]!
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "a14-iphone", "--a5-local-server", "--a5-theme", "light", "--server-url", ready["host"] as! String, "--a14-driver", driver]
        app.launch()
        for _ in 0..<100 {
            if (try await get("/report")["syncs"] as? Int ?? 0) > 0 { break }
            try await Task.sleep(for: .milliseconds(300))
        }
        try await wait({ app.buttons["刷新会话"].exists }, "Online workspace must finish opening before stopping the host")
        // The replica sync can finish before the initial session list, so wait for both.
        try await Task.sleep(for: .seconds(2)); _ = try await get("/stop")
        try await wait({ app.staticTexts["offlineTopWarning"].exists }, "Offline warning missing")
        XCTAssertTrue(app.staticTexts["offlineInputWarning"].exists)
        let field = app.textFields["offlineInput"].exists ? app.textFields["offlineInput"] : app.textViews["offlineInput"]
        field.tap(); field.typeText("我喝茶喜欢什么？")
        app.buttons["offlineSend"].tap()
        try await wait({ app.staticTexts["你喜欢茉莉花茶，不加糖。"].exists }, "Memory answer missing")
        capture(app, "memory")
        field.tap(); field.typeText("我徒步用墨绿色双肩背包。")
        app.buttons["offlineSend"].tap()
        try await wait({ app.staticTexts["收到，你徒步用墨绿色双肩背包。"].exists }, "Preference answer missing")
        capture(app, "preference")
        // Relaunch while the computer is still off: Keychain and ciphertext must restore.
        app.terminate(); app.launch()
        try await wait({ app.staticTexts["offlineTopWarning"].exists }, "Offline restart missing")
        app.buttons["对话"].tap()
        let row = app.buttons["我喝茶喜欢什么？"]
        try await wait({ row.exists }, "Encrypted history restore missing"); row.tap()
        try await wait({ app.staticTexts["你喜欢茉莉花茶，不加糖。"].exists }, "Restored answer missing")
        _ = try await get("/start")
        try await wait({ app.buttons["offlineHistory"].exists }, "Synced history entry missing")
        app.buttons["offlineHistory"].tap()
        try await wait({ app.staticTexts["已同步"].firstMatch.exists }, "Sync receipt missing")
        capture(app, "synced")
        let report = try await get("/report")
        XCTAssertEqual(report["modelCalls"] as? Int, 2)
        XCTAssertEqual((report["ingested"] as? [Any])?.count, 2)
        XCTAssertEqual(report["unrelatedSent"] as? Bool, false)
        XCTAssertEqual(report["toolsSent"] as? Bool, false)
        _ = try await get("/forget")
        try await wait({ !app.staticTexts["你喜欢茉莉花茶，不加糖。"].exists }, "Forgotten answer remains")
        _ = try await get("/stop")
        try await wait({ app.staticTexts["offlineTopWarning"].exists }, "Post-forget offline missing")
        XCTAssertFalse(app.staticTexts["收到，你徒步用墨绿色双肩背包。"].exists)
        capture(app, "forgotten")
        app.terminate()
    }
}
