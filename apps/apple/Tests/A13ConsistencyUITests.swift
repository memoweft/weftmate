import XCTest

final class A13ConsistencyUITests: XCTestCase {
    @MainActor private func get(_ path: String) async throws -> [String: Any] {
        let driver = ProcessInfo.processInfo.environment["WEFTMATE_A13_DRIVER"]!
        let (data, response) = try await URLSession.shared.data(from: URL(string: driver + path)!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    @MainActor private func expect(_ item: XCUIElement) throws {
        if !item.waitForExistence(timeout: 30) { throw NSError(domain: "A13MissingControl", code: 1) }
    }
    @MainActor private func tap(_ item: XCUIElement) throws { try expect(item); item.tap() }
    @MainActor private func gone(_ item: XCUIElement) async {
        let e = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: item)
        let result = await XCTWaiter.fulfillment(of: [e], timeout: 30); XCTAssertEqual(result, .completed)
    }
    @MainActor private func keep(_ app: XCUIApplication, _ scene: String, _ theme: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "a13-iphone-" + scene + "-" + theme; image.lifetime = .keepAlways; add(image)
        // One native accessibility snapshot, captured next to the PNG. Parse visible
        // labels/values only; identifiers and transport fields never become copy.
        let snapshot = app.debugDescription
        let regex = try! NSRegularExpression(pattern: "(?:label|value): '([^']*)'")
        let frames = try! NSRegularExpression(pattern: "\\{\\{(-?[0-9.]+), (-?[0-9.]+)\\}, \\{([0-9.]+), ([0-9.]+)\\}\\}")
        let bounds = app.frame
        var strings = Set<String>()
        let native = snapshot as NSString
        for match in regex.matches(in: snapshot, range: NSRange(snapshot.startIndex..., in: snapshot)) {
            let line = native.substring(with: native.lineRange(for: NSRange(location: match.range.location, length: 0)))
            if let frame = frames.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) {
                let n = (1...4).map { Double(line[Range(frame.range(at: $0), in: line)!])! }
                if !CGRect(x: n[0], y: n[1], width: n[2], height: n[3]).intersects(bounds) || n[2] == 0 || n[3] == 0 { continue }
            }
            strings.insert(String(snapshot[Range(match.range(at: 1), in: snapshot)!]))
        }
        let unquoted = try! NSRegularExpression(pattern: "value: (?!')([^\\n]+)")
        for match in unquoted.matches(in: snapshot, range: NSRange(snapshot.startIndex..., in: snapshot)) { strings.insert(String(snapshot[Range(match.range(at: 1), in: snapshot)!])) }
        let text = XCTAttachment(string: strings.sorted().joined(separator: "\n")); text.name = "a13-text-" + scene + "-" + theme; text.lifetime = .keepAlways; add(text)
    }
    @MainActor func testLightConsistency() async throws { try await run("light") }
    @MainActor func testDarkConsistency() async throws { try await run("dark") }
    @MainActor private func run(_ theme: String) async throws {
        continueAfterFailure = false
        _ = try await get("/prepare"); let ready = try await get("/ready")
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "a13-" + UUID().uuidString.prefix(8), "--a5-local-server", "--a5-theme", theme, "--server-url", ready["host"] as! String, "--a12-live-session", ready["sessionID"] as! String]
        app.launch(); defer { app.terminate() }
        try expect(app.descendants(matching: .any)["approvalBar"])
        try expect(app.staticTexts["处理审批后还有 3 个问题"])
        XCTAssertFalse(app.descendants(matching: .any)["questionBar"].exists)
        keep(app, "approval-priority", theme)
        for _ in 0..<2 {
            let button = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "approveOnce.")).firstMatch
            try tap(button); try await Task.sleep(for: .seconds(1))
        }
        try await gone(app.descendants(matching: .any)["approvalBar"])
        try tap(app.buttons["questionOption.format.简要报告"])
        XCTAssertEqual(app.buttons["questionOption.format.简要报告"].value as? String, "已选择")
        try expect(app.staticTexts["还有 2 个问题"]); keep(app, "single-choice", theme)
        try tap(app.buttons["questionDetails"]); try expect(app.staticTexts["完整说明：只用于合成报告的格式选择。"]); keep(app, "description", theme)
        let other = app.textFields["questionCustom.format"]
        try tap(other); other.typeText("合成其他格式\n")
        XCTAssertTrue(app.buttons["questionNext"].exists); XCTAssertEqual(app.buttons["questionOption.format.简要报告"].value as? String, "未选择")
        let partial = try await get("/report"); XCTAssertEqual((partial["questionHTTP"] as! [Any]).count, 0)
        keep(app, "other-input-return", theme)
        try tap(app.buttons["questionNext"])
        try tap(app.buttons["questionOption.sections.摘要"]); try tap(app.buttons["questionOption.sections.步骤"])
        let multiple = app.textFields["questionCustom.sections"]; try tap(multiple); multiple.typeText("合成补充")
        XCTAssertEqual(app.buttons["questionOption.sections.摘要"].value as? String, "已选择")
        XCTAssertEqual(app.buttons["questionOption.sections.步骤"].value as? String, "已选择")
        keep(app, "multiple-choice", theme)
        try tap(app.buttons["questionNext"]); let free = app.textFields["questionCustom.note"]; try tap(free); free.typeText("合成自由回答\n")
        let submit = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "submitQuestion.")).firstMatch
        try expect(submit); keep(app, "free-answer", theme)
        let before = try await get("/report"); XCTAssertEqual((before["questionHTTP"] as! [Any]).count, 0)
        try tap(submit); try await gone(app.descendants(matching: .any)["questionBar"])
        let answered = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "answeredQuestion.")).firstMatch
        try expect(answered); XCTAssertTrue(answered.label.contains("合成其他格式")); keep(app, "answered", theme)
        let report = try await get("/report"), http = report["questionHTTP"] as! [[String: Any]]
        XCTAssertEqual(http.count, 1); XCTAssertEqual(http[0]["status"] as? Int, 200)
        let answers = ((http[0]["request"] as! [String: Any])["answer"] as! [String: Any])["answers"] as! [[String: Any]]
        XCTAssertEqual(answers.map { $0["id"] as! String }, ["format", "sections", "note"])
        XCTAssertEqual(answers[0]["selected"] as? [String], []); XCTAssertEqual(answers[1]["selected"] as? [String], ["摘要", "步骤"])
        _ = try await get("/retry-batch")
        try tap(app.buttons["questionOption.format.完整记录"]); try tap(app.buttons["questionNext"])
        try tap(app.buttons["questionOption.sections.摘要"]); try tap(app.buttons["questionNext"])
        let retryInput = app.textFields["questionCustom.note"]; try tap(retryInput); retryInput.typeText("合成重试回答")
        _ = try await get("/lose-next"); try tap(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "submitQuestion.")).firstMatch)
        let retry = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "continueInteraction.question:")).firstMatch
        if retry.waitForExistence(timeout: 4) { keep(app, "retry", theme); try tap(retry) }
        try await gone(app.descendants(matching: .any)["questionBar"]); keep(app, "retry-reconciled", theme)
        try tap(app.buttons["openConversationResources"]); try expect(app.descendants(matching: .any)["conversationResourceList"])
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "准备可用工具")).firstMatch.exists)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "扩展服务")).firstMatch.exists)
        keep(app, "chinese-sources", theme)
        try tap(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "扩展服务")).firstMatch)
        try tap(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "详情")).firstMatch); try expect(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "附加信息")).firstMatch)
        keep(app, "chinese-detail", theme); try tap(app.buttons["closeResourcesPanel"])
        try tap(app.navigationBars.buttons.firstMatch)
        try tap(app.buttons["phoneAccountMenu"]); try tap(app.buttons["phoneMenu.settings"])
        try tap(app.buttons["settingsCategory.usage"])
        try expect(app.staticTexts["usageTotalCost"]); keep(app, "usage-month", theme)
        let picker = app.descendants(matching: .any)["usageMonth"]
        try tap(picker); keep(app, "usage-month-picker", theme)
        let calendar = Calendar(identifier: .gregorian), previous = calendar.date(byAdding: .month, value: -1, to: Date())!
        let previousLabel = "\(calendar.component(.year, from: previous)) 年 \(calendar.component(.month, from: previous)) 月"
        try tap(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", previousLabel)).firstMatch)
        try tap(app.buttons["readUsageMonth"]); try await Task.sleep(for: .seconds(1)); keep(app, "usage-month-selected", theme)
        XCTAssertFalse(app.textFields["usageMonth"].exists)
        let receipt = XCTAttachment(string: String(decoding: try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]), as: UTF8.self)); receipt.name = "a13-host-receipt"; receipt.lifetime = .keepAlways; add(receipt)
    }
}
