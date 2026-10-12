import XCTest
@testable import WeftMateCore
final class Apple3OutcomeTests: XCTestCase {
    func testRecoveredInterruptedFailedAndRunningClassification() {
        let failed=TimelineEvent(seq:1,type:"step.completed",data:.object(["taskId":.string("t1"),"stepId":.string("s1"),"state":.string("failed")]))
        for (reason, state, prominent) in [("completed",ReplyOutcome.State.completed,false),("aborted",.interrupted,false),("error",.failed,true),("blocked",.failed,true)] {
            let end=TimelineEvent(seq:2,type:"task.ended",data:.object(["taskId":.string("t1"),"reason":.string(reason)]))
            let value=ReplyOutcome.classify(events:[failed,end],taskID:"t1")
            XCTAssertEqual(value.state,state);XCTAssertEqual(value.prominent,prominent);XCTAssertEqual(value.retries,1)
            if state == .completed { XCTAssertEqual(value.text,"已完成 · 中途有 1 步重试") }
            if state == .interrupted { XCTAssertEqual(value.text,"已中断") }
        }
        XCTAssertEqual(ReplyOutcome.classify(events:[failed],taskID:"t1").state,.running)
        XCTAssertEqual(ReplyOutcome.classify(events:[failed],taskID:"other").retries,0)
    }
    func testArtifactDeduplicationCollapseAndTurnIsolation() {
        func file(_ seq:Int,_ id:String,_ path:String? = nil,_ role:String? = nil,_ task:String = "t1") -> TimelineEvent {
            var data:[String:JSONValue]=["artifactId":.string(id),"fileName":.string("同名.txt"),"taskId":.string(task)]
            if let path { data["path"] = .string(path) };if let role { data["role"] = .string(role) }
            return .init(seq:seq,type:"artifact.created",data:.object(data))
        }
        let events=[file(1,"old","a.txt"),file(2,"new","a.txt"),file(3,"b"),file(4,"c"),file(5,"d"),file(6,"temp",nil,"intermediate"),file(7,"other","a.txt",nil,"t2")]
        let bundles=ReplyArtifacts.bundles(events)
        XCTAssertEqual(bundles.count,2)
        XCTAssertEqual(bundles[0].files.count,4)
        XCTAssertEqual(bundles[0].files.first?.data["artifactId"]?.string,"new")
        XCTAssertEqual(bundles[0].visible(expanded:false).count,3)
        XCTAssertEqual(bundles[0].visible(expanded:true).count,4)
        XCTAssertEqual(bundles[1].files.count,1)
        let multi = TimelineEvent(seq:8,type:"artifact.created",data:.object(["taskId":.string("t3"),"artifacts":.array([.object(["artifactId":.string("one"),"fileName":.string("一.txt")]),.object(["artifactId":.string("two"),"fileName":.string("二.txt")])])]))
        let multiple=ReplyArtifacts.bundles([multi])
        XCTAssertEqual(multiple.first?.files.count,2)
        XCTAssertEqual(Set(multiple[0].files.map(\.artifactPresentationID)).count,2)
    }
}
