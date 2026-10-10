import XCTest

final class A17StatesUITests: XCTestCase {
    @MainActor func testState() async throws { try await checkState(ProcessInfo.processInfo.environment["WEFTMATE_A17_STATE"]!) }
    @MainActor func testAllStates() async throws {
        let driver = ProcessInfo.processInfo.environment["WEFTMATE_A17_DRIVER"]!
        for state in ["empty", "no-model", "error", "loading"] {
            let (_, response) = try await URLSession.shared.data(from: URL(string: driver + "/state/" + state)!)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            try await checkState(state)
        }
    }
    @MainActor private func checkState(_ state: String) async throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        let driver = env["WEFTMATE_A17_DRIVER"]!, theme = env["WEFTMATE_A17_THEME"]!
        let (data, _) = try await URLSession.shared.data(from: URL(string: driver + "/ready")!)
        let ready = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "a17-states-" + UUID().uuidString,
            "--a5-local-server", "--a5-theme", theme, "--server-url", ready["host"] as! String]
        if env["WEFTMATE_A17_LARGE_TEXT"] == "1" { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
        app.launch(); defer { app.terminate() }
        switch state {
        case "no-model":
            XCTAssertTrue(app.staticTexts["添加模型，开始对话"].waitForExistence(timeout: 30))
            let draft = app.descendants(matching: .any).matching(identifier: "mainChat.draft").firstMatch
            XCTAssertTrue(draft.exists); XCTAssertFalse(draft.isEnabled)
            let configure = app.buttons["设置模型"]
            XCTAssertTrue(configure.isEnabled)
            if env["WEFTMATE_A17_LARGE_TEXT"] == "1" {
                for _ in 0..<5 { if configure.isHittable { break }; app.scrollViews.firstMatch.swipeUp() }
                XCTAssertTrue(configure.isHittable, "Large text must leave the model action reachable")
            }
        case "empty": XCTAssertTrue(app.staticTexts["从这里开始"].waitForExistence(timeout: 30))
        case "error": XCTAssertTrue(app.buttons["重试"].waitForExistence(timeout: 30))
        case "loading": XCTAssertTrue(app.activityIndicators.firstMatch.waitForExistence(timeout: 10))
        default: XCTFail("Unknown synthetic state")
        }
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "a17-state-" + state + "-" + theme; image.lifetime = .keepAlways; add(image)
        let text = XCTAttachment(string: app.debugDescription); text.name = "a17-text-" + state + "-" + theme; text.lifetime = .keepAlways; add(text)
    }
    @MainActor func testNativePanels() async throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment, theme = ProcessInfo.processInfo.environment["WEFTMATE_A17_THEME"]!
        let (data, _) = try await URLSession.shared.data(from: URL(string: env["WEFTMATE_A17_DRIVER"]! + "/ready")!)
        let ready = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "a17-panels-" + UUID().uuidString,
            "--a5-local-server", "--a5-theme", theme, "--server-url", ready["host"] as! String]
        app.launch(); defer { app.terminate() }
        func press(_ element: XCUIElement) {
            XCTAssertTrue(element.waitForExistence(timeout: 20))
            element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        func keep(_ name: String) {
            let image = XCTAttachment(screenshot: app.screenshot()); image.name = "a17-panel-" + name + "-" + theme; image.lifetime = .keepAlways; add(image)
            let text = XCTAttachment(string: app.debugDescription); text.name = "a17-text-panel-" + name + "-" + theme; text.lifetime = .keepAlways; add(text)
        }
        let plus = app.descendants(matching: .any).matching(identifier: "mainChat.plus").firstMatch
        XCTAssertTrue(plus.waitForExistence(timeout: 30))
        press(plus); keep("plus")
        press(app.buttons["相机"].firstMatch)
        XCTAssertTrue(app.staticTexts["相机暂不可用，可从照片或文件添加。"].waitForExistence(timeout: 10)); keep("camera-unavailable")
        press(app.buttons["重试"].firstMatch)
        press(plus); press(app.buttons["照片"].firstMatch)
        XCTAssertTrue(app.buttons["取消"].firstMatch.waitForExistence(timeout: 15)); keep("photos")
        press(app.buttons["取消"].firstMatch)
        press(plus); XCTAssertTrue(app.buttons["文件"].firstMatch.waitForExistence(timeout: 10)); app.buttons["文件"].firstMatch.tap()
        XCTAssertTrue(app.buttons["取消"].firstMatch.waitForExistence(timeout: 15)); keep("files")
        app.buttons["取消"].firstMatch.tap()
        let restored = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: plus)
        let restoration = await XCTWaiter.fulfillment(of: [restored], timeout: 15)
        XCTAssertEqual(restoration, .completed)
        press(app.buttons["phoneAccountMenu"].firstMatch); keep("account")
    }

}
