import XCTest

final class A4bResourcesUITests: XCTestCase {
    private let base = "http://127.0.0.1:18765/personal/v1"
    @MainActor private func launch() async throws -> XCUIApplication {
        continueAfterFailure = false
        var request = URLRequest(url: URL(string: base + "/test/reset")!); request.httpMethod = "POST"
        _ = try await URLSession.shared.data(for: request)
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "a4b-" + UUID().uuidString.prefix(8),
            "--a4b-local-server", "--server-url", "http://localhost:18765"]
        app.launch()
        let row = element(app, "conversationRow.session-fixture")
        XCTAssertTrue(row.waitForExistence(timeout: 30)); row.tap()
        XCTAssertTrue(app.buttons["memoryUsed.3"].waitForExistence(timeout: 20))
        return app
    }
    @MainActor func testMemoryOriginalUnavailableAndReturnToDraft() async throws {
        let app = try await launch()
        XCTAssertFalse(app.buttons["memoryUsed.0"].exists); XCTAssertFalse(app.buttons["memoryUsed.1"].exists)
        let draft = app.textFields["conversationDraft"]
        draft.tap(); draft.typeText("A4b draft preserved")
        app.buttons["openConversationResources"].tap()
        XCTAssertTrue(app.buttons["closeResourcesPanel"].waitForExistence(timeout: 10))
        app.buttons["closeResourcesPanel"].tap()
        XCTAssertTrue(app.buttons["memoryUsed.3"].waitForExistence(timeout: 10))
        app.buttons["memoryUsed.3"].tap()
        XCTAssertTrue(element(app, "conversationResourcesPanel").waitForExistence(timeout: 10))
        screenshot(app, "01-memory-summaries")
        element(app, "memoryOriginal.memory-fixture").tap()
        XCTAssertTrue(app.staticTexts["请以后用中文回答，技术问题用买菜的例子解释。"].waitForExistence(timeout: 10))
        screenshot(app, "02-memory-original")
        element(app, "memoryOriginal.memory-forgotten").tap()
        XCTAssertTrue(app.staticTexts["当前来源不可读或已被忘掉，请稍后重试。"].waitForExistence(timeout: 10))
        screenshot(app, "03-memory-unavailable")
        app.buttons["closeResourcesPanel"].tap()
        XCTAssertTrue(app.buttons["memoryUsed.3"].waitForExistence(timeout: 10))
        XCTAssertEqual(draft.value as? String, "A4b draft preserved")
        screenshot(app, "04-return-position-draft")
        let report = try await report()
        let requests = try XCTUnwrap(report["requests"] as? [[String: Any]])
        XCTAssertEqual(requests.filter { ($0["path"] as? String) == "/memory/items/cognition/memory-fixture/sources" }.count, 1)
        XCTAssertFalse(requests.contains { ($0["path"] as? String)?.contains("/detail") == true })
    }
    @MainActor func testOutputGroupsPagedUsesOnDemandRawAndArtifactEntry() async throws {
        let app = try await launch()
        app.buttons["openConversationResources"].tap()
        let source = app.buttons["resourceSource.tool:read"]
        XCTAssertTrue(source.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["resourceOutput.artifact-new"].exists)
        screenshot(app, "05-output-source-list")
        let before = try await report()
        let beforeRequests = try XCTUnwrap(before["requests"] as? [[String: Any]])
        XCTAssertFalse(beforeRequests.contains { ($0["path"] as? String)?.hasSuffix("/detail") == true })
        source.tap()
        XCTAssertTrue(app.staticTexts["调用 2 次"].waitForExistence(timeout: 10))
        screenshot(app, "06-two-readable-uses")
        element(app, "resourceUse.call-read-a").tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "合成原始内容")).firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["内容已截断。"].exists)
        screenshot(app, "07-raw-content")
        app.buttons["closeResourcesPanel"].tap()
        app.buttons["previewArtifact.2"].tap()
        XCTAssertTrue(element(app, "attachmentTextContent").waitForExistence(timeout: 10))
        screenshot(app, "08-artifact-shared-panel")
        app.buttons["closeResourcesPanel"].tap()
        XCTAssertTrue(app.buttons["memoryUsed.3"].waitForExistence(timeout: 10))
        let after = try await report()
        let requests = try XCTUnwrap(after["requests"] as? [[String: Any]])
        XCTAssertEqual(requests.filter { ($0["path"] as? String) == "/sessions/session-fixture/events/11/detail" }.count, 1)
        XCTAssertEqual(requests.filter { ($0["path"] as? String) == "/artifacts/artifact-new/download" }.count, 1)
    }
    @MainActor private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }
    @MainActor private func report() async throws -> [String: Any] {
        let (data, _) = try await URLSession.shared.data(from: URL(string: base + "/test/report")!)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
    @MainActor private func screenshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "A4b-ios-" + name
        attachment.lifetime = .keepAlways; add(attachment)
    }
}
