import Foundation
import Testing
@testable import WeftMateCore

private let ramOrigin = "https://ram.unit.weftmate.example:8443"
private let ramMarker = "RAM-CORRECTION-BODY-DO-NOT-RETAIN"
private func ramJSON(_ fields: [String: Any]) -> HTTPResponse { .init(status: 200, body: try! JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys])) }
private func ramAuth(_ owner: String = "owner-A", device: String = "device-Mac") -> HTTPResponse {
    let fields: [String: Any] = ["account": ["ownerId": owner, "username": "test", "displayName": "Test"], "device": ["id": device, "name": "Mac"], "csrfToken": String(repeating: "b", count: 43)]
    return .init(status: 200, headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)], body: ramJSON(fields).body)
}
private func ramReceipt(request: String = "correct-request", command: String = "memory-correct", revision: Int = 5, state: String = "applied") throws -> MemoryMutationReceipt {
    let data = ramJSON(["commandId": command, "requestId": request, "state": state, "worldRevision": revision]).body
    return try JSONDecoder().decode(MemoryMutationReceipt.self, from: data)
}
private actor RAMScriptTransport: HTTPTransport {
    struct Step: Sendable { let path: String; let response: HTTPResponse; var method = "GET"; var pause = false }
    private var steps: [Step]; private var seen: [URLRequest] = []; private var paused: CheckedContinuation<Void, Never>?
    init(_ steps: [Step]) { self.steps = steps }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        seen.append(request); guard !steps.isEmpty else { throw APIFailure.invalidResponse }
        let step = steps.removeFirst()
        guard request.url?.path == "/personal/v1" + step.path, request.httpMethod == step.method else { throw APIFailure.invalidResponse }
        if step.pause { await withCheckedContinuation { paused = $0 } }
        return step.response
    }
    func waitUntilPaused() async { while paused == nil { await Task.yield() } }
    func release() { paused?.resume(); paused = nil }
    func requests() -> [URLRequest] { seen }
}
private func ramLoginSteps() -> [RAMScriptTransport.Step] {
    [.init(path: "/auth/login", response: ramAuth(), method: "POST"), .init(path: "/status", response: ramJSON(["ownerId": "owner-A", "hostId": "host-test"]))]
}
private func ramLogin(_ client: PersonalClient) async throws -> AccountSession {
    try await client.login(server: ServerConfiguration(input: ramOrigin), username: "test", password: "synthetic-only", deviceName: "Mac")
}
private func ramCorrection(_ session: AccountSession, request: String = "correct-request", target: String = "memory.1", expected: Int = 4, text: String = ramMarker) throws -> MemoryMutationIntent {
    try .init(session: session, operation: .correct, itemKind: .cognition, targetID: target, requestID: request, expectedWorldRevision: expected, correction: text)
}
private func ramProof(_ session: AccountSession, request: String = "correct-request", target: String = "memory.1", expected: Int = 4,
                      correctionRevision: Int = 5, deletionRevision: Int = 6) throws -> MemoryCorrectionRedactionProof {
    let correction = try ramCorrection(session, request: request, target: target, expected: expected)
    let deletion = try MemoryMutationIntent(session: session, operation: .deleteItem, itemKind: .cognition,
        targetID: target, requestID: "delete-request", expectedWorldRevision: 5)
    return try .init(correction: correction, correctionReceipt: ramReceipt(request: request, command: "memory-\(request)", revision: correctionRevision),
        deletedBy: deletion, deletionReceipt: ramReceipt(request: "delete-request", command: "memory-delete", revision: deletionRevision))
}

struct MemoryRAMRedactionTests {
    @Test func serializedProofHasNoCorrectionBodyPayloadOrBodyHashAndChecksTargetRevision() async throws {
        let client = PersonalClient(credentialStore: MemoryStore(), transport: RAMScriptTransport(ramLoginSteps()))
        let session = try await ramLogin(client)
        let proof = try ramProof(session)
        let bytes = try JSONEncoder().encode(proof)
        #expect(!(String(data: bytes, encoding: .utf8) ?? "").contains(ramMarker))
        let fields = try #require(try JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        let identity = try #require(fields["correction"] as? [String: Any])
        #expect(identity["payload"] == nil && identity["correction"] == nil && identity["payloadSHA256"] == nil)
        #expect(try JSONDecoder().decode(MemoryCorrectionRedactionProof.self, from: bytes) == proof)
        #expect(throws: APIFailure.invalidResponse) { try ramProof(session, expected: 7, correctionRevision: 7) }
        #expect(throws: APIFailure.invalidResponse) { try ramProof(session, correctionRevision: 7) }
        let wrongDelete = try MemoryMutationIntent(session: session, operation: .deleteItem, itemKind: .cognition, targetID: "other", requestID: "delete-request", expectedWorldRevision: 5)
        #expect(throws: APIFailure.invalidResponse) { try MemoryCorrectionRedactionProof(correction: ramCorrection(session), correctionReceipt: ramReceipt(), deletedBy: wrongDelete, deletionReceipt: ramReceipt(request: "delete-request", revision: 6)) }
    }

    @Test func provedRAMBodyIsRemovedAndFullIntentCannotEverReplayAfterRedaction() async throws {
        let receipt = try ramReceipt(command: "memory-correct-request")
        let reply = ramJSON(["receipt": try JSONSerialization.jsonObject(with: JSONEncoder().encode(receipt))])
        let transport = RAMScriptTransport(ramLoginSteps() + [.init(path: "/auth/me", response: ramAuth()), .init(path: "/memory/commands/by-request/correct-request", response: reply)])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let session = try await ramLogin(client); let correction = try ramCorrection(session)
        _ = try await client.reconcileMemoryMutation(correction)
        #expect(await client.memoryRAMRedactionState(requestID: correction.requestId).holdsBody)
        let proof = try ramProof(session)
        #expect(try await client.redactMemoryCorrection(proof) == .redacted)
        let state = await client.memoryRAMRedactionState(requestID: correction.requestId)
        #expect(!state.holdsBody && state.tombstoned)
        let count = await transport.requests().count
        for intent in [correction, try ramCorrection(session, text: "replacement body")] {
            await #expect(throws: APIFailure.server(status: 409, code: "MEMORY_LOCAL_REQUEST_REDACTED")) { try await client.reconcileMemoryMutation(intent, allowSubmission: true) }
        }
        #expect(await transport.requests().count == count)
        #expect(try await client.redactMemoryCorrection(proof) == .alreadyRedacted)
    }

    @Test func noBodyLookupKeepsTombstoneWhenServerReturnsNotFound() async throws {
        let missing = HTTPResponse(status: 404, body: ramJSON(["error": ["code": "NOT_FOUND"]]).body)
        let transport = RAMScriptTransport(ramLoginSteps() + [.init(path: "/auth/me", response: ramAuth()), .init(path: "/memory/commands/by-request/correct-request", response: missing)])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let proof = try ramProof(await ramLogin(client))
        #expect(try await client.reconcileRedactedMemoryCorrection(proof) == .notFound)
        let state = await client.memoryRAMRedactionState(requestID: proof.correction.requestId)
        #expect(state.tombstoned && !state.holdsBody)
        #expect(await transport.requests().filter { $0.httpMethod != "GET" }.count == 1)
    }

    @Test func inFlightBodyIsDeferredUntilOriginalRequestReceiptArrives() async throws {
        let receipt = try ramReceipt(command: "memory-correct-request")
        let response = ramJSON(["receipt": try JSONSerialization.jsonObject(with: JSONEncoder().encode(receipt))])
        let transport = RAMScriptTransport(ramLoginSteps() + [.init(path: "/auth/me", response: ramAuth()),
            .init(path: "/memory/commands/by-request/correct-request", response: response, pause: true)])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let session = try await ramLogin(client); let intent = try ramCorrection(session); let proof = try ramProof(session)
        let operation = Task { try await client.reconcileMemoryMutation(intent) }
        await transport.waitUntilPaused()
        #expect(try await client.redactMemoryCorrection(proof) == .deferredInFlight)
        #expect(await client.memoryRAMRedactionState(requestID: intent.requestId).holdsBody)
        await transport.release(); _ = try await operation.value
        #expect(try await client.redactMemoryCorrection(proof) == .redacted)
    }

    @Test func mismatchedCachedTargetOrProvedCommandCannotPurgeBody() async throws {
        let receipt = try ramReceipt(command: "memory-correct-request")
        let response = ramJSON(["receipt": try JSONSerialization.jsonObject(with: JSONEncoder().encode(receipt))])
        let transport = RAMScriptTransport(ramLoginSteps() + [.init(path: "/auth/me", response: ramAuth()), .init(path: "/memory/commands/by-request/correct-request", response: response)])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let session = try await ramLogin(client)
        _ = try await client.reconcileMemoryMutation(ramCorrection(session))
        await #expect(throws: APIFailure.identityMismatch) { try await client.redactMemoryCorrection(ramProof(session, target: "other-target")) }
        let deletion = try MemoryMutationIntent(session: session, operation: .deleteItem, itemKind: .cognition, targetID: "memory.1", requestID: "delete-request", expectedWorldRevision: 5)
        let wrong = try MemoryCorrectionRedactionProof(correction: ramCorrection(session), correctionReceipt: ramReceipt(command: "other-command"), deletedBy: deletion, deletionReceipt: ramReceipt(request: "delete-request", revision: 6))
        await #expect(throws: APIFailure.identityMismatch) { try await client.redactMemoryCorrection(wrong) }
        #expect(await client.memoryRAMRedactionState(requestID: "correct-request").holdsBody)
    }

    @Test func logoutClearsScopeAndPersistedNoBodyProofCanRestoreOwnTombstone() async throws {
        let transport = RAMScriptTransport(ramLoginSteps() + [.init(path: "/auth/logout", response: ramJSON([:]), method: "POST"),
            .init(path: "/auth/login", response: ramAuth("owner-B", device: "device-B"), method: "POST"), .init(path: "/status", response: ramJSON(["ownerId": "owner-B", "hostId": "host-test"])),
            .init(path: "/auth/logout", response: ramJSON([:]), method: "POST")] + ramLoginSteps())
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let proof = try ramProof(await ramLogin(client))
        _ = try await client.redactMemoryCorrection(proof)
        try await client.logout(); _ = try await ramLogin(client)
        #expect(await client.memoryRAMRedactionState(requestID: proof.correction.requestId).recordCount == 0)
        await #expect(throws: APIFailure.accountChanged) { try await client.redactMemoryCorrection(proof) }
        try await client.logout(); _ = try await ramLogin(client)
        #expect(try await client.redactMemoryCorrection(proof) == .redacted)
    }

    @Test func finiteBudgetIncludesNoBodyTombstonesAndCannotDropUnknownRowsForSpace() async throws {
        let client = PersonalClient(credentialStore: MemoryStore(), transport: RAMScriptTransport(ramLoginSteps()))
        let session = try await ramLogin(client)
        for index in 0..<256 { _ = try await client.redactMemoryCorrection(ramProof(session, request: "correct-\(index)")) }
        #expect(await client.memoryRAMRedactionState(requestID: "correct-0").recordCount == 256)
        await #expect(throws: APIFailure.requestLedgerLimit) { try await client.redactMemoryCorrection(ramProof(session, request: "correct-over-budget")) }
    }

    @Test func canonicalOriginProofWorksAndForeignScopeOrUnsuccessfulDeleteDoesNot() async throws {
        let client = PersonalClient(credentialStore: MemoryStore(), transport: RAMScriptTransport(ramLoginSteps()))
        let session = try await ramLogin(client)
        let correction = try ramCorrection(session)
        let otherSession = AccountSession(server: try ServerConfiguration(input: "https://foreign.unit.example"), account: session.account,
            device: session.device, hostId: session.hostId, verification: .verified)
        let foreign = try MemoryMutationIntent(session: otherSession, operation: .deleteItem, itemKind: .cognition, targetID: "memory.1", requestID: "delete-request", expectedWorldRevision: 5)
        #expect(throws: APIFailure.identityMismatch) { try MemoryCorrectionRedactionProof(correction: correction, correctionReceipt: ramReceipt(), deletedBy: foreign, deletionReceipt: ramReceipt(request: "delete-request", revision: 6)) }
        let deletion = try MemoryMutationIntent(session: session, operation: .deleteItem, itemKind: .cognition, targetID: "memory.1", requestID: "delete-request", expectedWorldRevision: 5)
        #expect(throws: APIFailure.invalidResponse) { try MemoryCorrectionRedactionProof(correction: correction, correctionReceipt: ramReceipt(), deletedBy: deletion, deletionReceipt: ramReceipt(request: "delete-request", revision: 6, state: "rejected")) }
        let bare = AccountSession(server: try ServerConfiguration(input: "https://canonical.unit.example"), account: session.account,
            device: session.device, hostId: session.hostId, verification: .verified)
        let explicit = AccountSession(server: try ServerConfiguration(input: "https://canonical.unit.example:443"), account: session.account,
            device: session.device, hostId: session.hostId, verification: .verified)
        let sameOriginDelete = try MemoryMutationIntent(session: bare, operation: .deleteItem, itemKind: .cognition, targetID: "memory.1", requestID: "delete-request", expectedWorldRevision: 5)
        let canonicalProof = try MemoryCorrectionRedactionProof(correction: ramCorrection(explicit), correctionReceipt: ramReceipt(),
            deletedBy: sameOriginDelete, deletionReceipt: ramReceipt(request: "delete-request", revision: 6))
        try canonicalProof.validate()
    }
}
