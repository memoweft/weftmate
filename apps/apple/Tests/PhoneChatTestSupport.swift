import XCTest

/// Shared navigation through the shipped phone controls, with the Mac path kept.
@MainActor enum PhoneChatTestSupport {
    static var outputTitle: String {
        #if os(iOS)
        "成果"
        #else
        "输出内容"
        #endif
    }
    static func openPending(_ app:XCUIApplication) {
        #if os(iOS)
        let approval=app.descendants(matching:.any).matching(NSPredicate(format:"identifier BEGINSWITH %@","approvalCard.")).firstMatch
        let question=app.descendants(matching:.any)["questionBar"]
        if approval.exists && approval.isHittable || question.exists && question.isHittable { return }
        let summary=app.buttons.matching(identifier:"phone.pendingDecision.open").firstMatch
        XCTAssertTrue(summary.waitForExistence(timeout:20)); summary.tap()
        #endif
    }
    static func category(_ app:XCUIApplication,_ id:String,global:Bool = false) -> XCUIElement {
        #if os(iOS)
        let more=app.buttons["approvalMore."+id]
        XCTAssertTrue(more.waitForExistence(timeout:10)); more.tap()
        #endif
        return app.buttons[global ? "approvalAlwaysAllow" : "approveCategory."+id]
    }
    static func closePending(_ app:XCUIApplication) {
        #if os(iOS)
        let close=app.buttons["phoneSheet.close"]
        XCTAssertTrue(close.waitForExistence(timeout:10)); close.tap()
        #endif
    }
    static func resourcesBack(_ app:XCUIApplication) -> XCUIElement {
        #if os(iOS)
        app.navigationBars.buttons.firstMatch
        #else
        app.buttons["closeResourcesPanel"]
        #endif
    }
    static func returnFromResources(_ app:XCUIApplication) {
        #if os(iOS)
        // Detail -> resource list -> conversation, all using native back buttons.
        for _ in 0..<3 {
            let back=resourcesBack(app)
            if app.descendants(matching:.any)["conversationDraft"].isHittable || app.descendants(matching:.any)["mainChat.draft"].isHittable { return }
            XCTAssertTrue(back.waitForExistence(timeout:10)); back.tap()
        }
        #else
        resourcesBack(app).tap()
        #endif
    }
}
