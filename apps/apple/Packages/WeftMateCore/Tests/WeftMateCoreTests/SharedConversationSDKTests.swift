import Foundation
import Testing
@testable import WeftMateCore

private let sharedOrigin = "https://shared.unit.weftmate.example:8443"
private let sharedCookie = "wm_personal_session=" + String(repeating: "a", count: 43)
private let sharedCSRF = String(repeating: "b", count: 43)
private func sharedJSON(_ value: [String: Any], status: Int = 200, headers: [String: String] = [:]) -> HTTPResponse {
    .init(status: status, headers: headers, body: try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]))
}
private func sharedAuth(_ owner: String = "owner-A", device: String = "device-Mac") -> HTTPResponse {
    sharedJSON(["account": ["ownerId": owner, "username": "test", "displayName": "Test", "profileRevision": 0],
        "device": ["id": device, "name": "Mac", "expiresAt": "2027-01-01T00:00:00Z"], "csrfToken": sharedCSRF],
        headers: ["set-cookie": sharedCookie + "; HttpOnly; Secure"])
}
private func sharedStatus(_ owner: String = "owner-A") -> HTTPResponse { sharedJSON(["ownerId": owner, "hostId": "host-test"]) }
private func sharedMissing(_ code: String = "NOT_FOUND", status: Int = 404) -> HTTPResponse {
    sharedJSON(["error": ["code": code]], status: status)
}
private func sharedReceipt(_ changes: [String: Any] = [:]) -> HTTPResponse {
    var command: [String: Any] = ["commandId": "cmd-test", "requestId": "apple-request-1", "kind": "session.message",
        "targetDeviceId": "host-test", "state": "accepted_by_dsh", "sessionId": "session-test", "receiptId": "receipt-test"]
    for (key, value) in changes { command[key] = value }
    return sharedJSON(["command": command])
}
private func sharedIntent(_ session: AccountSession, request: String = "apple-request-1", text: String = "fixture text") throws -> SharedCommandIntent {
    try .init(session: session, command: SharedCommandPayload(requestId: request, kind: .message,
        targetDeviceId: session.hostId, sessionId: "session-test", text: text))
}
private actor SharedScriptTransport: HTTPTransport {
    struct Step: Sendable {
        let path: String
        var method = "GET"
        var response = HTTPResponse(status: 200, body: Data("{}".utf8))
        var failure: APIFailure? = nil
        var pause = false
    }
    private var steps: [Step]
    private var recorded: [URLRequest] = []
    private var paused: CheckedContinuation<Void, Never>?
    init(_ steps: [Step]) { self.steps = steps }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        recorded.append(request)
        guard !steps.isEmpty else { throw APIFailure.invalidResponse }
        let step = steps.removeFirst()
        let path = (request.url?.path ?? "") + (request.url?.query.map { "?" + $0 } ?? "")
        guard path == "/personal/v1" + step.path, request.httpMethod == step.method else { throw APIFailure.invalidResponse }
        if step.pause { await withCheckedContinuation { paused = $0 } }
        if let failure = step.failure { throw failure }
        return step.response
    }
    func waitUntilPaused() async { while paused == nil { await Task.yield() } }
    func release() { paused?.resume(); paused = nil }
    func requests() -> [URLRequest] { recorded }
    func remaining() -> Int { steps.count }
}
private func sharedStep(_ path: String, _ response: HTTPResponse, method: String = "GET", pause: Bool = false) -> SharedScriptTransport.Step {
    .init(path: path, method: method, response: response, pause: pause)
}
private func sharedLoginSteps() -> [SharedScriptTransport.Step] {
    [sharedStep("/auth/login", sharedAuth(), method: "POST"), sharedStep("/status", sharedStatus())]
}
private func sharedLogin(_ client: PersonalClient) async throws -> AccountSession {
    try await client.login(server: ServerConfiguration(input: sharedOrigin), username: "test",
        password: "synthetic-fixture", deviceName: "Mac")
}
private func sharedHistory(_ events: [[String: Any]], next: Int, more: Bool = false) -> Data {
    try! JSONSerialization.data(withJSONObject: ["events": events, "nextSeq": next, "hasMore": more])
}
private func sharedEvent(_ seq: Int, _ type: String, _ data: [String: Any]) -> [String: Any] {
    ["seq": seq, "type": type, "data": data]
}

struct SharedConversationSDKTests {
    @Test func authenticatedTypedSessionsPreserveMissingModelIdentity() async throws {
        let transport = SharedScriptTransport(sharedLoginSteps() + [sharedStep("/auth/me", sharedAuth()),
            sharedStep("/sessions", sharedJSON(["sessions": [["sessionId": "session-test", "title": "Test", "running": false, "sendAvailable": true]]]))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        _ = try await sharedLogin(client)
        let sessions = try await client.sharedSessions()
        #expect(sessions.count == 1 && sessions[0].modelProfileId == nil)
        #expect(sessions[0].sendAvailable)
        #expect(await transport.remaining() == 0)
    }

    @Test func projectionValidatesHostBindingAndNonSecretOriginalModel() throws {
        let fields: [String: Any] = ["source": "host", "conversationId": "conversation-test", "hostId": "host-test",
            "syncThroughSeq": 6, "status": "active", "canAdopt": false,
            "originalModel": ["modelId": "model/test", "displayName": "Test model", "routeFingerprint": NSNull(), "hostProfileId": "profile-test"],
            "binding": ["conversationId": "conversation-test", "sessionId": "session-test", "modelProfileId": "profile-test", "revision": 1,
                "cutoverSyncSeq": 4, "contextHash": String(repeating: "a", count: 64), "historyMessageCount": 2,
                "truncated": false, "omittedImages": 0, "adoptCommandId": "cmd-create"]]
        let data = try JSONSerialization.data(withJSONObject: fields)
        let projection = try JSONDecoder().decode(SharedConversationProjection.self, from: data)
        try projection.validate(conversationID: "conversation-test", hostID: "host-test")
        #expect(projection.originalModel?.hostProfileId == "profile-test")
        #expect(throws: APIFailure.identityMismatch) { try projection.validate(conversationID: "conversation-test", hostID: "other-host") }
        var broken = fields; broken["status"] = "unbound"
        let invalid = try JSONDecoder().decode(SharedConversationProjection.self, from: JSONSerialization.data(withJSONObject: broken))
        #expect(throws: APIFailure.invalidResponse) { try invalid.validate(conversationID: "conversation-test", hostID: "host-test") }
    }

    @Test func payloadFactoriesRejectInvalidIDsMissingModelsAndWrongKinds() throws {
        #expect(throws: APIFailure.invalidResponse) { try SharedCommandPayload(requestId: "../new", kind: .create, targetDeviceId: "host-test", modelProfileId: "profile-test") }
        for request in [".", ".."] {
            #expect(throws: APIFailure.invalidResponse) { try SharedCommandPayload(requestId: request, kind: .create, targetDeviceId: "host-test", modelProfileId: "profile-test") }
        }
        #expect(throws: APIFailure.invalidResponse) { try SharedCommandPayload(requestId: "new", kind: .create, targetDeviceId: "host-test") }
        #expect(throws: APIFailure.invalidResponse) { try SharedCommandPayload(requestId: "new", kind: .message, targetDeviceId: "host-test", sessionId: "session-test", text: " ") }
        #expect(throws: APIFailure.invalidResponse) { try SharedCommandPayload(requestId: "new", kind: .cancel, targetDeviceId: "host-test", sessionId: "session-test", text: "message") }
        let bad = try JSONSerialization.data(withJSONObject: ["requestId": "new", "kind": "session.create", "targetDeviceId": "host-test", "modelProfileId": "profile-test", "apiKey": "forbidden"])
        #expect(throws: APIFailure.invalidResponse) { try SharedCommandIntent(server: ServerConfiguration(input: sharedOrigin), ownerId: "owner-A", hostId: "host-test", payload: bad) }
        #expect(throws: APIFailure.invalidResponse) { try SharedCommandIntent(server: ServerConfiguration(input: sharedOrigin), ownerId: "owner-A", hostId: "host-test", payload: Data("invalid-json".utf8)) }
    }

    @Test func reconciliationQueriesFirstAndPostsExactImmutableBodyOnlyAfterNotFound() async throws {
        let transport = SharedScriptTransport(sharedLoginSteps() + [sharedStep("/auth/me", sharedAuth()),
            sharedStep("/commands/by-request/apple-request-1", sharedMissing()), sharedStep("/commands", sharedReceipt(["state": "pending"]), method: "POST")])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let intent = try sharedIntent(await sharedLogin(client))
        let stored = try JSONDecoder().decode(SharedCommandIntent.self, from: JSONEncoder().encode(intent))
        #expect(stored == intent && stored.payload == intent.payload)
        guard case let .found(receipt) = try await client.reconcileCommand(stored, allowSubmission: true) else { Issue.record("Expected receipt"); return }
        #expect(receipt.state == .pending && !receipt.state.isAccepted)
        let requests = await transport.requests()
        let post = try #require(requests.last)
        #expect(post.httpBody == intent.payload && post.value(forHTTPHeaderField: "Origin") == sharedOrigin)
        #expect(post.value(forHTTPHeaderField: "X-WeftMate-CSRF") == sharedCSRF && post.value(forHTTPHeaderField: "Cookie") == sharedCookie)
        #expect(requests[requests.count - 2].url?.path.hasSuffix("/commands/by-request/apple-request-1") == true)
    }

    @Test func lostPostReplyAfterRestartIsRecoveredBySameRequestWithoutSecondPost() async throws {
        let transport = SharedScriptTransport(sharedLoginSteps() + [sharedStep("/auth/me", sharedAuth()),
            sharedStep("/commands/by-request/apple-request-1", sharedMissing()),
            .init(path: "/commands", method: "POST", failure: .transport(.timeout)),
            sharedStep("/auth/me", sharedAuth()), sharedStep("/status", sharedStatus()),
            sharedStep("/auth/me", sharedAuth()), sharedStep("/commands/by-request/apple-request-1", sharedReceipt())])
        let store = MemoryStore()
        let first = PersonalClient(credentialStore: store, transport: transport)
        let intent = try sharedIntent(await sharedLogin(first))
        await #expect(throws: APIFailure.transport(.timeout)) { try await first.reconcileCommand(intent, allowSubmission: true) }
        let restarted = PersonalClient(credentialStore: store, transport: transport)
        _ = try await restarted.restoreSession(server: intent.server)
        guard case let .found(receipt) = try await restarted.reconcileCommand(intent, allowSubmission: true) else { Issue.record("Missing receipt"); return }
        #expect(receipt.state.isAccepted)
        #expect(await transport.requests().filter { $0.httpMethod == "POST" && $0.url?.path.hasSuffix("/commands") == true }.count == 1)
        var tracker = try SharedTurnTracker(sessionID: "session-test")
        try tracker.apply(SharedHistoryPage.decode(sharedHistory([], next: 8), sessionID: "session-test", afterSeq: -1))
        #expect(tracker.progress(for: receipt) == .accepted)
    }

    @Test func lookupOnlyDoesNotPostAndOnlyExactNotFoundMeansAbsent() async throws {
        for (response, failure) in [(sharedMissing(), nil), (sharedMissing("SESSION_UNAVAILABLE"), APIFailure.server(status: 404, code: "SESSION_UNAVAILABLE")),
            (sharedMissing("SERVICE_UNAVAILABLE", status: 503), APIFailure.server(status: 503, code: "SERVICE_UNAVAILABLE"))] {
            let transport = SharedScriptTransport(sharedLoginSteps() + [sharedStep("/auth/me", sharedAuth()), sharedStep("/commands/by-request/apple-request-1", response)])
            let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
            let intent = try sharedIntent(await sharedLogin(client))
            if let failure { await #expect(throws: failure) { try await client.reconcileCommand(intent, allowSubmission: true) } }
            else { #expect(try await client.reconcileCommand(intent) == .notFound) }
            #expect(await transport.requests().filter { $0.httpMethod == "POST" && $0.url?.path.hasSuffix("/commands") == true }.isEmpty)
        }
    }

    @Test func changedPayloadWithSameRequestIsRejectedBeforeNetwork() async throws {
        let transport = SharedScriptTransport(sharedLoginSteps() + [sharedStep("/auth/me", sharedAuth()), sharedStep("/commands/by-request/apple-request-1", sharedReceipt())])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let session = try await sharedLogin(client)
        _ = try await client.reconcileCommand(sharedIntent(session))
        let count = await transport.requests().count
        await #expect(throws: APIFailure.server(status: 409, code: "REQUEST_CONFLICT")) {
            try await client.reconcileCommand(sharedIntent(session, text: "different text"), allowSubmission: true)
        }
        #expect(await transport.requests().count == count)
    }

    @Test func mismatchedReceiptIdentitiesNeverBecomeAccepted() async throws {
        for change in [["requestId": "other"], ["kind": "session.cancel"], ["targetDeviceId": "other-host"],
            ["sessionId": "other-session"], ["sourceSyncEventId": "other-source"]] {
            let transport = SharedScriptTransport(sharedLoginSteps() + [sharedStep("/auth/me", sharedAuth()), sharedStep("/commands/by-request/apple-request-1", sharedReceipt(change))])
            let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
            let intent = try sharedIntent(await sharedLogin(client))
            await #expect(throws: APIFailure.identityMismatch) { try await client.reconcileCommand(intent, allowSubmission: true) }
        }
    }

    @Test func lateOwnerALookupCannotPostOrReturnIntoOwnerB() async throws {
        let transport = SharedScriptTransport(sharedLoginSteps() + [sharedStep("/auth/me", sharedAuth()),
            sharedStep("/commands/by-request/apple-request-1", sharedMissing(), pause: true),
            sharedStep("/auth/logout", sharedJSON([:]), method: "POST"),
            sharedStep("/auth/login", sharedAuth("owner-B", device: "device-B"), method: "POST"), sharedStep("/status", sharedStatus("owner-B"))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let intent = try sharedIntent(await sharedLogin(client))
        let operation = Task { try await client.reconcileCommand(intent, allowSubmission: true) }
        await transport.waitUntilPaused()
        try await client.logout()
        _ = try await sharedLogin(client)
        await transport.release()
        await #expect(throws: APIFailure.accountChanged) { try await operation.value }
        #expect(await client.currentSession()?.account.ownerId == "owner-B")
        #expect(await transport.requests().filter { $0.url?.path.hasSuffix("/commands") == true && $0.httpMethod == "POST" }.isEmpty)
    }

    @Test func historyUsesScanWatermarkAndRejectsRegressionsDuplicatesAndOversize() throws {
        let emptyScan = try SharedHistoryPage.decode(sharedHistory([], next: 20), sessionID: "session-test", afterSeq: 8)
        #expect(emptyScan.nextSeq == 20 && emptyScan.events.isEmpty)
        let gap = try SharedHistoryPage.decode(sharedHistory([sharedEvent(12, "assistant.message", ["text": "reply"])], next: 30, more: true), sessionID: "session-test", afterSeq: 8)
        #expect(gap.nextSeq == 30 && gap.events.count == 1)
        for data in [sharedHistory([], next: 7), sharedHistory([], next: 8, more: true),
            sharedHistory([sharedEvent(12, "assistant.message", ["text": "a"]), sharedEvent(12, "assistant.message", ["text": "b"])], next: 12),
            sharedHistory([sharedEvent(12, "assistant.message", ["text": "a"])], next: 11)] {
            #expect(throws: APIFailure.invalidResponse) { try SharedHistoryPage.decode(data, sessionID: "session-test", afterSeq: 8) }
        }
        #expect(throws: APIFailure.invalidResponse) { try SharedHistoryPage.decode(sharedHistory([], next: 0), sessionID: "session-test", afterSeq: -2) }
        #expect(throws: APIFailure.responseTooLarge) { try SharedHistoryPage.decode(Data(repeating: 32, count: 1_048_577), sessionID: "session-test", afterSeq: -1) }
    }

    @Test func turnCompletionRequiresExactReceiptAndMatchingTurnEnd() throws {
        struct Reply: Decodable { let command: SharedCommandReceipt }
        let receipt = try JSONDecoder().decode(Reply.self, from: sharedReceipt().body).command
        var tracker = try SharedTurnTracker(sessionID: "session-test")
        let page = try SharedHistoryPage.decode(sharedHistory([
            sharedEvent(1, "turn.started", ["turn": 7]),
            sharedEvent(2, "user.message", ["text": "fixture", "receiptId": "receipt-test"]),
            sharedEvent(3, "assistant.message", ["text": "reply"])
        ], next: 4), sessionID: "session-test", afterSeq: -1)
        try tracker.apply(page)
        #expect(tracker.progress(for: receipt) == .running && tracker.messages.count == 2)
        #expect(throws: APIFailure.identityMismatch) { try tracker.apply(page) }
        try tracker.apply(SharedHistoryPage.decode(sharedHistory([sharedEvent(8, "turn.ended", ["turn": 7, "reason": "completed"])], next: 9), sessionID: "session-test", afterSeq: 4))
        #expect(tracker.progress(for: receipt) == .completed)
        var unrelated = try SharedTurnTracker(sessionID: "session-test")
        try unrelated.apply(SharedHistoryPage.decode(sharedHistory([sharedEvent(0, "turn.ended", ["turn": 7, "reason": "completed"])], next: 1), sessionID: "session-test", afterSeq: -1))
        #expect(unrelated.progress(for: receipt) == .accepted)
    }

    @Test func missingTurnNumberOrDuplicateReceiptCannotInventCompletion() throws {
        struct Reply: Decodable { let command: SharedCommandReceipt }
        let receipt = try JSONDecoder().decode(Reply.self, from: sharedReceipt().body).command
        for events in [
            [sharedEvent(0, "turn.started", [:]), sharedEvent(1, "user.message", ["text": "fixture", "receiptId": "receipt-test"]), sharedEvent(2, "turn.ended", ["reason": "completed"])],
            [sharedEvent(0, "turn.started", ["turn": 7]), sharedEvent(1, "user.message", ["text": "fixture", "receiptId": "receipt-test"]),
             sharedEvent(2, "user.message", ["text": "duplicate", "receiptId": "receipt-test"]), sharedEvent(3, "turn.ended", ["turn": 7, "reason": "completed"])]
        ] {
            var tracker = try SharedTurnTracker(sessionID: "session-test")
            try tracker.apply(SharedHistoryPage.decode(sharedHistory(events, next: 4), sessionID: "session-test", afterSeq: -1))
            #expect(tracker.progress(for: receipt) == .accepted)
        }
    }

    @Test func reusedTurnNumberCannotReuseOldCompletedEvidence() throws {
        struct Reply: Decodable { let command: SharedCommandReceipt }
        let receipt = try JSONDecoder().decode(Reply.self, from: sharedReceipt().body).command
        var tracker = try SharedTurnTracker(sessionID: "session-test")
        let events = [sharedEvent(0, "turn.started", ["turn": 7]),
            sharedEvent(1, "user.message", ["text": "old", "receiptId": "old-receipt"]),
            sharedEvent(2, "turn.ended", ["turn": 7, "reason": "completed"]),
            sharedEvent(3, "turn.started", ["turn": 7]),
            sharedEvent(4, "user.message", ["text": "new", "receiptId": "receipt-test"])]
        try tracker.apply(SharedHistoryPage.decode(sharedHistory(events, next: 4), sessionID: "session-test", afterSeq: -1))
        #expect(tracker.progress(for: receipt) == .unknown)
    }

    @Test func authenticatedHistoryUsesRequestedCursorAndImmutableSessionPath() async throws {
        let body = sharedHistory([sharedEvent(12, "assistant.message", ["text": "reply"])], next: 20)
        let transport = SharedScriptTransport(sharedLoginSteps() + [sharedStep("/auth/me", sharedAuth()),
            sharedStep("/sessions/session-test/events?afterSeq=8&limit=100", .init(status: 200, body: body))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        _ = try await sharedLogin(client)
        let page = try await client.sharedHistory(sessionID: "session-test", afterSeq: 8)
        #expect(page.sessionId == "session-test" && page.afterSeq == 8 && page.nextSeq == 20)
        let count = await transport.requests().count
        await #expect(throws: APIFailure.invalidResponse) { try await client.sharedHistory(sessionID: "../other", afterSeq: 8) }
        #expect(await transport.requests().count == count)
    }

    @Test func duplicateInFlightReconciliationIsRejectedWithoutSecondRequest() async throws {
        let transport = SharedScriptTransport(sharedLoginSteps() + [sharedStep("/auth/me", sharedAuth(), pause: true), sharedStep("/commands/by-request/apple-request-1", sharedMissing())])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let intent = try sharedIntent(await sharedLogin(client))
        let operation = Task { try await client.reconcileCommand(intent) }
        await transport.waitUntilPaused()
        await #expect(throws: APIFailure.server(status: 409, code: "REQUEST_IN_PROGRESS")) { try await client.reconcileCommand(intent) }
        await transport.release()
        #expect(try await operation.value == .notFound)
        #expect(await transport.requests().count == 4)
    }

    @Test func expiredCommandLookupClearsCurrentCredentialAndNeverPosts() async throws {
        let store = MemoryStore()
        let transport = SharedScriptTransport(sharedLoginSteps() + [sharedStep("/auth/me", sharedAuth()), sharedStep("/commands/by-request/apple-request-1", sharedMissing("UNAUTHORIZED", status: 401))])
        let client = PersonalClient(credentialStore: store, transport: transport)
        let intent = try sharedIntent(await sharedLogin(client))
        await #expect(throws: APIFailure.server(status: 401, code: "UNAUTHORIZED")) { try await client.reconcileCommand(intent, allowSubmission: true) }
        #expect(await client.currentSession() == nil && store.count == 0)
    }

    @Test func productionCapabilityDeclarationContainsOnlyAppleSharingFields() async throws {
        let response = sharedJSON(["deviceId": "device-Mac", "platform": "macos", "sharedConversations": 1])
        let transport = SharedScriptTransport(sharedLoginSteps() + [sharedStep("/auth/me", sharedAuth()),
            sharedStep("/sync/capabilities", response, method: "POST")])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport, platform: .macOS)
        _ = try await sharedLogin(client)
        try await client.declareSharedCapabilities()
        let request = try #require(await transport.requests().last)
        let body = try #require(request.httpBody)
        let fields = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(Set(fields.keys) == ["platform", "sharedConversations"])
        #expect(fields["platform"] as? String == "macos" && fields["sharedConversations"] as? Int == 1)
        #expect(request.value(forHTTPHeaderField: "X-WeftMate-CSRF") == sharedCSRF)
    }

    @Test func hostCataloguePreservesUnconfiguredWithoutInferringDefaultOrGeneration() async throws {
        let response = sharedJSON(["models": [["id": "profile-pending", "name": "Pending model", "model": "model/test",
            "configured": false, "routeFingerprint": NSNull(), "sourceKind": "cloud"]]])
        let transport = SharedScriptTransport(sharedLoginSteps() + [sharedStep("/auth/me", sharedAuth()), sharedStep("/models", response)])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        _ = try await sharedLogin(client)
        let models = try await client.hostModels()
        #expect(models.count == 1 && !models[0].configured && models[0].routeFingerprint == nil)
        #expect(await transport.requests().filter { $0.httpMethod == "POST" }.count == 1)
    }

    @Test func lateCapabilityFailureCannotPublishIntoAnotherOwner() async throws {
        let transport = SharedScriptTransport(sharedLoginSteps() + [sharedStep("/auth/me", sharedAuth()),
            .init(path: "/sync/capabilities", method: "POST", failure: .transport(.timeout), pause: true),
            sharedStep("/auth/logout", sharedJSON([:]), method: "POST"),
            sharedStep("/auth/login", sharedAuth("owner-B", device: "device-B"), method: "POST"), sharedStep("/status", sharedStatus("owner-B"))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        _ = try await sharedLogin(client)
        let operation = Task { try await client.declareSharedCapabilities() }
        await transport.waitUntilPaused()
        try await client.logout()
        _ = try await sharedLogin(client)
        await transport.release()
        await #expect(throws: APIFailure.accountChanged) { try await operation.value }
        #expect(await client.currentSession()?.account.ownerId == "owner-B")
    }

    @Test func requestMemoryBudgetMatchesDurableLimitsAndFailsBeforeNetwork() async throws {
        var steps = sharedLoginSteps()
        for index in 0..<256 {
            steps.append(sharedStep("/auth/me", sharedAuth()))
            steps.append(sharedStep("/commands/by-request/request-\(index)", sharedMissing()))
        }
        let transport = SharedScriptTransport(steps)
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let session = try await sharedLogin(client)
        for index in 0..<256 { #expect(try await client.reconcileCommand(sharedIntent(session, request: "request-\(index)")) == .notFound) }
        let count = await transport.requests().count
        await #expect(throws: APIFailure.requestLedgerLimit) { try await client.reconcileCommand(sharedIntent(session, request: "request-over-budget")) }
        #expect(await transport.requests().count == count)

        let freshTransport = SharedScriptTransport(sharedLoginSteps())
        let fresh = PersonalClient(credentialStore: MemoryStore(), transport: freshTransport)
        let freshSession = try await sharedLogin(fresh)
        var oversized = try sharedIntent(freshSession).payload
        oversized.append(Data(repeating: 32, count: 131_073 - oversized.count))
        #expect(throws: APIFailure.invalidResponse) {
            try SharedCommandIntent(server: freshSession.server, ownerId: freshSession.account.ownerId,
                hostId: freshSession.hostId, payload: oversized)
        }
        #expect(await freshTransport.requests().count == 2)
    }
}
