import Foundation
import Testing
@testable import WeftMateCore

private let adoptionOrigin = "https://adoption.unit.weftmate.example:8443"
private let adoptionPath = "/sync/conversations/conversation-test/shared"
private func adoptionJSON(_ fields: [String: Any], status: Int = 200, headers: [String: String] = [:]) -> HTTPResponse {
    .init(status: status, headers: headers, body: try! JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]))
}
private func adoptionAuth(_ owner: String = "owner-A", device: String = "device-Mac") -> HTTPResponse {
    adoptionJSON(["account": ["ownerId": owner, "username": "test", "displayName": "Test"], "device": ["id": device, "name": "Mac"],
        "csrfToken": String(repeating: "b", count: 43)], headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)])
}
private func adoptionCommand(state: String = "accepted_by_dsh", changes: [String: Any] = [:]) -> [String: Any] {
    var fields: [String: Any] = ["commandId": "cmd-create", "requestId": "adopt-request", "kind": "session.create", "targetDeviceId": "host-test",
        "state": state, "sessionId": "session-test", "conversationId": "conversation-test"]
    for (key, value) in changes { fields[key] = value }
    return fields
}
private func adoptionProjection(status: String = "active", through: Int = 4, bindingChanges: [String: Any] = [:]) -> [String: Any] {
    var fields: [String: Any] = ["source": "host", "hostId": "host-test", "conversationId": "conversation-test", "syncThroughSeq": through,
        "status": status, "canAdopt": status == "unbound", "originalModel": NSNull()]
    if status != "unbound" {
        var binding: [String: Any] = ["conversationId": "conversation-test", "sessionId": "session-test", "modelProfileId": "explicit-profile",
            "revision": 1, "cutoverSyncSeq": 4, "contextHash": String(repeating: "a", count: 64), "historyMessageCount": 2,
            "truncated": false, "omittedImages": 0, "adoptCommandId": "cmd-create"]
        for (key, value) in bindingChanges { binding[key] = value }
        fields["binding"] = binding
    }
    return fields
}
private actor AdoptionScriptTransport: HTTPTransport {
    struct Step: Sendable {
        let path: String
        var response = HTTPResponse(status: 200, body: Data("{}".utf8))
        var method = "GET"
        var failure: APIFailure? = nil
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
        guard request.url?.path == "/personal/v1" + step.path && request.httpMethod == step.method else { throw APIFailure.invalidResponse }
        if step.pause { await withCheckedContinuation { paused = $0 } }
        if let failure = step.failure { throw failure }
        return step.response
    }
    func waitUntilPaused() async { while paused == nil { await Task.yield() } }
    func release() { paused?.resume(); paused = nil }
    func requests() -> [URLRequest] { seen }
}
private func adoptionLoginSteps() -> [AdoptionScriptTransport.Step] {
    [.init(path: "/auth/login", response: adoptionAuth(), method: "POST"), .init(path: "/status", response: adoptionJSON(["ownerId": "owner-A", "hostId": "host-test"]))]
}
private func adoptionLogin(_ client: PersonalClient) async throws -> AccountSession {
    try await client.login(server: ServerConfiguration(input: adoptionOrigin), username: "test", password: "synthetic-only", deviceName: "Mac")
}
private func adoptionIntent(_ session: AccountSession, conversationID: String = "conversation-test", profile: String = "explicit-profile") throws -> SharedAdoptionIntent {
    try .init(session: session, conversationID: conversationID, requestID: "adopt-request", modelProfileID: profile, expectedSyncSeq: 4)
}
private func adoptionMissing(_ code: String = "NOT_FOUND", status: Int = 404) -> HTTPResponse { adoptionJSON(["error": ["code": code]], status: status) }

struct AdoptionSDKTests {
    @Test func endpointIntentHasExactSortedBodyAndCheckedPersistentCodec() async throws {
        let client = PersonalClient(credentialStore: MemoryStore(), transport: AdoptionScriptTransport(adoptionLoginSteps()))
        let session = try await adoptionLogin(client)
        let intent = try adoptionIntent(session)
        #expect(String(data: intent.payload, encoding: .utf8) == "{\"expectedSyncSeq\":4,\"modelProfileId\":\"explicit-profile\",\"requestId\":\"adopt-request\"}")
        let saved = try JSONEncoder().encode(intent)
        #expect(try JSONDecoder().decode(SharedAdoptionIntent.self, from: saved) == intent)
        var fields = try #require(try JSONSerialization.jsonObject(with: saved) as? [String: Any])
        fields["payload"] = Data("{}".utf8).base64EncodedString()
        #expect(throws: APIFailure.invalidResponse) { try JSONDecoder().decode(SharedAdoptionIntent.self, from: JSONSerialization.data(withJSONObject: fields)) }
        #expect(throws: APIFailure.invalidResponse) { try adoptionIntent(session, profile: "") }
        #expect(throws: APIFailure.invalidResponse) { try SharedAdoptionIntent(session: session, conversationID: "conversation-test", requestID: "new", modelProfileID: "explicit-profile", expectedSyncSeq: 0) }
    }

    @Test func lookupOnlyExactNotFoundDoesNotAdopt() async throws {
        let transport = AdoptionScriptTransport(adoptionLoginSteps() + [.init(path: "/auth/me", response: adoptionAuth()), .init(path: "/commands/by-request/adopt-request", response: adoptionMissing())])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let intent = try adoptionIntent(await adoptionLogin(client))
        #expect(try await client.reconcileAdoption(intent) == .notFound)
        #expect(await transport.requests().filter { $0.httpMethod == "POST" }.count == 1)
    }

    @Test func recoveredOriginalCreateMatchesBindingWithoutSecondPost() async throws {
        let transport = AdoptionScriptTransport(adoptionLoginSteps() + [.init(path: "/auth/me", response: adoptionAuth()),
            .init(path: "/commands/by-request/adopt-request", response: adoptionJSON(["command": adoptionCommand()])),
            .init(path: adoptionPath, response: adoptionJSON(adoptionProjection()))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let intent = try adoptionIntent(await adoptionLogin(client))
        guard case let .found(receipt) = try await client.reconcileAdoption(intent, allowSubmission: true, knownBindingRevision: 1) else { Issue.record("Expected adoption receipt"); return }
        #expect(receipt.validationLevel == .bindingMatched && receipt.bindingRevision == 1)
        #expect(await transport.requests().filter { $0.httpMethod == "POST" }.count == 1)
    }

    @Test func newAdoptionUsesExactPersistedBodyAfterFreshUnboundProjection() async throws {
        var reply = adoptionProjection(status: "creating"); reply["command"] = adoptionCommand(state: "pending")
        let transport = AdoptionScriptTransport(adoptionLoginSteps() + [.init(path: "/auth/me", response: adoptionAuth()),
            .init(path: "/commands/by-request/adopt-request", response: adoptionMissing()),
            .init(path: adoptionPath, response: adoptionJSON(adoptionProjection(status: "unbound"))),
            .init(path: adoptionPath, response: adoptionJSON(reply, status: 202), method: "POST")])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let intent = try adoptionIntent(await adoptionLogin(client))
        guard case let .found(receipt) = try await client.reconcileAdoption(intent, allowSubmission: true) else { Issue.record("Expected receipt"); return }
        #expect(receipt.command.state == .pending && receipt.projection.status == .creating)
        let request = try #require(await transport.requests().last)
        #expect(request.httpBody == intent.payload && request.url?.path == "/personal/v1" + adoptionPath)
        #expect(request.value(forHTTPHeaderField: "Origin") == adoptionOrigin && request.value(forHTTPHeaderField: "X-WeftMate-CSRF") == String(repeating: "b", count: 43))
    }

    @Test func lostPostAfterRestartRecoversSameIdentityAndBodyWithoutReplay() async throws {
        let transport = AdoptionScriptTransport(adoptionLoginSteps() + [.init(path: "/auth/me", response: adoptionAuth()),
            .init(path: "/commands/by-request/adopt-request", response: adoptionMissing()),
            .init(path: adoptionPath, response: adoptionJSON(adoptionProjection(status: "unbound"))), .init(path: adoptionPath, method: "POST", failure: .transport(.timeout)),
            .init(path: "/auth/me", response: adoptionAuth()), .init(path: "/status", response: adoptionJSON(["ownerId": "owner-A", "hostId": "host-test"])),
            .init(path: "/auth/me", response: adoptionAuth()), .init(path: "/commands/by-request/adopt-request", response: adoptionJSON(["command": adoptionCommand()])),
            .init(path: adoptionPath, response: adoptionJSON(adoptionProjection()))])
        let store = MemoryStore()
        let first = PersonalClient(credentialStore: store, transport: transport)
        let intent = try adoptionIntent(await adoptionLogin(first))
        await #expect(throws: APIFailure.transport(.timeout)) { try await first.reconcileAdoption(intent, allowSubmission: true) }
        let restored = PersonalClient(credentialStore: store, transport: transport)
        _ = try await restored.restoreSession(server: intent.server)
        guard case .found = try await restored.reconcileAdoption(intent, allowSubmission: true) else { Issue.record("Expected recovered receipt"); return }
        #expect(await transport.requests().filter { $0.httpMethod == "POST" && $0.url?.path.hasSuffix("/shared") == true }.count == 1)
    }

    @Test func rejectedCreationWithRemovedBindingRetainsOnlyExplicitRejectionProof() async throws {
        let transport = AdoptionScriptTransport(adoptionLoginSteps() + [.init(path: "/auth/me", response: adoptionAuth()),
            .init(path: "/commands/by-request/adopt-request", response: adoptionJSON(["command": adoptionCommand(state: "rejected", changes: ["errorCode": "MODEL_UNAVAILABLE"])])),
            .init(path: adoptionPath, response: adoptionJSON(adoptionProjection(status: "unbound")))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let intent = try adoptionIntent(await adoptionLogin(client))
        guard case let .found(receipt) = try await client.reconcileAdoption(intent, knownBindingRevision: 1) else { Issue.record("Expected rejection"); return }
        #expect(receipt.command.state == .rejected && receipt.validationLevel == .rejectedCommandOnly && receipt.bindingRevision == nil)
    }

    @Test func wrongProfileCutSessionCommandOrRevisionCannotProveAdoption() async throws {
        for (changes, known) in [(["modelProfileId": "other"] as [String: Any], nil), (["cutoverSyncSeq": 3], nil),
            (["sessionId": "other-session"], nil), (["adoptCommandId": "other-command"], nil), ([:], 2)] as [([String: Any], Int?)] {
            let transport = AdoptionScriptTransport(adoptionLoginSteps() + [.init(path: "/auth/me", response: adoptionAuth()),
                .init(path: "/commands/by-request/adopt-request", response: adoptionJSON(["command": adoptionCommand()])),
                .init(path: adoptionPath, response: adoptionJSON(adoptionProjection(bindingChanges: changes)))])
            let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
            let intent = try adoptionIntent(await adoptionLogin(client))
            await #expect(throws: APIFailure.identityMismatch) { try await client.reconcileAdoption(intent, knownBindingRevision: known) }
        }
    }

    @Test func staleOrAlreadyBoundProjectionCannotStartNewAdoption() async throws {
        for (projection, error) in [(adoptionProjection(status: "unbound", through: 5), APIFailure.server(status: 409, code: "CONVERSATION_SYNC_CHANGED")),
            (adoptionProjection(), .server(status: 409, code: "CONVERSATION_NOT_READY"))] {
            let transport = AdoptionScriptTransport(adoptionLoginSteps() + [.init(path: "/auth/me", response: adoptionAuth()),
                .init(path: "/commands/by-request/adopt-request", response: adoptionMissing()), .init(path: adoptionPath, response: adoptionJSON(projection))])
            let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
            let intent = try adoptionIntent(await adoptionLogin(client))
            await #expect(throws: error) { try await client.reconcileAdoption(intent, allowSubmission: true) }
            #expect(await transport.requests().filter { $0.httpMethod == "POST" && $0.url?.path.hasSuffix("/shared") == true }.isEmpty)
        }
    }

    @Test func sameBodyDifferentConversationCannotReuseRequestEndpoint() async throws {
        let transport = AdoptionScriptTransport(adoptionLoginSteps() + [.init(path: "/auth/me", response: adoptionAuth()), .init(path: "/commands/by-request/adopt-request", response: adoptionMissing())])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let session = try await adoptionLogin(client)
        _ = try await client.reconcileAdoption(adoptionIntent(session))
        let count = await transport.requests().count
        await #expect(throws: APIFailure.server(status: 409, code: "REQUEST_CONFLICT")) {
            try await client.reconcileAdoption(adoptionIntent(session, conversationID: "other-conversation"), allowSubmission: true)
        }
        #expect(await transport.requests().count == count)
    }

    @Test func nonAuthoritativeMissingOrNetworkErrorNeverPermitsPost() async throws {
        for response in [adoptionMissing("SESSION_UNAVAILABLE"), adoptionMissing("SERVICE_UNAVAILABLE", status: 503)] {
            let transport = AdoptionScriptTransport(adoptionLoginSteps() + [.init(path: "/auth/me", response: adoptionAuth()), .init(path: "/commands/by-request/adopt-request", response: response)])
            let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
            let intent = try adoptionIntent(await adoptionLogin(client))
            await #expect(throws: APIFailure.self) { try await client.reconcileAdoption(intent, allowSubmission: true) }
            #expect(await transport.requests().count == 4)
        }
    }

    @Test func lateOwnerResponseCannotStartAdoptionInAnotherOwner() async throws {
        let transport = AdoptionScriptTransport(adoptionLoginSteps() + [.init(path: "/auth/me", response: adoptionAuth()),
            .init(path: "/commands/by-request/adopt-request", response: adoptionMissing(), pause: true),
            .init(path: "/auth/logout", response: adoptionJSON([:]), method: "POST"), .init(path: "/auth/login", response: adoptionAuth("owner-B", device: "device-B"), method: "POST"),
            .init(path: "/status", response: adoptionJSON(["ownerId": "owner-B", "hostId": "host-test"]))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let intent = try adoptionIntent(await adoptionLogin(client))
        let operation = Task { try await client.reconcileAdoption(intent, allowSubmission: true) }
        await transport.waitUntilPaused(); try await client.logout(); _ = try await adoptionLogin(client); await transport.release()
        await #expect(throws: APIFailure.accountChanged) { try await operation.value }
        #expect(await transport.requests().allSatisfy { $0.httpMethod != "POST" || !($0.url?.path.hasSuffix("/shared") ?? false) })
    }
}
