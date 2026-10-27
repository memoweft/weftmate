import XCTest

final class Apple3UITests: XCTestCase {
    @MainActor private func choose(_ app: XCUIApplication, _ value: String) throws {
        let menu = app.buttons["apple3.scenarios"]
        XCTAssertTrue(menu.waitForExistence(timeout: 15)); menu.tap()
        let option = app.buttons[value].firstMatch
        guard option.waitForExistence(timeout: 10) else { throw NSError(domain:"Apple3UI",code:1) };option.tap()
    }
    @MainActor private func capture(_ app: XCUIApplication, _ theme: String, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "apple3-" + theme + "-" + name;attachment.lifetime = .keepAlways;add(attachment)
    }
    @MainActor func testSmallScreenEvidenceBatch() throws {
        let origin = ProcessInfo.processInfo.environment["WEFTMATE_APPLE3_ORIGIN"]!
        for theme in ["light", "dark"] {
            let app = XCUIApplication();app.launchArguments = ["--ui-testing", "--apple3-fixture", "--health4-render-only", "--a5-local-server", "--server-url", origin, "--ui-testing-namespace", "apple3-" + UUID().uuidString, "--a5-theme", theme, theme];app.launch()
            XCTAssertTrue(app.staticTexts["这一段正在生成，文字正在继续。"].waitForExistence(timeout: 35));capture(app,theme,"stream")
            XCTAssertTrue(app.buttons["mainChat.send"].label == "停止")
            try choose(app,"final")
            XCTAssertTrue(app.staticTexts["这一段正在生成，这是最终完整回复。"].waitForExistence(timeout: 20));capture(app,theme,"final")
            for value in ["aligned", "warning"] {
                try choose(app,value)
                XCTAssertTrue(app.descendants(matching:.any)["approvalSecondOpinion"].waitForExistence(timeout: 20))
                XCTAssertTrue(app.buttons["approvalAlwaysAllow"].exists);capture(app,theme,value)
            }
            try choose(app,"files")
            let expand=app.buttons["replyFiles.expand"]
            XCTAssertTrue(expand.waitForExistence(timeout:20));capture(app,theme,"files-collapsed");expand.tap();capture(app,theme,"files-expanded")
            for value in ["recovered", "interrupted", "failed"] {
                try choose(app,value)
                XCTAssertTrue(app.descendants(matching:.any)["replyOutcome"].waitForExistence(timeout:20));capture(app,theme,value)
            }
            try choose(app,"permissions")
            XCTAssertTrue(app.switches["settings.secondOpinionEnabled"].waitForExistence(timeout:20));capture(app,theme,"permissions")
            try choose(app,"healthSettings")
            XCTAssertTrue(app.switches["health.modelInsightsEnabled"].waitForExistence(timeout:20));capture(app,theme,"health-settings")
            try choose(app,"health")
            XCTAssertTrue(app.descendants(matching:.any)["health.insight"].waitForExistence(timeout:20));capture(app,theme,"health-buttons")
            let recovery=app.buttons["health.score.recovery"], sleep=app.buttons["health.score.sleep"]
            for _ in 0..<3 where !recovery.isHittable { app.swipeUp() }
            XCTAssertTrue(recovery.exists);XCTAssertTrue(sleep.exists)
            XCTAssertLessThan(recovery.frame.minY,sleep.frame.minY)
            XCTAssertTrue(app.descendants(matching:.any)["health.secondaryMetrics"].exists);capture(app,theme,"health-list")
            recovery.tap()
            XCTAssertTrue(app.buttons["health.analysis.recovery"].waitForExistence(timeout:20))
            app.swipeUp();app.buttons["health.analysis.recovery"].tap()
            XCTAssertTrue(app.buttons["health.analysisEnable.recovery"].waitForExistence(timeout:20));capture(app,theme,"health-analysis-off")
            app.buttons["health.analysisEnable.recovery"].tap()
            XCTAssertTrue(app.buttons["health.analysisAsk.recovery"].waitForExistence(timeout:25));capture(app,theme,"health-analysis-expanded")
            app.terminate()
        }
    }
    @MainActor private func framePair(_ app: XCUIApplication, _ first: XCUIElement, _ last: XCUIElement) throws {
        let scroll=app.scrollViews.firstMatch
        var framed=false
        for _ in 0..<12 {
            let top=max(app.navigationBars.firstMatch.frame.maxY,scroll.frame.minY) + 4
            let bottom=min(app.frame.maxY,scroll.frame.maxY) - 8
            if first.exists,last.exists,first.frame.minY > top,last.frame.maxY < bottom { framed=true;break }
            let down=first.exists && first.frame.minY < top
            let a=scroll.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:down ? 0.45 : 0.75))
            let b=scroll.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:down ? 0.6 : 0.58))
            a.press(forDuration:0.01,thenDragTo:b)
        }
        XCTAssertTrue(framed,"Required content must fit completely in the screenshot")
        if !framed { throw NSError(domain:"Apple3UI",code:2) }
    }
    @MainActor func testLayoutEvidenceBatch() throws {
        let origin=ProcessInfo.processInfo.environment["WEFTMATE_APPLE3_ORIGIN"]!
        for theme in ["light","dark"] {
            let app=XCUIApplication();app.launchArguments=["--ui-testing","--apple3-fixture","--health4-render-only","--a5-local-server","--server-url",origin,"--ui-testing-namespace","apple3-layout-"+UUID().uuidString,"--a5-theme",theme,theme];app.launch()
            XCTAssertTrue(app.buttons["apple3.scenarios"].waitForExistence(timeout:25))
            try choose(app,"files")
            let expand=app.buttons["replyFiles.expand"];XCTAssertTrue(expand.waitForExistence(timeout:20));expand.tap()
            try framePair(app,app.buttons["replyFile.10"],app.buttons["replyFile.14"])
            capture(app,theme,"files-expanded")
            try choose(app,"health")
            XCTAssertTrue(app.buttons["health.score.recovery"].waitForExistence(timeout:25))
            try framePair(app,app.buttons["health.score.recovery"],app.buttons["health.score.sleep"])
            capture(app,theme,"health-list")
            app.terminate()
        }
    }

}
