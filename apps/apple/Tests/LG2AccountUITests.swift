import XCTest

/// Uses real cloud main, file mail and an isolated host. No account endpoint is mocked.
final class LG2AccountUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    private var driver: String { ProcessInfo.processInfo.environment["WEFTMATE_LG2_DRIVER"]! }
    @MainActor private func get(_ path: String) async throws -> [String: String] {
        let (data, response) = try await URLSession.shared.data(from: URL(string: driver + path)!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try JSONSerialization.jsonObject(with: data) as! [String: String]
    }
    @MainActor private func control(_ app: XCUIApplication, _ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
    @MainActor private func expect(_ item: XCUIElement, timeout: TimeInterval = 20) throws {
        guard item.exists || item.waitForExistence(timeout: timeout) else { throw NSError(domain: "LG2UI", code: 1,userInfo:[NSLocalizedDescriptionKey:"Missing required native account control"]) }
    }
    @MainActor private func reveal(_ app: XCUIApplication, _ item: XCUIElement) {
        for up in [true, false] { for _ in 0..<6 {
            if item.exists && app.frame.contains(item.frame) && item.isHittable { return }
            app.coordinate(withNormalizedOffset:CGVector(dx:0.98,dy:up ? 0.78 : 0.28)).press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:CGVector(dx:0.98,dy:up ? 0.28 : 0.78)))
        } }
    }
    @MainActor private func tap(_ app: XCUIApplication, _ id: String) throws {
        let item=app.buttons[id]
        if !item.exists {_ = item.waitForExistence(timeout:3)}
        if !item.exists {reveal(app,item)}
        try expect(item)
        if !app.frame.contains(item.frame) {reveal(app,item)}
        if !item.isEnabled {
            let ready=XCTNSPredicateExpectation(predicate:NSPredicate(format:"enabled == true"),object:item)
            guard XCTWaiter.wait(for:[ready],timeout:30) == .completed else {throw NSError(domain:"LG2DisabledControl",code:1,userInfo:[NSLocalizedDescriptionKey:"Required button stayed disabled: "+id])}
        }
        item.tap()
    }
    @MainActor private func fill(_ app: XCUIApplication, _ id: String, _ value: String, secure: Bool = false) throws {
        let item = secure ? app.secureTextFields[id] : app.textFields[id]
        reveal(app, item); try expect(item)
        if !secure,item.value as? String == value {return}
        item.tap()
        if let old=item.value as? String,!old.isEmpty {
            // A centre tap puts the caret inside an existing email. Move to
            // its trailing edge before deleting the complete fixture value.
            item.coordinate(withNormalizedOffset:CGVector(dx:0.95,dy:0.5)).tap()
            item.typeText(String(repeating:XCUIKeyboardKey.delete.rawValue,count:old.count))
        }
        item.typeText(value)
        if !secure,item.value as? String != value {throw NSError(domain:"LG2TypedValue",code:1,userInfo:[NSLocalizedDescriptionKey:"Typed value did not replace field "+id])}
        if app.buttons["dismissAccountKeyboard"].exists { app.buttons["dismissAccountKeyboard"].tap() }
    }
    @MainActor private func keep(_ app: XCUIApplication, _ name: String) { let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image) }
    @MainActor private func launch() async throws -> (XCUIApplication, [String: String]) {
        let ready = try await get("/ready")
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "lg2-" + UUID().uuidString, "--lg2-cloud", "--a5-theme", "light", "--health4-render-only", "--server-url", ready["host"]!, "--s1c-cloud-url", ready["cloud"]!]
        app.launch(); return (app, ready)
    }
    @MainActor private func settings(_ app: XCUIApplication) throws {
        if app.alerts.buttons["以后再说"].exists {app.alerts.buttons["以后再说"].tap()}
        if app.buttons["知道了"].exists && app.buttons["知道了"].isHittable {app.buttons["知道了"].tap()}
        if control(app, "closeAuxiliarySheetButton").exists { try tap(app, "closeAuxiliarySheetButton") }
        if app.alerts.buttons["以后再说"].exists {app.alerts.buttons["以后再说"].tap()}
        if app.buttons["知道了"].exists && app.buttons["知道了"].isHittable {app.buttons["知道了"].tap()}
        if control(app, "phoneAccountMenu").exists { try tap(app, "phoneAccountMenu") }
        else { try tap(app,app.buttons["phone.sidebar"].exists ? "phone.sidebar" : "phoneChat.sidebar"); try tap(app, "phone.sidebar.settings") }
        try expect(control(app, "settings.accountCard"))
    }
    @MainActor private func account(_ app: XCUIApplication) throws { try settings(app); try tap(app, "settings.accountCard") }
    @MainActor private func login(_ app: XCUIApplication) throws { if !control(app, "authRoot").exists { try account(app) }; try expect(control(app, "authRoot")) }
    @MainActor private func passwordLogin(_ app: XCUIApplication, password: String) throws {
        if !app.secureTextFields["accountPassword"].exists { app.segmentedControls["loginMethod"].buttons["密码"].tap() }
        try fill(app, "accountPassword", password, secure: true)
        try tap(app, "accountSubmit")
    }
    @MainActor private func confirmDevice(_ app: XCUIApplication) async throws {
        if app.textFields["accountCode"].waitForExistence(timeout: 5) { try fill(app, "accountCode", try await get("/code")["code"]!); try tap(app, "accountSubmit") }
    }
    @MainActor private func signedIn(_ app:XCUIApplication) async throws {
        try await workspace(app)
        try account(app);try expect(control(app,"signedInEmail"),timeout:30)
    }
    @MainActor private func workspace(_ app:XCUIApplication) async throws {
        let root=XCTNSPredicateExpectation(predicate:NSPredicate {_,_ in
            ["phoneAccountMenu","phone.sidebar","phoneChat.sidebar"].contains {id in
                let button=app.buttons[id];return button.exists && button.isHittable
            }
        },object:nil)
        guard await XCTWaiter.fulfillment(of:[root],timeout:30) == .completed else {throw NSError(domain:"LG2Workspace",code:1)}
    }
    @MainActor private func loggedOut(_ app:XCUIApplication) async throws {
        // Account changes dismiss the old settings sheet. Reopen from the
        // stable workspace rather than observing the briefly visible AuthView.
        try await workspace(app)
        try account(app);try expect(control(app,"authRoot"))
    }
    @MainActor private func logout(_ app:XCUIApplication) async throws {
        try tap(app,"accountLogout")
        try expect(app.buttons["退出登录"],timeout:10)
        keep(app,"ios-logout-confirmation")
        try tap(app,"退出登录");try await loggedOut(app)
    }
    @MainActor private func registered(_ app: XCUIApplication, credentials: [String: String]) async throws {
        try login(app); try tap(app, "accountRegistration")
        if (app.textFields["accountEmail"].value as? String) != credentials["email"]! { try fill(app, "accountEmail", credentials["email"]!) }
        try tap(app, "accountSubmit"); try fill(app, "accountCode", try await get("/code")["code"]!); try tap(app, "accountSubmit")
        try fill(app, "accountPassword", credentials["password"]!, secure: true); try fill(app, "accountRepeatedPassword", credentials["password"]!, secure: true)
        try tap(app, "accountSubmit"); try expect(app.textFields["accountDeviceName"]); try tap(app, "accountSubmit"); try await confirmDevice(app)
        try await workspace(app)
        try account(app)
        try expect(control(app, "signedInEmail"), timeout: 30)
    }
    @MainActor func testRealRegistrationRecoveryAndLogout() async throws {
        let credentials = try await get("/credentials"), (app, _) = try await launch(); defer { app.terminate() }
        try login(app); keep(app, "ios-login")
        try fill(app, "accountEmail", credentials["email"]!); try passwordLogin(app, password: UUID().uuidString)
        try expect(app.staticTexts["邮箱或密码不对，请检查后重试。"]); keep(app, "ios-login-error")
        try tap(app, "accountRegistration"); try tap(app, "服务条款")
        try expect(app.navigationBars["服务条款"])
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "WeftMate 服务条款")).firstMatch.exists)
        app.navigationBars.buttons.firstMatch.tap(); try tap(app, "account.backToLogin")
        try await registered(app, credentials: credentials); keep(app, "ios-registered")
        try await logout(app)
        try tap(app, "accountRecovery")
        if (app.textFields["accountEmail"].value as? String) != credentials["email"]! { try fill(app, "accountEmail", credentials["email"]!) }
        try tap(app, "accountSubmit"); try fill(app, "accountCode", try await get("/code")["code"]!); try tap(app, "accountSubmit")
        try fill(app, "accountPassword", credentials["nextPassword"]!, secure: true); try fill(app, "accountRepeatedPassword", credentials["nextPassword"]!, secure: true); try tap(app, "accountSubmit")
        try expect(app.staticTexts["密码已更新，请登录。"])
        XCTAssertEqual(app.textFields["accountEmail"].value as? String, credentials["email"]!)
        keep(app, "ios-password-recovered"); try passwordLogin(app, password: credentials["nextPassword"]!); try await confirmDevice(app)
        try await signedIn(app); keep(app, "ios-recovered-login")
    }
    @MainActor func testRealAccountLifecycleOnFreshCloud() async throws {
        let credentials = try await get("/credentials"), (app, ready) = try await launch(); defer { app.terminate() }
        try await registered(app, credentials: credentials)
        _ = try await get("/bootstrap")
        try settings(app); try tap(app, "settingsCategory.devices"); try tap(app, "devices.refresh")
        let device = ready["computerDeviceId"]!, renamed = "LG2 已改名电脑"
        try tap(app, "device.actions." + device); try tap(app, "renameDevice." + device)
        let field = app.textFields["devices.renameField"]; try expect(field); field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (field.value as? String ?? "").count) + renamed)
        try tap(app, "devices.saveName"); try expect(app.staticTexts[renamed]); keep(app, "ios-device-renamed")
        try tap(app, "device.actions." + device); try tap(app, "removeDevice." + device); try tap(app, "devices.confirmRemove")
        let revokedDevice = control(app, "device.actions." + device)
        let removed = NSPredicate { _, _ in !revokedDevice.exists }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: removed, object: nil)], timeout: 20), .completed)
        try account(app); try tap(app, "account.logoutOthers"); try tap(app, "退出其他设备")
        let logoutNotice=app.staticTexts["其他设备已退出。"].firstMatch
        reveal(app,logoutNotice);try expect(logoutNotice)
        try tap(app, "account.changeEmail"); try fill(app, "account.newEmail", "lg2-renamed@example.com")
        try tap(app, "account.sendEmailCode"); try fill(app, "account.newEmailCode", try await get("/code")["code"]!); try tap(app, "account.confirmEmail")
        try await loggedOut(app); try expect(app.staticTexts["邮箱已更新，请用新邮箱登录。"])
        XCTAssertEqual(app.textFields["accountEmail"].value as? String, "lg2-renamed@example.com")
        try passwordLogin(app, password: credentials["password"]!); try await confirmDevice(app);try await signedIn(app)
        try expect(app.staticTexts["lg2-renamed@example.com"].firstMatch)
        try tap(app, "account.delete"); try fill(app, "account.deletePassword", credentials["password"]!, secure: true)
        try tap(app, "account.confirmDelete"); try tap(app, "永久注销账号")
        try await loggedOut(app); try expect(app.staticTexts["账号已注销，本机对话与记忆保留。"], timeout: 30); keep(app, "ios-account-deleted")
    }
    @MainActor func testRealWrongExpiredCodeAndResendCooldown() async throws {
        let credentials=try await get("/credentials"),(app,_)=try await launch();defer{app.terminate()}
        try login(app);try tap(app,"accountRegistration");try fill(app,"accountEmail",credentials["email"]!);try tap(app,"accountSubmit")
        let original=try await get("/code")["code"]!
        let wrong=(original.first == "0" ? "1" : "0")+String(original.dropFirst())
        try fill(app,"accountCode",wrong);try tap(app,"accountSubmit")
        try expect(app.staticTexts["验证码不对，请检查邮件中的 6 位数字。"])
        XCTAssertFalse(app.buttons["accountResend"].isEnabled)
        _ = try await get("/expire-code")
        try fill(app,"accountCode",original);try tap(app,"accountSubmit")
        try expect(app.staticTexts["验证码不对、已过期或尝试次数已用完，请重新发送验证码。"])
        let retry=XCTNSPredicateExpectation(predicate:NSPredicate(format:"enabled == true"),object:app.buttons["accountResend"])
        let ready=await XCTWaiter.fulfillment(of:[retry],timeout:75);XCTAssertEqual(ready,.completed)
        try tap(app,"accountResend");try fill(app,"accountCode",try await get("/code")["code"]!);try tap(app,"accountSubmit")
        try expect(app.secureTextFields["accountPassword"]);keep(app,"real-code-retried")
    }
    @MainActor func testRealDirectPasswordChange() async throws {
        let credentials=try await get("/credentials"),(app,_)=try await launch();defer{app.terminate()}
        try await registered(app,credentials:credentials);try tap(app,"account.changePassword")
        try fill(app,"account.currentPassword",credentials["password"]!,secure:true)
        try fill(app,"account.newPassword",credentials["nextPassword"]!,secure:true)
        try fill(app,"account.repeatPassword",credentials["nextPassword"]!,secure:true);try tap(app,"account.savePassword")
        try await loggedOut(app);try fill(app,"accountEmail",credentials["email"]!);try passwordLogin(app,password:credentials["nextPassword"]!);try await confirmDevice(app)
        try await signedIn(app);keep(app,"real-password-changed")
    }
    @MainActor func testRealOfflineLoginCanRetryWithoutLosingEmail() async throws {
        let credentials=try await get("/credentials"),(app,_)=try await launch();defer{app.terminate()}
        try await registered(app,credentials:credentials);try await logout(app)
        try fill(app,"accountEmail",credentials["email"]!)
        app.segmentedControls["loginMethod"].buttons["验证码"].tap()
        XCTAssertEqual(app.buttons["accountSubmit"].label,"发送验证码")
        _ = try await get("/cloud-offline")
        try tap(app,"accountSubmit")
        try expect(control(app,"authError"),timeout:90)
        XCTAssertEqual(app.textFields["accountEmail"].value as? String,credentials["email"]!)
        _ = try await get("/cloud-online")
        try tap(app,"accountSubmit");try expect(app.textFields["accountCode"],timeout:30)
        keep(app,"real-network-retry")
    }
}
