import XCTest

final class A5ParityUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    private var driver: String { ProcessInfo.processInfo.environment["WEFTMATE_A5_DRIVER"]! }
    @MainActor private func get(_ path: String) async throws -> [String: Any] {
        let (data,response) = try await URLSession.shared.data(from: URL(string:driver + path)!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode,200)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw NSError(domain:"A5Driver",code:1) }
        return try JSONSerialization.jsonObject(with:data) as! [String: Any]
    }
    @MainActor private func expect(_ element: XCUIElement, _ timeout: TimeInterval = 30) throws {
        XCTAssertTrue(element.waitForExistence(timeout:timeout),"Missing control: " + element.identifier)
        if !element.exists { throw NSError(domain:"A5UI",code:1) }
    }
    @MainActor private func tap(_ app: XCUIApplication, _ name: String) throws { let element=app.buttons[name];try expect(element);element.tap() }
    @MainActor private func fill(_ app: XCUIApplication, _ name: String, _ text: String, secure: Bool = false) throws {
        let element=secure ? app.secureTextFields[name] : app.textFields[name];try expect(element);element.tap();element.typeText(text)
    }
    @MainActor private func keep(_ app: XCUIApplication, _ scene: String, _ theme: String) {
        let attachment=XCTAttachment(screenshot:app.screenshot());attachment.name="review-iphone-" + scene + "-" + theme;attachment.lifetime = .keepAlways;add(attachment)
    }
    @MainActor private func reveal(_ app: XCUIApplication, _ element: XCUIElement) {
        for up in [true, false] {
            for _ in 0..<8 {
                if element.exists && element.isHittable { return }
                if up { app.swipeUp() } else { app.swipeDown() }
            }
        }
    }
    @MainActor private func row(_ app: XCUIApplication, _ id: String) throws { let element=app.descendants(matching:.any).matching(identifier:"conversationRow." + id).firstMatch;try expect(element);element.tap() }
    @MainActor private func back(_ app: XCUIApplication) throws { let button=app.navigationBars.buttons.firstMatch;try expect(button);button.tap() }
    @MainActor private func send(_ app: XCUIApplication, _ text: String) throws {
        try fill(app,"conversationDraft",text)
        let button=app.buttons["sendButton"];let ready=NSPredicate(format:"enabled == true")
        let enabled=XCTNSPredicateExpectation(predicate:ready,object:button)
        let readyResult=XCTWaiter.wait(for:[enabled],timeout:20);XCTAssertEqual(readyResult,.completed)
        guard readyResult == .completed else { throw NSError(domain:"A5SendReadiness",code:1) };button.tap()
        let empty=NSPredicate(format:"value == %@", "向 WeftMate 说说你的目标")
        // A cleared TextField reports its placeholder as value.
        let cleared=XCTNSPredicateExpectation(predicate:empty,object:app.textFields["conversationDraft"])
        XCTAssertEqual(XCTWaiter.wait(for:[cleared],timeout:20),.completed)
    }
    @MainActor func testLightParityFlowAndGallery() async throws { try await run(theme:"light",behavior:true) }
    @MainActor func testDarkGallery() async throws { try await run(theme:"dark",behavior:false) }
    @MainActor private func run(theme: String, behavior: Bool) async throws {
        let ready=try await get("/ready"),credentials=try await get("/credentials")
        let app=XCUIApplication();app.launchArguments=["--ui-testing","--ui-testing-namespace","a5-" + UUID().uuidString.prefix(8),"--lg2-cloud","--a5-theme",theme,
            "--server-url",ready["host"] as! String,"--s1c-cloud-url",ready["cloud"] as! String,"--s1c-qr-url",driver + "/pairing.png"]
        app.launch();try expect(app.staticTexts["登录 WeftMate"]);keep(app,"login",theme)
        try fill(app,"accountEmail",credentials["email"] as! String);try tap(app,"accountRegistration");try tap(app,"accountSubmit")
        try fill(app,"accountCode",try await get("/code")["code"] as! String);try tap(app,"accountSubmit")
        try fill(app,"accountPassword",credentials["password"] as! String,secure:true);try fill(app,"accountRepeatedPassword",credentials["password"] as! String,secure:true);try tap(app,"accountSubmit")
        try expect(app.textFields["accountDeviceName"]);try tap(app,"accountSubmit");try expect(app.textFields["accountCode"])
        try fill(app,"accountCode",try await get("/code")["code"] as! String);try tap(app,"accountSubmit")
        try expect(app.staticTexts["已登录 WeftMate"]);_ = try await get("/bootstrap")
        try tap(app,"设置 → 设备");try tap(app,"刷新设备")
        try tap(app,"connectHost." + (ready["hostId"] as! String));try expect(app.descendants(matching:.any)["cloudPairingReady"].firstMatch)
        try tap(app,"cloudRequestApproval");try expect(app.staticTexts["cloudWaiting"]);_ = try await get("/approve")
        let ids=try await get("/a5/ids");try expect(app.descendants(matching:.any)["conversationList"].firstMatch);keep(app,"sessions",theme)
        if behavior {
            try row(app,ids["queue"] as! String)
            try send(app,"A5_HOLD original task")
            try send(app,"A5_STEER supplemental instruction")
            try expect(app.staticTexts["已补充到当前任务"])
            app.segmentedControls["sendIntent"].buttons["新任务"].tap()
            for text in ["A5_QUEUE_1", "A5_QUEUE_2", "A5_CANCEL", "A5_EDIT"] { try send(app,text) }
            let queued=app.buttons["4 个排队中"];try expect(queued);queued.tap()
            let cancelCard=app.descendants(matching:.any).matching(NSPredicate(format:"identifier BEGINSWITH %@ AND label CONTAINS %@","queuedTask.","A5_CANCEL")).firstMatch
            // Locate the named task card, then its named cancel action; no position assumptions.
            let cancelText=app.staticTexts["A5_CANCEL"];try expect(cancelText)
            let report=try await get("/a5/report"),ops=report["operations"] as! [[String:Any]]
            let cancelReceipt=ops.last { $0["text"] as? String == "A5_CANCEL" }!["receiptId"] as! String
            _ = cancelReceipt;_ = cancelCard
            try tap(app,"取消排队任务 A5_CANCEL")
            try tap(app,"编辑排队任务 A5_EDIT")
            let editable=app.textFields["conversationDraft"]
            let restored=XCTNSPredicateExpectation(predicate:NSPredicate(format:"value == %@","A5_EDIT"),object:editable)
            XCTAssertEqual(XCTWaiter.wait(for:[restored],timeout:20),.completed)
            editable.tap();editable.typeText("-changed")
            XCTAssertEqual(editable.value as? String,"A5_EDIT-changed")
            try tap(app,"sendButton")
            try tap(app,"stopActiveTask")
            // The real host projection is polled until both queued goals have been consumed in order.
            var final:[String:Any]=[:]
            for _ in 0..<100 {
                final=try await get("/a5/report")
                let starts=(final["operations"] as! [[String:Any]]).filter { $0["kind"] as? String == "started" }.compactMap { $0["text"] as? String }
                if starts.contains("A5_EDIT-changed") { break };try await Task.sleep(for:.milliseconds(200))
            }
            let starts=(final["operations"] as! [[String:Any]]).filter { $0["kind"] as? String == "started" }.compactMap { $0["text"] as? String }
            XCTAssertEqual(starts.filter { $0.hasPrefix("A5_QUEUE_") },["A5_QUEUE_1","A5_QUEUE_2"])
            XCTAssertFalse(starts.contains("A5_CANCEL"));XCTAssertFalse(starts.contains("A5_EDIT"));XCTAssertTrue(starts.contains("A5_EDIT-changed"));XCTAssertFalse(starts.contains("A5_STEER supplemental instruction"))
            try back(app)
        }
        try row(app,ids["review"] as! String)
        try expect(app.buttons["openConversationResources"]);keep(app,"conversation",theme)
        let allow=app.buttons.matching(NSPredicate(format:"identifier BEGINSWITH %@","approveOnce.")).firstMatch
        reveal(app,allow)
        try expect(allow);keep(app,"approval",theme)
        if behavior {
            XCTAssertTrue(app.staticTexts["删除合成草稿文件"].exists);allow.tap()
            let deny=try await get("/a5/deny");try tap(app,"refreshHistoryButton")
            let reject=app.buttons["rejectApproval." + (deny["approvalId"] as! String)]
            reveal(app,reject)
            try expect(reject);reject.tap()
        }
        let question=app.staticTexts["报告要采用哪种格式？"]
        reveal(app,question)
        try expect(question);keep(app,"question",theme)
        try tap(app,"openConversationResources");try expect(app.staticTexts["输出内容"]);keep(app,"outputs-sources",theme);try tap(app,"closeResourcesPanel")
        try tap(app,"phoneAccountMenu");try tap(app,"phoneMenu.memory");try expect(app.staticTexts["我的记忆"]);keep(app,"memory",theme);try tap(app,"closeAuxiliarySheetButton")
        try tap(app,"phoneAccountMenu");try tap(app,"phoneMenu.settings");try expect(app.staticTexts["账户与设置"]);keep(app,"appearance",theme)
        try tap(app,"openUsage");try expect(app.staticTexts["本月合计"]);keep(app,"usage",theme)
        if behavior {
            let report=try await get("/a5/report"),usage=report["usage"] as! [String:Any],total=usage["total"] as! [String:Any]
            XCTAssertTrue(app.staticTexts[String(format:"¥%.6f",total["cost"] as! Double)].exists)
            _ = try await get("/a5/usage-warning");app.swipeUp();try tap(app,"刷新用量");try expect(app.staticTexts.containing(NSPredicate(format:"label CONTAINS %@","80%")).firstMatch)
            _ = try await get("/a5/usage-blocked");try tap(app,"刷新用量");try expect(app.staticTexts.containing(NSPredicate(format:"label CONTAINS %@","云端模型请求已暂停")).firstMatch)
            let refused=try await get("/a5/refused");XCTAssertEqual(refused["status"] as? Int,402)
            try fill(app,"usageTemporaryLimit","1");try tap(app,"临时提高本月上限")
            try tap(app,"完成");try tap(app,"closeAuxiliarySheetButton");try back(app)
            try row(app,ids["deletion"] as! String);try tap(app,"对话菜单");try tap(app,"归档对话");try back(app)
            try tap(app,"已归档");try row(app,ids["deletion"] as! String)
            XCTAssertFalse(app.buttons["sendButton"].isEnabled);try tap(app,"恢复对话")
            try tap(app,"对话菜单");try tap(app,"删除对话")
            XCTAssertEqual(app.switches["forgetConversationMemories"].value as? String,"0");try tap(app,"confirmDeleteConversation")
            try back(app);try tap(app,"返回最近对话");try row(app,ids["forget"] as! String);try tap(app,"对话菜单");try tap(app,"删除对话")
            app.switches["forgetConversationMemories"].tap();try tap(app,"confirmDeleteConversation")
            let final=try await get("/a5/report");XCTAssertEqual((final["memoryDeletes"] as! [[String:Any]]).count,1)
            let exists=final["workspaceExists"] as! [String:Bool];XCTAssertEqual(exists["deletion"],false);XCTAssertEqual(exists["forget"],false)
        }
        if !behavior { try tap(app,"完成");try tap(app,"closeAuxiliarySheetButton") }
        if behavior { try back(app);try row(app,ids["review"] as! String) }
        try tap(app,"对话菜单");try expect(app.buttons["归档对话"]);keep(app,"session-menu",theme)
        app.terminate()
    }
}
