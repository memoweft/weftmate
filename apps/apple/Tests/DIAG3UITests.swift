import XCTest
final class DIAG3UITests: XCTestCase {
    @MainActor private func launch(_ namespace: String, theme: String, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--apple-contract-fixture", "--diag3-fixture", "--ui-testing-namespace", namespace, "--a5-theme", theme] + extra
        app.launch(); return app
    }
    @MainActor private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
    @MainActor private func expect(_ app: XCUIApplication, _ id: String) { XCTAssertTrue(node(app, id).waitForExistence(timeout: 30), id) }
    @MainActor private func keep(_ app: XCUIApplication, _ name: String) {
        Thread.sleep(forTimeInterval: 2) // Let native glass and text rendering settle before full-screen capture.
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
    }
    @MainActor private func entry(_ app: XCUIApplication) {
        expect(app, "openRunLog")
        let row = node(app, "openRunLog")
        for _ in 0..<6 { if row.isHittable { return }; app.swipeUp() }
        XCTAssertTrue(row.isHittable)
    }
    @MainActor private func open(_ app: XCUIApplication) { entry(app); node(app, "openRunLog").tap(); expect(app, "runLogPage"); expect(app, "closeAuxiliarySheetButton") }
    @MainActor private func actions(_ app: XCUIApplication, enabled: Bool) {
        let copy = app.buttons["previewRunSummary"], share = app.buttons["shareRunLog"]
        XCTAssertEqual(copy.label, "复制诊断摘要"); XCTAssertEqual(share.label, "分享日志文件")
        XCTAssertEqual(copy.isEnabled, enabled); XCTAssertEqual(share.isEnabled, enabled)
        XCTAssertEqual(copy.frame.midY, share.frame.midY, accuracy: 1)
        XCTAssertEqual(copy.frame.width, share.frame.width, accuracy: 1)
        XCTAssertFalse(app.buttons["reloadRunLog"].exists)
    }
    @MainActor private func back(_ app: XCUIApplication) { app.navigationBars.buttons.element(boundBy: 0).tap() }
    @MainActor func testRunLogStatesLightAndDark() {
        continueAfterFailure = false
        for theme in ["light", "dark"] {
            let namespace = "diag3-ui-" + UUID().uuidString
            var app = launch(namespace, theme: theme)
            entry(app); XCTAssertTrue(node(app, "openRunLog").label.contains("暂无记录")); keep(app, "iphone-about-empty-" + theme)
            open(app); expect(app, "runLogEmpty"); actions(app, enabled: true)
            XCTAssertTrue(node(app, "runLogRetention").label.contains("2 MB")); keep(app, "iphone-empty-" + theme)
            app.terminate() // Forced end. The delegate cannot record app.exit.
            app = launch(namespace, theme: theme)
            expect(app, "previousRunNotice"); keep(app, "iphone-banner-" + theme)
            let banner = node(app, "previousRunNoticeRow")
            XCTAssertGreaterThanOrEqual(banner.frame.minY, app.navigationBars.firstMatch.frame.maxY)
            app.buttons["previousRunNotice"].tap(); expect(app, "runLogRecord.0"); expect(app, "closeAuxiliarySheetButton")
            XCTAssertFalse(node(app, "previousRunNotice").exists)
            actions(app, enabled: true); keep(app, "iphone-records-" + theme)
            back(app); entry(app); XCTAssertTrue(node(app, "openRunLog").label.contains("上次没有正常结束"))
            keep(app, "iphone-about-records-" + theme)
            open(app); app.buttons["runLogRecord.0"].tap(); expect(app, "runLogDetail"); expect(app, "closeAuxiliarySheetButton")
            XCTAssertFalse(node(app, "runLogRawRecord").exists)
            XCTAssertTrue(app.staticTexts["结束前最后记录"].exists); XCTAssertTrue(app.staticTexts["当时的状态"].exists)
            keep(app, "iphone-detail-" + theme)
            node(app, "expandRunLogRaw").tap(); expect(app, "runLogRawRecord"); keep(app, "iphone-detail-raw-" + theme)
            back(app)
            app.buttons["previewRunSummary"].tap(); expect(app, "runSummaryPreviewSection")
            XCTAssertFalse(node(app, "runSummaryPreview").exists); keep(app, "iphone-summary-preview-" + theme)
            app.buttons["expandRunSummaryRaw"].tap(); expect(app, "runSummaryPreview")
            XCTAssertTrue(node(app, "runSummaryPreview").label.contains("app.previous_unclean_exit")); keep(app, "iphone-summary-raw-" + theme)
            app.buttons["copyRunSummary"].tap(); expect(app, "runLogPage")
            app.buttons["shareRunLog"].tap(); expect(app, "runLogFilePreview")
            XCTAssertFalse(node(app, "runLogFilePreviewText").exists); keep(app, "iphone-file-preview-" + theme)
            app.buttons["expandRunFileRaw"].tap(); expect(app, "runLogFilePreviewText")
            XCTAssertTrue(node(app, "runLogFilePreviewText").label.contains("app.start")); keep(app, "iphone-file-raw-" + theme)
            app.buttons["closeRunLogPreview"].tap(); expect(app, "runLogPage")
            app.terminate()
            app = launch("diag3-failure-" + UUID().uuidString, theme: theme, extra: ["--diag3-read-failure"])
            entry(app); keep(app, "iphone-about-read-failure-" + theme)
            open(app); expect(app, "runLogReadFailure"); actions(app, enabled: false)
            keep(app, "iphone-read-failure-" + theme)
            app.buttons["retryRunLog"].tap(); expect(app, "runLogReadFailure"); app.terminate()
            app = launch(namespace, theme: theme)
            expect(app, "previousRunNotice"); app.buttons["dismissPreviousRunNotice"].tap()
            XCTAssertFalse(node(app, "previousRunNotice").exists)
            XCUIDevice.shared.press(.home); app.activate(); XCTAssertFalse(node(app, "previousRunNotice").exists)
            keep(app, "iphone-banner-dismissed-" + theme); app.terminate()
        }
    }
    @MainActor func testBackgroundResumeDoesNotShowNotice() {
        continueAfterFailure = false
        for theme in ["light", "dark"] {
            let namespace = "diag3-resume-" + UUID().uuidString
            var app = launch(namespace, theme: theme)
            entry(app); XCUIDevice.shared.press(.home); app.activate()
            entry(app); XCTAssertFalse(node(app, "previousRunNotice").exists)
            open(app); expect(app, "runLogEmpty"); app.terminate()
            // Test-only synthetic normal exit uses the same durable store API. No production lifecycle change.
            app = launch(namespace, theme: theme, extra: ["--diag3-clean-exit"])
            expect(app, "diag3CleanExitRecorded"); app.terminate()
            app = launch(namespace, theme: theme)
            entry(app); XCTAssertFalse(node(app, "previousRunNotice").exists)
            XCTAssertTrue(node(app, "openRunLog").label.contains("上次正常结束"))
            keep(app, "iphone-about-normal-" + theme)
            open(app); keep(app, "iphone-normal-" + theme); app.terminate()
        }
    }
    @MainActor func testFilePreviewBeforeShare() {
        continueAfterFailure = false
        for theme in ["light", "dark"] {
            let app = launch("diag3-share-" + UUID().uuidString, theme: theme, extra: ["--diag3-watch-fixture"])
            open(app); expect(app, "runLogEmpty")
            XCTAssertFalse(app.buttons["copyRunSummary"].exists)
            app.buttons["shareRunLog"].tap(); expect(app, "runLogFilePreview")
            XCTAssertFalse(node(app, "runLogFilePreviewText").exists); keep(app, "iphone-empty-file-preview-" + theme)
            app.buttons["expandRunFileRaw"].tap(); expect(app, "runLogFilePreviewText")
            XCTAssertTrue(node(app, "runLogFilePreviewText").label.contains("app.start"))
            XCTAssertTrue(app.buttons["confirmShareRunLog"].exists)
            app.buttons["confirmShareRunLog"].tap()
            XCTAssertTrue(app.buttons["关闭"].waitForExistence(timeout: 10) || app.buttons["Close"].exists || app.otherElements["ActivityListView"].exists)
            keep(app, "iphone-system-share-" + theme)
            if app.buttons["Close"].exists { app.buttons["Close"].tap() }
            else if app.buttons["关闭"].exists { app.buttons["关闭"].tap() }
            else { app.swipeDown() }
            expect(app, "runLogSource"); app.segmentedControls["runLogSource"].buttons["手表"].tap()
            expect(app, "runLogRecord.0"); XCTAssertTrue(node(app, "runLogRetention").label.contains("256 KB"))
            keep(app, "iphone-watch-" + theme)
            app.buttons["runLogRecord.0"].tap(); expect(app, "runLogDetail"); expect(app, "closeAuxiliarySheetButton")
            XCTAssertTrue(app.staticTexts["服务请求错误"].exists); keep(app, "iphone-watch-detail-" + theme)
            app.terminate()
        }
    }
    @MainActor func testLaunchLoggingOverhead() {
        continueAfterFailure = false
        var rows: [[String: Any]] = []
        for enabled in [false, true] {
            for _ in 0..<3 {
                let started = Date()
                let app = launch("diag3-perf-" + UUID().uuidString, theme: "light", extra: enabled ? [] : ["--diag3-disable-logging"])
                entry(app)
                let ready = Date(); app.terminate()
                rows.append(["logging": enabled, "launchToAboutReadyMs": ready.timeIntervalSince(started) * 1000, "forcedTerminationMs": Date().timeIntervalSince(ready) * 1000])
            }
        }
        let object: [String: Any] = ["method": "Same final Debug app; synthetic About, three isolated launches with logging disabled/enabled. XCTest launch overhead included; termination is forced by XCTest, not an iOS normal exit callback.", "runs": rows]
        let bytes = try! JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
        let attachment = XCTAttachment(data: bytes, uniformTypeIdentifier: "public.json"); attachment.name = "iphone-performance"; attachment.lifetime = .keepAlways; add(attachment)
    }
}
