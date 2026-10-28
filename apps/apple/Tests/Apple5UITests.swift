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
            XCTAssertTrue(app.descendants(matching:.any)["health.secondaryMetrics"].waitForExistence(timeout:20))
            capture(app,theme,"health-today-upper")
            app.swipeUp(); capture(app,theme,"health-today-lower")
            app.buttons["phone.tab.activity"].tap()
            let activity=app.buttons["activity.row.apple5-complete"]
            XCTAssertTrue(activity.waitForExistence(timeout:20))
            for _ in 0..<6 where !activity.isHittable { app.swipeUp() }
            XCTAssertTrue(activity.isHittable); capture(app,theme,"activity-list"); activity.tap()
            XCTAssertTrue(app.descendants(matching:.any)["library.detail"].waitForExistence(timeout:15)); capture(app,theme,"activity-source")
            app.buttons["phone.tab.chat"].tap(); app.buttons["phone.sidebar"].tap(); app.buttons["phone.sidebar.goals"].tap()
            capture(app,theme,"goals-list")
            app.buttons["goals.schedules"].tap()
            let schedule=app.buttons["goals.schedule.apple5-reminder"]
            for _ in 0..<3 where !schedule.isHittable { app.swipeUp() }
            XCTAssertTrue(schedule.waitForExistence(timeout:20)); capture(app,theme,"goals-list"); schedule.tap()
            XCTAssertTrue(app.navigationBars["最近执行"].waitForExistence(timeout:10));capture(app,theme,"schedules-detail")
            app.buttons["phone.tab.chat"].tap(); app.buttons["phone.tab.chat"].tap(); app.buttons["phone.sidebar"].tap(); app.buttons["phone.sidebar.library"].tap()
            let file=app.buttons["library.row.apple5-file"]
            XCTAssertTrue(file.waitForExistence(timeout:20)); capture(app,theme,"library-list"); file.tap()
            XCTAssertTrue(app.descendants(matching:.any)["library.preview"].waitForExistence(timeout:15));XCTAssertTrue(app.buttons["library.share"].exists)
            capture(app,theme,"library-preview")
            app.terminate()
        }
    }

    @MainActor private func pageControl(_ app: XCUIApplication,_ id: String) -> XCUIElement {
        app.descendants(matching:.any).matching(identifier:id).firstMatch
    }
    @MainActor private func pageTap(_ app: XCUIApplication,_ id: String) {
        let element=pageControl(app,id);XCTAssertTrue(element.waitForExistence(timeout:20),id)
        for _ in 0..<8 where !element.isHittable { app.swipeUp() }
        XCTAssertTrue(element.isHittable,id);element.tap()
    }
    @MainActor private func pageCapture(_ app: XCUIApplication,_ theme: String,_ name: String) {
        let shot=XCTAttachment(screenshot:app.screenshot());shot.name=name+"-"+theme;shot.lifetime = .keepAlways;add(shot)
    }
    @MainActor private func root(_ app: XCUIApplication,_ route: String) {
        pageTap(app,"phone.tab.chat");pageTap(app,"phone.tab.chat")
        pageTap(app,"phone.sidebar");pageTap(app,"phone.sidebar."+route)
    }
    @MainActor func testPagesLightAndDark() throws {
        continueAfterFailure=false
        let env=ProcessInfo.processInfo.environment
        for theme in ["light","dark"] {
            let app=XCUIApplication()
            app.launchArguments=["--ui-testing","--apple5-fixture","--health4-render-only","--a5-local-server","--server-url",try XCTUnwrap(env["WEFTMATE_APPLE5_ORIGIN"]),"--ui-testing-namespace","ios-ui-3-"+UUID().uuidString,"--a5-theme",theme,theme]
            app.launchEnvironment=["WEFTMATE_APPLE5_USERNAME":try XCTUnwrap(env["WEFTMATE_APPLE5_USERNAME"]),"WEFTMATE_APPLE5_PASSWORD":try XCTUnwrap(env["WEFTMATE_APPLE5_PASSWORD"])]
            app.launch()
            pageTap(app,"phone.tab.activity")
            XCTAssertTrue(pageControl(app,"activity.row.apple5-complete").waitForExistence(timeout:20));pageCapture(app,theme,"activity")
            pageTap(app,"activity.row.apple5-complete")
            XCTAssertTrue(pageControl(app,"library.preview").waitForExistence(timeout:20),"Activity must return to the real artifact")
            pageCapture(app,theme,"library-detail")
            pageTap(app,"library.source");XCTAssertTrue(pageControl(app,"mainChat.plus").waitForExistence(timeout:15))
            root(app,"library");pageTap(app,"library.row.apple5-file");pageTap(app,"library.source")
            XCTAssertTrue(pageControl(app,"mainChat.plus").waitForExistence(timeout:15),"The same source must still return to chat")
            pageTap(app,"phone.tab.health")
            XCTAssertTrue(pageControl(app,"health.secondaryMetrics").waitForExistence(timeout:20));pageCapture(app,theme,"health")
            pageTap(app,"health.sleepDuration")
            XCTAssertTrue(pageControl(app,"health.range").waitForExistence(timeout:20));pageCapture(app,theme,"health-detail")
            pageTap(app,"phone.tab.health") // Reselect the current tab to pop to its root.
            app.buttons["健康设置"].tap()
            XCTAssertTrue(pageControl(app,"health.settings").waitForExistence(timeout:15));pageCapture(app,theme,"health-settings")
            root(app,"goals");XCTAssertTrue(pageControl(app,"goals.reminders").waitForExistence(timeout:20));pageCapture(app,theme,"goals")
            pageTap(app,"goals.reminders");pageCapture(app,theme,"reminders")
            pageTap(app,"reminders.new");pageTap(app,"reminders.text");app.typeText("带水出门")
            pageTap(app,"reminders.save")
            XCTAssertTrue(app.staticTexts["带水出门"].waitForExistence(timeout:10))
            root(app,"goals");pageTap(app,"goals.schedules")
            XCTAssertTrue(pageControl(app,"goals.schedule.apple5-reminder").waitForExistence(timeout:20));pageCapture(app,theme,"schedules")
            app.buttons["暂停"].firstMatch.tap();XCTAssertTrue(app.buttons["恢复"].firstMatch.waitForExistence(timeout:15));app.buttons["恢复"].firstMatch.tap()
            XCTAssertTrue(app.buttons["暂停"].firstMatch.waitForExistence(timeout:15))
            root(app,"goals");pageTap(app,"goals.goal.apple5-goal")
            XCTAssertTrue(pageControl(app,"goals.nextStep").waitForExistence(timeout:15));pageCapture(app,theme,"goal-detail")
            root(app,"library");pageCapture(app,theme,"library")
            pageTap(app,"library.search");app.typeText("没有这样的文件名\n")
            XCTAssertTrue(app.staticTexts["没有找到匹配的成果"].waitForExistence(timeout:15))
            root(app,"memory");XCTAssertTrue(pageControl(app,"phoneMemory.explanation").waitForExistence(timeout:15));pageCapture(app,theme,"memory")
            pageTap(app,"phoneMemory.manageComputer");pageTap(app,"memoryItem.ios-ui-memory")
            XCTAssertTrue(pageControl(app,"memoryDetailText").waitForExistence(timeout:15));pageCapture(app,theme,"memory-detail")
            if theme == "dark" {
                pageTap(app,"deleteMemoryButton")
                let confirm=pageControl(app,"confirmForgetMemory")
                XCTAssertTrue(confirm.waitForExistence(timeout:15))
                let enabled=XCTNSPredicateExpectation(predicate:NSPredicate(format:"enabled == true"),object:confirm)
                XCTAssertEqual(XCTWaiter.wait(for:[enabled],timeout:20),.completed)
                pageCapture(app,theme,"sheet-forget-memory");confirm.tap()
                XCTAssertTrue(pageControl(app,"memory.cleanup").waitForExistence(timeout:15));pageTap(app,"memory.cleanup")
                XCTAssertTrue(app.staticTexts["电脑存储：等待清理"].waitForExistence(timeout:15));pageCapture(app,theme,"memory-cleanup")
                XCTAssertTrue(app.staticTexts["其他设备：尚无逐台回执，无法核实"].exists)
            } else {
                pageTap(app,"muteMemoryButton")
                XCTAssertTrue(app.buttons["停用记忆"].waitForExistence(timeout:10));app.buttons["停用记忆"].tap()
                XCTAssertTrue(pageControl(app,"memory.cleanup").waitForExistence(timeout:15));pageTap(app,"memory.cleanup");pageCapture(app,theme,"memory-cleanup")
            }
            app.terminate()
        }
    }
}
