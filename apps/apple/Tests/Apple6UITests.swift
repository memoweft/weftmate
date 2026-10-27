import XCTest

final class Apple6UITests: XCTestCase {
    override func setUp() { super.setUp();continueAfterFailure=false }
    @MainActor private func get(_ path: String) async throws -> [String:String] {
        let root=try XCTUnwrap(ProcessInfo.processInfo.environment["WEFTMATE_APPLE6_DRIVER"])
        let (data,response)=try await URLSession.shared.data(from:URL(string:root+path)!)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw NSError(domain:"Apple6LocalDriver",code:1) }
        return (try JSONSerialization.jsonObject(with:data) as? [String:String]) ?? [:]
    }
    @MainActor private func expect(_ element: XCUIElement, timeout: TimeInterval=20) throws { guard element.waitForExistence(timeout:timeout) else { throw NSError(domain:"Apple6MissingNativeControl:"+element.identifier,code:1) } }
    @MainActor private func tap(_ app: XCUIApplication,_ id: String) throws { let item=app.descendants(matching:.any).matching(identifier:id).firstMatch;try expect(item);for _ in 0..<6 where !item.isHittable { app.swipeUp() };item.tap() }
    @MainActor private func fill(_ app: XCUIApplication,_ id: String,_ value: String, secure: Bool=false) throws {
        let field=secure ? app.secureTextFields[id] : app.descendants(matching:.any)[id];try expect(field);field.tap();field.typeText(value)
        if app.buttons["dismissAccountKeyboard"].exists { app.buttons["dismissAccountKeyboard"].tap() }
        else if app.buttons["完成"].exists { app.buttons["完成"].firstMatch.tap() }
    }
    @MainActor private func shot(_ app: XCUIApplication,_ name: String) async throws {
        // Two independent capture paths of the same screen, with a settling interval.
        try await Task.sleep(for:.seconds(2))
        let screen=XCTAttachment(screenshot:XCUIScreen.main.screenshot());screen.name="apple6screen-"+name;screen.lifetime = .keepAlways;add(screen)
        let attachment=XCTAttachment(screenshot:app.screenshot());attachment.name="apple6-"+name;attachment.lifetime = .keepAlways;add(attachment)
        _=try await get("/capture/"+name)
    }
    @MainActor private func launch(_ theme: String,_ namespace: String, legacy: Bool=false) async throws -> XCUIApplication {
        let ready=try await get("/ready"),app=XCUIApplication()
        app.launchArguments=["--ui-testing","--apple6-fixture","--lg2-cloud","--health4-render-only","--s1c-cloud-url",ready["cloud"]!,"--ui-testing-namespace",namespace,"--a5-theme",theme,"--apple6-model-url",ready["model"]!]
        if legacy { app.launchArguments.append("--apple6-legacy-entry") }
        app.launch();try expect(app.buttons["phoneAccountMenu"],timeout:45);return app
    }
    @MainActor private func openLogin(_ app: XCUIApplication) throws {
        try tap(app,"phoneAccountMenu");try tap(app,"settings.accountCard");try expect(app.textFields["accountEmail"])
    }
    @MainActor func testLegacyNoComputerEntry() async throws {
        let c=try await get("/credentials"),app=try await launch("light","apple6-legacy-"+UUID().uuidString,legacy:true)
        try openLogin(app);try fill(app,"accountEmail",c["email"]!);try fill(app,"accountPassword",c["password"]!,secure:true);try tap(app,"accountSubmit")
        try expect(app.textFields["accountCode"]);try fill(app,"accountCode",try await get("/code")["code"]!);try tap(app,"accountSubmit")
        if app.buttons["完成"].waitForExistence(timeout:5) { app.buttons["完成"].firstMatch.tap() }
        try expect(app.buttons["retryComputer"]);XCTAssertFalse(app.otherElements["phone.bottomTabs"].exists)
        XCTAssertTrue(app.staticTexts["电脑没开或没联网"].exists)
        try await shot(app,"baseline-no-computer");app.terminate()
    }
    @MainActor func testAStandaloneLight() async throws { try await journey("light") }
    @MainActor func testBStandaloneDark() async throws { try await journey("dark") }
    @MainActor private func journey(_ theme: String) async throws {
        let c=try await get("/new-account"),namespace="apple6-"+theme+"-"+UUID().uuidString,app=try await launch(theme,namespace)
        try openLogin(app);try tap(app,"accountRegistration");try fill(app,"accountEmail",c["email"]!);try tap(app,"accountSubmit")
        try fill(app,"accountCode",try await get("/code")["code"]!);try tap(app,"accountSubmit")
        try fill(app,"accountPassword",c["password"]!,secure:true);try fill(app,"accountRepeatedPassword",c["password"]!,secure:true);try tap(app,"accountSubmit");try tap(app,"accountSubmit")
        if app.textFields["accountCode"].waitForExistence(timeout:8) { try fill(app,"accountCode",try await get("/code")["code"]!);try tap(app,"accountSubmit") }
        try expect(app.buttons["phoneModel.test"],timeout:40)
        XCTAssertFalse(app.buttons["retryComputer"].exists);XCTAssertFalse(app.staticTexts["请重新登录"].exists)
        // Close the retained settings sheet after account login.
        try expect(app.buttons["phone.tab.chat"]);try await shot(app,theme+"-registered-no-computer")
        try fill(app,"phoneModel.key",c["modelKey"]!,secure:true);XCTAssertTrue(app.buttons["phoneModel.test"].isEnabled);try await shot(app,theme+"-model-before-test");app.buttons["phoneModel.test"].coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.5)).press(forDuration:0.2);try await Task.sleep(for:.seconds(2));try await shot(app,theme+"-model-test-result");try expect(app.staticTexts["phoneModel.notice"])
        XCTAssertEqual(app.staticTexts["phoneModel.notice"].label,"连接成功，可以保存并开始聊天。")
        try await shot(app,theme+"-model-tested");try tap(app,"phoneModel.save")
        try expect(app.descendants(matching:.any)["phoneChat.draft"])
        try fill(app,"phoneChat.draft","手机独立聊天");try tap(app,"phoneChat.send")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format:"label CONTAINS %@","手机自己就能聊天")).firstMatch.waitForExistence(timeout:10))
        try await shot(app,theme+"-streaming")
        try expect(app.staticTexts["你好，手机自己就能聊天。这是一条合成流式回复。操作电脑，连上电脑后可用。"])
        try await shot(app,theme+"-reply")
        try tap(app,"phoneChat.copy");try tap(app,"phoneChat.regenerate")
        try expect(app.buttons["phoneChat.send"]);try await Task.sleep(for:.milliseconds(400));try tap(app,"phoneChat.send")
        try expect(app.staticTexts["已停止，已收到的内容保留。"]);try await shot(app,theme+"-stopped")
        for label in ["动态","健康","聊天"] {
            let button=app.buttons["phone.tab."+["聊天":"chat","动态":"activity","健康":"health"][label]!];try expect(button);button.tap();XCTAssertTrue(button.isSelected)
            try await shot(app,theme+"-tab-"+["动态":"activity","健康":"health","聊天":"chat"][label]!)
        }
        try tap(app,"phoneChat.sidebar");try await shot(app,theme+"-sidebar")
        app.buttons["关闭侧栏"].firstMatch.tap()
        try tap(app,"phoneAccountMenu");try await shot(app,theme+"-settings");try tap(app,"settingsCategory.models")
        try expect(app.staticTexts["手机上的模型"]);try await shot(app,theme+"-settings-models");app.buttons["完成"].firstMatch.tap()
        try tap(app,"phoneAccountMenu");try tap(app,"settingsCategory.devices");try expect(app.staticTexts["在电脑上安装 WeftMate 并用同一个账号登录，就会出现在这里。"])
        try await shot(app,theme+"-devices");XCTAssertFalse(app.staticTexts["请重新登录"].exists);app.buttons["完成"].firstMatch.tap()
        app.terminate();app.launch();try expect(app.staticTexts.matching(NSPredicate(format:"label CONTAINS %@","手机自己就能聊天")).firstMatch,timeout:45)
        try await shot(app,theme+"-reopened");app.terminate()
    }
    @MainActor func testCPresentationLightAndDark() async throws {
        let env=ProcessInfo.processInfo.environment
        for theme in ["light","dark"] {
            let app=XCUIApplication()
            app.launchArguments=["--ui-testing","--apple5-addendum","--apple5-reset-presentation","--health4-render-only","--a5-local-server","--server-url",try XCTUnwrap(env["WEFTMATE_APPLE5_ORIGIN"]),"--ui-testing-namespace","apple6-media-"+UUID().uuidString,theme]
            app.launchEnvironment=["WEFTMATE_APPLE5_USERNAME":try XCTUnwrap(env["WEFTMATE_APPLE5_USERNAME"]),"WEFTMATE_APPLE5_PASSWORD":try XCTUnwrap(env["WEFTMATE_APPLE5_PASSWORD"])]
            app.launch();try expect(app.buttons["apple5add.scenarios"],timeout:40)
            try await shot(app,theme+"-connected-composer-collapsed")
            app.textFields["mainChat.draft"].tap();app.textFields["mainChat.draft"].typeText("合成输入");try expect(app.buttons["mainChat.model"])
            XCTAssertGreaterThanOrEqual(app.buttons["mainChat.model"].frame.width,44)
            try await shot(app,theme+"-connected-composer-expanded")
            app.buttons["apple5add.scenarios"].tap();try tap(app,"apple5add.attachments")
            try await shot(app,theme+"-attachments-before-query");XCTAssertTrue((app.buttons["apple5add.scenarios"].value as? String ?? "").contains("输入区附件 2"));try expect(app.descendants(matching:.any).matching(identifier:"attachment.remove.合成照片.png").firstMatch);try expect(app.descendants(matching:.any).matching(identifier:"attachment.remove.合成计划.pdf").firstMatch)
            XCTAssertEqual(app.descendants(matching:.any).matching(identifier:"attachment.remove.合成照片.png").firstMatch.frame.width,app.descendants(matching:.any).matching(identifier:"attachment.remove.合成计划.pdf").firstMatch.frame.width,accuracy:1)
            try await shot(app,theme+"-connected-attachments-keyboard")
            app.buttons["apple5add.scenarios"].tap();try tap(app,"apple5add.pdf");try expect(app.buttons["filePreview.close"])
            XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout:10))
            try await shot(app,theme+"-pdf-fullscreen");try tap(app,"filePreview.more");try expect(app.buttons["filePreview.save"])
            try await shot(app,theme+"-pdf-menu");app.tap();try tap(app,"filePreview.close")
            try await shot(app,theme+"-connected-attachments-collapsed")
            try tap(app,"attachment.remove.合成照片.png");try tap(app,"attachment.remove.合成计划.pdf")
            try tap(app,"phone.tab.health");try expect(app.buttons["health.score.recovery"])
            try await shot(app,theme+"-health-upper")
            let hrv=app.buttons["health.vital.hrvSdnnMs"]
            for _ in 0..<7 where !hrv.isHittable { app.swipeUp() };try expect(hrv)
            XCTAssertLessThanOrEqual(hrv.frame.maxX,app.frame.maxX-12)
            XCTAssertEqual(hrv.frame.width,app.buttons["health.vital.restingHeartRateBpm"].frame.width,accuracy:1)
            try await shot(app,theme+"-health-vitals")
            try tap(app,"phone.tab.chat");try tap(app,"phone.sidebar")
            try expect(app.buttons["phone.sidebar.close"]);try await shot(app,theme+"-connected-sidebar")
            XCTAssertFalse(app.buttons["phone.tab.chat"].isHittable);try tap(app,"phone.sidebar.close")
            try tap(app,"phoneAccountMenu");try await shot(app,theme+"-connected-settings-zero-cost")
            app.terminate()
        }
    }

}
