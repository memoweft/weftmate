import XCTest

final class IOSUIChatUITests: XCTestCase {
    @MainActor func testCandidateFixtureNamespacesKeepSeparateDrafts() throws {
        let origin=try XCTUnwrap(ProcessInfo.processInfo.environment["WEFTMATE_APPLE3_ORIGIN"])
        let a="candidate-scope-a-"+UUID().uuidString,b="candidate-scope-b-"+UUID().uuidString
        let marker="FIXTURE_ONLY_A"
        for (namespace,write,restored) in [(a,true,false),(b,false,false),(a,false,true)] {
            let app=XCUIApplication()
            app.launchArguments=["--ui-testing","--apple4-fixture","--health4-render-only","--a5-local-server","--server-url",origin,"--ui-testing-namespace",namespace]
            app.launch(); defer { app.terminate() }
            let input=app.descendants(matching:.any)["mainChat.draft"]
            XCTAssertTrue(input.waitForExistence(timeout:30))
            if write {
                input.tap(); input.typeText(marker)
                XCTAssertEqual(input.value as? String,marker)
                Thread.sleep(forTimeInterval:1)
            } else if restored {
                let expected=XCTNSPredicateExpectation(predicate:NSPredicate(format:"value == %@",marker),object:input)
                XCTAssertEqual(XCTWaiter.wait(for:[expected],timeout:10),.completed)
            } else { XCTAssertFalse((input.value as? String ?? "").contains(marker)) }
        }
    }
    override func setUp() { super.setUp(); continueAfterFailure=false }
    @MainActor private func element(_ app:XCUIApplication,_ id:String) -> XCUIElement {
        app.descendants(matching:.any).matching(identifier:id).firstMatch
    }
    @MainActor private func tap(_ app:XCUIApplication,_ id:String) {
        let item=element(app,id); XCTAssertTrue(item.waitForExistence(timeout:20),id); item.tap()
    }
    @MainActor private func choose(_ app:XCUIApplication,_ scenario:String) {
        tap(app,"apple4.scenarios")
        if ["conversations","search","history","work","projects","resources","task"].contains(scenario) {
            tap(app,"apple4.pages")
        }
        let option=app.buttons[scenario].firstMatch
        XCTAssertTrue(option.waitForExistence(timeout:10)); option.tap()
        let selected=XCTNSPredicateExpectation(predicate:NSPredicate(format:"value == %@",scenario),object:app.buttons["apple4.scenarios"])
        XCTAssertEqual(XCTWaiter.wait(for:[selected],timeout:20),.completed,"Wait for the fixture's real reads before inspecting the new page")
    }
    @MainActor private func capture(_ app:XCUIApplication,_ page:String,_ theme:String) {
        Thread.sleep(forTimeInterval: 1)
        let shot=XCTAttachment(screenshot:app.screenshot()); shot.name=page+"-"+theme
        shot.lifetime = .keepAlways; add(shot)
    }
    @MainActor func testLocalComposerFiveLinesAndAnchoredMenus() {
        for dark in [false,true] {
            let app=XCUIApplication()
            app.launchArguments=["--ui-testing","--apple11-fixture","--ios-ui-shell-fixture","--health4-render-only","--ui-testing-namespace","ios-ui-2-local-"+UUID().uuidString]
            if dark { app.launchArguments.append("--apple11-dark") }
            app.launch(); defer { app.terminate() }
            let input=element(app,"phoneChat.draft")
            XCTAssertTrue(input.waitForExistence(timeout:30)); let one=input.frame.height
            input.tap()
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
            input.typeText("第一行\n第二行\n第三行\n第四行\n第五行")
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
    @MainActor func testChatPagesAndDecisionSheetsLightAndDark() async throws {
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
            capture(app,"sheet-approval",theme) // Measure the settled sheet, not its presentation scale.
            XCTAssertGreaterThanOrEqual(allow.frame.height,44)
            allow.tap()
            XCTAssertTrue(allow.waitForNonExistence(timeout:15))
            let approvalReport=try await queueReport(origin)
            let decisions=try XCTUnwrap(approvalReport["decisions"] as? [[String:Any]])
            XCTAssertEqual(decisions.count,1)
            XCTAssertEqual(decisions.first?["approvalId"] as? String,"apple3-two")
            XCTAssertEqual(decisions.first?["outcome"] as? String,"allowed-once")
            choose(app,"question"); PhoneChatTestSupport.openPending(app)
            capture(app,"sheet-question-open",theme)
            let option=app.buttons["questionOption.plan.读书"]
            let enabled=XCTNSPredicateExpectation(predicate:NSPredicate(format:"exists == true AND enabled == true"),object:option)
            let ready=await XCTWaiter.fulfillment(of:[enabled],timeout:15)
            XCTAssertEqual(ready,.completed)
            guard ready == .completed else { return }
            tap(app,"questionOption.plan.读书")
            XCTAssertEqual(app.buttons["questionOption.plan.读书"].value as? String,"已选择")
            capture(app,"sheet-question",theme); tap(app,"submitQuestion.apple5-question")
            XCTAssertTrue(element(app,"questionBar").waitForNonExistence(timeout:15))
            let report=try await queueReport(origin)
            let submitted=try XCTUnwrap(report["questionAnswer"] as? [String:Any])
            let answer=try XCTUnwrap(submitted["answer"] as? [String:Any])
            let answers=try XCTUnwrap(answer["answers"] as? [[String:Any]])
            XCTAssertEqual(answers.count,1); XCTAssertEqual(answers.first?["id"] as? String,"plan")
            XCTAssertEqual(answers.first?["selected"] as? [String],["读书"])
            XCTAssertFalse((submitted["requestId"] as? String ?? "").isEmpty)
        }
    }
    @MainActor func testLargeTypeReducedMotionComposerRemainsReachable() {
        let app=XCUIApplication(); defer { app.terminate() }
        app.launchArguments=["--ui-testing","--apple11-fixture","--ios-ui-shell-fixture","--health4-render-only",
            "--ios-ui-reduce-motion","--ui-testing-namespace","ios-ui-2-accessibility-"+UUID().uuidString,
            "-UIPreferredContentSizeCategoryName","UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        let input=element(app,"phoneChat.draft")
        XCTAssertTrue(input.waitForExistence(timeout:30)); input.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout:10))
        input.typeText("one\ntwo\nthree\nfour\nfive")
        let five=input.frame.height
        input.typeText("\nsix\nseven")
        XCTAssertEqual(input.frame.height,five,accuracy:3)
        let send=app.buttons["phoneChat.send"]
        XCTAssertTrue(send.isHittable); XCTAssertGreaterThanOrEqual(send.frame.height,44)
        XCTAssertLessThanOrEqual(send.frame.maxY,app.keyboards.firstMatch.frame.minY+1)
        capture(app,"large-reduced-five-lines","light")
        app.buttons["收起键盘"].tap()
        XCTAssertTrue(app.buttons["phone.tab.chat"].waitForExistence(timeout:10))
        tap(app,"phoneChat.model")
        XCTAssertTrue(element(app,"modelServices.add").waitForExistence(timeout:10))
        capture(app,"large-reduced-model-menu","light")
    }
    @MainActor func testQueueEditAndRetractPreserveCurrentDraftAndUseOnlyUnstartedIDs() async throws {
        let origin=try XCTUnwrap(ProcessInfo.processInfo.environment["WEFTMATE_APPLE3_ORIGIN"])
        let app=XCUIApplication(); defer { app.terminate() }
        app.launchArguments=["--ui-testing","--apple4-fixture","--apple5-reset-presentation","--health4-render-only",
            "--a5-local-server","--server-url",origin,"--ui-testing-namespace","ios-ui-2-queue-"+UUID().uuidString]
        app.launch(); choose(app,"queue")
        let input=element(app,"mainChat.draft"),current="PRESERVE_CURRENT"
        XCTAssertTrue(input.waitForExistence(timeout:30)); input.tap(); input.typeText(current)
        tap(app,"mainChat.queue")
        XCTAssertFalse(element(app,"mainChat.queued.queue-active").exists)
        let edit=app.buttons["mainChat.queueEdit.queue-edit"]
        guard edit.waitForExistence(timeout:10) else { XCTFail("The queued message must expose its edit action"); return }; edit.tap()
        XCTAssertTrue(app.staticTexts["先发送或清空当前草稿，再修改排队消息。"].waitForExistence(timeout:10))
        var report=try await queueReport(origin)
        XCTAssertEqual((report["queueCancels"] as? [[String:Any]])?.count,0)
        tap(app,"phoneSheet.close")
        XCTAssertEqual(input.value as? String,current)
        input.coordinate(withNormalizedOffset:CGVector(dx:0.98,dy:0.5)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout:10))
        input.coordinate(withNormalizedOffset:CGVector(dx:0.98,dy:0.5)).tap()
        input.typeText(String(repeating:XCUIKeyboardKey.delete.rawValue,count:current.count))
        let cleared=input.value as? String ?? ""
        guard cleared.isEmpty || cleared == input.placeholderValue else { XCTFail("Clear the current draft through the native editor before editing a queued message"); return }
        tap(app,"mainChat.queue"); edit.tap()
        let restored=XCTNSPredicateExpectation(predicate:NSPredicate(format:"value == %@","QUEUED_EDIT"),object:input)
        let result=await XCTWaiter.fulfillment(of:[restored],timeout:15)
        XCTAssertEqual(result,.completed)
        guard result == .completed else { return }
        tap(app,"mainChat.queue")
        let retract=app.buttons["mainChat.queueRetract.queue-retract"]
        XCTAssertTrue(retract.waitForExistence(timeout:10)); retract.tap()
        XCTAssertTrue(element(app,"mainChat.queued.queue-retract").waitForNonExistence(timeout:15))
        capture(app,"queue-receipt","light")
        if app.buttons["phoneSheet.close"].exists && app.buttons["phoneSheet.close"].isHittable { tap(app,"phoneSheet.close") }
        XCTAssertEqual(input.value as? String,"QUEUED_EDIT")
        report=try await queueReport(origin)
        let cancels=try XCTUnwrap(report["queueCancels"] as? [[String:Any]])
        XCTAssertEqual(cancels.compactMap{$0["taskId"] as? String},["queue-edit","queue-retract"])
        let requests=cancels.compactMap{$0["requestId"] as? String}
        XCTAssertEqual(Set(requests).count,2)
        XCTAssertTrue(requests.allSatisfy{$0.hasPrefix("apple-queue-cancel-")})
    }
    @MainActor private func queueReport(_ origin:String) async throws -> [String:Any] {
        let (data,response)=try await URLSession.shared.data(from:try XCTUnwrap(URL(string:origin+"/fixture/apple3-report")))
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode,200)
        return try XCTUnwrap(JSONSerialization.jsonObject(with:data) as? [String:Any])
    }
    @MainActor func testCalendarDismissesBeforeHistoryNavigation() throws {
        let origin=try XCTUnwrap(ProcessInfo.processInfo.environment["WEFTMATE_APPLE3_ORIGIN"])
        let app=XCUIApplication(); defer { app.terminate() }
        app.launchArguments=["--ui-testing","--apple4-fixture","--ios-ui-2-capture","--health4-render-only",
            "--a5-local-server","--server-url",origin,"--ui-testing-namespace","ios-ui-2-calendar-"+UUID().uuidString]
        app.launch()
        XCTAssertTrue(element(app,"mainChat.draft").waitForExistence(timeout:30))
        tap(app,"phone.sidebar"); tap(app,"phone.sidebar.conversations")
        let dateRow=element(app,"conversations.date")
        for _ in 0..<5 where !dateRow.exists || !dateRow.isHittable { app.swipeUp() }
        tap(app,"conversations.date")
        let action=app.buttons["conversations.showDate"]
        XCTAssertTrue(action.waitForExistence(timeout:10))
        let frame=XCTAttachment(string:action.debugDescription); frame.name="calendar-action-frame"; frame.lifetime = .keepAlways; add(frame)
        capture(app,"calendar-before","light")
        XCTAssertLessThan(action.frame.height,100,"Select the action itself, not the entire calendar container")
        action.tap()
        let history=element(app,"mainChat.historyDate")
        guard history.waitForExistence(timeout:15) else { capture(app,"calendar-after-failure","light"); XCTFail("The selected day must open after the calendar closes"); return }
        capture(app,"calendar-after","light")
        XCTAssertTrue(app.buttons["mainChat.historyReturn"].isHittable)
    }
    @MainActor func testSystemAndReplyGlyphRendering() throws {
        let origin=try XCTUnwrap(ProcessInfo.processInfo.environment["WEFTMATE_APPLE3_ORIGIN"])
        let app=XCUIApplication(); defer { app.terminate() }
        app.launchArguments=["--ui-testing","--apple4-fixture","--ios-ui-2-glyph-probe","--health4-render-only",
            "--a5-local-server","--server-url",origin,"--ui-testing-namespace","ios-ui-2-glyph-"+UUID().uuidString]
        app.launch()
        let sample="e\u{301} 👨‍👩‍👧‍👦 🚶🏽‍♀️"
        XCTAssertTrue(element(app,"glyph.system").waitForExistence(timeout:30))
        capture(app,"system-complete-live-glyphs","light")
        XCTAssertEqual(element(app,"glyph.system").label,sample)
        XCTAssertEqual(element(app,"glyph.complete").label,sample)
        let live=app.textViews.matching(NSPredicate(format:"identifier BEGINSWITH %@","reply.live.glyph-probe")).firstMatch
        XCTAssertTrue(live.waitForExistence(timeout:10))
        XCTAssertEqual(live.value as? String,sample)
    }
    @MainActor func testReferenceScreensThroughTheRealShell() async throws {
        let origin=try XCTUnwrap(ProcessInfo.processInfo.environment["WEFTMATE_APPLE3_ORIGIN"])
        for theme in ["light","dark"] {
            let app=XCUIApplication()
            app.launchArguments=["--ui-testing","--apple4-fixture","--ios-ui-2-capture","--health4-render-only","--a5-local-server","--server-url",origin,"--ui-testing-namespace","ios-ui-2-shots-"+UUID().uuidString,theme]
            app.launch(); defer { app.terminate() }
            XCTAssertTrue(element(app,"mainChat.draft").waitForExistence(timeout:35))
            let firstMessage=app.staticTexts["周末想去公园走走，帮我留出一个不赶时间的上午。"]
            for _ in 0..<4 where !firstMessage.exists || !firstMessage.isHittable { app.scrollViews["mainChat.scroll"].swipeDown() }
            XCTAssertTrue(firstMessage.isHittable); capture(app,"chat",theme)
            let retainedDraft="HISTORY_DRAFT"
            let rootDraft=element(app,"mainChat.draft"); rootDraft.tap(); rootDraft.typeText(retainedDraft)
            tap(app,"phone.sidebar"); tap(app,"phone.sidebar.conversations")
            XCTAssertTrue(element(app,"conversationList").waitForExistence(timeout:15)); capture(app,"conversations",theme)
            // Search and date use the actual list inputs and the anchored calendar.
            let search=app.searchFields.firstMatch
            if !search.isHittable { app.swipeDown() }
            XCTAssertTrue(search.waitForExistence(timeout:10)); search.tap(); search.typeText("合成")
            search.typeText("\n")
            XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout:10))
            capture(app,"search",theme)
            search.tap()
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout:10))
            search.buttons.firstMatch.tap() // Native clear button restores the conversation list.
            // An empty native search disables Return. Its visible close control
            // sits immediately to the right of the actual search field.
            capture(app,"search-before-native-close",theme)
            let closeX=(search.frame.maxX+app.frame.maxX)/2
            app.coordinate(withNormalizedOffset:.zero).withOffset(CGVector(dx:closeX,dy:search.frame.midY)).tap()
            guard app.keyboards.firstMatch.waitForNonExistence(timeout:10) else {
                capture(app,"search-close-failure",theme); XCTFail("Close the native search before opening the calendar"); return
            }
            XCTAssertTrue(app.navigationBars["全部对话"].waitForExistence(timeout: 10))
            let dateRow=element(app,"conversations.date")
            for _ in 0..<5 where !dateRow.exists || !dateRow.isHittable { app.swipeUp() }
            tap(app,"conversations.date"); XCTAssertTrue(element(app,"conversations.datePicker").waitForExistence(timeout:10))
            tap(app,"conversations.showDate")
            guard element(app,"conversations.datePicker").waitForNonExistence(timeout:15) else {
                capture(app,"calendar-active-failure",theme)
                XCTFail("The calendar must dismiss before the history page is used"); return
            }
            XCTAssertTrue(element(app,"mainChat.historyDate").waitForExistence(timeout:15)); capture(app,"history",theme)
            XCTAssertTrue(app.navigationBars.buttons.firstMatch.isHittable)
            let historyComposer=element(app,"mainChat.composer")
            XCTAssertFalse(historyComposer.exists && historyComposer.isHittable)
            tap(app,"mainChat.historyReturn")
            XCTAssertTrue(element(app,"conversationList").waitForExistence(timeout:15))
            tap(app,"phone.tab.chat")
            capture(app,"after-nested-history-reset",theme)
            guard app.buttons["phone.sidebar"].waitForExistence(timeout:15) else {
                XCTFail("Reselect must reset both value and destination-based navigation"); return
            }
            XCTAssertEqual(rootDraft.value as? String,retainedDraft,"Reading a date must preserve the current conversation draft")
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
            XCTAssertTrue(app.staticTexts["合成散步清单.txt"].waitForExistence(timeout:15))
            XCTAssertTrue(app.buttons["查看旧版本"].exists); capture(app,"resources",theme)
            tap(app,"resources.process")
            XCTAssertTrue(element(app,"phone.task").waitForExistence(timeout:15))
            for block in app.buttons.matching(NSPredicate(format:"identifier BEGINSWITH %@","executionBlock.")).allElementsBoundByIndex {
                if block.isHittable { block.tap() }
            }
            for step in app.buttons.matching(NSPredicate(format:"identifier BEGINSWITH %@","executionStep.")).allElementsBoundByIndex {
                if step.isHittable { step.tap() }
            }
            guard app.staticTexts["已读取「合成周末计划.txt」的文字内容。"].waitForExistence(timeout:10) else {
                capture(app,"task-detail-failure",theme); XCTFail("Opening a real step must read and show its detail response"); return
            }
            let detailReport=try await queueReport(origin)
            let detailReads=try XCTUnwrap(detailReport["reads"] as? [[String:Any]])
            XCTAssertTrue(detailReads.contains{$0["kind"] as? String == "detail" && ($0["seq"] as? Int).map{[3,4].contains($0)} == true})
            capture(app,"task",theme)
            XCTAssertTrue(app.buttons["phone.tab.chat"].exists)
        }
    }
    @MainActor func testStreamingDoesNotMoveHistoryReader() throws {
        let app=XCUIApplication(),origin=try XCTUnwrap(ProcessInfo.processInfo.environment["WEFTMATE_APPLE3_ORIGIN"])
        app.launchArguments=["--ui-testing","--apple4-fixture","--health4-render-only","--a5-local-server","--server-url",origin,"--ui-testing-namespace","ios-ui-2-follow-"+UUID().uuidString]
        app.launch(); defer { app.terminate() }
        choose(app,"stream-long")
        let scroll=app.scrollViews["mainChat.scroll"]
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
