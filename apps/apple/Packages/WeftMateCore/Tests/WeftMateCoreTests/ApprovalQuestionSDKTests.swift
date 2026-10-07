import Foundation
import Testing
@testable import WeftMateCore

private let interactionOrigin = "https://interaction.unit.weftmate.example:8443"
private let interactionSession = "session-test"
private let interactionTime = "2026-10-06T01:00:00Z"
private let batchID = "00000000-0000-0000-0000-000000000001"
private func interactionJSON(_ value: [String: Any], status: Int = 200) -> HTTPResponse {
    .init(status: status, body: try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]))
}
private func interactionAuth(_ owner: String = "owner-A", device: String = "device-Mac") -> HTTPResponse {
    .init(status: 200, headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)],
        body: interactionJSON(["account": ["ownerId": owner, "username": "test", "displayName": "Test"],
            "device": ["id": device, "name": "Mac"], "csrfToken": String(repeating: "b", count: 43)]).body)
}
private func interactionScope(owner: String = "owner-A", host: String = "host-test", session: String = interactionSession,
                              origin: String = interactionOrigin) throws -> SessionInteractionScope {
    try SessionInteractionScope(session: AccountSession(server: ServerConfiguration(input: origin),
        account: AccountProfile(ownerId: owner, username: "test", displayName: "Test", profileRevision: nil),
        device: DeviceRecord(id: "device-Mac", name: "Mac"), hostId: host, verification: .verified), sessionID: session)
}
private func approvalFields(id: String = "approval-a", changes: [String: Any] = [:]) -> [String: Any] {
    var row: [String: Any] = ["approvalId": id, "sessionId": interactionSession, "taskId": "cmd-root", "sourceCommandId": "cmd-child",
        "sourceReceiptId": "rpc:receipt-child", "turn": 2, "callId": "call:tool:1", "rootCallId": "call-root", "toolName": "desktop.run",
        "reason": "执行当前已核对的脚本", "createdAt": interactionTime, "status": "pending"]
    for (key, value) in changes { row[key] = value }; return row
}
private func questionFields(id: String = batchID, multi: Bool = false, changes: [String: Any] = [:]) -> [String: Any] {
    var row: [String: Any] = ["questionRpcId": id, "sessionId": interactionSession, "taskId": "cmd-root", "sourceCommandId": "cmd-child",
        "sourceReceiptId": "rpc:receipt-child", "turn": 2, "createdAt": interactionTime, "status": "pending", "questions": [
            ["id": "q-first", "question": "原题\n保持完整 / 不压缩", "header": "第一题", "options": [
                ["label": "甲 原选项", "description": "第一项说明"], ["label": "乙", "description": "第二项说明"]],
                "multiSelect": multi, "detail": "原生 detail", "intent": "原生 intent"],
            ["id": "q-second", "question": "补充资料", "options": [], "multiSelect": false]]]
    for (key, value) in changes { row[key] = value }; return row
}
private func approvalRecord(_ changes: [String: Any] = [:]) throws -> SessionApproval {
    try JSONDecoder().decode(SessionApproval.self, from: interactionJSON(approvalFields(changes: changes)).body)
}
private func questionRecord(multi: Bool = false, changes: [String: Any] = [:]) throws -> SessionQuestionBatch {
    try JSONDecoder().decode(SessionQuestionBatch.self, from: interactionJSON(questionFields(multi: multi, changes: changes)).body)
}
private func approvalPage(_ rows: [[String: Any]], next: String? = nil) -> HTTPResponse {
    interactionJSON(["approvals": rows, "nextBefore": next as Any? ?? NSNull(), "hasMore": next != nil])
}
private func questionPage(_ rows: [[String: Any]], next: String? = nil) -> HTTPResponse {
    interactionJSON(["questions": rows, "nextBefore": next as Any? ?? NSNull(), "hasMore": next != nil])
}
private func answers(custom: String = "  原文 / 补充\n  ") -> [QuestionAnswerItem] {
    [.init(id: "q-first", selected: ["甲 原选项"]), .init(id: "q-second", selected: [], custom: custom)]
}
private func questionAcknowledgment(_ intent: QuestionAnswerIntent, status: String = "answered", accepted: Bool = false) throws -> HTTPResponse {
    var row = questionFields(changes: ["status": status, "answerRequestId": intent.requestId, "answeredAt": interactionTime,
        "answer": try JSONSerialization.jsonObject(with: JSONEncoder().encode(intent.answer))])
    if accepted { row["answerAcceptedAt"] = interactionTime }
    return interactionJSON(["question": row, "requestId": intent.requestId])
}
private func approvalAcknowledgment(_ intent: ApprovalDecisionIntent, status: String = "answered") -> HTTPResponse {
    interactionJSON(["approval": approvalFields(changes: ["status": status, "decisionOutcome": intent.outcome.rawValue,
        "decisionRequestId": intent.requestId, "answeredAt": interactionTime]), "requestId": intent.requestId])
}
private actor InteractionScriptTransport: HTTPTransport {
    struct Step: Sendable {
        let path: String
        var response = HTTPResponse(status: 200, body: Data("{}".utf8))
        var method = "GET"
        var failure: APIFailure?
        var pause = false
    }
    private var steps: [Step]
    private var seen: [URLRequest] = []
    private var paused: CheckedContinuation<Void, Never>?
    init(_ steps: [Step]) { self.steps = steps }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        seen.append(request)
        guard !steps.isEmpty else { throw APIFailure.invalidResponse }
        let step = steps.removeFirst()
        let path = (request.url?.path ?? "") + (request.url?.query.map { "?" + $0 } ?? "")
        guard path == "/personal/v1" + step.path, request.httpMethod == step.method else { throw APIFailure.invalidResponse }
        if step.pause { await withCheckedContinuation { paused = $0 } }
        if let failure = step.failure { throw failure }; return step.response
    }
    func requests() -> [URLRequest] { seen }
    func waitUntilPaused() async { while paused == nil { await Task.yield() } }
    func release() { paused?.resume(); paused = nil }
}
private func interactionLoginSteps(owner: String = "owner-A", device: String = "device-Mac") -> [InteractionScriptTransport.Step] {
    [.init(path: "/auth/login", response: interactionAuth(owner, device: device), method: "POST"),
        .init(path: "/status", response: interactionJSON(["ownerId": owner, "hostId": "host-test"]))]
}
private func interactionLogin(_ client: PersonalClient) async throws -> AccountSession {
    try await client.login(server: ServerConfiguration(input: interactionOrigin), username: "test", password: "synthetic-only", deviceName: "Mac")
}

struct ApprovalQuestionSDKTests {
    @Test func permissionBodyOnlyContainsStableRequestAndOneDecision() throws {
        let intent = try ApprovalDecisionIntent(scope: interactionScope(), approval: approvalRecord(), outcome: .allowedOnce, requestID: "approval-request")
        #expect(String(data: intent.payload, encoding: .utf8) == "{\"outcome\":\"allowed-once\",\"requestId\":\"approval-request\"}")
        #expect(intent.approvalId == "approval-a" && intent.sourceCommandId == "cmd-child" && intent.sourceReceiptId == "rpc:receipt-child")
        #expect(try JSONDecoder().decode(ApprovalDecisionIntent.self, from: JSONEncoder().encode(intent)) == intent)
        let rejected = try ApprovalDecisionIntent(scope: interactionScope(), approval: approvalRecord(), outcome: .rejected, requestID: "reject-request")
        #expect(String(data: rejected.payload, encoding: .utf8) == "{\"outcome\":\"rejected\",\"requestId\":\"reject-request\"}")
        #expect(throws: APIFailure.invalidResponse) {
            try ApprovalDecisionIntent(scope: interactionScope(), approval: approvalRecord(["status": "resolved"]), outcome: .allowedOnce, requestID: "new-request")
        }
    }

    @Test func questionBodyKeepsBatchOrderExactLabelsAndUntrimmedCustom() throws {
        let intent = try QuestionAnswerIntent(scope: interactionScope(), question: questionRecord(), answers: answers(), requestID: "answer-request")
        let body = try #require(JSONSerialization.jsonObject(with: intent.payload) as? [String: Any])
        #expect(Set(body.keys) == ["requestId", "answer"])
        let answer = try #require(body["answer"] as? [String: Any])
        #expect(Set(answer.keys) == ["answers"])
        let items = try #require(answer["answers"] as? [[String: Any]])
        #expect(items.map { $0["id"] as? String } == ["q-first", "q-second"])
        #expect(items[0]["selected"] as? [String] == ["甲 原选项"] && items[0]["custom"] == nil)
        #expect(items[1]["custom"] as? String == "  原文 / 补充\n  ")
        #expect(intent.questionRpcId == batchID && intent.question.questions.first?.question == "原题\n保持完整 / 不压缩")
        #expect(try JSONDecoder().decode(QuestionAnswerIntent.self, from: JSONEncoder().encode(intent)) == intent)
        var saved = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(intent)) as? [String: Any])
        var alteredBody = body; alteredBody["outcome"] = "allowed-once"
        saved["payload"] = try JSONSerialization.data(withJSONObject: alteredBody, options: [.sortedKeys]).base64EncodedString()
        let corrupt = try JSONSerialization.data(withJSONObject: saved)
        #expect(throws: APIFailure.invalidResponse) { try JSONDecoder().decode(QuestionAnswerIntent.self, from: corrupt) }
    }

    @Test func singleAndMultipleChoiceRulesUseOriginalLabelsAndIDs() throws {
        let scope = try interactionScope(), single = try questionRecord()
        let invalid: [[QuestionAnswerItem]] = [
            [.init(id: "q-first", selected: ["甲 原选项"], custom: "同时自定义"), answers()[1]],
            [.init(id: "q-first", selected: ["甲 原选项", "乙"]), answers()[1]],
            [.init(id: "q-first", selected: ["甲 原选项", "甲 原选项"]), answers()[1]],
            [.init(id: "q-first", selected: ["甲原选项"]), answers()[1]],
            [answers()[0], .init(id: "q-second", selected: [], custom: " \n\t")],
            [answers()[0], .init(id: "q-second", selected: [])],
            [answers()[1], answers()[0]], [answers()[0]],
            [.init(id: batchID, selected: ["甲 原选项"]), answers()[1]]]
        for selection in invalid {
            #expect(throws: APIFailure.invalidResponse) { try QuestionAnswerIntent(scope: scope, question: single, answers: selection, requestID: "answer-request") }
        }
        let customOnly = try QuestionAnswerIntent(scope: scope, question: single,
            answers: [.init(id: "q-first", selected: [], custom: "同意"), answers()[1]], requestID: "custom-request")
        #expect(customOnly.answer.answers.first?.custom == "同意")
        let multiple = try questionRecord(multi: true)
        let combined = try QuestionAnswerIntent(scope: scope, question: multiple,
            answers: [.init(id: "q-first", selected: ["乙", "甲 原选项"], custom: "也补充"), answers()[1]], requestID: "multi-request")
        #expect(combined.answer.answers.first?.selected == ["乙", "甲 原选项"] && combined.answer.answers.first?.custom == "也补充")
        #expect(throws: APIFailure.invalidResponse) {
            try QuestionAnswerIntent(scope: scope, question: multiple,
                answers: [.init(id: "q-first", selected: ["乙", "乙"], custom: "重复"), answers()[1]], requestID: "duplicate-request")
        }
    }

    @Test func pagesPreserveUnknownStatesAndKeepQuestionRPCSeparateFromItemIDs() throws {
        let scope = try interactionScope()
        let approval = try ApprovalPage.decode(approvalPage([approvalFields(changes: ["status": "future_state", "outcome": "future_outcome"])]).body,
            scope: scope, limit: 50, previous: nil).approvals[0]
        #expect(approval.status.rawValue == "future_state" && !approval.status.isKnown && !approval.status.isTerminal && !approval.canDecide)
        #expect(approval.outcome?.rawValue == "future_outcome" && approval.outcome?.isKnown == false)
        let page = try QuestionPage.decode(questionPage([questionFields(changes: ["status": "future_state"])]).body, scope: scope, limit: 50, previous: nil)
        #expect(page.questions.first?.questionRpcId == batchID && page.questions.first?.questions.first?.id == "q-first")
        #expect(page.questions.first?.status.isKnown == false && page.questions.first?.canAnswer == false)
        #expect(throws: APIFailure.invalidResponse) { try QuestionAnswerIntent(scope: scope, question: page.questions[0], answers: answers(), requestID: "answer-request") }
        #expect(throws: APIFailure.identityMismatch) {
            try ApprovalPage.decode(approvalPage([approvalFields(changes: ["sessionId": "other-session"])]).body, scope: scope, limit: 50, previous: nil)
        }
    }

    @Test func bothTypedPagesUseTheirOwnCursorAndRejectDuplicateOrCrossScopeReads() async throws {
        let nextBatch = "00000000-0000-0000-0000-000000000002"
        let transport = InteractionScriptTransport(interactionLoginSteps() + [
            .init(path: "/auth/me", response: interactionAuth()), .init(path: "/sessions/session-test/approvals?limit=50", response: approvalPage([approvalFields()], next: "approval-a")),
            .init(path: "/auth/me", response: interactionAuth()), .init(path: "/sessions/session-test/approvals?before=approval-a&limit=50", response: approvalPage([approvalFields(id: "approval-b")])),
            .init(path: "/auth/me", response: interactionAuth()), .init(path: "/sessions/session-test/questions?limit=50", response: questionPage([questionFields()], next: batchID)),
            .init(path: "/auth/me", response: interactionAuth()), .init(path: "/sessions/session-test/questions?before=\(batchID)&limit=50", response: questionPage([questionFields(id: nextBatch)]))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); _ = try await interactionLogin(client)
        let approvals = try await client.approvals(sessionID: interactionSession)
        let count = await transport.requests().count
        await #expect(throws: APIFailure.invalidResponse) { try await client.approvals(sessionID: "other-session", before: approvals.nextCursor) }
        #expect(await transport.requests().count == count)
        #expect(try await client.approvals(sessionID: interactionSession, before: approvals.nextCursor).approvals.first?.id == "approval-b")
        let questions = try await client.questions(sessionID: interactionSession)
        #expect(try await client.questions(sessionID: interactionSession, before: questions.nextCursor).questions.first?.id == nextBatch)
        for scope in [try interactionScope(owner: "owner-B"), try interactionScope(host: "host-other"), try interactionScope(origin: "https://other.example:8443")] {
            #expect(throws: APIFailure.accountChanged) { try approvals.nextCursor?.validate(scope: scope) }
            #expect(throws: APIFailure.accountChanged) { try questions.nextCursor?.validate(scope: scope) }
        }
        #expect(throws: APIFailure.invalidResponse) {
            try QuestionPage.decode(questionPage([questionFields()]).body, scope: questions.scope, limit: 50, previous: questions.nextCursor)
        }
        #expect(throws: APIFailure.invalidResponse) {
            try ApprovalPage.decode(approvalPage([approvalFields(), approvalFields()]).body, scope: approvals.scope, limit: 50, previous: nil)
        }
    }

    @Test func permissionPOSTUsesExistingAuthAndExactBytesAndDuplicateReturnsOriginalReceipt() async throws {
        let intent = try ApprovalDecisionIntent(scope: interactionScope(), approval: approvalRecord(), outcome: .allowedOnce, requestID: "approval-request")
        let transport = InteractionScriptTransport(interactionLoginSteps() + [
            .init(path: "/auth/me", response: interactionAuth()),
            .init(path: "/sessions/session-test/approvals/approval-a", response: approvalAcknowledgment(intent), method: "POST"),
            .init(path: "/auth/me", response: interactionAuth())])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); _ = try await interactionLogin(client)
        let original = try await client.submitApproval(intent), duplicate = try await client.submitApproval(intent)
        #expect(original == duplicate && original.approval.status == .answered && !original.approval.status.isTerminal && original.approval.outcome == nil)
        let posts = await transport.requests().filter { $0.url?.path.contains("/approvals/") == true }
        #expect(posts.count == 1 && posts[0].httpBody == intent.payload)
        #expect(posts[0].value(forHTTPHeaderField: "Cookie") == "wm_personal_session=" + String(repeating: "a", count: 43))
        #expect(posts[0].value(forHTTPHeaderField: "X-WeftMate-CSRF") == String(repeating: "b", count: 43))
        #expect(posts[0].value(forHTTPHeaderField: "Origin") == interactionOrigin)
        let changed = try ApprovalDecisionIntent(scope: interactionScope(), approval: approvalRecord(), outcome: .rejected, requestID: "approval-request")
        let count = await transport.requests().count
        await #expect(throws: APIFailure.server(status: 409, code: "REQUEST_CONFLICT")) { try await client.submitApproval(changed) }
        let crossEndpoint = try QuestionAnswerIntent(scope: interactionScope(), question: questionRecord(), answers: answers(), requestID: "approval-request")
        await #expect(throws: APIFailure.server(status: 409, code: "REQUEST_CONFLICT")) { try await client.submitQuestionAnswer(crossEndpoint) }
        #expect(await transport.requests().count == count)
    }

    @Test func question200RegistrationDuplicateAndNativeAnswerAreSeparateFromEntryAcceptance() async throws {
        let intent = try QuestionAnswerIntent(scope: interactionScope(), question: questionRecord(), answers: answers(), requestID: "answer-request")
        let terminal = questionFields(changes: ["status": "resolved", "outcome": "answered", "resolvedAt": interactionTime])
        let transport = InteractionScriptTransport(interactionLoginSteps() + [
            .init(path: "/auth/me", response: interactionAuth()), .init(path: "/sessions/session-test/questions/\(batchID)", response: try questionAcknowledgment(intent), method: "POST"),
            .init(path: "/auth/me", response: interactionAuth()), .init(path: "/sessions/session-test/questions?limit=50", response: questionPage([terminal])),
            .init(path: "/auth/me", response: interactionAuth())])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); _ = try await interactionLogin(client)
        let receipt = try await client.submitQuestionAnswer(intent)
        #expect(receipt.question.status == .answered && !receipt.answerAcceptedByEntry)
        let current = try await client.questions(sessionID: interactionSession)
        #expect(current.questions[0].status == .resolved && current.questions[0].outcome == .answered && !current.questions[0].acceptedAnswer(requestID: intent.requestId))
        #expect(try await client.submitQuestionAnswer(intent) == receipt)
        #expect(current.questions[0].status == .resolved)
        #expect(await transport.requests().filter { $0.url?.path.hasSuffix("/\(batchID)") == true }.map(\.httpBody) == [intent.payload])
        let accepted = try QuestionAnswerReceipt.decode(questionAcknowledgment(intent, accepted: true).body, intent: intent)
        #expect(accepted.answerAcceptedByEntry)
    }

    @Test func temporaryFailuresRetainTheSameQuestionIntentWithoutDestroyingAuthentication() async throws {
        let intent = try QuestionAnswerIntent(scope: interactionScope(), question: questionRecord(), answers: answers(), requestID: "answer-request")
        let path = "/sessions/session-test/questions/\(batchID)"
        let transport = InteractionScriptTransport(interactionLoginSteps() + [
            .init(path: "/auth/me", response: interactionAuth()), .init(path: path, response: interactionJSON(["error": ["code": "SOURCE_UNCONFIRMED"]], status: 403), method: "POST"),
            .init(path: "/auth/me", response: interactionAuth()), .init(path: path, response: interactionJSON(["error": ["code": "SOURCE_TEMPORARY"]], status: 503), method: "POST"),
            .init(path: "/auth/me", response: interactionAuth()), .init(path: path, response: try questionAcknowledgment(intent), method: "POST")])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); _ = try await interactionLogin(client)
        await #expect(throws: APIFailure.server(status: 403, code: "SOURCE_UNCONFIRMED")) { try await client.submitQuestionAnswer(intent) }
        #expect(await client.currentSession() != nil)
        await #expect(throws: APIFailure.server(status: 503, code: "SOURCE_TEMPORARY")) { try await client.submitQuestionAnswer(intent) }
        #expect(await client.currentSession() != nil)
        #expect(try await client.submitQuestionAnswer(intent).question.answerRequestId == intent.requestId)
        #expect(await transport.requests().filter { $0.url?.path.hasSuffix("/\(batchID)") == true }.map(\.httpBody) == Array(repeating: intent.payload, count: 3))
    }

    @Test func unknownOrMismatched200NeverBecomesARegisteredAnswer() throws {
        let permission = try ApprovalDecisionIntent(scope: interactionScope(), approval: approvalRecord(), outcome: .rejected, requestID: "approval-request")
        #expect(throws: APIFailure.invalidResponse) { try ApprovalDecisionReceipt.decode(approvalAcknowledgment(permission, status: "future_state").body, intent: permission) }
        let intent = try QuestionAnswerIntent(scope: interactionScope(), question: questionRecord(), answers: answers(), requestID: "answer-request")
        #expect(throws: APIFailure.invalidResponse) { try QuestionAnswerReceipt.decode(questionAcknowledgment(intent, status: "future_state").body, intent: intent) }
        var mismatch = try #require(JSONSerialization.jsonObject(with: questionAcknowledgment(intent).body) as? [String: Any])
        mismatch["requestId"] = "different-request"
        #expect(throws: APIFailure.identityMismatch) { try QuestionAnswerReceipt.decode(interactionJSON(mismatch).body, intent: intent) }
        let altered = interactionJSON(["approval": approvalFields(changes: ["status": "answered", "sourceReceiptId": "rpc:wrong",
            "decisionOutcome": "rejected", "decisionRequestId": permission.requestId, "answeredAt": interactionTime]), "requestId": permission.requestId])
        #expect(throws: APIFailure.identityMismatch) { try ApprovalDecisionReceipt.decode(altered.body, intent: permission) }
    }

    @Test func terminalAndConflictHTTPRepliesRemainExplicitErrors() async throws {
        let intent = try QuestionAnswerIntent(scope: interactionScope(), question: questionRecord(), answers: answers(), requestID: "answer-request")
        let path = "/sessions/session-test/questions/\(batchID)"
        let transport = InteractionScriptTransport(interactionLoginSteps() + [
            .init(path: "/auth/me", response: interactionAuth()), .init(path: path, response: interactionJSON(["error": ["code": "QUESTION_NOT_PENDING"]], status: 409), method: "POST"),
            .init(path: "/auth/me", response: interactionAuth()), .init(path: path, response: interactionJSON(["error": ["code": "REQUEST_CONFLICT"]], status: 409), method: "POST")])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); _ = try await interactionLogin(client)
        await #expect(throws: APIFailure.server(status: 409, code: "QUESTION_NOT_PENDING")) { try await client.submitQuestionAnswer(intent) }
        await #expect(throws: APIFailure.server(status: 409, code: "REQUEST_CONFLICT")) { try await client.submitQuestionAnswer(intent) }
        #expect(await transport.requests().filter { $0.url?.path.hasSuffix("/\(batchID)") == true }.map(\.httpBody) == [intent.payload, intent.payload])
    }

    @Test func scopesAndInvalidParametersFailBeforeAnyAuthenticatedReadOrSubmission() async throws {
        let transport = InteractionScriptTransport(interactionLoginSteps())
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); _ = try await interactionLogin(client)
        await #expect(throws: APIFailure.invalidResponse) { try await client.approvals(sessionID: "../escape") }
        await #expect(throws: APIFailure.invalidResponse) { try await client.questions(sessionID: interactionSession, limit: 101) }
        for scope in [try interactionScope(owner: "owner-B"), try interactionScope(host: "other-host"), try interactionScope(origin: "https://other.example:8443")] {
            let permission = try ApprovalDecisionIntent(scope: scope, approval: approvalRecord(), outcome: .rejected, requestID: "approval-request")
            let answer = try QuestionAnswerIntent(scope: scope, question: questionRecord(), answers: answers(), requestID: "answer-request")
            await #expect(throws: APIFailure.accountChanged) { try await client.submitApproval(permission) }
            await #expect(throws: APIFailure.accountChanged) { try await client.submitQuestionAnswer(answer) }
        }
        #expect(await transport.requests().count == 2)
    }

    @Test func latePageAndLatePOSTCannotPublishAfterAccountEpochChanges() async throws {
        let intent = try QuestionAnswerIntent(scope: interactionScope(), question: questionRecord(), answers: answers(), requestID: "answer-request")
        for isSubmission in [false, true] {
            let pending: InteractionScriptTransport.Step = isSubmission
                ? .init(path: "/sessions/session-test/questions/\(batchID)", response: try questionAcknowledgment(intent), method: "POST", pause: true)
                : .init(path: "/sessions/session-test/approvals?limit=50", response: approvalPage([approvalFields()]), pause: true)
            let transport = InteractionScriptTransport(interactionLoginSteps() + [.init(path: "/auth/me", response: interactionAuth()), pending,
                .init(path: "/auth/logout", response: interactionJSON([:]), method: "POST")] + interactionLoginSteps(owner: "owner-B", device: "device-B"))
            let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); _ = try await interactionLogin(client)
            let operation = Task {
                if isSubmission { _ = try await client.submitQuestionAnswer(intent) }
                else { _ = try await client.approvals(sessionID: interactionSession) }
            }
            await transport.waitUntilPaused(); try await client.logout(); _ = try await interactionLogin(client); await transport.release()
            await #expect(throws: APIFailure.accountChanged) { try await operation.value }
            #expect(await client.currentSession()?.account.ownerId == "owner-B")
        }
    }

    @Test func cancelledQuestionReadAndPermissionPOSTNeverPublish() async throws {
        let intent = try ApprovalDecisionIntent(scope: interactionScope(), approval: approvalRecord(), outcome: .rejected, requestID: "approval-request")
        for isSubmission in [false, true] {
            let pending: InteractionScriptTransport.Step = isSubmission
                ? .init(path: "/sessions/session-test/approvals/approval-a", response: approvalAcknowledgment(intent), method: "POST", pause: true)
                : .init(path: "/sessions/session-test/questions?limit=50", response: questionPage([questionFields()]), pause: true)
            let transport = InteractionScriptTransport(interactionLoginSteps() + [.init(path: "/auth/me", response: interactionAuth()), pending])
            let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); _ = try await interactionLogin(client)
            let operation = Task {
                if isSubmission { _ = try await client.submitApproval(intent) }
                else { _ = try await client.questions(sessionID: interactionSession) }
            }
            await transport.waitUntilPaused(); operation.cancel(); await transport.release()
            await #expect(throws: CancellationError.self) { try await operation.value }
            #expect(await transport.requests().count == 4)
        }
    }
}
