import XCTest

final class A3TimelineUITests: XCTestCase {
    @MainActor func testLongTailOlderExecutionApprovalQuestionAndArtifact() async throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "a3-" + UUID().uuidString.prefix(8),
            "--a3-local-server", "--server-url", "http://localhost:18763"]
        app.launch()
        let row = app.descendants(matching: .any)["conversationRow.session-fixture"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 30)); row.tap()
        let draft = app.textFields["conversationDraft"]
        XCTAssertTrue(draft.waitForExistence(timeout: 20))
        let latest = app.staticTexts["最新记录 · 已打开长会话尾页"]
        XCTAssertTrue(latest.waitForExistence(timeout: 20))
        XCTAssertFalse(app.staticTexts["旧记录 0"].exists)
        let tree = XCTAttachment(string: app.debugDescription); tree.name = "A3-tail-accessibility"; tree.lifetime = .keepAlways; add(tree)
        let block = app.descendants(matching: .any)["executionBlock.22004"].firstMatch
        reach(block, app: app); XCTAssertTrue(block.exists); if !block.exists { return }
        XCTAssertFalse(app.staticTexts["列出测试目录 · 运行中"].exists)
        screenshot(app, "01-tail-collapsed")
        block.tap()
        let step = app.descendants(matching: .any)["executionStep.22004"].firstMatch
        XCTAssertTrue(step.waitForExistence(timeout: 5)); step.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "按需读取")).firstMatch.waitForExistence(timeout: 10))
        screenshot(app, "02-execution-detail")
        step.tap(); block.tap()
        let approval = app.buttons["approveOnce.11111111-1111-4111-8111-111111111111"]
        reach(approval, app: app); XCTAssertTrue(approval.isEnabled); screenshot(app, "03-approval"); approval.tap()
        let option = app.buttons["questionOption.22222222-2222-4222-8222-222222222222.format.纯文本"]
        XCTAssertTrue(option.waitForExistence(timeout: 20)); reach(option, app: app); option.tap()
        let submit = app.buttons["submitQuestion.22222222-2222-4222-8222-222222222222"]
        reach(submit, app: app); XCTAssertTrue(submit.isEnabled); XCTAssertEqual(option.value as? String, "已选择"); screenshot(app, "04-question"); submit.tap()
        let preview = app.buttons["previewArtifact.22011"]
        reach(preview, app: app); XCTAssertTrue(preview.waitForExistence(timeout: 25))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "执行了 1 步")).firstMatch.exists)
        screenshot(app, "05-completed-artifact"); preview.tap()
        let content = app.staticTexts["attachmentTextContent"]
        XCTAssertTrue(content.waitForExistence(timeout: 15)); XCTAssertTrue(content.label.contains("A3 合成成果"))
        XCTAssertTrue(app.buttons["保存文件"].exists); XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "分享")).firstMatch.exists)
        screenshot(app, "06-artifact-preview")
        app.buttons["关闭预览"].tap()
        // Navigate to the beginning of the loaded tail; explicit upward paging retains the current conversation.
        let older = app.buttons["loadOlderTimeline"]
        for _ in 0..<35 {
            if older.exists && older.isHittable && older.frame.minY > app.navigationBars.firstMatch.frame.maxY &&
                older.frame.maxY < draft.frame.minY - 60 { break }
            scrollEarlier(app)
        }
        XCTAssertTrue(older.exists && older.isHittable)
        let readingAnchor = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "旧记录 ")).allElementsBoundByIndex.first {
            $0.frame.minY > app.navigationBars.firstMatch.frame.maxY && $0.frame.maxY < draft.frame.minY - 60
        }
        let anchorLabel = try XCTUnwrap(readingAnchor?.label)
        let anchorY = app.staticTexts[anchorLabel].frame.minY
        older.tap()
        let (data, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:18763/personal/v1/test/report")!)
        let report = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let requests = try XCTUnwrap(report["requests"] as? [[String: Any]])
        XCTAssertTrue(requests.contains { ($0["query"] as? [String: [String]])?["beforeSeq"]?.first == "21906" })
        XCTAssertFalse(requests.contains { ($0["query"] as? [String: [String]])?["afterSeq"]?.first == "-1" })
        let retainedAnchor = app.staticTexts[anchorLabel]
        print("A3 reading anchor \(anchorLabel): before=\(anchorY), after=\(retainedAnchor.frame.minY)")
        XCTAssertEqual(retainedAnchor.frame.minY, anchorY, accuracy: 48, "Prepending a page moved the reading anchor")
        let earlier = app.staticTexts["旧记录 21806"]
        for _ in 0..<16 {
            if earlier.exists && earlier.isHittable { break }
            scrollEarlier(app)
        }
        XCTAssertTrue(earlier.exists)
        XCTAssertTrue(draft.exists)
        screenshot(app, "07-older-page")
        XCTAssertFalse(app.buttons["conversationTasksButton"].exists)
        XCTAssertFalse(app.scrollViews["taskWorkspace"].exists)
    }
    @MainActor private func reach(_ element: XCUIElement, app: XCUIApplication) {
        let window = app.windows.firstMatch, draft = app.textFields["conversationDraft"]
        for _ in 0..<12 {
            let top = app.navigationBars.firstMatch.frame.maxY + 12
            let bottom = draft.frame.minY - 60
            if element.exists, element.isHittable, element.frame.minY > top, element.frame.maxY < bottom { return }
            let goingDown = !element.exists || element.frame.maxY >= bottom
            let origin = window.coordinate(withNormalizedOffset: .zero)
            let start = origin.withOffset(CGVector(dx: window.frame.midX, dy: goingDown ? bottom - 20 : top + 20))
            let end = origin.withOffset(CGVector(dx: window.frame.midX, dy: goingDown ? top + 20 : bottom - 20))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
    }
    @MainActor private func scrollEarlier(_ app: XCUIApplication) {
        let window = app.windows.firstMatch
        let top = app.navigationBars.firstMatch.frame.maxY + 30
        let bottom = app.textFields["conversationDraft"].frame.minY - 80
        let origin = window.coordinate(withNormalizedOffset: .zero)
        origin.withOffset(CGVector(dx: window.frame.midX, dy: top)).press(forDuration: 0.05,
            thenDragTo: origin.withOffset(CGVector(dx: window.frame.midX, dy: bottom)),
            withVelocity: .slow, thenHoldForDuration: 0.2)
    }
    @MainActor private func screenshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "A3-" + name
        attachment.lifetime = .keepAlways; add(attachment)
    }
}
