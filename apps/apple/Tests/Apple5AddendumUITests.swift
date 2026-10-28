import XCTest

final class Apple5AddendumUITests: XCTestCase {
    @MainActor private func capture(_ app: XCUIApplication,_ theme: String,_ name: String) {
        let attachment=XCTAttachment(screenshot:app.screenshot());attachment.name="apple5add-"+theme+"-"+name;attachment.lifetime = .keepAlways;add(attachment)
    }
    @MainActor private func choose(_ app: XCUIApplication,_ name: String) {
        app.buttons["apple5add.scenarios"].tap(); app.buttons["apple5add."+name].tap()
    }
    @MainActor func testNavigationAndMediaBatch() throws {
        let env=ProcessInfo.processInfo.environment
        for theme in ["light","dark"] {
            let app=XCUIApplication(); app.launchArguments=["--ui-testing","--apple5-addendum","--health4-render-only","--a5-local-server","--server-url",try XCTUnwrap(env["WEFTMATE_APPLE5_ORIGIN"]),"--ui-testing-namespace","apple5add-"+UUID().uuidString,theme]
            app.launchEnvironment=["WEFTMATE_APPLE5_USERNAME":try XCTUnwrap(env["WEFTMATE_APPLE5_USERNAME"]),"WEFTMATE_APPLE5_PASSWORD":try XCTUnwrap(env["WEFTMATE_APPLE5_PASSWORD"])];app.launch()
            XCTAssertTrue(app.buttons["apple5add.scenarios"].waitForExistence(timeout:35))
            for label in ["聊天","动态","健康"] {
                let tab=app.otherElements["phone.bottomTabs"].buttons[label]; XCTAssertTrue(tab.exists); XCTAssertGreaterThanOrEqual(tab.frame.width,44);XCTAssertGreaterThanOrEqual(tab.frame.height,44)
                XCTAssertTrue(app.otherElements["phone.bottomTabs"].staticTexts[label].exists)
            }
            XCTAssertEqual(app.buttons["mainChat.send"].label,"语音输入");capture(app,theme,"navigation")
            choose(app,"narrow");XCTAssertTrue(app.otherElements["phone.bottomTabs"].buttons["健康"].exists);capture(app,theme,"navigation-320")
            choose(app,"large");XCTAssertTrue(app.otherElements["phone.bottomTabs"].buttons["健康"].exists);capture(app,theme,"navigation-large")
            choose(app,"normal")
            XCUIDevice.shared.orientation = .landscapeLeft;capture(app,theme,"navigation-landscape");XCUIDevice.shared.orientation = .portrait
            choose(app,"attachments")
            XCTAssertTrue(app.descendants(matching:.any)["mainChat.attachmentBlocks"].waitForExistence(timeout:15));XCTAssertEqual(app.buttons["mainChat.send"].label,"发送")
            let remove=app.buttons["attachment.remove.合成照片.png"];XCTAssertGreaterThanOrEqual(remove.frame.height,44);capture(app,theme,"attachments-keyboard-hidden")
            app.descendants(matching:.any)["mainChat.draft"].tap();XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout:10));capture(app,theme,"attachments-keyboard")
            app.buttons["mainChat.menu"].tap();app.buttons["输出与来源"].firstMatch.tap();XCTAssertTrue(PhoneChatTestSupport.resourcesBack(app).waitForExistence(timeout:15));PhoneChatTestSupport.returnFromResources(app)
            remove.tap();app.buttons["attachment.remove.合成计划.pdf"].tap();XCTAssertEqual(app.buttons["mainChat.send"].label,"语音输入")
            choose(app,"pdf");XCTAssertTrue(app.buttons["filePreview.close"].waitForExistence(timeout:10));XCTAssertFalse(app.otherElements["attachmentPreviewPanel"].descendants(matching:.any)["mainChat.draft"].exists);capture(app,theme,"pdf-fullscreen")
            app.buttons["filePreview.more"].tap();XCTAssertTrue(app.buttons["filePreview.save"].waitForExistence(timeout:10));capture(app,theme,"pdf-menu")
            app.terminate()
        }
    }
    @MainActor func testDecisionCardsBatch() throws {
        let env=ProcessInfo.processInfo.environment
        for theme in ["light","dark"] {
            let card=XCUIApplication();card.launchArguments=["--ui-testing","--apple4-fixture","--apple5-reset-presentation","--health4-render-only","--a5-local-server","--server-url",try XCTUnwrap(env["WEFTMATE_APPLE3_ORIGIN"]),"--ui-testing-namespace","apple5add-cards-"+UUID().uuidString,theme]
            card.launch();XCTAssertTrue(card.buttons["apple4.scenarios"].waitForExistence(timeout:30))
            card.buttons["apple4.scenarios"].tap();card.buttons["two"].tap();PhoneChatTestSupport.openPending(card);XCTAssertTrue(card.buttons["approveOnce.apple3-two"].waitForExistence(timeout:20));capture(card,theme,"approval-two-actions");card.buttons["phoneSheet.close"].tap()
            card.buttons["apple4.scenarios"].tap();card.buttons["aligned"].tap();PhoneChatTestSupport.openPending(card);XCTAssertTrue(card.buttons["approveOnce.apple3-aligned"].waitForExistence(timeout:20));capture(card,theme,"approval-choices")
            card.buttons["rejectApproval.apple3-aligned"].tap();XCTAssertTrue(card.descendants(matching:.any)["approvalSummary.apple3-aligned"].waitForExistence(timeout:15));capture(card,theme,"approval-receipt")
            card.buttons["apple4.scenarios"].tap();card.buttons["question"].tap();PhoneChatTestSupport.openPending(card);XCTAssertTrue(card.buttons["questionOption.plan.读书"].waitForExistence(timeout:20));card.buttons["questionOption.plan.读书"].tap();capture(card,theme,"question-choices");XCTAssertTrue(card.buttons["submitQuestion.apple5-question"].exists)
            card.terminate()
            card.launchArguments += ["--apple5-large"];card.launch();XCTAssertTrue(card.buttons["apple4.scenarios"].waitForExistence(timeout:30));card.buttons["apple4.scenarios"].tap();card.buttons["warning"].tap();PhoneChatTestSupport.openPending(card);XCTAssertTrue(card.buttons["approveOnce.apple3-warning"].waitForExistence(timeout:20));capture(card,theme,"approval-large-top");card.swipeUp();capture(card,theme,"approval-large-bottom");card.terminate()
        }
    }
}
