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
    @MainActor func testLightMainChat() async throws {try await run("light")}
    @MainActor func testDarkMainChat() async throws {try await run("dark")}
    @MainActor private func run(_ theme:String) async throws {
        continueAfterFailure=false;let ready=try await get("/ready") as! [String:Any]
        let app=XCUIApplication();app.launchArguments=["--ui-testing","--ui-testing-namespace","a16-"+UUID().uuidString.prefix(8),"--a5-local-server","--a5-theme",theme,"--server-url",ready["host"] as! String,"--a16-driver",ProcessInfo.processInfo.environment["WEFTMATE_A16_DRIVER"]!]
        app.launch();defer{app.terminate()}
        try tap(element(app,"mainChat.latest"));keep(app,"first-screen",theme)
        XCTAssertTrue(element(app,"mainChat").exists)
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
        try tap(element(app,"mainChat.next"));keep(app,"search-next",theme);try tap(element(app,"mainChat.previous"))
        let message=element(app,"mainChat.event."+source);message.press(forDuration:1)
        try tap(app.buttons["开旁聊"]);XCTAssertTrue(element(app,"sideChat.referencesOnly").waitForExistence(timeout:30));keep(app,"side-source",theme)
        try tap(element(app,"sideChat.source"));XCTAssertTrue(element(app,"mainChat.event."+source).waitForExistence(timeout:30));keep(app,"returned-source",theme)
        try tap(element(app,"mainChat.latest"))
        // Returning to the root and refreshing reads the host's tail, including real result cards.
        try tap(element(app,"mainChat.latest"))
        if let result=(ready["resultIDs"] as? [String])?.first {
            let card=element(app,"mainChat.result."+result)
            for _ in 0..<12 {if card.isHittable{break};app.scrollViews.firstMatch.swipeUp()}
            try tap(card);XCTAssertTrue(element(app,"conversationDetail").waitForExistence(timeout:20));keep(app,"result-opened",theme)
            try tap(app.navigationBars.buttons["WeftMate"].firstMatch)
        }
        try tap(element(app,"mainChat.plus"));try tap(app.buttons["添加合成附件"])
        let draft=element(app,"mainChat.draft");try tap(draft);draft.typeText("A16 合成主对话发送")
        try tap(element(app,"mainChat.send"));keep(app,"sent",theme)
        XCTAssertTrue(element(app,"approvalBar").waitForExistence(timeout:30));keep(app,"approval",theme)
        let report=try await get("/report") as! [String:Any]
        if let approval=(report["approvals"] as? [[String:Any]])?.first(where:{$0["resolved"] as? Bool==false})?["id"] as? String{
            try tap(element(app,"approveOnce."+approval));_=try await get("/consume")
        }
        try tap(element(app,"mainChat.plus"));try tap(app.buttons["这次别记"])
        XCTAssertTrue(element(app,"temporaryChat.title").waitForExistence(timeout:30));XCTAssertTrue(element(app,"temporaryChat.composer").exists);keep(app,"temporary",theme)
        try tap(element(app,"conversationMenu"));let memory=element(app,"temporaryChat.memory"),recall=element(app,"temporaryChat.recall")
        XCTAssertTrue(memory.waitForExistence(timeout:10));XCTAssertEqual(memory.value as? String,"1");XCTAssertEqual(recall.value as? String,"1");keep(app,"temporary-menu",theme)
        try tap(element(app,"temporaryChat.expiryMenu"));keep(app,"temporary-expiry",theme)
        try tap(app.buttons["7 天"])
        try await Task.sleep(for:.seconds(1))
        let temporary=try await get("/temporary") as! [[String:Any]];XCTAssertEqual(temporary.last?["autoDeleteDays"] as? Int,7)
        try tap(recall);try await Task.sleep(for:.seconds(1));XCTAssertEqual(recall.value as? String,"0");keep(app,"temporary-recall-off",theme)
        try tap(element(app,"closeSessionActions"))
        _=try await get("/expire")
        XCTAssertTrue(app.staticTexts["会话已变更"].waitForExistence(timeout:30))
        keep(app,"temporary-expired",theme)
        try tap(app.navigationBars.buttons.firstMatch)
        // Native application scroll measurement uses the same ten-thousand-row HTTP history.
        if app.navigationBars.buttons["WeftMate"].firstMatch.exists {try tap(app.navigationBars.buttons["WeftMate"].firstMatch)}
        _=try await get("/perf-start"); try await Task.sleep(for:.seconds(3))
        let began=ProcessInfo.processInfo.systemUptime
        let options = XCTMeasureOptions(); options.iterationCount = 3
        measure(metrics: [XCTMemoryMetric(application: app), XCTOSSignpostMetric.scrollDecelerationMetric], options: options) {
            for _ in 0..<4 { app.scrollViews.firstMatch.swipeDown(); app.scrollViews.firstMatch.swipeUp() }
        }
        _=try await get("/perf-stop"); try await Task.sleep(for:.seconds(3))
        let data: [String:Any]=["hostHistory":10000,"nativeGestures":24,"seconds":ProcessInfo.processInfo.systemUptime-began,"measurement":"XCUITest native swipe wall time; frame/memory sampling in native app report"]
        let perf=XCTAttachment(string:String(decoding:try JSONSerialization.data(withJSONObject:data),as:UTF8.self));perf.name="a16-perf-"+theme;perf.lifetime = .keepAlways;add(perf)
    }
}
