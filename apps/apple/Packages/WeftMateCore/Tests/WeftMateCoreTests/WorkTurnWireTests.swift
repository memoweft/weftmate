import Foundation
import Testing
@testable import WeftMateCore

private func workTurnFixture(_ name: String) throws -> Data {
    let root = try #require(Bundle.module.resourceURL)
    return try Data(contentsOf: root.appendingPathComponent("Fixtures/WorkTurn/" + name + ".json"))
}

@Suite struct WorkTurnWireTests {
    @Test func preview19ActualTailAndEveryPhoneIncrementalPageDecode() throws {
        struct Capture: Decodable {
            struct Record: Decodable { let path: String; let body: JSONValue }
            let source: String; let sessionId: String; let records: [Record]
        }
        let capture = try JSONDecoder().decode(Capture.self, from: workTurnFixture("preview19-phone-requests"))
        #expect(capture.source == "0389aba1c")
        var pages = 0
        for record in capture.records where record.path.contains("/events?") {
            let bytes = try JSONEncoder().encode(record.body)
            let query = try #require(URLComponents(string: "https://synthetic.example" + record.path)?.queryItems)
            let after = query.first { $0.name == "afterSeq" }?.value.flatMap(Int.init)
            let timeline = try TimelinePage.decode(bytes, afterSeq: after)
            let seed = after ?? ((timeline.events.first?.seq ?? (timeline.nextSeq + 1)) - 1)
            let shared = try SharedHistoryPage.decode(bytes, sessionID: capture.sessionId, afterSeq: seed)
            #expect(shared.nextSeq == timeline.nextSeq)
            // The observer also re-encodes its typed tail before seeding receipt correlation.
            #expect(try SharedHistoryPage.decode(JSONEncoder().encode(timeline), sessionID: capture.sessionId, afterSeq: seed) == shared)
            pages += 1
        }
        #expect(pages >= 3)
    }

    @Test func realProposalCompletionEndsOnlyItsOriginalReceipt() throws {
        let bytes = try workTurnFixture("proposal-ended-events")
        let page = try SharedHistoryPage.decode(bytes, sessionID: "synthetic-session", afterSeq: -1)
        let receiptID = try #require(page.events.first { $0.type == "user.message" }?.data.receiptId)
        let receipt = SharedCommandReceipt(commandId: "synthetic-command", requestId: "synthetic-request", kind: .message,
            targetDeviceId: "synthetic-host", state: .acceptedByDSH, sessionId: "synthetic-session", conversationId: nil,
            sourceSyncEventId: nil, receiptId: receiptID, errorCode: nil)
        var tracker = try SharedTurnTracker(sessionID: "synthetic-session")
        try tracker.apply(page)
        #expect(tracker.progress(for: receipt) == .completed)
        #expect(tracker.progress(for: receipt).isTerminal)
        #expect(ComposerAction.resolve(running: TimelineProjection.taskRunning(page.timelinePage.events, fallback: true), text: "") == .send)
    }

    @Test func preview19ProposalHidesItsCommandStepAndKeepsOriginalMessages() throws {
        let page = try TimelinePage.decode(workTurnFixture("preview19-events"))
        let calls = WorkAndChat.proposedCallIDs(events: page.events, approvals: [])
        #expect(!calls.isEmpty)
        let visible = page.events.filter { WorkAndChat.showsChatEvent(type: $0.type, data: $0.data, proposedCalls: calls) }
        #expect(!visible.contains { $0.data["toolName"]?.string == "pwsh" && $0.type.hasPrefix("step.") })
        #expect(visible.contains { $0.type == "user.message" && $0.data["text"]?.string == "创建一个文件夹叫 她" })
        #expect(visible.contains { $0.data["toolName"]?.string == "load_tools" && $0.type.hasPrefix("step.") })
    }

    @Test func preview19RealTaskResponseProvidesOnlyItsOwnProposalText() async throws {
        struct Wire: Decodable { let taskId: String; let source: TaskCommandRecord }
        let bytes = try workTurnFixture("preview19-task")
        let wire = try JSONDecoder().decode(Wire.self, from: bytes)
        let transport = Mode2ITransport(host: wire.source.targetDeviceId)
        let client = PersonalClient(credentialStore: Mode2IKeys(), transport: transport)
        let session = try await client.login(server: ServerConfiguration(input: "https://a2-ui.unit.example"), username: "synthetic", password: "synthetic-only", deviceName: "Synthetic")
        let task = try TaskSnapshot.decode(bytes, scope: TaskReadScope(session), taskID: wire.taskId)
        #expect(task.sourceText == "创建一个文件夹叫 她")
        #expect(task.source.receiptId != nil && task.sessionId == wire.source.sessionId)
        struct Approvals: Decodable { let approvals: [SessionApproval] }
        let approval = try #require(try JSONDecoder().decode(Approvals.self, from: workTurnFixture("preview19-approvals")).approvals.first)
        #expect(try WorkAndChat.proposalText(approval: approval, task: task) == task.sourceText)
        let unrelated = try await client.approvals(sessionID: "session-main").approvals[0]
        #expect(throws: APIFailure.identityMismatch) { try WorkAndChat.proposalText(approval: unrelated, task: task) }
        #expect(!WorkAndChat.isEndedProposal(approval: approval, task: task))
    }

    @Test func actualNewHostProposalUsesEndedReplyAndDistinctWorkIdentity() async throws {
        struct TaskWire: Decodable { let taskId: String; let source: TaskCommandRecord }
        struct Approvals: Decodable { let approvals: [SessionApproval] }
        struct Decision: Decodable { let approval: SessionApproval; let requestId: String }
        let bytes=try workTurnFixture("proposal-ended-task")
        let wire=try JSONDecoder().decode(TaskWire.self,from:bytes)
        let client=PersonalClient(credentialStore:Mode2IKeys(),transport:Mode2ITransport(host:wire.source.targetDeviceId))
        let account=try await client.login(server:ServerConfiguration(input:"https://a2-ui.unit.example"),username:"synthetic",password:"synthetic-only",deviceName:"Synthetic")
        let task=try TaskSnapshot.decode(bytes,scope:TaskReadScope(account),taskID:wire.taskId)
        let approval=try #require(try JSONDecoder().decode(Approvals.self,from:workTurnFixture("proposal-ended-approvals")).approvals.first)
        #expect(task.control.state == .active && task.replyEvidence.status == .completed)
        #expect(WorkAndChat.isEndedProposal(approval:approval,task:task))
        let reply=try workTurnFixture("proposal-accepted")
        let decision=try JSONDecoder().decode(Decision.self,from:reply)
        let value=try JSONDecoder().decode(JSONValue.self,from:reply)
        let project=try #require(value["approval"]?["workProjectId"]?.string)
        let intent=try ApprovalDecisionIntent(scope:SessionInteractionScope(session:account,sessionID:approval.sessionId),approval:approval,
            outcome:.allowedOnce,requestID:decision.requestId,workProjectId:project)
        let accepted=try ApprovalDecisionReceipt.decode(reply,intent:intent)
        #expect(accepted.approval.workSessionId != approval.sessionId && accepted.approval.workCreateCommandId != nil)
        let work=try SharedHistoryPage.decode(workTurnFixture("work-ended-events"),sessionID:try #require(accepted.approval.workSessionId),afterSeq:-1)
        #expect(work.messages.first?.text == task.sourceText)
        #expect(work.events.last?.type == "turn.ended")
    }

    @Test func newEventPayloadDoesNotDecodeAsAMessageOrLifecycle() throws {
        var json = try #require(try JSONSerialization.jsonObject(with: workTurnFixture("proposal-ended-events")) as? [String: Any])
        var events = try #require(json["events"] as? [[String: Any]])
        let next = try #require(json["nextSeq"] as? Int) + 1
        // Evolving metadata may reuse field names with a different schema, or carry no object.
        let metadata: [String: Any] = ["text": ["label": "future"], "turn": "opaque", "tasks": ["future"]]
        let payloads: [Any] = [metadata, NSNull(), ["future"]]
        for payload in payloads {
            events.append(["seq": next, "type": "future.metadata", "data": payload])
            json["events"] = events; json["nextSeq"] = next
            let page = try SharedHistoryPage.decode(JSONSerialization.data(withJSONObject: json), sessionID: "synthetic-session", afterSeq: -1)
            #expect(page.events.last?.type == "future.metadata")
            #expect(page.messages.count == 2)
            events.removeLast()
        }
    }

    @Test func newEndReasonIsUnknownAndMissingEnvelopeStillFails() throws {
        let unknown = Data(#"{"events":[{"seq":1,"type":"turn.ended","data":{"turn":1,"reason":"new_reason","extra":true}}],"nextSeq":1,"hasMore":false}"#.utf8)
        #expect(try SharedHistoryPage.decode(unknown, sessionID: "synthetic-session", afterSeq: -1).events.count == 1)
        for malformed in [
            #"{"events":[{"type":"future.metadata","data":null}],"nextSeq":1,"hasMore":false}"#,
            #"{"events":[{"seq":1,"type":"user.message","data":{}}],"nextSeq":1,"hasMore":false}"#,
            #"{"events":[{"seq":1,"type":"turn.ended","data":{"turn":1}}],"nextSeq":1,"hasMore":false}"#
        ] {
            #expect(throws: APIFailure.invalidResponse) { try SharedHistoryPage.decode(Data(malformed.utf8), sessionID: "synthetic-session", afterSeq: -1) }
        }
    }
}
