import XCTest

final class HEALTH4UITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure=false }
    private var origin: String { ProcessInfo.processInfo.environment["WEFTMATE_HEALTH4_ORIGIN"]! }
    @MainActor private func control(_ fields: [String:Any]) async throws {
        var request=URLRequest(url:URL(string:origin+"/fixture/control")!);request.httpMethod="POST";request.httpBody=try JSONSerialization.data(withJSONObject:fields)
        let (_,r)=try await URLSession.shared.data(for:request);XCTAssertEqual((r as? HTTPURLResponse)?.statusCode,200)
    }
    @MainActor private func report() async throws -> [String:Any] {
        let (d,_)=try await URLSession.shared.data(from:URL(string:origin+"/fixture/report")!);return try JSONSerialization.jsonObject(with:d) as! [String:Any]
    }
    @MainActor private func waitRecords(_ version: Int) async throws {
        for _ in 0..<150 {
            let value=try await report()
            let records=value["records"] as? [[String:Any]] ?? []
            if records.count == 90 && records.allSatisfy({ ($0["health"] as? [String:Any])?["version"] as? Int == version }) { return }
            try await Task.sleep(for:.seconds(1))
        }
        XCTFail("Ninety-day record batch did not complete")
    }
    @MainActor private func tap(_ app: XCUIApplication,_ id: String) throws {
        let e=app.descendants(matching:.any).matching(identifier:id).firstMatch
        guard e.waitForExistence(timeout:30) else { XCTFail("Missing "+id);throw NSError(domain:"Health4UI",code:1) }
        let enabled=XCTNSPredicateExpectation(predicate:NSPredicate(format:"enabled == true"),object:e)
        guard XCTWaiter.wait(for:[enabled],timeout:60) == .completed else { throw NSError(domain:"Health4UI",code:3) }
        for _ in 0..<8 where !e.isHittable { app.swipeUp() }
        e.tap()
    }
    @MainActor private func capture(_ app: XCUIApplication,_ theme: String,_ name: String) {
        let a=XCTAttachment(screenshot:app.screenshot());a.name="health4-"+theme+"-"+name;a.lifetime = .keepAlways;add(a)
    }
    @MainActor private func authorize(_ app: XCUIApplication, required: Bool = false) throws {
        let springboard=XCUIApplication(bundleIdentifier:"com.apple.springboard")
        for surface in [app,springboard] {
            let all=surface.cells["UIA.Health.AuthSheet.AllCategoryButton"]
            if all.waitForExistence(timeout:8) { all.tap();let allow=surface.buttons["UIA.Health.Allow.Button"];XCTAssertTrue(allow.waitForExistence(timeout:10));allow.tap();return }
        }
        if required { XCTFail("Expected simulator HealthKit authorization") }
    }
    @MainActor func testLightHealthJourney() async throws { try await journey("light") }
    @MainActor func testDarkHealthJourney() async throws { try await journey("dark") }
    @MainActor private func journey(_ theme: String) async throws {
        try await control(["version":2,"scenario":"data","enabled":false,"failBatch":1])
        let seed=XCUIApplication(bundleIdentifier:"com.weftmate.apple.weftmatehealth4seed");seed.launchArguments=["--health4-synthetic"];seed.launch()
        try tap(seed,"health4.seed");try authorize(seed)
        XCTAssertTrue(seed.staticTexts["SAVED"].waitForExistence(timeout:120));seed.terminate()
        let app=XCUIApplication();app.launchArguments=["--ui-testing","--health4-fixture","--a5-local-server","--server-url",origin,"--ui-testing-namespace","health4-"+UUID().uuidString,"--a5-theme",theme,theme];app.launch()
        try tap(app,"health4.connectLegacy");try authorize(app)
        XCTAssertTrue(app.buttons["health.expandAuthorize"].waitForExistence(timeout:90));capture(app,theme,"additional-authorization")
        try tap(app,"health.expandAuthorize");try authorize(app,required:true)
        XCTAssertTrue(app.descendants(matching:.any)["health.insight"].waitForExistence(timeout:90))
        // A failed batch interrupts delivery. The same production refresh resumes durable progress.
        try tap(app,"health.refresh")
        try await waitRecords(2)
        let v2=try await report();XCTAssertEqual(v2["version"] as? Int,2)
        capture(app,theme,"today-data")
        try tap(app,"health.score.recovery");guard app.segmentedControls.firstMatch.waitForExistence(timeout:20) else { XCTFail("Score detail did not open");throw NSError(domain:"Health4UI",code:2) };capture(app,theme,"score-detail")
        app.navigationBars.buttons.element(boundBy:0).tap()
        try tap(app,"health.analysis.recovery");capture(app,theme,"analysis-off-explanation")
        try tap(app,"health.analysisEnable.recovery");capture(app,theme,"analysis-generating")
        XCTAssertTrue(app.buttons["health.analysisAsk.recovery"].waitForExistence(timeout:30));capture(app,theme,"analysis-expanded")
        try tap(app,"health.analysis.recovery");capture(app,theme,"analysis-collapsed")
        app.swipeDown();app.swipeDown()
        try tap(app,"health.remind.walk");XCTAssertTrue(app.staticTexts["已经替你记下提醒。"].waitForExistence(timeout:20))
        try tap(app,"health.ask");XCTAssertTrue(app.textFields["health4.draft"].waitForExistence(timeout:15)||app.textViews["health4.draft"].waitForExistence(timeout:15));capture(app,theme,"ask-draft")
        app.buttons["返回健康"].tap()
        try tap(app,"health.vital.hrvSdnnMs")
        app.segmentedControls.buttons["60 天"].tap();try tap(app,"health.overlay");try await Task.sleep(for:.seconds(3));capture(app,theme,"metric-sixty-day-overlay")
        app.navigationBars.buttons.element(boundBy:0).tap()
        try await control(["version":3,"scenario":"extras"])
        try tap(app,"health.refresh");try await waitRecords(3)
        try tap(app,"health.extra.stress");app.navigationBars.buttons.element(boundBy:0).tap();app.swipeUp();capture(app,theme,"today-new-cards")
        for scenario in ["insufficient","disconnected"] {
            try await control(["scenario":scenario]);try tap(app,"health.refresh");try await Task.sleep(for:.seconds(3));capture(app,theme,"today-"+scenario)
        }
        let final=try await report();XCTAssertGreaterThan(final["reminders"] as? Int ?? 0,0)
        app.terminate();seed.launch();try tap(seed,"health4.cleanup");XCTAssertTrue(seed.staticTexts["CLEAN"].waitForExistence(timeout:20));seed.terminate()
    }
}
