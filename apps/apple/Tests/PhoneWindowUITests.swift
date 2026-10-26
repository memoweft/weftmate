import XCTest

final class PhoneWindowUITests: XCTestCase {
    @MainActor func testMemoryRoutes() throws {
        continueAfterFailure=false
        for scene in ["no-copy","copy","unreachable"] {
            let app=XCUIApplication()
            app.launchArguments=["--ui-testing","--phone-window-fixture","--ui-testing-namespace","apple-1-window-"+UUID().uuidString,"--phone-window-scene",scene]
            app.launch()
            XCTAssertTrue(app.staticTexts["phoneMemory.explanation"].waitForExistence(timeout:20))
            XCTAssertEqual(app.staticTexts["phoneMemory.empty"].exists,scene == "no-copy")
            XCTAssertEqual(app.staticTexts["phoneMemory.text.window-memory"].exists,scene != "no-copy")
            XCTAssertEqual(app.staticTexts["phoneMemory.offline"].exists,scene == "unreachable")
            XCTAssertEqual(app.buttons["phoneMemory.manageComputer"].exists,scene == "copy")
            for id in ["phoneMemory.add","phoneMemory.forgetAll","phoneMemory.save","phoneMemory.edit.window-memory","phoneMemory.forget.window-memory"] {
                XCTAssertFalse(app.buttons[id].exists)
            }
            XCTAssertFalse(app.switches["phoneMemory.pinned"].exists)
            let image=XCTAttachment(screenshot:app.screenshot());image.name="apple-1-window-"+scene;image.lifetime = .keepAlways;add(image)
            app.terminate()
        }
    }
}
