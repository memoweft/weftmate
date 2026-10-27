import XCTest

final class IOSUIChatUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure=false }
    @MainActor private func element(_ app:XCUIApplication,_ id:String) -> XCUIElement {
        app.descendants(matching:.any).matching(identifier:id).firstMatch
    }
    @MainActor private func tap(_ app:XCUIApplication,_ id:String) {
        let item=element(app,id); XCTAssertTrue(item.waitForExistence(timeout:20),id); item.tap()
    }
    @MainActor private func choose(_ app:XCUIApplication,_ scenario:String) {
        tap(app,"apple4.scenarios"); let option=app.buttons[scenario].firstMatch
        XCTAssertTrue(option.waitForExistence(timeout:10)); option.tap()
    }
    @MainActor private func capture(_ app:XCUIApplication,_ page:String,_ theme:String) {
        let shot=XCTAttachment(screenshot:app.screenshot()); shot.name=page+"-"+theme
        shot.lifetime = .keepAlways; add(shot)
    }
    @MainActor func testLocalComposerFiveLinesAndAnchoredMenus() {
        for dark in [false,true] {
            let app=XCUIApplication()
            app.launchArguments=["--ui-testing","--apple11-fixture","--health4-render-only","--ui-testing-namespace","ios-ui-2-local-"+UUID().uuidString]
            if dark { app.launchArguments.append("--apple11-dark") }
            app.launch(); defer { app.terminate() }
            let input=element(app,"phoneChat.draft")
            XCTAssertTrue(input.waitForExistence(timeout:30)); let one=input.frame.height
            input.tap(); input.typeText("第一行\n第二行\n第三行\n第四行\n第五行")
            let five=input.frame.height
            XCTAssertGreaterThan(five,one)
            input.typeText("\n第六行\n第七行")
            XCTAssertEqual(input.frame.height,five,accuracy:3)
            let send=app.buttons["phoneChat.send"]
            XCTAssertLessThanOrEqual(send.frame.maxY,app.keyboards.firstMatch.frame.minY+1)
            XCTAssertFalse(app.buttons["phone.tab.chat"].exists)
            app.buttons["收起键盘"].tap()
            tap(app,"phoneChat.plus")
            XCTAssertTrue(app.buttons["文件"].waitForExistence(timeout:10)); XCTAssertFalse(app.buttons["phoneSheet.close"].exists)
            capture(app,"popover-attachments",dark ? "dark" : "light")
            app.coordinate(withNormalizedOffset:CGVector(dx:0.9,dy:0.3)).tap()
            tap(app,"phoneChat.model")
            XCTAssertTrue(element(app,"modelServices.add").waitForExistence(timeout:10))
            XCTAssertLessThan(element(app,"modelServices.add").frame.width,app.frame.width)
            capture(app,"popover-models",dark ? "dark" : "light")
        }
    }
    @MainActor func testChatPagesAndDecisionSheetsLightAndDark() throws {
        let origin=try XCTUnwrap(ProcessInfo.processInfo.environment["WEFTMATE_APPLE3_ORIGIN"])
        for theme in ["light","dark"] {
            let app=XCUIApplication()
            app.launchArguments=["--ui-testing","--apple4-fixture","--apple5-reset-presentation","--health4-render-only","--a5-local-server","--server-url",origin,"--ui-testing-namespace","ios-ui-2-"+UUID().uuidString,theme]
            app.launch(); defer { app.terminate() }
            XCTAssertTrue(element(app,"mainChat.draft").waitForExistence(timeout:35))
            capture(app,"journey-chat",theme)
            for page in ["conversations","search","history","work","projects","resources","task"] {
                choose(app,page)
                let identity=["conversations":"conversationList","search":"conversationList","history":"mainChat.historyDate","work":"phone.work.start","projects":"phone.projects","resources":"mainChat.resourcesPage","task":"phone.task"][page]!
                XCTAssertTrue(element(app,identity).waitForExistence(timeout:20),page)
                capture(app,"journey-"+page,theme)
            }
            choose(app,"two")
            XCTAssertTrue(app.buttons["phone.pendingDecision.open"].waitForExistence(timeout:20))
            XCTAssertFalse(app.buttons["approveOnce.apple3-two"].exists)
            PhoneChatTestSupport.openPending(app)
            let allow=app.buttons["approveOnce.apple3-two"]
            XCTAssertTrue(allow.waitForExistence(timeout:10)); XCTAssertTrue(allow.isEnabled)
            XCTAssertGreaterThanOrEqual(allow.frame.height,44); capture(app,"sheet-approval",theme)
            allow.tap()
            XCTAssertTrue(allow.waitForNonExistence(timeout:15))
            choose(app,"question"); PhoneChatTestSupport.openPending(app)
            tap(app,"questionOption.plan.读书")
            XCTAssertEqual(app.buttons["questionOption.plan.读书"].value as? String,"已选择")
            capture(app,"sheet-question",theme); tap(app,"submitQuestion.apple5-question")
            XCTAssertTrue(element(app,"questionBar").waitForNonExistence(timeout:15))
        }
    }
    @MainActor func testReferenceScreensThroughTheRealShell() async throws {
        let origin=try XCTUnwrap(ProcessInfo.processInfo.environment["WEFTMATE_APPLE3_ORIGIN"])
        for theme in ["light","dark"] {
            let app=XCUIApplication()
            app.launchArguments=["--ui-testing","--apple4-fixture","--ios-ui-2-capture","--health4-render-only","--a5-local-server","--server-url",origin,"--ui-testing-namespace","ios-ui-2-shots-"+UUID().uuidString,theme]
            app.launch(); defer { app.terminate() }
            XCTAssertTrue(element(app,"mainChat.draft").waitForExistence(timeout:35)); capture(app,"chat",theme)
            tap(app,"phone.sidebar"); tap(app,"phone.sidebar.conversations")
            XCTAssertTrue(element(app,"conversationList").waitForExistence(timeout:15)); capture(app,"conversations",theme)
            // Search and date use the actual list inputs and the anchored calendar.
            let search=app.searchFields.firstMatch
            if !search.isHittable { app.swipeDown() }
            XCTAssertTrue(search.waitForExistence(timeout:10)); search.tap(); search.typeText("合成")
            capture(app,"search",theme)
            search.buttons.firstMatch.tap() // Native clear button restores the conversation list.
            if app.buttons["Cancel"].firstMatch.exists { app.buttons["Cancel"].firstMatch.tap() } else { app.buttons["取消"].firstMatch.tap() }
            tap(app,"conversations.date"); XCTAssertTrue(element(app,"conversations.datePicker").waitForExistence(timeout:10))
            app.buttons["查看这一天"].tap()
            XCTAssertTrue(element(app,"mainChat.historyDate").waitForExistence(timeout:15)); capture(app,"history",theme)
            tap(app,"phone.tab.chat")
            tap(app,"phone.sidebar"); tap(app,"phone.sidebar.new"); tap(app,"phone.sidebar.newWork")
            XCTAssertTrue(element(app,"phone.work.start").waitForExistence(timeout:15)); capture(app,"work",theme)
            tap(app,"phone.tab.chat")
            tap(app,"phone.sidebar"); tap(app,"phone.sidebar.projects")
            XCTAssertTrue(element(app,"phone.projects").waitForExistence(timeout:15)); capture(app,"projects",theme)
            tap(app,"phone.tab.chat")
            var request=URLRequest(url:try XCTUnwrap(URL(string:origin+"/fixture/apple3")))
            request.httpMethod="POST"; request.httpBody=try JSONSerialization.data(withJSONObject:["scenario":"resources"])
            let (_,response)=try await URLSession.shared.data(for:request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode,200)
            tap(app,"mainChat.menu"); app.buttons["刷新记录"].firstMatch.tap()
            XCTAssertTrue(app.buttons.matching(NSPredicate(format:"label CONTAINS %@","已处理 · 2 个步骤")).firstMatch.waitForExistence(timeout:15))
            tap(app,"mainChat.menu"); tap(app,"mainChat.resources")
            XCTAssertTrue(app.staticTexts["合成散步清单.txt"].waitForExistence(timeout:15)); capture(app,"resources",theme)
            tap(app,"resources.process")
            XCTAssertTrue(element(app,"phone.task").waitForExistence(timeout:15)); capture(app,"task",theme)
            XCTAssertTrue(app.buttons["phone.tab.chat"].exists)
        }
    }
    @MainActor func testStreamingDoesNotMoveHistoryReader() throws {
        let app=XCUIApplication(),origin=try XCTUnwrap(ProcessInfo.processInfo.environment["WEFTMATE_APPLE3_ORIGIN"])
        app.launchArguments=["--ui-testing","--apple4-fixture","--health4-render-only","--a5-local-server","--server-url",origin,"--ui-testing-namespace","ios-ui-2-follow-"+UUID().uuidString]
        app.launch(); defer { app.terminate() }
        choose(app,"stream-long")
        let scroll=app.scrollViews.firstMatch
        XCTAssertTrue(scroll.waitForExistence(timeout:30)); scroll.swipeDown(); scroll.swipeDown()
        let latest=element(app,"mainChat.latest")
        XCTAssertTrue(latest.waitForExistence(timeout:10))
        let visible=app.staticTexts.allElementsBoundByIndex.first { $0.label.hasPrefix("历史合成回复") && $0.isHittable }
        let anchor=try XCTUnwrap(visible),y=anchor.frame.minY
        let live=app.textViews.matching(NSPredicate(format:"identifier BEGINSWITH %@","reply.live.")).firstMatch
        XCTAssertTrue(live.waitForExistence(timeout:10)); let before=live.value as? String ?? ""
        let changed=XCTNSPredicateExpectation(predicate:NSPredicate(format:"value != %@",before),object:live)
        XCTAssertEqual(XCTWaiter.wait(for:[changed],timeout:15),.completed)
        XCTAssertEqual(anchor.frame.minY,y,accuracy:3,"Incoming text moved the history reader")
        latest.tap(); XCTAssertTrue(latest.waitForNonExistence(timeout:10))
    }
}
