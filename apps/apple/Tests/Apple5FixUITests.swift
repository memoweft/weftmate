import XCTest

final class Apple5FixUITests: XCTestCase {
    @MainActor private func capture(_ app: XCUIApplication,_ theme: String,_ name: String) {
        let shot=XCTAttachment(screenshot:app.screenshot());shot.name="apple5fix-"+theme+"-"+name;shot.lifetime = .keepAlways;add(shot)
    }
    @MainActor private func choose(_ app: XCUIApplication,_ name: String,_ prefix: String) throws {
        app.buttons[prefix+".scenarios"].tap();let item=app.buttons[prefix == "apple4" ? name : prefix+"."+name];XCTAssertTrue(item.waitForExistence(timeout:5));item.tap()
    }
    @MainActor private func launch(_ theme: String, cards: Bool) throws -> XCUIApplication {
        let env=ProcessInfo.processInfo.environment,app=XCUIApplication()
        app.launchArguments=["--ui-testing",cards ? "--apple4-fixture" : "--apple5-addendum","--apple5-reset-presentation","--health4-render-only","--a5-local-server","--server-url",try XCTUnwrap(env[cards ? "WEFTMATE_APPLE3_ORIGIN" : "WEFTMATE_APPLE5_ORIGIN"]),"--ui-testing-namespace","apple5fix-"+UUID().uuidString,theme]
        if !cards { app.launchEnvironment=["WEFTMATE_APPLE5_USERNAME":try XCTUnwrap(env["WEFTMATE_APPLE5_USERNAME"]),"WEFTMATE_APPLE5_PASSWORD":try XCTUnwrap(env["WEFTMATE_APPLE5_PASSWORD"])] }
        app.launch();XCTAssertTrue(app.buttons[cards ? "apple4.scenarios" : "apple5add.scenarios"].waitForExistence(timeout:35));return app
    }
    @MainActor private func waitHittable(_ element: XCUIElement) {
        let ready=XCTNSPredicateExpectation(predicate:NSPredicate(format:"hittable == true"),object:element)
        XCTAssertEqual(XCTWaiter.wait(for:[ready],timeout:10),.completed)
    }
    @MainActor private func waitGone(_ element: XCUIElement) { XCTAssertTrue(element.waitForNonExistence(timeout:10)) }
    @MainActor func testFooterKeyboardAttachmentsAndAllTabs() throws {
        for theme in ["light","dark"] {
            let app=try launch(theme,cards:false)
            let composer=app.otherElements["mainChat.composer"]
            XCTAssertTrue(composer.waitForExistence(timeout:10));XCTAssertEqual(app.buttons["mainChat.send"].label,"语音输入")
            XCTAssertFalse(app.buttons["mainChat.dictation"].exists);XCTAssertFalse(app.buttons["mainChat.latest"].exists);capture(app,theme,"empty-collapsed")
            app.descendants(matching:.any)["mainChat.draft"].tap();XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout:10))
            XCTAssertFalse(app.buttons["mainChat.dictation"].exists);XCTAssertLessThanOrEqual(composer.frame.maxY,app.keyboards.firstMatch.frame.minY+1);capture(app,theme,"focused")
            app.buttons["mainChat.menu"].tap();app.buttons["输出与来源"].firstMatch.tap();XCTAssertTrue(app.buttons["phoneSheet.close"].waitForExistence(timeout:15));app.buttons["phoneSheet.close"].tap()
            try choose(app,"attachments","apple5add")
            let image=app.buttons["attachment.remove.合成照片.png"],file=app.buttons["attachment.remove.合成计划.pdf"]
            XCTAssertTrue(image.waitForExistence(timeout:10));XCTAssertGreaterThanOrEqual(image.frame.width,44);XCTAssertGreaterThanOrEqual(file.frame.width,44);XCTAssertEqual(image.frame.height,file.frame.height,accuracy:1)
            XCTAssertEqual(app.buttons["mainChat.send"].label,"发送");capture(app,theme,"attachments-idle")
            app.descendants(matching:.any)["mainChat.draft"].tap();XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout:10));XCTAssertLessThanOrEqual(composer.frame.maxY,app.keyboards.firstMatch.frame.minY+1);capture(app,theme,"attachments-keyboard")
            app.buttons["mainChat.menu"].tap();app.buttons["输出与来源"].firstMatch.tap();XCTAssertTrue(app.buttons["phoneSheet.close"].waitForExistence(timeout:15));app.buttons["phoneSheet.close"].tap();image.tap();file.tap()
            for label in ["聊天","动态","健康","目标","成果库","聊天"] {
                let tabs=app.otherElements["phone.bottomTabs"],button=tabs.buttons[label]
                XCTAssertTrue(button.waitForExistence(timeout:15));XCTAssertGreaterThanOrEqual(button.frame.width,44);XCTAssertGreaterThanOrEqual(button.frame.height,44);button.tap();XCTAssertTrue(button.isSelected)
                if label != "聊天" { capture(app,theme,"tab-"+label) }
            }
            capture(app,theme,"returned-chat");app.terminate()
        }
    }
    @MainActor func testDecisionVisibilityReturnControlAndReceipt() throws {
        for theme in ["light","dark"] {
            let app=try launch(theme,cards:true)
            try choose(app,"two","apple4")
            let approve=app.buttons["approveOnce.apple3-two"]
            XCTAssertTrue(approve.waitForExistence(timeout:20));waitHittable(approve)
            let card=app.otherElements["approvalCard.apple3-two"],composer=app.otherElements["mainChat.composer"]
            XCTAssertLessThanOrEqual(card.frame.maxY,composer.frame.minY+1);waitGone(app.buttons["mainChat.latest"]);waitGone(app.buttons["phone.pendingDecision.open"]);capture(app,theme,"approval-two-visible")
            try choose(app,"aligned","apple4")
            let confirm=app.buttons["approvalConfirm.apple3-aligned"]
            XCTAssertTrue(confirm.waitForExistence(timeout:20));waitHittable(confirm);XCTAssertLessThanOrEqual(confirm.frame.maxY,composer.frame.minY+1)
            waitGone(app.buttons["phone.pendingDecision.open"]);waitGone(app.buttons["mainChat.latest"]);capture(app,theme,"approval-three-visible")
            app.buttons["rejectApproval.apple3-aligned"].tap();confirm.tap()
            XCTAssertTrue(app.descendants(matching:.any)["approvalSummary.apple3-aligned"].waitForExistence(timeout:15));capture(app,theme,"registered-receipt")
            try choose(app,"long","apple4")
            let longConfirm=app.buttons["approvalConfirm.apple3-long"]
            XCTAssertTrue(longConfirm.waitForExistence(timeout:20));waitHittable(longConfirm);capture(app,theme,"new-decision-auto-visible")
            let hint=app.buttons["phone.pendingDecision.open"]
            for _ in 0..<6 where !hint.exists { app.swipeDown() }
            XCTAssertTrue(hint.waitForExistence(timeout:10));XCTAssertLessThanOrEqual(hint.frame.maxY,composer.frame.minY+1);capture(app,theme,"decision-outside-hint")
            hint.tap();waitHittable(longConfirm);waitGone(hint);XCTAssertLessThanOrEqual(longConfirm.frame.maxY,composer.frame.minY+1);capture(app,theme,"hint-returned-to-card")
            app.terminate()
        }
    }
}
