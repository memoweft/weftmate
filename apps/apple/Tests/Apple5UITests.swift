import XCTest

final class Apple5UITests: XCTestCase {
    @MainActor private func capture(_ app: XCUIApplication,_ theme: String,_ name: String) {
        let attachment=XCTAttachment(screenshot:app.screenshot()); attachment.name="apple5-"+theme+"-"+name; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testFeatureBatch() throws {
        let env=ProcessInfo.processInfo.environment
        let origin=try XCTUnwrap(env["WEFTMATE_APPLE5_ORIGIN"])
        for theme in ["light","dark"] {
            let app=XCUIApplication()
            app.launchArguments=["--ui-testing","--apple5-fixture","--health4-render-only","--a5-local-server","--server-url",origin,"--ui-testing-namespace","apple5-"+UUID().uuidString,"--a5-theme",theme,theme]
            app.launchEnvironment=["WEFTMATE_APPLE5_USERNAME":try XCTUnwrap(env["WEFTMATE_APPLE5_USERNAME"]),"WEFTMATE_APPLE5_PASSWORD":try XCTUnwrap(env["WEFTMATE_APPLE5_PASSWORD"])]
            app.launch()
            XCTAssertTrue(app.buttons["phone.sidebar"].waitForExistence(timeout: 35))
            app.buttons["phone.sidebar"].tap(); app.buttons["phone.sidebar.main"].tap()
            XCTAssertTrue(app.buttons["mainChat.plus"].waitForExistence(timeout:35))
            let input=app.descendants(matching:.any)["mainChat.draft"]
            XCTAssertTrue(input.waitForExistence(timeout:10))
            XCTAssertTrue(app.buttons["phone.tab.chat"].exists)
            capture(app,theme,"composer-collapsed")
            let collapsed=input.frame.height
            input.tap(); XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout:10))
            XCTAssertFalse(app.buttons["phone.tab.chat"].exists)
            capture(app,theme,"composer-focused")
            input.typeText("整理周末计划\n留出一点时间散步\n再读几页书\n把需要做的事分开\n先从最容易的开始\n做完再继续\n还有一些记录\n最后回顾一下")
            XCTAssertGreaterThan(input.frame.height,collapsed)
            let send=app.buttons["mainChat.send"]
            XCTAssertLessThanOrEqual(send.frame.maxY,app.keyboards.firstMatch.frame.minY+2)
            capture(app,theme,"composer-multiline-above-keyboard")
            // Use the existing bounded resource sheet to finish input; the SE date popover is taller than the screen.
            app.buttons["mainChat.menu"].tap(); app.buttons["输出与来源"].firstMatch.tap()
            XCTAssertTrue(app.buttons["phoneSheet.close"].waitForExistence(timeout:15)); app.buttons["phoneSheet.close"].tap()
            XCTAssertTrue(app.buttons["phone.tab.health"].waitForExistence(timeout:15))
            app.buttons["phone.tab.health"].tap()
            XCTAssertTrue(app.descendants(matching:.any)["health.scoreGrid"].waitForExistence(timeout:20))
            capture(app,theme,"health-today-upper")
            app.swipeUp(); capture(app,theme,"health-today-lower")
            app.buttons["phone.tab.activity"].tap()
            let activity=app.buttons["activity.row.apple5-complete"]
            XCTAssertTrue(activity.waitForExistence(timeout:20))
            for _ in 0..<6 where !activity.isHittable { app.swipeUp() }
            XCTAssertTrue(activity.isHittable); capture(app,theme,"activity-list"); activity.tap()
            XCTAssertTrue(app.buttons["phoneSheet.close"].waitForExistence(timeout:10)); capture(app,theme,"activity-detail"); app.buttons["phoneSheet.close"].tap()
            app.buttons["phone.tab.chat"].tap(); app.buttons["phone.sidebar"].tap(); app.buttons["phone.sidebar.goals"].tap()
            let schedule=app.buttons["goals.schedule.apple5-reminder"]
            for _ in 0..<3 where !schedule.isHittable { app.swipeUp() }
            XCTAssertTrue(schedule.waitForExistence(timeout:20)); capture(app,theme,"goals-list"); schedule.tap()
            XCTAssertTrue(app.buttons["phoneSheet.close"].waitForExistence(timeout:10)); capture(app,theme,"goals-detail"); app.buttons["phoneSheet.close"].tap()
            app.buttons["phone.tab.chat"].tap(); app.buttons["phone.tab.chat"].tap(); app.buttons["phone.sidebar"].tap(); app.buttons["phone.sidebar.library"].tap()
            let file=app.buttons["library.row.apple5-file"]
            XCTAssertTrue(file.waitForExistence(timeout:20)); capture(app,theme,"library-list"); file.tap()
            XCTAssertTrue(app.descendants(matching:.any)["attachmentPreviewPanel"].waitForExistence(timeout:15)); XCTAssertTrue(app.buttons["filePreview.more"].exists)
            capture(app,theme,"library-preview"); app.buttons["filePreview.close"].tap()
            app.terminate()
        }
    }
}
