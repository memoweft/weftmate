import XCTest
final class A16WatchUITests: XCTestCase {
    @MainActor private func get(_ path: String) async throws -> [String:Any] {
        let driver=ProcessInfo.processInfo.environment["WEFTMATE_A16_DRIVER"]!
        let(data,response)=try await URLSession.shared.data(from:URL(string:driver+path)!)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode,200);return try JSONSerialization.jsonObject(with:data) as! [String:Any]
    }
    @MainActor func testMainApprovalProjection() async throws {
        continueAfterFailure=false
        let app=XCUIApplication();app.launchArguments=["--a12-live-evidence"];app.launch();defer{app.terminate()}
        let headline=app.staticTexts["要运行命令：npm run verify"]
        let wait=XCTNSPredicateExpectation(predicate:NSPredicate(format:"exists == true"),object:headline)
        let status = await XCTWaiter.fulfillment(of:[wait],timeout:90); XCTAssertEqual(status,.completed)
        XCTAssertTrue(app.buttons["watchApprove"].exists)
        let image=XCTAttachment(screenshot:app.screenshot());image.name="a16-watch-approval";image.lifetime = .keepAlways;add(image)
        let snapshot=app.debugDescription,regex=try! NSRegularExpression(pattern:"(?:label|value): '([^']*)'")
        let strings=regex.matches(in:snapshot,range:NSRange(snapshot.startIndex...,in:snapshot)).map{String(snapshot[Range($0.range(at:1),in:snapshot)!])}
        let text=XCTAttachment(string:strings.joined(separator:"\n"));text.name="a16-watch-text";text.lifetime = .keepAlways;add(text)
        XCTAssertFalse(strings.contains{$0.contains("合成记录") || $0.contains("A16 合成临时正文")})
        app.buttons["watchApprove"].firstMatch.tap()
        for _ in 0..<50{let report=try await get("/report");if (report["operations"] as? [[String:Any]])?.contains(where:{$0["kind"] as? String=="approval"})==true{return};_=try await get("/consume");try await Task.sleep(for:.milliseconds(200))}
        XCTFail("Original approval receipt not consumed by host")
    }
}
