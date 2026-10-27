import XCTest

/// Regression journeys for the replacement composer and decision presentations.
final class Apple5FixUITests: XCTestCase {
    @MainActor func testFooterKeyboardAttachmentsAndAllTabs() throws {
        for theme in ["light","dark"] {
            let app=XCUIApplication(),env=ProcessInfo.processInfo.environment
            app.launchArguments=["--ui-testing","--apple5-addendum","--apple5-reset-presentation","--health4-render-only","--a5-local-server","--server-url",try XCTUnwrap(env["WEFTMATE_APPLE5_ORIGIN"]),"--ui-testing-namespace","ios-ui-2-footer-"+UUID().uuidString,theme]
            app.launchEnvironment=["WEFTMATE_APPLE5_USERNAME":try XCTUnwrap(env["WEFTMATE_APPLE5_USERNAME"]),"WEFTMATE_APPLE5_PASSWORD":try XCTUnwrap(env["WEFTMATE_APPLE5_PASSWORD"])]; app.launch(); defer { app.terminate() }
            let composer=app.otherElements["mainChat.composer"],input=app.descendants(matching:.any)["mainChat.draft"]
            XCTAssertTrue(composer.waitForExistence(timeout:35)); input.tap()
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout:10))
            XCTAssertLessThanOrEqual(composer.frame.maxY,app.keyboards.firstMatch.frame.minY+1)
            input.typeText("保留这段草稿")
            app.buttons["mainChat.menu"].tap(); app.buttons["输出与来源"].firstMatch.tap()
            XCTAssertTrue(PhoneChatTestSupport.resourcesBack(app).waitForExistence(timeout:15)); PhoneChatTestSupport.returnFromResources(app)
            XCTAssertEqual(input.value as? String,"保留这段草稿")
            app.buttons["apple5add.scenarios"].tap(); app.buttons["apple5add.attachments"].tap()
            let image=app.buttons["attachment.remove.合成照片.png"],file=app.buttons["attachment.remove.合成计划.pdf"]
            XCTAssertTrue(image.waitForExistence(timeout:10)); XCTAssertGreaterThanOrEqual(image.frame.width,44); XCTAssertGreaterThanOrEqual(file.frame.height,44)
            XCTAssertEqual(app.buttons["mainChat.send"].label,"发送"); image.tap(); file.tap()
            for id in ["activity","health","chat"] {
                let tab=app.buttons["phone.tab."+id]; XCTAssertTrue(tab.waitForExistence(timeout:15)); tab.tap(); XCTAssertTrue(tab.isSelected)
            }
            XCTAssertEqual(input.value as? String,"保留这段草稿")
        }
    }
    @MainActor func testDecisionSummaryOpensSheetAndKeepsHistoryPosition() throws {
        for theme in ["light","dark"] {
            let app=XCUIApplication(),origin=try XCTUnwrap(ProcessInfo.processInfo.environment["WEFTMATE_APPLE3_ORIGIN"])
            app.launchArguments=["--ui-testing","--apple4-fixture","--apple5-reset-presentation","--health4-render-only","--a5-local-server","--server-url",origin,"--ui-testing-namespace","ios-ui-2-decisions-"+UUID().uuidString,theme]
            app.launch(); defer { app.terminate() }
            XCTAssertTrue(app.buttons["apple4.scenarios"].waitForExistence(timeout:35)); app.buttons["apple4.scenarios"].tap(); app.buttons["long"].tap()
            let notice=app.buttons["phone.pendingDecision.open"]
            XCTAssertTrue(notice.waitForExistence(timeout:20)); XCTAssertFalse(app.buttons["approveOnce.apple3-long"].exists)
            PhoneChatTestSupport.openPending(app)
            let allow=app.buttons["approveOnce.apple3-long"],reject=app.buttons["rejectApproval.apple3-long"]
            XCTAssertTrue(allow.waitForExistence(timeout:10)); XCTAssertGreaterThan(reject.frame.minY,allow.frame.minY)
            XCTAssertTrue(app.buttons["phoneSheet.close"].exists); reject.tap()
            XCTAssertTrue(reject.waitForNonExistence(timeout:15)); XCTAssertFalse(notice.exists)
            XCTAssertTrue(app.buttons["mainChat.send"].exists)
        }
    }
}
