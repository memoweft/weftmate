import XCTest

final class PhoneWindowUITests: XCTestCase {
    @MainActor func testMemoryRoutes() throws {
        continueAfterFailure=false
        for theme in ["light","dark"] {
        for scene in ["no-copy","copy","unreachable"] {
            let app=XCUIApplication()
            app.launchArguments=["--ui-testing","--phone-window-fixture","--ui-testing-namespace","apple-1-window-"+UUID().uuidString,"--phone-window-scene",scene,"--a5-theme",theme,theme]
            app.launch()
            XCTAssertTrue(app.staticTexts["phoneMemory.explanation"].waitForExistence(timeout:20))
            XCTAssertEqual(app.staticTexts["phoneMemory.empty"].exists,scene == "no-copy")
            XCTAssertEqual(app.buttons["phoneMemory.text.window-memory"].exists,scene != "no-copy")
            XCTAssertEqual(app.staticTexts["phoneMemory.offline"].exists,scene == "unreachable")
            XCTAssertTrue(app.buttons["phoneMemory.manageComputer"].exists)
            XCTAssertEqual(app.buttons["phoneMemory.manageComputer"].isEnabled,scene == "copy")
            for id in ["phoneMemory.add","phoneMemory.forgetAll","phoneMemory.save","phoneMemory.edit.window-memory","phoneMemory.forget.window-memory"] {
                XCTAssertFalse(app.buttons[id].exists)
            }
            XCTAssertFalse(app.switches["phoneMemory.pinned"].exists)
            let image=XCTAttachment(screenshot:app.screenshot());image.name=(scene == "copy" ? "memory" : "memory-"+scene)+"-"+theme;image.lifetime = .keepAlways;add(image)
            if scene != "no-copy" {
                app.buttons["phoneMemory.text.window-memory"].tap()
                XCTAssertTrue(app.descendants(matching:.any)["phoneMemory.detail"].waitForExistence(timeout:10))
                XCTAssertEqual(app.buttons["phoneMemory.correct"].exists,scene == "copy")
                let detail=XCTAttachment(screenshot:app.screenshot());detail.name="memory-detail-"+scene+"-"+theme;detail.lifetime = .keepAlways;add(detail)
            }
            app.terminate()
        }
        }
    }
}
