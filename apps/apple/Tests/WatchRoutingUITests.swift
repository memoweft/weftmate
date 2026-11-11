// 保护：真实手表窗口保留可操作的发送、改选设备和失败恢复入口。
import XCTest

final class WatchRoutingUITests: XCTestCase {
    @MainActor private func capture(_ app: XCUIApplication,_ name: String) {
        Thread.sleep(forTimeInterval:0.4)
        let image=XCTAttachment(screenshot:app.screenshot());image.name=name;image.lifetime = .keepAlways;add(image)
    }
    @MainActor func testSendAndChooseDevice() {
        continueAfterFailure=false
        let app=XCUIApplication();defer { app.terminate() }
        app.launchArguments=["--ui-testing","--watch-routing-preview","empty"]
        app.launch();XCTAssertTrue(app.buttons["watchChatSend"].waitForExistence(timeout:20))
        capture(app,"watch-empty");app.buttons["watchChatSend"].tap()
        XCTAssertTrue(app.staticTexts["合成回复：已收到这句话。"].waitForExistence(timeout:5));capture(app,"watch-phone-answer")
        app.terminate();app.launchArguments=["--ui-testing","--watch-routing-preview","choose"];app.launch()
        XCTAssertTrue(app.buttons["电脑"].waitForExistence(timeout:20));capture(app,"watch-device-choice")
        app.buttons["电脑"].tap()
        XCTAssertTrue(app.staticTexts["合成回复：已收到这句话。"].waitForExistence(timeout:5));capture(app,"watch-computer-answer")
    }
    @MainActor func testLoadingFailureAndOffline() {
        let app=XCUIApplication();defer { app.terminate() }
        for scene in ["loading","error","offline","answer","approval"] {
            app.launchArguments=["--ui-testing","--watch-routing-preview",scene];app.launch()
            XCTAssertTrue(app.otherElements["watchHome"].waitForExistence(timeout:20));capture(app,"watch-"+scene);app.terminate()
        }
    }
}
