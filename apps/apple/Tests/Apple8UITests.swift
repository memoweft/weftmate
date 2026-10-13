import XCTest

final class Apple8UITests: XCTestCase {
    override func setUp() { super.setUp();continueAfterFailure=false }
    @MainActor func testAttachmentScreenshots() throws {
        for (theme,scene) in [("light","menu"),("light","draft"),("light","sent"),("light","text"),("dark","draft"),("dark","sent")] {
            let app=XCUIApplication()
            app.launchArguments=["--ui-testing","--apple8-fixture","--ui-testing-namespace","apple8-"+UUID().uuidString,"--apple8-scene",scene,"--apple8-theme",theme]
            app.launch()
            let plus=app.buttons["phoneChat.plus"]
            XCTAssertTrue(plus.waitForExistence(timeout:20));XCTAssertTrue(plus.isEnabled)
            if scene == "menu" || scene == "text" {
                plus.tap();XCTAssertTrue(app.buttons["文件"].waitForExistence(timeout:5))
                XCTAssertTrue(app.buttons["拍照"].exists);XCTAssertTrue(app.buttons["照片图库"].exists)
                if scene == "text" { XCTAssertFalse(app.buttons["拍照"].isEnabled);XCTAssertFalse(app.buttons["照片图库"].isEnabled);XCTAssertTrue(app.staticTexts["当前模型看不了图片"].exists) }
            } else {
                XCTAssertTrue(app.descendants(matching:.any).matching(NSPredicate(format:"label CONTAINS %@","合成色块.jpg")).firstMatch.waitForExistence(timeout:5));XCTAssertTrue(app.descendants(matching:.any).matching(NSPredicate(format:"label CONTAINS %@","虚构周报.md")).firstMatch.exists)
                if scene == "draft" { XCTAssertTrue(app.buttons["attachment.remove.合成色块.jpg"].exists) }
            }
            let attachment=XCTAttachment(screenshot:XCUIScreen.main.screenshot());attachment.name="apple8-"+theme+"-"+scene;attachment.lifetime = .keepAlways;add(attachment)
            app.terminate()
        }
    }
}
