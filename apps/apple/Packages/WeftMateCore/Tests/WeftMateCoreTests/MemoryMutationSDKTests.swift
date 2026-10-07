import Foundation
import Testing
@testable import WeftMateCore

private let mutationOrigin = "https://mutation.unit.weftmate.example:8443"
private func mutationJSON(_ fields: [String: Any], status: Int = 200) -> HTTPResponse {
    .init(status: status, body: try! JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]))
}
private func mutationAuth(_ owner: String = "owner-A", device: String = "device-Mac") -> HTTPResponse {
    let fields: [String: Any] = ["account": ["ownerId": owner, "username": "test", "displayName": "Test"], "device": ["id": device, "name": "Mac"], "csrfToken": String(repeating: "b", count: 43)]
    return .init(status: 200, headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)], body: mutationJSON(fields).body)
}
private func mutationReceipt(_ state: String = "applied", revision: Int = 5, cleanup: String? = nil, detail: String? = nil,
                             changes: [String: Any] = [:], status: Int = 200) -> HTTPResponse {
    var receipt: [String: Any] = ["commandId": "memory-command", "requestId": "memory-request", "state": state, "worldRevision": revision]
    if let cleanup { receipt["storageCleanup"] = ["state": cleanup, "detailCode": detail ?? (cleanup == "complete" ? "current_wal_truncated" : "wal_reader_busy")] }
    for (key, value) in changes { receipt[key] = value }
    return mutationJSON(["receipt": receipt], status: status)
}
private func parsedMutationReceipt(_ reply: HTTPResponse) throws -> MemoryMutationReceipt {
    struct Reply: Decodable { let receipt: MemoryMutationReceipt }
    return try JSONDecoder().decode(Reply.self, from: reply.body).receipt
}
private actor MutationScriptTransport: HTTPTransport {
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
        guard request.url?.path == "/personal/v1" + step.path, request.httpMethod == step.method else { throw APIFailure.invalidResponse }
        if step.pause { await withCheckedContinuation { paused = $0 } }
        if let failure = step.failure { throw failure }
        return step.response
    }
    func waitUntilPaused() async { while paused == nil { await Task.yield() } }
    func release() { paused?.resume(); paused = nil }
    func requests() -> [URLRequest] { seen }
}
private let mutationLookup = "/memory/commands/by-request/memory-request"
private func mutationMissing(_ code: String = "NOT_FOUND", status: Int = 404) -> HTTPResponse { mutationJSON(["error": ["code": code]], status: status) }
private func mutationLoginSteps() -> [MutationScriptTransport.Step] {
    [.init(path: "/auth/login", response: mutationAuth(), method: "POST"), .init(path: "/status", response: mutationJSON(["ownerId": "owner-A", "hostId": "host-test"]))]
}
private func mutationLogin(_ client: PersonalClient) async throws -> AccountSession {
    try await client.login(server: ServerConfiguration(input: mutationOrigin), username: "test", password: "synthetic-only", deviceName: "Mac")
}
private func mutationIntent(_ session: AccountSession, operation: MemoryMutationKind = .mute, target: String = "memory.1") throws -> MemoryMutationIntent {
    try .init(session: session, operation: operation, itemKind: operation == .deleteEvidence ? nil : .cognition,
        targetID: target, requestID: "memory-request", expectedWorldRevision: 4, correction: operation == .correct ? "synthetic correction" : nil)
}

struct MemoryMutationSDKTests {
    @Test func immutableWhitelistedIntentCodecRejectsBadRevisionTargetAndPayload() async throws {
        let client = PersonalClient(credentialStore: MemoryStore(), transport: MutationScriptTransport(mutationLoginSteps()))
        let session = try await mutationLogin(client)
        let intent = try mutationIntent(session, operation: .correct)
        #expect(intent.httpMethod == "POST" && intent.endpointPath == "/memory/items/cognition/memory.1/correct")
        #expect(try JSONDecoder().decode(MemoryMutationIntent.self, from: JSONEncoder().encode(intent)) == intent)
        var fields = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(intent)) as? [String: Any])
        fields["payload"] = Data("{}".utf8).base64EncodedString()
        #expect(throws: APIFailure.invalidResponse) { try JSONDecoder().decode(MemoryMutationIntent.self, from: JSONSerialization.data(withJSONObject: fields)) }
        #expect(throws: APIFailure.invalidResponse) { try mutationIntent(session, target: "../other") }
        #expect(throws: APIFailure.invalidResponse) { try MemoryMutationIntent(session: session, operation: .correct, itemKind: .entity, targetID: "entity.1", requestID: "new", expectedWorldRevision: 4, correction: "text") }
        #expect(throws: APIFailure.invalidResponse) { try MemoryMutationIntent(session: session, operation: .mute, itemKind: .cognition, targetID: "memory.1", requestID: "__proto__", expectedWorldRevision: 4) }
        #expect(throws: APIFailure.invalidResponse) { try MemoryMutationIntent(session: session, operation: .mute, itemKind: .cognition, targetID: "memory.1", requestID: "new", expectedWorldRevision: -1) }
    }

    @Test func lookupOnlyAbsentDoesNotMutate() async throws {
        let transport = MutationScriptTransport(mutationLoginSteps() + [.init(path: "/auth/me", response: mutationAuth()), .init(path: mutationLookup, response: mutationMissing())])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let intent = try mutationIntent(await mutationLogin(client))
        #expect(try await client.reconcileMemoryMutation(intent) == .notFound)
        #expect(await transport.requests().filter { $0.httpMethod != "GET" }.count == 1)
    }

    @Test func bothSuccessAndHTTP409DomainReceiptsAreRetained() async throws {
        for (state, status, revision) in [("applied", 200, 5), ("no_change", 200, 4), ("revision_conflict", 409, 3), ("rejected", 409, 4)] {
            let transport = MutationScriptTransport(mutationLoginSteps() + [.init(path: "/auth/me", response: mutationAuth()),
                .init(path: mutationLookup, response: mutationMissing()), .init(path: "/memory/items/cognition/memory.1/mute", response: mutationReceipt(state, revision: revision, status: status), method: "POST")])
            let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
            let intent = try mutationIntent(await mutationLogin(client))
            guard case let .found(receipt) = try await client.reconcileMemoryMutation(intent, allowSubmission: true) else { Issue.record("Expected receipt"); return }
            #expect(receipt.state.rawValue == state && receipt.worldRevision == revision)
            let request = try #require(await transport.requests().last)
            #expect(request.httpBody == intent.payload && request.value(forHTTPHeaderField: "X-WeftMate-CSRF") == String(repeating: "b", count: 43))
        }
    }

    @Test func plain409ErrorIsNotAnEmptyOrSuccessfulReceipt() async throws {
        let transport = MutationScriptTransport(mutationLoginSteps() + [.init(path: "/auth/me", response: mutationAuth()), .init(path: mutationLookup, response: mutationMissing()),
            .init(path: "/memory/items/cognition/memory.1/mute", response: mutationMissing("MEMORY_REQUEST_CONFLICT", status: 409), method: "POST")])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let intent = try mutationIntent(await mutationLogin(client))
        await #expect(throws: APIFailure.server(status: 409, code: "MEMORY_REQUEST_CONFLICT")) { try await client.reconcileMemoryMutation(intent, allowSubmission: true) }
    }

    @Test func lostReplyAfterRestartOnlyRecoversOriginalRequest() async throws {
        let transport = MutationScriptTransport(mutationLoginSteps() + [.init(path: "/auth/me", response: mutationAuth()), .init(path: mutationLookup, response: mutationMissing()),
            .init(path: "/memory/items/cognition/memory.1/mute", method: "POST", failure: .transport(.timeout)),
            .init(path: "/auth/me", response: mutationAuth()), .init(path: "/status", response: mutationJSON(["ownerId": "owner-A", "hostId": "host-test"])),
            .init(path: "/auth/me", response: mutationAuth()), .init(path: mutationLookup, response: mutationReceipt())])
        let store = MemoryStore()
        let first = PersonalClient(credentialStore: store, transport: transport)
        let intent = try mutationIntent(await mutationLogin(first))
        await #expect(throws: APIFailure.transport(.timeout)) { try await first.reconcileMemoryMutation(intent, allowSubmission: true) }
        let restored = PersonalClient(credentialStore: store, transport: transport); _ = try await restored.restoreSession(server: intent.server)
        guard case .found = try await restored.reconcileMemoryMutation(intent, allowSubmission: true) else { Issue.record("Expected recovered receipt"); return }
        #expect(await transport.requests().filter { $0.url?.path.hasSuffix("/mute") == true }.count == 1)
    }

    @Test func sameBytesDifferentTargetCannotReplaceRequestEndpoint() async throws {
        let transport = MutationScriptTransport(mutationLoginSteps() + [.init(path: "/auth/me", response: mutationAuth()), .init(path: mutationLookup, response: mutationMissing())])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let session = try await mutationLogin(client)
        _ = try await client.reconcileMemoryMutation(mutationIntent(session))
        let count = await transport.requests().count
        await #expect(throws: APIFailure.server(status: 409, code: "MEMORY_REQUEST_CONFLICT")) { try await client.reconcileMemoryMutation(mutationIntent(session, target: "memory.2"), allowSubmission: true) }
        #expect(await transport.requests().count == count)
    }

    @Test func cleanupPendingAndNoChangeDoNotClaimPhysicalCompletion() async throws {
        let client = PersonalClient(credentialStore: MemoryStore(), transport: MutationScriptTransport(mutationLoginSteps()))
        let intent = try mutationIntent(await mutationLogin(client), operation: .deleteItem)
        let pending = try parsedMutationReceipt(mutationReceipt("no_change", revision: 4, cleanup: "pending"))
        try pending.validate(intent: intent)
        #expect(pending.effectApplied && pending.cleanupPending && !pending.cleanupConfirmedComplete)
        let absent = try parsedMutationReceipt(mutationReceipt("no_change", revision: 4))
        try absent.validate(intent: intent)
        #expect(!absent.cleanupConfirmedComplete)
    }

    @Test func cleanupPairsAndKnownProofCannotRegressOrDisappear() async throws {
        let client = PersonalClient(credentialStore: MemoryStore(), transport: MutationScriptTransport(mutationLoginSteps()))
        let intent = try mutationIntent(await mutationLogin(client), operation: .deleteEvidence)
        let complete = try parsedMutationReceipt(mutationReceipt(cleanup: "complete"))
        let busyComplete = try parsedMutationReceipt(mutationReceipt(cleanup: "complete", detail: "wal_reader_busy"))
        #expect(throws: APIFailure.invalidResponse) { try busyComplete.validate(intent: intent) }
        let pending = try parsedMutationReceipt(mutationReceipt(cleanup: "pending"))
        #expect(throws: APIFailure.invalidResponse) { try pending.validate(intent: intent, knownReceipt: complete) }
        let absent = try parsedMutationReceipt(mutationReceipt())
        #expect(throws: APIFailure.invalidResponse) { try absent.validate(intent: intent, knownReceipt: pending) }
    }

    @Test func retryQueriesOriginalDeletionThenPostsOnlyEmptyCleanupBody() async throws {
        let pending = try parsedMutationReceipt(mutationReceipt(cleanup: "pending"))
        let transport = MutationScriptTransport(mutationLoginSteps() + [.init(path: "/auth/me", response: mutationAuth()), .init(path: mutationLookup, response: mutationReceipt(cleanup: "pending")),
            .init(path: mutationLookup + "/retry-cleanup", response: mutationReceipt(cleanup: "complete"), method: "POST")])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let intent = try mutationIntent(await mutationLogin(client), operation: .deleteItem)
        guard case let .found(receipt) = try await client.retryMemoryCleanup(intent, knownReceipt: pending, allowSubmission: true) else { Issue.record("Missing cleanup receipt"); return }
        #expect(receipt.cleanupConfirmedComplete)
        let request = try #require(await transport.requests().last)
        #expect(request.httpBody == Data("{}".utf8) && request.httpMethod == "POST")
        #expect(await transport.requests().allSatisfy { $0.httpMethod != "DELETE" })
    }

    @Test func cleanupDefaultLookupAndMissingNeverRepeatDelete() async throws {
        let pending = try parsedMutationReceipt(mutationReceipt(cleanup: "pending"))
        for response in [mutationReceipt(cleanup: "pending"), mutationMissing(), mutationReceipt(cleanup: "complete")] {
            let transport = MutationScriptTransport(mutationLoginSteps() + [.init(path: "/auth/me", response: mutationAuth()), .init(path: mutationLookup, response: response)])
            let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
            let intent = try mutationIntent(await mutationLogin(client), operation: .deleteEvidence)
            _ = try await client.retryMemoryCleanup(intent, knownReceipt: pending)
            #expect(await transport.requests().count == 4)
        }
    }

    @Test func lostCleanupReplyIsRecoveredWithoutSecondCleanupOrDelete() async throws {
        let pending = try parsedMutationReceipt(mutationReceipt(cleanup: "pending"))
        let transport = MutationScriptTransport(mutationLoginSteps() + [.init(path: "/auth/me", response: mutationAuth()), .init(path: mutationLookup, response: mutationReceipt(cleanup: "pending")),
            .init(path: mutationLookup + "/retry-cleanup", method: "POST", failure: .transport(.timeout)),
            .init(path: "/auth/me", response: mutationAuth()), .init(path: mutationLookup, response: mutationReceipt(cleanup: "complete"))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let intent = try mutationIntent(await mutationLogin(client), operation: .deleteItem)
        await #expect(throws: APIFailure.transport(.timeout)) { try await client.retryMemoryCleanup(intent, knownReceipt: pending, allowSubmission: true) }
        guard case let .found(receipt) = try await client.retryMemoryCleanup(intent, knownReceipt: pending) else { Issue.record("Missing recovered cleanup"); return }
        #expect(receipt.cleanupConfirmedComplete)
        #expect(await transport.requests().filter { $0.url?.path.hasSuffix("/retry-cleanup") == true }.count == 1)
    }

    @Test func wrongReceiptHTTPStateAndImmutableKnownOutcomeAreRejected() async throws {
        let client = PersonalClient(credentialStore: MemoryStore(), transport: MutationScriptTransport(mutationLoginSteps()))
        let intent = try mutationIntent(await mutationLogin(client))
        let known = try parsedMutationReceipt(mutationReceipt())
        for receipt in [try parsedMutationReceipt(mutationReceipt(changes: ["requestId": "other"])), try parsedMutationReceipt(mutationReceipt(changes: ["commandId": "other-command"]))] {
            #expect(throws: APIFailure.identityMismatch) { try receipt.validate(intent: intent, knownReceipt: known) }
        }
        let changed = try parsedMutationReceipt(mutationReceipt("rejected", revision: 5))
        #expect(throws: APIFailure.identityMismatch) { try changed.validate(intent: intent, knownReceipt: known) }
        let transport = MutationScriptTransport(mutationLoginSteps() + [.init(path: "/auth/me", response: mutationAuth()), .init(path: mutationLookup, response: mutationMissing()),
            .init(path: "/memory/items/cognition/memory.1/mute", response: mutationReceipt(status: 409), method: "POST")])
        let actor = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let freshIntent = try mutationIntent(await mutationLogin(actor))
        await #expect(throws: APIFailure.invalidResponse) { try await actor.reconcileMemoryMutation(freshIntent, allowSubmission: true) }
    }

    @Test func nonDeletionCannotRetryCleanupAndReceiptIsBounded() async throws {
        let transport = MutationScriptTransport(mutationLoginSteps())
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let intent = try mutationIntent(await mutationLogin(client))
        await #expect(throws: APIFailure.invalidResponse) { try await client.retryMemoryCleanup(intent, knownReceipt: parsedMutationReceipt(mutationReceipt()), allowSubmission: true) }
        #expect(await transport.requests().count == 2)
        let oversized = MutationScriptTransport(mutationLoginSteps() + [.init(path: "/auth/me", response: mutationAuth()),
            .init(path: mutationLookup, response: .init(status: 200, body: Data(repeating: 32, count: 65_537)))])
        let reader = PersonalClient(credentialStore: MemoryStore(), transport: oversized)
        let readIntent = try mutationIntent(await mutationLogin(reader))
        await #expect(throws: APIFailure.responseTooLarge) { try await reader.reconcileMemoryMutation(readIntent) }
    }

    @Test func knownReceiptDisappearanceNeverReplaysPreviouslyProvedMutation() async throws {
        let transport = MutationScriptTransport(mutationLoginSteps() + [.init(path: "/auth/me", response: mutationAuth()), .init(path: mutationLookup, response: mutationMissing())])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let intent = try mutationIntent(await mutationLogin(client))
        #expect(try await client.reconcileMemoryMutation(intent, allowSubmission: true, knownReceipt: parsedMutationReceipt(mutationReceipt())) == .notFound)
        #expect(await transport.requests().count == 4)
    }

    @Test func lateMutationReceiptCannotPublishIntoAnotherOwner() async throws {
        let transport = MutationScriptTransport(mutationLoginSteps() + [.init(path: "/auth/me", response: mutationAuth()), .init(path: mutationLookup, response: mutationMissing()),
            .init(path: "/memory/items/cognition/memory.1/mute", response: mutationReceipt(), method: "POST", pause: true),
            .init(path: "/auth/logout", response: mutationJSON([:]), method: "POST"), .init(path: "/auth/login", response: mutationAuth("owner-B", device: "device-B"), method: "POST"),
            .init(path: "/status", response: mutationJSON(["ownerId": "owner-B", "hostId": "host-test"]))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let intent = try mutationIntent(await mutationLogin(client))
        let operation = Task { try await client.reconcileMemoryMutation(intent, allowSubmission: true) }
        await transport.waitUntilPaused(); try await client.logout(); _ = try await mutationLogin(client); await transport.release()
        await #expect(throws: APIFailure.accountChanged) { try await operation.value }
        #expect(await client.currentSession()?.account.ownerId == "owner-B")
    }
}
