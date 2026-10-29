import XCTest
import UIKit

final class IOSUISettingsAccessibilityUITests:XCTestCase {
    @MainActor private func control(_ app:XCUIApplication,_ id:String)->XCUIElement {app.descendants(matching:.any).matching(identifier:id).firstMatch}
    @MainActor private func tap(_ app:XCUIApplication,_ id:String) {
        let item=control(app,id)
        for _ in 0..<12 {
            if item.exists && item.isHittable {break}
            app.coordinate(withNormalizedOffset:CGVector(dx:0.98,dy:0.78)).press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:CGVector(dx:0.98,dy:0.28)))
        }
        XCTAssertTrue(item.waitForExistence(timeout:20),id);XCTAssertTrue(item.isHittable,id);item.tap()
    }
    @MainActor func testLargestSystemTypeAndReducedMotionKeepDraftAndReturnPath() throws {
        guard ProcessInfo.processInfo.environment["WEFTMATE_UI_ACCESSIBILITY_STRESS"] == "1" else {throw XCTSkip("Run the explicit settings accessibility batch")}
        continueAfterFailure=false
        XCTAssertEqual(UIApplication.shared.preferredContentSizeCategory,.accessibilityExtraExtraExtraLarge)
        XCTAssertTrue(UIAccessibility.isReduceMotionEnabled)
        let app=XCUIApplication()
        app.launchArguments=["--ui-testing","--apple11-fixture","--ios-ui-shell-fixture","--health4-render-only","--ui-testing-namespace","settings-accessibility-"+UUID().uuidString,"--ios-ui-reduce-motion"]
        app.launch();defer{app.terminate()}
        let draft=control(app,"phoneChat.draft");XCTAssertTrue(draft.waitForExistence(timeout:30));draft.tap();app.typeText("保留大字号下的草稿")
        tap(app,"phoneChat.sidebar");tap(app,"phone.sidebar.settings")
        tap(app,"settingsSearch");app.typeText("外观\n");tap(app,"settingsCategory.appearance")
        let motion=control(app,"settings.reduceMotion");XCTAssertTrue(motion.waitForExistence(timeout:20))
        XCTAssertTrue((motion.label+" "+(motion.value as? String ?? "")).contains("已开启"))
        XCTAssertTrue(app.staticTexts["系统辅助字号"].exists)
        let image=XCTAttachment(screenshot:app.screenshot());image.name="accessibility-appearance";image.lifetime = .keepAlways;add(image)
        app.navigationBars.buttons.firstMatch.tap();tap(app,"closeAuxiliarySheetButton")
        XCTAssertEqual(control(app,"phoneChat.draft").value as? String,"保留大字号下的草稿")
    }
}
