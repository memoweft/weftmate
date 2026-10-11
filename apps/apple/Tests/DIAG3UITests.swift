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
        // Screen includes system status bar and home indicator, not app-only crop.
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
    }
    @MainActor func testRunLogStatesLightAndDark() {
        continueAfterFailure = false
        for theme in ["light", "dark"] {
            let namespace = "diag3-ui-" + UUID().uuidString
            var app = launch(namespace, theme: theme)
            expect(app, "openRunLog"); app.buttons["openRunLog"].tap()
            expect(app, "runLogEmpty"); keep(app, "iphone-empty-" + theme)
            app.terminate() // forced process end; no delegate app.exit
            app = launch(namespace, theme: theme)
            expect(app, "previousRunNotice"); keep(app, "iphone-banner-" + theme)
            app.buttons["previousRunNotice"].tap(); expect(app, "runLogRecords")
            keep(app, "iphone-records-" + theme)
            app.buttons["previewRunSummary"].tap(); expect(app, "runSummaryPreview")
            XCTAssertTrue(node(app, "runSummaryPreview").label.contains("app.previous_unclean_exit"))
            app.terminate()
            app = launch("diag3-failure-" + UUID().uuidString, theme: theme, extra: ["--diag3-read-failure"])
            expect(app, "openRunLog"); app.buttons["openRunLog"].tap(); expect(app, "runLogReadFailure")
            keep(app, "iphone-read-failure-" + theme); app.terminate()
        }
    }
    @MainActor func testBackgroundResumeDoesNotShowNotice() {
        continueAfterFailure = false
        let app = launch("diag3-resume-" + UUID().uuidString, theme: "light")
        expect(app, "openRunLog")
        XCUIDevice.shared.press(.home); app.activate()
        expect(app, "openRunLog"); XCTAssertFalse(node(app, "previousRunNotice").exists)
        app.buttons["openRunLog"].tap(); expect(app, "runLogEmpty"); app.terminate()
    }
    @MainActor func testFilePreviewBeforeShare() {
        continueAfterFailure = false
        let app = launch("diag3-share-" + UUID().uuidString, theme: "light")
        expect(app, "openRunLog"); app.buttons["openRunLog"].tap(); expect(app, "runLogEmpty")
        XCTAssertFalse(app.buttons["copyRunSummary"].exists)
        app.buttons["shareRunLog"].tap(); expect(app, "runLogFilePreview")
        XCTAssertTrue(node(app, "runLogFilePreviewText").label.contains("app.start"))
        XCTAssertTrue(app.buttons["confirmShareRunLog"].exists)
        app.buttons["closeRunLog"].tap(); expect(app, "openRunLog")
        app.terminate()
    }

    @MainActor func testLaunchLoggingOverhead() {
        continueAfterFailure = false
        var rows: [[String: Any]] = []
        for enabled in [false, true] {
            for _ in 0..<3 {
                let started = Date()
                let app = launch("diag3-perf-" + UUID().uuidString, theme: "light", extra: enabled ? [] : ["--diag3-disable-logging"])
                expect(app, "openRunLog")
                let ready = Date()
                app.terminate()
                rows.append(["logging": enabled, "launchToAboutReadyMs": ready.timeIntervalSince(started) * 1000, "forcedTerminationMs": Date().timeIntervalSince(ready) * 1000])
            }
        }
        let object: [String: Any] = ["method": "Same final Debug app; synthetic About, three isolated launches with logging disabled/enabled. XCTest launch overhead included; termination is forced by XCTest, not an iOS normal exit callback.", "runs": rows]
        let bytes = try! JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
        let attachment = XCTAttachment(data: bytes, uniformTypeIdentifier: "public.json"); attachment.name = "iphone-performance"; attachment.lifetime = .keepAlways; add(attachment)
    }

}
