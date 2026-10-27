import XCTest

/// No service credentials: the existing isolated phone fixture supplies synthetic model data.
final class IOSUIShellUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    @MainActor private func control(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }
    @MainActor private func tap(_ app: XCUIApplication, _ id: String) {
        let item = control(app, id); XCTAssertTrue(item.waitForExistence(timeout: 20), id); item.tap()
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "ios-ui-1-" + name
        image.lifetime = .keepAlways; add(image)
    }
    @MainActor func testShellLightAndDark() {
        for dark in [false, true] { journey(dark: dark, reduced: false) }
    }
    @MainActor func testReducedMotionKeepsNavigationAndDraft() { journey(dark: false, reduced: true) }
    @MainActor private func journey(dark: Bool, reduced: Bool) {
        let app = XCUIApplication(), theme = (dark ? "dark" : "light") + (reduced ? "-reduced" : "")
        app.launchArguments = ["--ui-testing", "--apple11-fixture", "--health4-render-only", "--ui-testing-namespace", "ios-ui-1-" + UUID().uuidString]
        if dark { app.launchArguments.append("--apple11-dark") }
        if reduced { app.launchArguments.append("--ios-ui-reduce-motion") }
        app.launch()
        let draft = control(app, "phoneChat.draft")
        XCTAssertTrue(draft.waitForExistence(timeout: 30))
        for id in ["chat", "activity", "health"] { XCTAssertTrue(control(app, "phone.tab." + id).exists) }
        XCTAssertFalse(control(app, "phone.tab.goals").exists); XCTAssertFalse(control(app, "phone.tab.resources").exists)
        draft.tap(); draft.typeText("切换后继续写")
        app.buttons["收起键盘"].tap(); capture(app, theme + "-chat")
        tap(app, "phoneChat.plus")
        XCTAssertTrue(app.buttons["文件"].waitForExistence(timeout: 10))
        XCTAssertFalse(control(app, "phoneSheet.close").exists)
        capture(app, theme + "-attachments-menu")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.3)).tap()
        tap(app, "phoneChat.model")
        XCTAssertTrue(control(app, "modelServices.add").waitForExistence(timeout: 10))
        XCTAssertLessThan(control(app, "modelServices.add").frame.width, app.frame.width)
        capture(app, theme + "-model-menu")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.3)).tap()
        tap(app, "phoneChat.sidebar"); capture(app, theme + "-sidebar")
        XCTAssertTrue(control(app, "phone.sidebar.search").exists)
        XCTAssertFalse(control(app, "phone.sidebar.tab.activity").exists)
        tap(app, "phone.sidebar.memory")
        XCTAssertTrue(control(app, "phoneMemory.explanation").waitForExistence(timeout: 10))
        tap(app, "phone.tab.activity"); capture(app, theme + "-activity")
        tap(app, "phone.tab.chat")
        XCTAssertTrue(control(app, "phoneMemory.explanation").waitForExistence(timeout: 10), "The chat stack must survive switching tabs")
        // The left edge belongs to system back while a child page is visible.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.4)).press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.4)))
        XCTAssertTrue(draft.waitForExistence(timeout: 10))
        XCTAssertEqual(draft.value as? String, "切换后继续写")
        for route in ["goals", "library", "projects", "conversations"] {
            tap(app, "phoneChat.sidebar"); tap(app, "phone.sidebar." + route)
            XCTAssertFalse(control(app, "phone.sidebar.close").exists)
            XCTAssertTrue(app.navigationBars.buttons.firstMatch.waitForExistence(timeout: 10))
            if route == "goals" {
                tap(app, "reminders.new")
                XCTAssertTrue(control(app, "reminders.text").waitForExistence(timeout: 10))
                capture(app, theme + "-reminder-sheet")
                tap(app, "phoneSheet.close")
            }
            tap(app, "phone.tab.chat") // Reselecting the current tab returns to its root.
            XCTAssertTrue(draft.waitForExistence(timeout: 10))
        }
        tap(app, "phone.tab.health"); capture(app, theme + "-health")
        tap(app, "phone.sidebar"); tap(app, "phone.sidebar.settings")
        XCTAssertTrue(control(app, "settings.accountCard").waitForExistence(timeout: 10)); capture(app, theme + "-settings")
        tap(app, "closeAuxiliarySheetButton")
        tap(app, "phone.tab.chat")
        // At the root the same edge opens the drawer, and closing it keeps the draft.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.4)).press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.4)))
        XCTAssertTrue(control(app, "phone.sidebar.close").waitForExistence(timeout: 10))
        tap(app, "phone.sidebar.close")
        XCTAssertEqual(draft.value as? String, "切换后继续写")
        app.terminate()
    }
}
