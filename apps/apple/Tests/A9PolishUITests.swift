import XCTest

final class A9PolishUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    private var driver: String { ProcessInfo.processInfo.environment["WEFTMATE_A5_DRIVER"]! }
    @MainActor private func get(_ path: String) async throws -> [String: Any] {
        let (bytes, response) = try await URLSession.shared.data(from: URL(string: driver + path)!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
    }
    @MainActor private func expect(_ item: XCUIElement) throws {
        guard item.waitForExistence(timeout: 30) else { XCTFail("Missing " + item.identifier); throw NSError(domain: "A9UI", code: 1) }
    }
    @MainActor private func tap(_ item: XCUIElement) throws { try expect(item); item.tap() }
    @MainActor private func keep(_ app: XCUIApplication, _ scene: String, _ theme: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "a9-iphone-" + scene + "-" + theme
        image.lifetime = .keepAlways; add(image)
    }
    @MainActor private func settings(_ app: XCUIApplication) throws {
        try tap(app.buttons["phoneAccountMenu"]); try tap(app.buttons["phoneMenu.settings"])
        try tap(app.buttons["settingsCategory.general"])
    }
    @MainActor func testLightPolish() async throws { try await run("light", before: ProcessInfo.processInfo.environment["WEFTMATE_A9_BASELINE"] == "1") }
    @MainActor func testDarkPolish() async throws { try await run("dark", before: ProcessInfo.processInfo.environment["WEFTMATE_A9_BASELINE"] == "1") }
    @MainActor private func run(_ theme: String, before: Bool) async throws {
        _ = try await get("/a5/setup"); _ = try await get("/bootstrap"); _ = try await get("/a8/prepare")
        let ready = try await get("/ready"), ids = try await get("/a5/ids")
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "a9-" + UUID().uuidString.prefix(8), "--a5-local-server", "--a5-theme", theme, "--server-url", ready["host"] as! String]
        app.launch(); defer { app.terminate() }
        try tap(app.descendants(matching: .any).matching(identifier: "conversationRow." + (ids["review"] as! String)).firstMatch)
        try expect(app.staticTexts["processingLine"])
        let stop = app.buttons["sendButton"]
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: stop)
        let result = await XCTWaiter.fulfillment(of: [enabled], timeout: 30); XCTAssertEqual(result, .completed)
        keep(app, "stop", theme)
        try settings(app)
        if before { XCTAssertFalse(app.segmentedControls["runningMessageMode"].exists) }
        else {
            try expect(app.segmentedControls["runningMessageMode"])
            XCTAssertTrue(app.segmentedControls["runningMessageMode"].buttons["排队"].isSelected)
            try expect(app.staticTexts["等当前回复结束后作为下一条处理。"])
            try expect(app.staticTexts["插入当前回复，引导它调整方向。"])
        }
        keep(app, "general", theme); try tap(app.buttons["closeAuxiliarySheetButton"])
        _ = try await get("/a8/tools")
        let group = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "executionBlock.")).firstMatch
        try expect(group); keep(app, "progress", theme); try tap(group)
        let step = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "executionStep.")).firstMatch
        try tap(step); try expect(app.buttons["复制"])
        if !before {
            try expect(app.staticTexts["路径：notes.md"]); try expect(app.staticTexts["合成步骤完成。"])
            XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "toolCallId")).firstMatch.exists)
            XCTAssertTrue(app.buttons["查看使用的来源"].exists)
        }
        keep(app, "detail", theme)
        if !before {
            try tap(app.buttons["查看原始数据"])
            try expect(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "toolCallId")).firstMatch)
            keep(app, "raw", theme); try tap(app.buttons["查看原始数据"])
        }
        try tap(step); try tap(group)
        if !before {
            for mode in ["排队", "引导"] {
                try settings(app); try tap(app.segmentedControls["runningMessageMode"].buttons[mode])
                keep(app, "general-" + (mode == "排队" ? "queue" : "steer"), theme)
                try tap(app.buttons["closeAuxiliarySheetButton"])
                // Reopen verifies the control reads the saved device/account preference.
                try settings(app); XCTAssertTrue(app.segmentedControls["runningMessageMode"].buttons[mode].isSelected)
                try tap(app.buttons["closeAuxiliarySheetButton"])
                let draft = app.textFields["conversationDraft"]; try tap(draft); draft.typeText("合成" + mode + "消息")
                XCTAssertEqual(stop.label, "发送"); keep(app, "send-" + (mode == "排队" ? "queue" : "steer"), theme)
                try tap(stop)
                let cleared = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "停止"), object: stop)
                let result = await XCTWaiter.fulfillment(of: [cleared], timeout: 30); XCTAssertEqual(result, .completed)
                let report = try await get("/a5/report")
                XCTAssertTrue((report["operations"] as! [[String: Any]]).contains { $0["kind"] as? String == "send" && $0["text"] as? String == "合成" + mode + "消息" && $0["mode"] as? String == (mode == "排队" ? "queue" : "steer") })
            }
            app.terminate(); app.launch()
            try tap(app.descendants(matching: .any).matching(identifier: "conversationRow." + (ids["review"] as! String)).firstMatch)
            try settings(app); XCTAssertTrue(app.segmentedControls["runningMessageMode"].buttons["引导"].isSelected)
            try tap(app.buttons["closeAuxiliarySheetButton"])
            _ = try await get("/a8/failure")
            try expect(app.staticTexts["合成检查失败，请检查输入文件。"])
            keep(app, "error", theme)
        }
    }
}
