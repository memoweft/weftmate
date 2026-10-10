import XCTest
final class A16ChatUITests: XCTestCase {
    @MainActor private func get(_ path:String) async throws -> Any {
        let driver=ProcessInfo.processInfo.environment["WEFTMATE_A16_DRIVER"]!
        let(data,response)=try await URLSession.shared.data(from:URL(string:driver+path)!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode,200)
        return try JSONSerialization.jsonObject(with:data)
    }
    @MainActor private func element(_ app:XCUIApplication,_ id:String)->XCUIElement {
        let byID = app.descendants(matching:.any).matching(identifier:id).firstMatch
        if byID.exists { return byID }
        let names = ["mainChat.date":"跳日期", "mainChat.search":"搜索", "mainChat.find":"查找", "mainChat.previous":"上一条", "mainChat.next":"下一条", "mainChat.latest":"回到底部", "mainChat.plus":"添加", "mainChat.send":"发送", "conversationMenu":"对话菜单"]
        return names[id].map { app.buttons[$0] } ?? byID
    }
    @MainActor private func tap(_ item:XCUIElement) throws {if !item.waitForExistence(timeout:30){XCTFail("Missing control "+item.identifier);throw NSError(domain:"A16",code:1)};item.tap()}
    @MainActor private func keep(_ app:XCUIApplication,_ scene:String,_ theme:String){
        let image=XCTAttachment(screenshot:app.screenshot());image.name="a16-"+scene+"-"+theme;image.lifetime = .keepAlways;add(image)
        let snapshot=app.debugDescription,regex=try! NSRegularExpression(pattern:"(?:label|value): '([^']*)'")
        let strings=regex.matches(in:snapshot,range:NSRange(snapshot.startIndex...,in:snapshot)).map{String(snapshot[Range($0.range(at:1),in:snapshot)!])}
        let text=XCTAttachment(string:strings.joined(separator:"\n"));text.name="a16-text-"+scene+"-"+theme;text.lifetime = .keepAlways;add(text)
    }
    @MainActor func testExportPanel() async throws {
        continueAfterFailure=false;let ready=try await get("/ready") as! [String:Any]
        let app=XCUIApplication();app.launchArguments=["--ui-testing","--ui-testing-namespace","a16-export-"+UUID().uuidString,"--a5-local-server","--a5-theme","light","--server-url",ready["host"] as! String,"--a16-driver",ProcessInfo.processInfo.environment["WEFTMATE_A16_DRIVER"]!]
        app.launch();defer{app.terminate()}
        try tap(element(app,"mainChat.latest"))
        let reply=element(app,"mainChat.event."+(ready["tailAssistantEventID"] as! String))
        for _ in 0..<4 { if reply.isHittable { break };app.scrollViews.firstMatch.swipeDown() }
        reply.press(forDuration:1);try tap(app.buttons["导出"].firstMatch)
        XCTAssertTrue(element(app,"message.exportPreview").waitForExistence(timeout:15))
        try tap(element(app,"保存 Markdown"))
        XCTAssertTrue(app.buttons["保存"].waitForExistence(timeout:15));keep(app,"export-save-panel","light")
        // Opening is the assertion here. The system file-service Cancel action is
        // separately documented as unverified on this SDK's unstable remote AX tree.
        app.terminate(); app.launch()
        XCTAssertTrue(element(app,"mainChat.latest").waitForExistence(timeout:30))
    }
    @MainActor func testLightMainChat() async throws {try await run("light")}
    @MainActor func testDarkMainChat() async throws {try await run("dark")}
    @MainActor func testScrollSmoke() async throws {
        continueAfterFailure = false
        let ready = try await get("/ready") as! [String: Any]
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "a16-scroll-" + UUID().uuidString, "--a5-local-server", "--a5-theme", "light", "--server-url", ready["host"] as! String, "--a16-driver", ProcessInfo.processInfo.environment["WEFTMATE_A16_DRIVER"]!]
        app.launch(); defer { app.terminate() }
        try tap(element(app, "mainChat.latest")); try tap(element(app, "mainChat.search"))
        try tap(element(app, "mainChat.query")); element(app, "mainChat.query").typeText("A16查找纸船")
        try tap(element(app, "mainChat.find")); try tap(element(app, "mainChat.latest"))
        _ = try await get("/perf-start"); try await Task.sleep(for: .seconds(3))
        for _ in 0..<3 { app.scrollViews.firstMatch.swipeDown(); app.scrollViews.firstMatch.swipeUp() }
        _ = try await get("/perf-stop"); try await Task.sleep(for: .seconds(3))
        try tap(element(app, "mainChat.date"))
        XCTAssertTrue(element(app, "mainChat.datePicker").waitForExistence(timeout:10))
        keep(app, "scroll-smoke", "light")
    }
    @MainActor private func run(_ theme:String) async throws {
        continueAfterFailure=false;let ready=try await get("/ready") as! [String:Any]
        let app=XCUIApplication();app.launchArguments=["--ui-testing","--ui-testing-namespace","a16-"+UUID().uuidString.prefix(8),"--a5-local-server","--a5-theme",theme,"--server-url",ready["host"] as! String,"--a16-driver",ProcessInfo.processInfo.environment["WEFTMATE_A16_DRIVER"]!]
        app.launch();defer{app.terminate()}
        try tap(element(app,"mainChat.latest"));keep(app,"first-screen",theme)
        XCTAssertTrue(element(app,"mainChat").exists)
        try tap(element(app,"mainChat.resources"));XCTAssertTrue(app.staticTexts["输出内容"].waitForExistence(timeout:15));keep(app,"resources",theme)
        try tap(app.buttons["完成"].firstMatch)
        // Native menu and calendar, without substituting model callbacks for UI actions.
        try tap(element(app,"mainChat.date"));XCTAssertTrue(element(app,"mainChat.datePicker").waitForExistence(timeout:10));keep(app,"native-date-picker",theme)
        try tap(app.buttons["跳到这一天"])
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format:"exists == false"), object: element(app,"mainChat.datePicker"))
        let dismissal = await XCTWaiter.fulfillment(of:[dismissed],timeout:15)
        XCTAssertEqual(dismissal,.completed)
        guard dismissal == .completed else { throw NSError(domain:"A16DateDismiss",code:1) }
        keep(app,"date-located",theme)
        app.scrollViews.firstMatch.swipeDown()
        if let day=ready["oldDay"] as? String {
            let row=element(app,"mainChat.day."+day)
            for _ in 0..<8 {if row.isHittable{break};app.scrollViews.firstMatch.swipeDown()}
            try tap(row)
            let expanded = XCTNSPredicateExpectation(predicate:NSPredicate(format:"value == %@","已展开"),object:row)
            let expansion = await XCTWaiter.fulfillment(of:[expanded],timeout:10); XCTAssertEqual(expansion,.completed)
            guard expansion == .completed else { throw NSError(domain:"A16DayExpand",code:1) }
            keep(app,"expanded-day",theme)
            try tap(row);XCTAssertEqual(row.value as? String,"已折叠")
        }
        try tap(element(app,"mainChat.search"))
        let query=element(app,"mainChat.query");try tap(query);query.typeText("A16查找纸船")
        try tap(element(app,"mainChat.find"))
        let source=ready["searchEventID"] as! String
        XCTAssertTrue(element(app,"mainChat.event."+source).waitForExistence(timeout:30));keep(app,"search-first",theme)
        try tap(element(app,"mainChat.next"))
        if let second = ready["secondSearchEventID"] as? String {
            let visible = XCTNSPredicateExpectation(predicate:NSPredicate(format:"hittable == true"),object:element(app,"mainChat.event."+second))
            let located = await XCTWaiter.fulfillment(of:[visible],timeout:15);XCTAssertEqual(located,.completed)
        }
        keep(app,"search-next",theme);try tap(element(app,"mainChat.previous"))
        let message=element(app,"mainChat.event."+source);message.press(forDuration:1);keep(app,"user-message-menu",theme)
        XCTAssertFalse(app.buttons["编辑并重发"].exists)
        try tap(app.buttons["开旁聊"]);XCTAssertTrue(element(app,"sideChat.referencesOnly").waitForExistence(timeout:30));keep(app,"side-source",theme)
        try tap(element(app,"sideChat.source"));XCTAssertTrue(element(app,"mainChat.event."+source).waitForExistence(timeout:30))
        let returned = XCTNSPredicateExpectation(predicate:NSPredicate(format:"hittable == true"),object:element(app,"mainChat.event."+source))
        let locatedSource = await XCTWaiter.fulfillment(of:[returned],timeout:15);XCTAssertEqual(locatedSource,.completed)
        keep(app,"returned-source",theme)
        if let assistantID = ready["assistantEventID"] as? String {
            let reply = element(app,"mainChat.event." + assistantID)
            for _ in 0..<4 { if reply.isHittable { break }; app.scrollViews.firstMatch.swipeUp() }
            reply.press(forDuration:1);keep(app,"assistant-message-menu",theme)
            for label in ["复制", "有用", "没用", "重新生成", "导出", "引用"] { XCTAssertTrue(app.buttons[label].firstMatch.exists) }
            try tap(app.buttons["导出"].firstMatch)
            XCTAssertTrue(element(app,"message.exportPreview").waitForExistence(timeout:10));keep(app,"export-preview",theme)
            try tap(element(app,"保存 Markdown"))
            XCTAssertTrue(app.buttons["保存"].waitForExistence(timeout:15));keep(app,"export-save-panel",theme)
            // Restore only this isolated app after capturing the system file service;
            // do not count restart as a successful system Cancel or file write.
            app.terminate(); app.launch()
            XCTAssertTrue(element(app,"mainChat.latest").waitForExistence(timeout:30))
        }
        // Returning to the root and refreshing reads the host's tail, including real result cards.
        try tap(element(app,"mainChat.latest"))
        if let result=(ready["resultIDs"] as? [String])?.first {
            let card=element(app,"mainChat.result."+result)
            for _ in 0..<12 {if card.isHittable{break};app.scrollViews.firstMatch.swipeUp()}
            try tap(card);XCTAssertTrue(element(app,"conversationDetail").waitForExistence(timeout:20));keep(app,"result-opened",theme)
            try tap(app.navigationBars.buttons["WeftMate"].firstMatch)
        }
        try tap(element(app,"mainChat.plus"));keep(app,"composer-menu",theme)
        try tap(app.buttons["mainChat.syntheticAttachment"].firstMatch)
        XCTAssertTrue(app.staticTexts["A16-synthetic.txt"].waitForExistence(timeout:10))
        let draft=element(app,"mainChat.draft");try tap(draft);draft.typeText("A16 合成主对话发送")
        try tap(element(app,"mainChat.send"));keep(app,"sent",theme)
        XCTAssertTrue(element(app,"approvalBar").waitForExistence(timeout:30));keep(app,"approval",theme)
        let report=try await get("/report") as! [String:Any]
        if let approval=(report["approvals"] as? [[String:Any]])?.first(where:{$0["resolved"] as? Bool==false})?["id"] as? String{
            try tap(element(app,"approveOnce."+approval));_=try await get("/consume")
        }
        try tap(element(app,"mainChat.plus"))
        let temporaryAction = app.buttons["mainChat.temporary"].firstMatch
        XCTAssertTrue(temporaryAction.waitForExistence(timeout:10))
        // UIKit's menu activation point can refer to its presenting control on this
        // simulator. Target the center of the resolved, named menu item's own frame.
        print("A16_TEMPORARY_MENU_FRAME", temporaryAction.frame)
        temporaryAction.coordinate(withNormalizedOffset: CGVector(dx:0.5,dy:0.5)).tap()
        XCTAssertTrue(element(app,"temporaryChat.title").waitForExistence(timeout:30));XCTAssertTrue(element(app,"temporaryChat.composer").exists);keep(app,"temporary",theme)
        try tap(element(app,"conversationMenu"));let memory=element(app,"temporaryChat.memory"),recall=element(app,"temporaryChat.recall")
        let policyBefore = try await get("/temporary") as! [[String:Any]]
        XCTAssertEqual(policyBefore.last?["memoryMode"] as? String,"off"); XCTAssertEqual(policyBefore.last?["recallEnabled"] as? Bool,true)
        XCTAssertTrue(memory.waitForExistence(timeout:10));XCTAssertTrue(memory.isSelected || memory.value as? String == "1");XCTAssertTrue(recall.isSelected || recall.value as? String == "1");keep(app,"temporary-menu",theme)
        let expiry = element(app,"temporaryChat.expiryMenu"); XCTAssertTrue(expiry.exists); expiry.coordinate(withNormalizedOffset: CGVector(dx:0.5,dy:0.5)).tap();keep(app,"temporary-expiry",theme)
        try tap(app.buttons["7 天"])
        try await Task.sleep(for:.seconds(1))
        let temporary=try await get("/temporary") as! [[String:Any]];XCTAssertEqual(temporary.last?["autoDeleteDays"] as? Int,7)
        try tap(element(app,"conversationMenu"))
        try tap(element(app,"temporaryChat.recall"));try await Task.sleep(for:.seconds(1))
        try tap(element(app,"conversationMenu"))
        XCTAssertFalse(element(app,"temporaryChat.recall").isSelected)
        let policyAfter = try await get("/temporary") as! [[String:Any]]; XCTAssertEqual(policyAfter.last?["recallEnabled"] as? Bool,false)
        keep(app,"temporary-recall-off",theme)
        app.coordinate(withNormalizedOffset: CGVector(dx:0.1,dy:0.5)).tap()
        _=try await get("/expire")
        XCTAssertTrue(app.staticTexts["会话已变更"].waitForExistence(timeout:30))
        keep(app,"temporary-expired",theme)
        try tap(app.navigationBars.buttons.firstMatch)
        // Native application scroll measurement uses the same ten-thousand-row HTTP history.
        if app.navigationBars.buttons["WeftMate"].firstMatch.exists {try tap(app.navigationBars.buttons["WeftMate"].firstMatch)}
        _=try await get("/perf-start"); try await Task.sleep(for:.seconds(3))
        let began=ProcessInfo.processInfo.systemUptime
        // Use one sampler: the app reports display-link intervals and resident memory.
        // Keep the same 24 native gestures without layering XCTest's scroll profiler
        // onto the app's active display link (the simulator can stop reaching idle).
        for _ in 0..<3 {
            for _ in 0..<4 { app.scrollViews.firstMatch.swipeDown(); app.scrollViews.firstMatch.swipeUp() }
        }
        _=try await get("/perf-stop"); try await Task.sleep(for:.seconds(3))
        let data: [String:Any]=["hostHistory":10000,"nativeGestures":24,"seconds":ProcessInfo.processInfo.systemUptime-began,"measurement":"XCUITest native swipe wall time; frame/memory sampling in native app report"]
        let perf=XCTAttachment(string:String(decoding:try JSONSerialization.data(withJSONObject:data),as:UTF8.self));perf.name="a16-perf-"+theme;perf.lifetime = .keepAlways;add(perf)
    }
}
