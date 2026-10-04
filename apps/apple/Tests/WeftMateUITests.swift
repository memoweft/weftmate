import XCTest

final class WeftMateUITests: XCTestCase {
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

    private func login(_ app: XCUIApplication, username: String, password: String) {
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
        let later = app.buttons["以后"].firstMatch
        if later.waitForExistence(timeout: 3) { later.tap() }
        #endif
    }

    private func openDevices(_ app: XCUIApplication) -> String {
        #if os(macOS)
        element(app, "devicesNavigation").tap()
        #else
        app.tabBars.buttons["设备"].tap()
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
        app.tabBars.buttons["设置"].tap()
        #endif
        let account = element(app, "accountUsername")
        XCTAssertTrue(account.waitForExistence(timeout: 15))
        XCTAssertEqual(account.label, username)
    }

    private func signOut(_ app: XCUIApplication) {
        #if os(macOS)
        element(app, "settingsNavigation").tap()
        #else
        app.tabBars.buttons["设置"].tap()
        #endif
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
        app.tabBars.buttons["对话"].tap()
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
