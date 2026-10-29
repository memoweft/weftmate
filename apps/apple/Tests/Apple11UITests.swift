import XCTest

final class Apple11UITests: XCTestCase {
    override func setUp() { super.setUp();continueAfterFailure=false }
    @MainActor func testTwoMinuteLocalNotificationAndTap() throws {
        let app=XCUIApplication()
        app.launchArguments=["--ui-testing","--apple11-fixture","--ui-testing-namespace","apple11-"+UUID().uuidString]
        app.launch()
        let draft=app.descendants(matching:.any)["phoneChat.draft"].firstMatch
        XCTAssertTrue(draft.waitForExistence(timeout:30))
        draft.tap();draft.typeText("2 分钟后提醒我 喝水");app.buttons["phoneChat.send"].tap()
        let explanation=app.alerts["允许到点提醒你吗？"]
        XCTAssertTrue(explanation.waitForExistence(timeout:10));explanation.buttons["允许通知"].tap()
        let springboard=XCUIApplication(bundleIdentifier:"com.apple.springboard")
        let allow=springboard.buttons["Allow"],allowChinese=springboard.buttons["允许"]
        if allow.waitForExistence(timeout:5) { allow.tap() }
        else if allowChinese.waitForExistence(timeout:5) { allowChinese.tap() }
        let evidence=app.staticTexts["reminders.systemEvidence"]
        XCTAssertTrue(evidence.waitForExistence(timeout:10))
        let queued=NSPredicate(format:"label CONTAINS 'pending=1'")
        expectation(for:queued,evaluatedWith:evidence);waitForExpectations(timeout:15)
        app.buttons["phoneChat.sidebar"].tap(); app.buttons["phone.sidebar.goals"].tap(); app.buttons["goals.reminders"].tap()
        XCTAssertTrue(app.buttons["reminders.new"].waitForExistence(timeout:10))
        capture("apple11-light-reminders")
        app.buttons["phone.tab.chat"].tap()
        capture("apple11-light-scheduled")
        let start=Date()
        while Date().timeIntervalSince(start) < 135 {
            if springboard.staticTexts["喝水"].exists { break }
            RunLoop.current.run(until:Date().addingTimeInterval(0.5))
        }
        XCTAssertTrue(springboard.staticTexts["喝水"].exists,"System banner must contain the actual reminder body")
        // Accessibility becomes available before SpringBoard finishes the banner animation.
        RunLoop.current.run(until:Date().addingTimeInterval(1))
        XCTAssertTrue(springboard.staticTexts["喝水"].exists)
        capture("apple11-local-notification-banner")
        springboard.staticTexts["喝水"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching:.any)["phoneChat.draft"].firstMatch.waitForExistence(timeout:10))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format:"label CONTAINS '已记下：喝水'")).firstMatch.exists)
        capture("apple11-notification-opened-chat")
        app.terminate()
    }
    @MainActor func testReminderPageDark() throws {
        let app=XCUIApplication()
        app.launchArguments=["--ui-testing","--apple11-fixture","--apple11-dark","--ui-testing-namespace","apple11-dark-"+UUID().uuidString]
        app.launch()
        XCTAssertTrue(app.descendants(matching:.any)["phoneChat.draft"].firstMatch.waitForExistence(timeout:30))
        app.buttons["phoneChat.sidebar"].tap(); app.buttons["phone.sidebar.goals"].tap(); app.buttons["goals.reminders"].tap()
        XCTAssertTrue(app.buttons["reminders.new"].waitForExistence(timeout:10))
        capture("apple11-dark-reminders")
        app.terminate()
    }
    @MainActor private func capture(_ name: String) {
        let attachment=XCTAttachment(screenshot:XCUIScreen.main.screenshot());attachment.name=name;attachment.lifetime = .keepAlways;add(attachment)
    }
}
