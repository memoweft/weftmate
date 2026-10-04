import XCTest

final class WeftMateUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func launchApp(realServer: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        if realServer {
            app.launchArguments += ["--server-url", ProcessInfo.processInfo.environment["WEFTMATE_E2E_SERVER"] ?? "https://home.weftmate.com:8443"]
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
              !username.isEmpty, !password.isEmpty else {
            throw XCTSkip("An isolated backend account is required for the real login test.")
        }
        let app = launchApp(realServer: true)
        let usernameField = app.textFields["username"]
        XCTAssertTrue(usernameField.waitForExistence(timeout: 15))
        usernameField.tap()
        usernameField.typeText(username)
        let passwordField = app.secureTextFields["password"]
        passwordField.tap()
        passwordField.typeText(password)
        app.buttons["loginButton"].tap()
        XCTAssertTrue(app.otherElements["conversationList"].waitForExistence(timeout: 45)
            || app.collectionViews["conversationList"].exists
            || app.tables["conversationList"].exists,
            "Login must reach the real conversation screen.")
        if let title = environment["WEFTMATE_E2E_CONVERSATION_TITLE"], !title.isEmpty {
            XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 30),
                          "The original test conversation must come from the server.")
        }
    }
}
