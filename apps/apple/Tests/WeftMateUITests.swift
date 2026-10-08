import XCTest
import CryptoKit
#if os(macOS)
import AppKit
import ApplicationServices
#endif

final class WeftMateUITests: XCTestCase {
    @MainActor func testA2AttachmentHistoryComposerAndPreview() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "a2-" + UUID().uuidString,
            "--apple-contract-fixture", "--server-url", "https://a2-ui.unit.example"]
        app.launch()
        XCTAssertTrue(element(app, "conversationList").waitForExistence(timeout: 15))
        let row = element(app, "conversationRow.session-11111111-1111-4111-8111-111111111111")
        XCTAssertTrue(row.waitForExistence(timeout: 15)); row.tap()
        let detail = element(app, "conversationDraft")
        XCTAssertTrue(detail.waitForExistence(timeout: 10))
        XCTAssertFalse(element(app, "conversationTasksButton").exists)
        let history = app.buttons.matching(NSPredicate(format: "label == %@", "预览 历史图片.png")).firstMatch
        XCTAssertTrue(history.waitForExistence(timeout: 10)); history.tap()
        let panel = element(app, "attachmentPreviewPanel")
        XCTAssertTrue(panel.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["保存文件"].waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "attachmentImageContent").waitForExistence(timeout: 10))
        retainScreenshot(app, name: "a2-history-image-preview")
        app.buttons["关闭预览"].tap()
        XCTAssertTrue(element(app, "conversationDraft").waitForExistence(timeout: 5))
        element(app, "addAttachmentButton").tap()
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "添加测试文件")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["A2-测试文件.txt"].waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "sendButton").isEnabled)
        retainScreenshot(app, name: "a2-attachment-only-composer")
        element(app, "sendButton").tap()
        XCTAssertTrue(app.staticTexts["已收到测试文件。"].waitForExistence(timeout: 10))
        retainScreenshot(app, name: "a2-sent-file-in-history")
        let file = app.buttons.matching(NSPredicate(format: "label == %@", "预览 A2-测试文件.txt")).firstMatch
        XCTAssertTrue(file.waitForExistence(timeout: 5)); file.tap()
        XCTAssertTrue(app.buttons["保存文件"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "A2 controlled attachment file 中文")).firstMatch.waitForExistence(timeout: 10))
        retainScreenshot(app, name: "a2-history-file-preview")
        app.buttons["关闭预览"].tap()
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func launchApp(realServer: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        let environment = ProcessInfo.processInfo.environment
        let namespace = realServer
            ? (environment["WEFTMATE_E2E_NAMESPACE"] ?? "real-ui-" + UUID().uuidString)
            : "smoke-ui-" + UUID().uuidString
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", namespace]
        if realServer {
            app.launchArguments += ["--server-url", environment["WEFTMATE_E2E_SERVER"] ?? "https://home.weftmate.com:8443"]
            if let port = environment["WEFTMATE_E2E_DEVELOPMENT_PROXY_PORT"] {
                app.launchArguments += ["--development-proxy-port", port]
            }
        }
        app.launch()
        return app
    }

    private func retainScreenshot(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func login(_ app: XCUIApplication, username: String, password: String, privateReadiness: Bool = false) {
        let usernameField = app.textFields["username"]
        XCTAssertTrue(usernameField.waitForExistence(timeout: 15))
        usernameField.tap()
        usernameField.typeText(username)
        let passwordField = app.secureTextFields["password"]
        passwordField.tap()
        passwordField.typeText(password)
        app.buttons["loginButton"].tap()
        XCTAssertTrue(element(app, "conversationList").waitForExistence(timeout: 45),
                      "Login must reach the real conversation screen.")
        #if os(iOS)
        // The system offers to save the synthetic password after a real login.
        // Keep that credential out of Passwords and expose the underlying app.
        let offer = app.sheets.matching(NSPredicate(format: "label == %@", "保存密码？")).firstMatch
        if offer.waitForExistence(timeout: 5) {
            retainScreenshot(app, name: "synthetic-password-offer-before-decline")
            let later = offer.buttons.matching(NSPredicate(format: "label == %@", "以后")).firstMatch
            XCTAssertTrue(later.exists && later.isEnabled && later.isHittable)
            if privateReadiness { print("PASSWORD_OFFER observed=true") }
            else { print("PASSWORD_OFFER observed=保存密码？ button=以后 frame=\(later.frame)") }
            // Target the actual system-sheet button, not a same-named node elsewhere in the app.
            later.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            var closed = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: offer)], timeout: 4) == .completed
            if !closed && later.exists && later.isHittable {
                later.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                closed = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: offer)], timeout: 4) == .completed
            }
            XCTAssertTrue(closed, "The normal password offer must actually disappear before continuing.")
            print("PASSWORD_OFFER declineTapped=true sheetDisappeared=\(closed)")
            retainScreenshot(app, name: "synthetic-password-offer-declined-list-visible")
        }
        #endif
    }

    private func openDevices(_ app: XCUIApplication) -> String {
        #if os(macOS)
        element(app, "settingsNavigation").tap(); element(app, "settingsCategory.devices").tap()
        #else
        openPhoneAuxiliary(app, item: "phoneMenu.devices")
        #endif
        XCTAssertTrue(element(app, "devicesList").waitForExistence(timeout: 15))
        let current = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", "currentDevice.")).firstMatch
        XCTAssertTrue(current.waitForExistence(timeout: 30),
                      "The server must identify this app's current device.")
        return current.identifier
    }

    private func verifyAccount(_ app: XCUIApplication, username: String) {
        #if os(macOS)
        element(app, "settingsNavigation").tap()
        #else
        openPhoneAuxiliary(app, item: "phoneMenu.settings")
        #endif
        element(app, "settingsCategory.account").tap()
        let account = element(app, "accountUsername")
        XCTAssertTrue(account.waitForExistence(timeout: 15))
        XCTAssertEqual(account.label, username)
    }

    private func signOut(_ app: XCUIApplication) {
        #if os(macOS)
        element(app, "settingsNavigation").tap()
        #else
        openPhoneAuxiliary(app, item: "phoneMenu.settings")
        #endif
        element(app, "settingsCategory.account").tap()
        let button = app.buttons["signOutButton"]
        XCTAssertTrue(button.waitForExistence(timeout: 15))
        button.tap()
        let confirmation = app.buttons["退出登录"].firstMatch
        XCTAssertTrue(confirmation.waitForExistence(timeout: 5))
        confirmation.tap()
        XCTAssertTrue(app.textFields["username"].waitForExistence(timeout: 30))
    }

    private func readFixture(_ app: XCUIApplication, conversationID: String, title: String?, marker: String) {
        #if !os(macOS)
        closePhoneAuxiliary(app)
        if element(app, "conversationDetail").exists {
            let back = app.navigationBars.buttons["对话"].firstMatch
            XCTAssertTrue(back.exists)
            back.tap()
        }
        #endif
        let row = element(app, "conversationRow." + conversationID)
        XCTAssertTrue(row.waitForExistence(timeout: 30),
                      "The original conversation identity must come from the server.")
        if let title, !title.isEmpty {
            XCTAssertTrue(row.label.contains(title), "The original server conversation title must be retained.")
        }
        row.tap()
        XCTAssertTrue(element(app, "conversationDetail").waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts[marker].waitForExistence(timeout: 30),
                      "Read the original synthetic message; a conversation row alone is insufficient.")
    }

    #if os(iOS)
    private func closePhoneAuxiliary(_ app: XCUIApplication) {
        let done = app.buttons["closeAuxiliarySheetButton"]
        if done.exists { done.tap() }
    }

    private func openPhoneAuxiliary(_ app: XCUIApplication, item: String) {
        closePhoneAuxiliary(app)
        let menu = app.buttons["phoneAccountMenu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        menu.tap()
        let choice = app.buttons[["phoneMenu.devices", "phoneMenu.spirit"].contains(item) ? "phoneMenu.settings" : item]
        XCTAssertTrue(choice.waitForExistence(timeout: 5))
        choice.tap()
        if item == "phoneMenu.devices" { element(app, "settingsCategory.devices").tap() }
        if item == "phoneMenu.spirit" { element(app, "settingsCategory.appearance").tap(); app.buttons["小纬形象"].tap() }
    }

    @MainActor func testPhoneAccountMenuReturnsToSameDraft() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let username = environment["WEFTMATE_E2E_USERNAME"],
              let password = environment["WEFTMATE_E2E_PASSWORD"],
              let conversationID = environment["WEFTMATE_E2E_CONVERSATION_ID"],
              let marker = environment["WEFTMATE_E2E_MARKER"] else {
            throw XCTSkip("An isolated original-message fixture is required.")
        }
        let app = launchApp(realServer: true)
        login(app, username: username, password: password)
        XCTAssertEqual(app.tabBars.count, 0, "Conversation is the primary page, auxiliary pages use the account menu.")
        readFixture(app, conversationID: conversationID,
                    title: environment["WEFTMATE_E2E_CONVERSATION_TITLE"], marker: marker)
        retainScreenshot(app, name: "account-menu-original-conversation-before-draft")
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "account-menu-conversation-accessibility"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        let draft = element(app, "conversationDraft")
        XCTAssertTrue(draft.waitForExistence(timeout: 15))
        let text = "Apple account-menu draft " + UUID().uuidString
        draft.tap(); draft.typeText(text)
        let saved = app.descendants(matching: .any).matching(identifier: "draftSaveStatus").firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 10))
        let savedPredicate = NSPredicate(format: "label CONTAINS %@", "已保存到本机")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: savedPredicate, object: saved)], timeout: 10), .completed)
        retainScreenshot(app, name: "account-menu-saved-draft")

        openPhoneAuxiliary(app, item: "phoneMenu.spirit")
        XCTAssertTrue(element(app, "spiritProfile").waitForExistence(timeout: 10))
        app.buttons["spiritStatesDisclosure"].tap()
        retainScreenshot(app, name: "selected-spirit-details")
        closePhoneAuxiliary(app)
        XCTAssertTrue(app.staticTexts[marker].exists)
        XCTAssertEqual(draft.value as? String, text)

        openPhoneAuxiliary(app, item: "phoneMenu.memory")
        XCTAssertTrue(app.staticTexts["我的记忆"].waitForExistence(timeout: 15))
        closePhoneAuxiliary(app)
        XCTAssertEqual(draft.value as? String, text)
        XCTAssertTrue(app.staticTexts[marker].exists)
        retainScreenshot(app, name: "account-menu-returned-to-draft")
        signOut(app)
    }

    @MainActor func testPhoneSpiritReferenceShowsWholeImage() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let username = environment["WEFTMATE_E2E_USERNAME"],
              let password = environment["WEFTMATE_E2E_PASSWORD"] else {
            throw XCTSkip("An isolated backend fixture is required.")
        }
        let app = launchApp(realServer: true)
        login(app, username: username, password: password)
        openPhoneAuxiliary(app, item: "phoneMenu.spirit")
        XCTAssertTrue(element(app, "spiritProfile").waitForExistence(timeout: 10))
        app.buttons["spiritStatesDisclosure"].tap()
        let image = app.images.matching(NSPredicate(format: "label == %@",
            "小纬的待机、倾听、思考和完成四种表情设定")).firstMatch
        XCTAssertTrue(image.waitForExistence(timeout: 10))
        app.scrollViews.firstMatch.swipeUp()
        XCTAssertGreaterThan(image.frame.width, 200)
        XCTAssertEqual(image.frame.width, image.frame.height, accuracy: 2,
                       "The square state artwork must retain its full aspect ratio.")
        retainScreenshot(app, name: "selected-spirit-full-state-reference")
        closePhoneAuxiliary(app)
        signOut(app)
    }
    #endif

    func testSignedOutEntryCanBeUsed() throws {
        let app = launchApp()
        XCTAssertTrue(app.textFields["username"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.secureTextFields["password"].exists)
        XCTAssertTrue(app.buttons["loginButton"].exists)
        XCTAssertTrue(app.buttons["注册"].exists)
        app.buttons["注册"].tap()
        XCTAssertTrue(app.buttons["registerButton"].exists)
        retainScreenshot(app, name: "isolated-registration-form")
    }

    func testConnectionFailurePreservesInputs() throws {
        let app = launchApp()
        let username = app.textFields["username"]
        XCTAssertTrue(username.waitForExistence(timeout: 15))
        username.tap()
        username.typeText("apple_failure_probe")
        let password = app.secureTextFields["password"]
        password.tap()
        password.typeText("LocalFailureProbe123!")
        app.buttons["loginButton"].tap()
        XCTAssertTrue(app.otherElements["authError"].waitForExistence(timeout: 30)
            || app.staticTexts["authError"].exists,
            "An unreachable server must show a failure instead of a logged-in state.")
        XCTAssertEqual(username.value as? String, "apple_failure_probe")
        XCTAssertTrue(app.buttons["loginButton"].isEnabled)
        XCTAssertFalse(app.tables["conversationList"].exists)
        retainScreenshot(app, name: "isolated-connection-failure")
    }

    func testRealLoginAndConversationRead() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let username = environment["WEFTMATE_E2E_USERNAME"],
              let password = environment["WEFTMATE_E2E_PASSWORD"],
              let conversationID = environment["WEFTMATE_E2E_CONVERSATION_ID"],
              let marker = environment["WEFTMATE_E2E_MARKER"],
              !username.isEmpty, !password.isEmpty, !conversationID.isEmpty, !marker.isEmpty else {
            throw XCTSkip("An isolated backend account and original message fixture are required for the real login test.")
        }
        let app = launchApp(realServer: true)
        login(app, username: username, password: password)
        let title = environment["WEFTMATE_E2E_CONVERSATION_TITLE"]
        readFixture(app, conversationID: conversationID, title: title, marker: marker)
        retainScreenshot(app, name: "real-original-message")
        let firstDevice = openDevices(app)
        retainScreenshot(app, name: "real-server-devices")
        verifyAccount(app, username: username)

        // Same test namespace and launch arguments restore the issued credential.
        app.terminate()
        app.launch()
        XCTAssertTrue(element(app, "conversationList").waitForExistence(timeout: 45),
                      "Restart must verify the saved credential without a new login.")
        XCTAssertFalse(app.textFields["username"].exists)
        XCTAssertEqual(openDevices(app), firstDevice, "Restart must preserve the issued device identity.")
        readFixture(app, conversationID: conversationID, title: title, marker: marker)
        retainScreenshot(app, name: "real-restored-original-message")

        if let secondUsername = environment["WEFTMATE_E2E_SECOND_USERNAME"],
           let secondPassword = environment["WEFTMATE_E2E_SECOND_PASSWORD"],
           !secondUsername.isEmpty, !secondPassword.isEmpty {
            signOut(app)
            login(app, username: secondUsername, password: secondPassword)
            XCTAssertTrue(app.staticTexts["这个账户还没有已同步的对话。"].waitForExistence(timeout: 30),
                          "The isolated second account must finish loading its own empty history.")
            XCTAssertFalse(element(app, "conversationRow." + conversationID).exists)
            XCTAssertFalse(app.staticTexts[marker].exists)
            XCTAssertNotEqual(openDevices(app), firstDevice)
            verifyAccount(app, username: secondUsername)
            retainScreenshot(app, name: "real-second-account-isolation")
            signOut(app)
            login(app, username: username, password: password)
            readFixture(app, conversationID: conversationID, title: title, marker: marker)
            retainScreenshot(app, name: "real-primary-account-return")
        } else {
            XCTContext.runActivity(named: "Second-account UI isolation not run: private fixture missing") { _ in }
        }
        signOut(app)
    }

    func testRealConversationNavigationLayout() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let username = environment["WEFTMATE_E2E_USERNAME"],
              let password = environment["WEFTMATE_E2E_PASSWORD"],
              let conversationID = environment["WEFTMATE_E2E_CONVERSATION_ID"],
              let marker = environment["WEFTMATE_E2E_MARKER"],
              !username.isEmpty, !password.isEmpty, !conversationID.isEmpty, !marker.isEmpty else {
            throw XCTSkip("A private original-message fixture is required for the layout regression.")
        }
        let app = launchApp(realServer: true)
        login(app, username: username, password: password)
        let title = environment["WEFTMATE_E2E_CONVERSATION_TITLE"]
        readFixture(app, conversationID: conversationID, title: title, marker: marker)
        let refresh = app.buttons["refreshHistoryButton"]
        XCTAssertTrue(refresh.exists && refresh.isHittable,
                      "The navigation refresh control must remain usable below the development notice.")
        #if os(iOS)
        let navigation = app.navigationBars.firstMatch
        XCTAssertTrue(navigation.exists)
        let back = navigation.buttons.firstMatch
        XCTAssertTrue(back.exists && back.isHittable)
        let notice = element(app, "developmentRouteNotice")
        if notice.exists {
            XCTAssertFalse(notice.frame.intersects(refresh.frame))
            XCTAssertFalse(notice.frame.intersects(back.frame))
            if let title, !title.isEmpty {
                let heading = navigation.staticTexts[title].firstMatch
                XCTAssertTrue(heading.exists)
                XCTAssertFalse(notice.frame.intersects(heading.frame))
            }
        }
        #endif
        retainScreenshot(app, name: "real-original-message-navigation-visible")
        signOut(app)
    }
}

#if os(iOS)
extension WeftMateUITests {
    @MainActor func testHealthSettingsDefaultsAndReturnToConversation() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "h1-settings-" + UUID().uuidString,
            "--apple-contract-fixture", "--server-url", "https://a2-ui.unit.example"]
        app.launch()
        XCTAssertTrue(app.buttons["phoneAccountMenu"].waitForExistence(timeout: 20))
        app.buttons["phoneAccountMenu"].tap()
        app.buttons["phoneMenu.health"].tap()
        XCTAssertTrue(app.buttons["healthAuthorize"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label == %@", "尚未请求读取权限")).firstMatch.exists)
        let cloud = app.descendants(matching: .any).matching(identifier: "healthCloudAllowed").firstMatch
        for _ in 0..<4 {
            if cloud.exists && cloud.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(cloud.exists)
        XCTAssertEqual(cloud.value as? String, "0")
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "h1-health-settings-defaults"
        screenshot.lifetime = .keepAlways; add(screenshot)
        app.buttons["closeAuxiliarySheetButton"].tap()
        XCTAssertTrue(app.buttons["phoneAccountMenu"].waitForExistence(timeout: 10))
        app.buttons["phoneAccountMenu"].tap(); app.buttons["phoneMenu.health"].tap()
        app.buttons["healthAuthorize"].tap()
        XCTAssertTrue(app.buttons["仅供本地模型使用（默认）"].waitForExistence(timeout: 5))
        app.terminate() // Dismiss the consent prompt without requesting any system authorization.
    }

    @MainActor func testHealthKitSyntheticDailySummary() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "h1-isolated", "--h1-healthkit-fixture"]
        app.launch()
        XCTAssertTrue(app.buttons["healthFixtureStart"].waitForExistence(timeout: 20))
        app.buttons["healthFixtureStart"].tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let deadline = Date().addingTimeInterval(60)
        while Date() < deadline {
            let result = app.staticTexts["healthFixtureResult"]
            if result.exists && (result.label.hasPrefix("PASS:") || result.label.hasPrefix("FAIL:") || result.label == "UNAVAILABLE") { break }
            let allCategories = app.cells["UIA.Health.AuthSheet.AllCategoryButton"]
            if allCategories.exists && allCategories.isHittable { allCategories.tap() }
            for surface in [app, springboard] {
                for label in ["Turn On All", "全部打开", "Allow", "允许", "Done", "完成"] {
                    let control = surface.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
                    if control.exists && control.isHittable && control.isEnabled { control.tap() }
                }
            }
            Thread.sleep(forTimeInterval: 0.5)
        }
        let result = app.staticTexts["healthFixtureResult"]
        if result.label == "UNAVAILABLE" { throw XCTSkip("HealthKit is unavailable on this simulator") }
        XCTAssertTrue(result.label.hasPrefix("PASS:"), result.label + "\n" + app.debugDescription)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.lifetime = .keepAlways; add(attachment)
    }
}
#endif

#if os(iOS)
extension WeftMateUITests {
    @MainActor func testH3HealthKitCalculationUploadAndHealthPage() throws {
        guard let origin = ProcessInfo.processInfo.environment["WEFTMATE_H3_HOST"], origin.hasPrefix("http://127.0.0.1:") else {
            throw XCTSkip("Start the isolated H3 personal host and pass WEFTMATE_H3_HOST.")
        }
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ui-testing-namespace", "h3-" + UUID().uuidString,
            "--h1-healthkit-fixture", "--h3-health-metrics-fixture", "--a3-local-server", "--server-url", origin]
        app.launch()
        XCTAssertTrue(app.buttons["healthFixtureStart"].waitForExistence(timeout: 30))
        app.buttons["healthFixtureStart"].tap()
        func capture(_ name: String) {
            let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name
            attachment.lifetime = .keepAlways; add(attachment)
        }
        var capturedAuthorization = false
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let deadline = Date().addingTimeInterval(150)
        while Date() < deadline {
            let result = app.staticTexts["healthFixtureResult"]
            if result.exists && (result.label.hasPrefix("PASS:") || result.label.hasPrefix("FAIL:")) { break }
            let all = app.cells["UIA.Health.AuthSheet.AllCategoryButton"]
            if all.exists && all.isHittable {
                all.tap()
                if !capturedAuthorization { capture("h3-healthkit-synthetic-authorization"); capturedAuthorization = true }
            }
            for surface in [app, springboard] {
                for label in ["Turn On All", "全部打开", "Allow", "允许", "Done", "完成"] {
                    let control = surface.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
                    if control.exists && control.isHittable && control.isEnabled { control.tap() }
                }
            }
            Thread.sleep(forTimeInterval: 0.5)
        }
        let result = app.staticTexts["healthFixtureResult"]
        XCTAssertTrue(result.label.hasPrefix("PASS:"), result.label + "\n" + app.debugDescription)
        for name in ["battery", "recovery", "load", "sleep"] {
            XCTAssertTrue(app.staticTexts["healthMetric." + name].exists)
            XCTAssertFalse(app.staticTexts["healthMetric." + name].label.contains("数据不足"))
        }
        XCTAssertFalse(app.staticTexts["healthMetric.stress"].label.contains("数据不足"))
        capture("h3-health-latest")
        let hourly = app.descendants(matching: .any).matching(identifier: "healthHourlyTrend").firstMatch
        for _ in 0..<5 { if hourly.exists && hourly.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(hourly.exists)
        capture("h3-health-hourly-trend")
        let range = app.descendants(matching: .any).matching(identifier: "healthTrendRange").firstMatch
        for _ in 0..<5 { if range.exists && range.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(range.exists)
        capture("h3-health-7-day-trends")
        range.tap()
        let month = app.buttons["30 天"]
        XCTAssertTrue(month.waitForExistence(timeout: 5)); month.tap()
        capture("h3-health-30-day-trends")
        // Clean only samples this fixture wrote; the runner also removes its dedicated simulator.
        app.buttons["healthFixtureCleanup"].tap()
    }
}
#endif
