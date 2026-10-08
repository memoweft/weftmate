import XCTest

final class IC2WatchIconsUITests: XCTestCase {
    @MainActor func testApprovalAndLauncherIcons() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ic2-icons-fixture"]
        app.launch()
        XCTAssertTrue(app.staticTexts["运行合成脚本"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["允许"].exists)
        XCTAssertFalse(app.buttons["允许"].isEnabled) // Fixture never impersonates a reachable phone.
        capture(app.screenshot(), "approval")
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 2)
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 2)
        let carousel = XCUIApplication(bundleIdentifier: "com.apple.Carousel")
        let tree = XCTAttachment(string: carousel.debugDescription)
        tree.name = "IC2-Watch-launcher-tree"; tree.lifetime = .keepAlways; add(tree)
        capture(XCUIScreen.main.screenshot(), "launcher")
    }
    private func capture(_ screenshot: XCUIScreenshot, _ name: String) {
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = "IC2-Watch-" + name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
