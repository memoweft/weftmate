import XCTest

final class A15UXUITests: XCTestCase {
    @MainActor private func get(_ path: String) async throws -> [String: Any] {
        let driver = ProcessInfo.processInfo.environment["WEFTMATE_A15_DRIVER"]!
        let (data,response) = try await URLSession.shared.data(from: URL(string: driver + path)!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode,200)
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    @MainActor private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
    @MainActor private func expect(_ item: XCUIElement) throws {
        if !item.waitForExistence(timeout: 25) { XCTFail("Missing native control: " + item.identifier); throw NSError(domain: "A15MissingControl",code: 1) }
    }
    @MainActor private func tap(_ item: XCUIElement) throws { try expect(item); item.tap() }
    @MainActor private func keep(_ app: XCUIApplication, _ scene: String, _ theme: String) {
        #if os(macOS)
        let screenshot = app.windows.firstMatch.screenshot()
        #else
        let screenshot = app.screenshot()
        #endif
        let image = XCTAttachment(screenshot: screenshot); image.name = "a15-" + scene + "-" + theme; image.lifetime = .keepAlways; add(image)
        let snapshot = app.debugDescription
        let regex = try! NSRegularExpression(pattern: "(?:label|value): '([^']*)'")
        let strings = regex.matches(in: snapshot,range: NSRange(snapshot.startIndex...,in: snapshot)).map { String(snapshot[Range($0.range(at: 1),in: snapshot)!]) }
        let text = XCTAttachment(string: strings.joined(separator: "\n")); text.name = "a15-text-" + scene + "-" + theme; text.lifetime = .keepAlways; add(text)
    }
    @MainActor func testLightUX23() async throws { try await run("light") }
    @MainActor func testDarkUX23() async throws { try await run("dark") }
    @MainActor private func run(_ theme: String) async throws {
        continueAfterFailure = false
        let ready = try await get("/ready"), project = ready["projectID"] as! String, session = ready["sessionID"] as! String
        let ids = ready["projectIDs"] as! [String]
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing","--ui-testing-namespace","a15-" + UUID().uuidString.prefix(8),"--a5-local-server","--a5-theme",theme,"--server-url",ready["host"] as! String,"--a15-synthetic-media"]
        #if os(macOS)
        app.launchArguments += ["--a10-ephemeral-credentials"]
        #endif
        app.launch(); defer { app.terminate() }
        let more = element(app,"projectMore." + project)
        try expect(more); XCTAssertTrue(more.label.contains("2")); keep(app,"recent-five",theme)
        XCTAssertFalse(element(app,"conversationRow." + ids[0]).exists)
        try tap(more); try expect(element(app,"conversationRow." + ids[0])); keep(app,"project-expanded",theme)
        XCTAssertEqual(more.value as? String,"已展开")
        #if os(macOS)
        let row = element(app,"conversationRow." + ids[6]); row.hover()
        try expect(app.buttons["sessionPin." + ids[6]])
        try await Task.sleep(for: .milliseconds(700)); try expect(element(app,"sessionHoverDetails")); keep(app,"hover-details",theme)
        try tap(app.buttons["sessionPin." + ids[6]])
        row.hover(); try tap(app.buttons["sessionArchive." + ids[6]])
        #else
        let row = element(app,"conversationRow." + ids[6]); row.press(forDuration: 1)
        try tap(app.buttons["sessionAction.archive"])
        #endif
        let undoDebug = XCTAttachment(string: app.debugDescription); undoDebug.name = "a15-debug-archive-receipt-" + theme; undoDebug.lifetime = .keepAlways; add(undoDebug)
        try expect(app.buttons["撤销归档"])
        // This action expires after ten seconds. Retain the screenshot before the
        // native hierarchy scan, then immediately use the real undo control.
        let undoImage = XCTAttachment(screenshot: app.screenshot()); undoImage.name = "a15-archive-undo-" + theme; undoImage.lifetime = .keepAlways; add(undoImage)
        let undoText = XCTAttachment(string: app.buttons["撤销归档"].label); undoText.name = "a15-text-archive-undo-" + theme; undoText.lifetime = .keepAlways; add(undoText)
        try tap(app.buttons["撤销归档"])
        try expect(element(app,"conversationRow." + ids[6]))
        #if os(macOS)
        try tap(app.buttons["macAccountMenu"])
        #else
        try tap(app.buttons["phoneAccountMenu"])
        #endif
        keep(app,"account-menu",theme)
        #if os(macOS)
        try expect(element(app,"accountUsageTotal")); XCTAssertTrue(element(app,"accountUsageTotal").label.contains("剩余"))
        app.typeKey(.escape,modifierFlags: [])
        #else
        try tap(app.buttons["phoneMenu.settings"]); try expect(element(app,"accountUsageTotal")); keep(app,"settings-usage",theme)
        try tap(app.buttons["closeAuxiliarySheetButton"])
        #endif
        try tap(element(app,"conversationRow." + session))
        let plus = app.buttons["addAttachmentButton"]
        try expect(plus); try tap(plus); keep(app,"plus-menu",theme)
        #if os(macOS)
        try expect(app.buttons["composer.screenshot"]); try expect(app.buttons["composer.clipboard"])
        #else
        try expect(app.buttons["composer.camera"]); try expect(app.buttons["composer.photos"])
        #endif
        try expect(app.buttons["composer.file"])
        try tap(app.buttons["composer.thinking"]); try expect(element(app,"thinkingMarker")); keep(app,"thinking-enabled",theme)
        try tap(plus); try tap(app.buttons["composer.thinking"])
        let disabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element(app,"thinkingMarker"))
        let disableResult = await XCTWaiter.fulfillment(of: [disabled],timeout: 15); XCTAssertEqual(disableResult,.completed)
        try tap(plus); try tap(app.buttons["composer.syntheticFile"])
        try expect(app.staticTexts["A2-测试文件.txt"])
        #if os(macOS)
        try tap(plus); try tap(app.buttons["composer.screenshot"])
        try tap(plus); try tap(app.buttons["composer.clipboard"])
        #endif
        keep(app,"synthetic-attachments",theme)
        #if os(iOS)
        XCTAssertEqual(element(app,"conversationDraft").placeholderValue,"排队到下一条…")
        try tap(app.buttons["phoneAccountMenu"]);try tap(app.buttons["phoneMenu.settings"])
        try tap(app.buttons["settingsCategory.general"])
        try tap(element(app,"runningMessageMode").buttons["引导"])
        try tap(app.buttons["closeAuxiliarySheetButton"])
        XCTAssertEqual(element(app,"conversationDraft").placeholderValue,"引导当前回复…");keep(app,"running-steer",theme)
        try tap(app.buttons["phoneAccountMenu"]);try tap(app.buttons["phoneMenu.settings"])
        try tap(app.buttons["settingsCategory.general"])
        try tap(element(app,"runningMessageMode").buttons["排队"])
        try tap(app.buttons["closeAuxiliarySheetButton"])
        XCTAssertEqual(element(app,"conversationDraft").placeholderValue,"排队到下一条…");keep(app,"running-queue",theme)
        #endif
        let subtasks = element(app,"composerSubtasks")
        try tap(subtasks)
        XCTAssertEqual(subtasks.value as? String,"已展开")
        let subtaskDebug = XCTAttachment(string: app.debugDescription); subtaskDebug.name = "a15-debug-subtasks-" + theme; subtaskDebug.lifetime = .keepAlways; add(subtaskDebug)
        let active = app.buttons.matching(NSPredicate(format:"label CONTAINS %@","合成进行中")).firstMatch
        try expect(active); keep(app,"subtask-list",theme)
        XCTAssertTrue(active.label.contains("进行中")); XCTAssertTrue(active.label.contains("秒"))
        try tap(active)
        let step = element(app,"executionStep." + String(ready["activeStepSeq"] as! Int))
        try expect(step); XCTAssertEqual(step.value as? String,"已展开")
        keep(app,"subtask-step",theme)
        #if os(iOS)
        let input = element(app,"conversationDraft");try tap(input);input.typeText("合成焦点保持")
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        #endif
        _ = try await get("/finish")
        let ended = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"),object: subtasks)
        let endedResult = await XCTWaiter.fulfillment(of: [ended],timeout: 30); XCTAssertEqual(endedResult,.completed)
        #if os(iOS)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        XCTAssertTrue((element(app,"conversationDraft").value as? String)?.contains("合成焦点保持") == true)
        #endif
        let report = try await get("/report")
        let traffic = report["traffic"] as! [[String: Any]]
        XCTAssertTrue(traffic.contains { $0["method"] as? String == "PATCH" && ($0["body"] as? [String: Any])?["enabled"] as? Bool == true })
        XCTAssertTrue(traffic.contains { $0["method"] as? String == "PATCH" && ($0["body"] as? [String: Any])?["enabled"] as? Bool == false })
        keep(app,"subtasks-ended",theme)
    }
}
