import XCTest

final class Apple9UITests: XCTestCase {
    override func setUp() { super.setUp();continueAfterFailure=false }
    @MainActor func testServiceAndComputerScreenshots() throws {
        for theme in ["light","dark"] {
            for scene in ["one","two","settings","add","addQueried","computers","list"] {
                let app=XCUIApplication()
                app.launchArguments=["--ui-testing","--apple9-fixture","--ui-testing-namespace","apple9-"+UUID().uuidString,"--apple9-scene",scene,"--apple9-theme",theme]
                if scene == "addQueried",let url=ProcessInfo.processInfo.environment["APPLE9_MODEL_URL"] { app.launchArguments += ["--apple9-model-url",url] }
                app.launch()
                if scene == "one" || scene == "two" {
                    let button=app.buttons["phoneChat.model"];XCTAssertTrue(button.waitForExistence(timeout:20));button.tap()
                    XCTAssertTrue(app.buttons["modelServices.choose.mimo-v2.6-flash"].waitForExistence(timeout:5))
                    XCTAssertTrue(app.buttons["modelServices.add"].exists)
                    if scene == "one" { XCTAssertTrue(app.buttons["modelServices.thinking"].exists) }
                    if scene == "two" { XCTAssertTrue(app.staticTexts["Claude"].exists) }
                } else if scene == "settings" {
                    XCTAssertTrue(app.buttons["modelServices.new"].waitForExistence(timeout:20))
                } else if scene == "add" {
                    XCTAssertTrue(app.secureTextFields["modelServices.key"].waitForExistence(timeout:20))
                    XCTAssertTrue(app.buttons["modelServices.query"].exists)
                } else if scene == "addQueried" {
                    XCTAssertTrue(app.staticTexts["modelServices.queryResult"].waitForExistence(timeout:20))
                    XCTAssertTrue(app.buttons["modelServices.default.mimo-v2.6-pro"].exists)
                    XCTAssertTrue(app.buttons["modelServices.save"].isEnabled)
                } else if scene == "computers" {
                    let button=app.buttons["computer.menu"];XCTAssertTrue(button.waitForExistence(timeout:20));button.tap()
                    XCTAssertTrue(app.staticTexts["这件事在哪台电脑上做"].waitForExistence(timeout:5))
                    XCTAssertTrue(app.buttons["computer.choose.synthetic-laptop"].exists)
                } else {
                    let button=app.buttons["phoneChat.sidebar"];XCTAssertTrue(button.waitForExistence(timeout:20));button.tap()
                    XCTAssertTrue(app.buttons["computer.conversation.synthetic-desk|synthetic-chat-a"].waitForExistence(timeout:5))
                    XCTAssertTrue(app.staticTexts["工作电脑"].exists)
                }
                let attachment=XCTAttachment(screenshot:XCUIScreen.main.screenshot());attachment.name="apple9-"+theme+"-"+scene;attachment.lifetime = .keepAlways;add(attachment)
                app.terminate()
            }
        }
    }
}
