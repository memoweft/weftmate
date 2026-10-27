import XCTest
@testable import WeftMateCore

final class Apple3ApprovalTests: XCTestCase {
    private func approval(_ category: String, offered: Bool = true, opinion: [String:String]? = nil) throws -> SessionApproval {
        var row: [String:Any] = ["approvalId":"a1","sessionId":"s1","taskId":"t1","sourceCommandId":"c1","sourceReceiptId":"r1","turn":1,"callId":"call1","toolName":"shell","reason":"运行命令","createdAt":"2026-10-12T00:00:00Z","status":"pending","operationCategories":[category],"canAlwaysAllow":offered]
        if let opinion { row["secondOpinion"] = opinion }
        return try JSONDecoder().decode(SessionApproval.self, from: JSONSerialization.data(withJSONObject: row))
    }
    func testOpinionStatesAndAbsentOpinion() throws {
        XCTAssertNil(try approval("command").secondOpinion)
        let aligned = try approval("command", opinion:["alignment":"对得上","externalInfluence":"没有","reason":"符合要求"]).secondOpinion!
        XCTAssertFalse(aligned.recommendsRejection)
        XCTAssertEqual(aligned.text,"另一个模型看过：和你的要求一致")
        for (alignment, influence) in [("对不上","没有"),("对得上","有")] {
            let opinion = try approval("command", opinion:["alignment":alignment,"externalInfluence":influence,"reason":"请检查\n来源"]).secondOpinion!
            XCTAssertTrue(opinion.recommendsRejection)
            XCTAssertFalse(opinion.text.contains("\n"))
        }
        let uncertain = try approval("command", opinion:["alignment":"拿不准","externalInfluence":"没有","reason":"范围不清楚"]).secondOpinion!
        XCTAssertFalse(uncertain.recommendsRejection)
        XCTAssertTrue(uncertain.text.contains("拿不准"))
    }
    func testGlobalAllowExcludesDangerousCategories() throws {
        for category in ["delete","external","spend"] { XCTAssertFalse(try approval(category).offersAlwaysAllow) }
        XCTAssertFalse(try approval("write", offered:false).offersAlwaysAllow)
        XCTAssertTrue(try approval("write").offersAlwaysAllow)
        XCTAssertEqual(ApprovalDecisionScope.globalCategory.rawValue,"global-category")
        let old = try JSONDecoder().decode(ApprovalModeSettings.self,from: Data(#"{"mode":"auto"}"#.utf8))
        XCTAssertTrue(old.effectiveSecondOpinionEnabled)
        let disabled = try JSONDecoder().decode(ApprovalModeSettings.self,from: Data(#"{"mode":"ask","secondOpinionEnabled":false}"#.utf8))
        XCTAssertFalse(disabled.effectiveSecondOpinionEnabled)
    }
    func testWatchApprovalCompatibility() throws {
        let old = try JSONDecoder().decode(WatchApproval.self,from:Data(#"{"id":"a1","summary":"运行命令"}"#.utf8))
        XCTAssertNil(old.secondOpinion)
        let updated=WatchApproval(id:"a1",summary:"运行命令",secondOpinion:"另一模型的意见")
        XCTAssertEqual(try JSONDecoder().decode(WatchApproval.self,from:JSONEncoder().encode(updated)),updated)
    }
}
