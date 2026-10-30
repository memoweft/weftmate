import XCTest

final class Apple9UITests: XCTestCase {
    override func setUp() { super.setUp();continueAfterFailure=false }
    @MainActor private func reveal(_ app:XCUIApplication,_ item:XCUIElement) {
        for up in [true,false] {for _ in 0..<8 {
            if item.exists && app.frame.contains(item.frame) && item.isHittable {return}
            app.coordinate(withNormalizedOffset:CGVector(dx:0.98,dy:up ? 0.8 : 0.3)).press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:CGVector(dx:0.98,dy:up ? 0.3 : 0.8)))
        }}
    }
    @MainActor func testServiceAndComputerScreenshots() throws {
        for theme in ["light","dark"] {
            for scene in ["one","two","settings","add","addQueried","computers","list"] {
                let app=XCUIApplication()
                app.launchArguments=["--ui-testing","--apple9-fixture","--ui-testing-namespace","apple9-"+UUID().uuidString,"--apple9-scene",scene,"--apple9-theme",theme]
                if scene == "addQueried",let url=ProcessInfo.processInfo.environment["APPLE9_MODEL_URL"] { app.launchArguments += ["--apple9-model-url",url] }
                app.launch()
                if scene == "add" || scene == "addQueried" {
                    let add=app.buttons["modelServices.new"];XCTAssertTrue(add.waitForExistence(timeout:20));add.tap()
                }
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
                if scene == "addQueried" {
                    let choice=app.buttons["modelServices.default.mimo-v2.6-pro"]
                    reveal(app,choice);choice.tap()
                    let save=app.buttons["modelServices.save"];reveal(app,save);XCTAssertTrue(save.isEnabled);save.tap()
                    let saved=app.buttons.matching(NSPredicate(format:"identifier BEGINSWITH %@ AND label CONTAINS %@","modelServices.edit.","合成模型服务")).firstMatch
                    XCTAssertTrue(saved.waitForExistence(timeout:20));saved.tap()
                    XCTAssertEqual(app.textFields["modelServices.name"].value as? String,"合成模型服务")
                    XCTAssertEqual(app.textFields["modelServices.address"].value as? String,ProcessInfo.processInfo.environment["APPLE9_MODEL_URL"])
                    let key=app.secureTextFields["modelServices.key"]
                    XCTAssertTrue((key.value as? String ?? "").isEmpty || key.value as? String == key.placeholderValue,"Reopening a saved service must keep its key private")
                    let top=XCTAttachment(screenshot:app.screenshot());top.name="apple9-"+theme+"-saved-editor";top.lifetime = .keepAlways;add(top)
                    let selected=app.buttons["modelServices.default.mimo-v2.6-pro"]
                    reveal(app,selected);XCTAssertEqual(selected.value as? String,"当前选择")
                    let reopened=XCTAttachment(screenshot:app.screenshot());reopened.name="apple9-"+theme+"-saved-editor-models";reopened.lifetime = .keepAlways;add(reopened)
                }
                app.terminate()
            }
        }
    }
}
