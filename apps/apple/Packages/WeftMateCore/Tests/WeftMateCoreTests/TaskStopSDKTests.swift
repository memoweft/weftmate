import Foundation
import Testing
@testable import WeftMateCore

private let stopOrigin = "https://stop.unit.weftmate.example:8443"
private func stopJSON(_ fields: [String: Any], status: Int = 200) -> HTTPResponse { .init(status: status, body: try! JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys])) }
private func stopAuth(_ owner: String = "owner-A", device: String = "device-Mac") -> HTTPResponse {
    let fields: [String: Any] = ["account": ["ownerId": owner, "username": "test", "displayName": "Test"], "device": ["id": device, "name": "Mac"], "csrfToken": String(repeating: "b", count: 43)]
    return .init(status: 200, headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)], body: stopJSON(fields).body)
}
private func stopFields(root: String = "cmd-root", receipt: String? = "receipt-root", state: String = "active", status: String = "requested",
                        updated: String = "2026-10-05T00:00:00Z", canStop: Bool = true) -> [String: Any] {
    var source: [String: Any] = ["commandId": root, "requestId": "source-request", "kind": "session.message", "targetDeviceId": "host-test",
        "state": receipt == nil ? "pending" : "accepted_by_dsh", "sessionId": "session-root", "createdAt": "2026-10-05T00:00:00Z", "updatedAt": updated]
    if let receipt { source["receiptId"] = receipt }
    var control: [String: Any] = ["state": state, "updatedAt": updated, "canStop": canStop, "canSupplement": state == "active", "canResume": false]
    if state == "stop_requested" {
        control["canStop"] = false; control["canSupplement"] = false
        control["stopStatus"] = status; control["pendingReceipts"] = status == "stopped" || status == "completed" ? 0 : 1
    }
    return ["taskId": root, "sessionId": "session-root", "sourceText": "synthetic root task", "source": source,
        "artifacts": [], "steps": [], "sources": [], "supplements": [], "resumes": [], "control": control,
        "replyEvidence": ["status": "unconfirmed", "turn": NSNull(), "assistantChunks": 0, "textChunks": 0, "reasoningChunks": 0,
            "assistantMessages": 0, "toolSaveObserved": false]]
}
private func stopSnapshot(_ session: AccountSession, _ fields: [String: Any] = stopFields()) throws -> TaskSnapshot {
    try TaskSnapshot.decode(stopJSON(fields).body, scope: TaskReadScope(session), taskID: fields["taskId"] as! String)
}
private actor StopScriptTransport: HTTPTransport {
    struct Step: Sendable { let path: String; var response = HTTPResponse(status: 200, body: Data("{}".utf8)); var method = "GET"; var failure: APIFailure?; var pause = false }
    private var steps: [Step]; private var seen: [URLRequest] = []; private var paused: CheckedContinuation<Void, Never>?
    init(_ steps: [Step]) { self.steps = steps }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        seen.append(request); guard !steps.isEmpty else { throw APIFailure.invalidResponse }
        let step = steps.removeFirst()
        guard request.url?.path == "/personal/v1" + step.path, request.httpMethod == step.method else { throw APIFailure.invalidResponse }
        if step.pause { await withCheckedContinuation { paused = $0 } }
        if let failure = step.failure { throw failure }; return step.response
    }
    func waitUntilPaused() async { while paused == nil { await Task.yield() } }
    func release() { paused?.resume(); paused = nil }
    func requests() -> [URLRequest] { seen }
}
private func stopLoginSteps() -> [StopScriptTransport.Step] {
    [.init(path: "/auth/login", response: stopAuth(), method: "POST"), .init(path: "/status", response: stopJSON(["ownerId": "owner-A", "hostId": "host-test"]))]
}
private func stopLogin(_ client: PersonalClient) async throws -> AccountSession {
    try await client.login(server: ServerConfiguration(input: stopOrigin), username: "test", password: "synthetic-only", deviceName: "Mac")
}
private func stopDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("TaskStopTests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]); return url
}
private func stopPermit(_ journal: TaskStopJournal, _ intent: TaskStopIntent) async throws -> TaskStopSubmissionPermit {
    let record = try await journal.persist(intent)
    return try await journal.submissionPermit(for: intent, expectedRevision: record.revision)
}

struct TaskStopSDKTests {
    @Test func intentAndJournalCodecFixRootSourceAndExactOnlyRequestBody() async throws {
        let directory = try stopDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
        let client = PersonalClient(credentialStore: MemoryStore(), transport: StopScriptTransport(stopLoginSteps()))
        let session = try await stopLogin(client)
        let intent = try TaskStopIntent(snapshot: stopSnapshot(session), requestID: "stop-request")
        #expect(String(data: intent.payload, encoding: .utf8) == "{\"requestId\":\"stop-request\"}")
        #expect(try JSONDecoder().decode(TaskStopIntent.self, from: JSONEncoder().encode(intent)) == intent)
        let journal = try TaskStopJournal(directory: directory); _ = try await journal.persist(intent)
        let reopened = try TaskStopJournal(directory: directory)
        #expect(try await reopened.operation(for: intent)?.state == .prepared)
    }

    @Test func matched202PersistsAcknowledgmentButRequestedDoesNotMeanStopped() async throws {
        let directory = try stopDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
        let transport = StopScriptTransport(stopLoginSteps() + [.init(path: "/auth/me", response: stopAuth()), .init(path: "/tasks/cmd-root", response: stopJSON(stopFields())),
            .init(path: "/tasks/cmd-root/stop", response: stopJSON(["task": stopFields(state: "stop_requested")], status: 202), method: "POST")])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); let session = try await stopLogin(client)
        let intent = try TaskStopIntent(snapshot: stopSnapshot(session), requestID: "stop-request")
        let journal = try TaskStopJournal(directory: directory); let permit = try await stopPermit(journal, intent)
        let observation = try await client.submitTaskStop(permit)
        #expect(observation.ownStopAcknowledged && observation.journalAcknowledgmentSaved && observation.task.control.stopStatus == .requested)
        #expect(try await journal.operation(for: intent)?.state == .acknowledged)
        let count = await transport.requests().count
        await #expect(throws: TaskStopJournalFailure.submissionAlreadyAttempted) { try await client.submitTaskStop(permit) }
        #expect(await transport.requests().count == count)
    }

    @Test func unknownRestartOnlyReadsAndNewUUIDSameRootCannotBypassAttempt() async throws {
        let directory = try stopDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
        let transport = StopScriptTransport(stopLoginSteps() + [.init(path: "/auth/me", response: stopAuth()), .init(path: "/tasks/cmd-root", response: stopJSON(stopFields())),
            .init(path: "/tasks/cmd-root/stop", method: "POST", failure: .transport(.timeout)),
            .init(path: "/auth/me", response: stopAuth()), .init(path: "/tasks/cmd-root", response: stopJSON(stopFields()))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); let session = try await stopLogin(client)
        let intent = try TaskStopIntent(snapshot: stopSnapshot(session), requestID: "stop-request")
        let journal = try TaskStopJournal(directory: directory); let permit = try await stopPermit(journal, intent)
        await #expect(throws: APIFailure.transport(.timeout)) { try await client.submitTaskStop(permit) }
        let reopened = try TaskStopJournal(directory: directory)
        #expect(try await reopened.operation(for: intent)?.state == .attemptedUnknown)
        let observation = try await client.reconcileTaskStop(intent)
        #expect(observation.proofLevel == .taskStateOnly && !observation.ownStopAcknowledged)
        let different = try TaskStopIntent(snapshot: stopSnapshot(session), requestID: "new-UUID-request")
        await #expect(throws: TaskStopJournalFailure.unresolvedRootStop) { try await reopened.persist(different) }
        #expect(await transport.requests().filter { $0.url?.path.hasSuffix("/stop") == true }.count == 1)
    }

    @Test func active202KeepsServerSnapshotButDoesNotClaimStopAcknowledgment() async throws {
        let directory = try stopDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
        let transport = StopScriptTransport(stopLoginSteps() + [.init(path: "/auth/me", response: stopAuth()), .init(path: "/tasks/cmd-root", response: stopJSON(stopFields())),
            .init(path: "/tasks/cmd-root/stop", response: stopJSON(["task": stopFields()], status: 202), method: "POST")])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); let session = try await stopLogin(client)
        let intent = try TaskStopIntent(snapshot: stopSnapshot(session), requestID: "stop-request")
        let journal = try TaskStopJournal(directory: directory)
        let observation = try await client.submitTaskStop(stopPermit(journal, intent))
        #expect(observation.proofLevel == .taskStateOnly && observation.task.control.state == .active)
        #expect(try await journal.operation(for: intent)?.state == .attemptedUnknown)
    }

    @Test func queuedNilReceiptCanAdvanceOnlyInMatched202Response() async throws {
        let directory = try stopDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
        let transport = StopScriptTransport(stopLoginSteps() + [.init(path: "/auth/me", response: stopAuth()), .init(path: "/tasks/cmd-root", response: stopJSON(stopFields(receipt: nil))),
            .init(path: "/tasks/cmd-root/stop", response: stopJSON(["task": stopFields(receipt: "allocated-receipt", state: "stop_requested")], status: 202), method: "POST")])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); let session = try await stopLogin(client)
        let intent = try TaskStopIntent(snapshot: stopSnapshot(session, stopFields(receipt: nil)), requestID: "stop-request")
        let journal = try TaskStopJournal(directory: directory)
        let observation = try await client.submitTaskStop(stopPermit(journal, intent))
        #expect(observation.ownStopAcknowledged)
        #expect(try await journal.operation(for: intent)?.acknowledgment?.returnedSourceReceiptId == "allocated-receipt")
    }

    @Test func nonnilSourceReceiptReplacementLeavesAttemptUnknown() async throws {
        let directory = try stopDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
        let transport = StopScriptTransport(stopLoginSteps() + [.init(path: "/auth/me", response: stopAuth()), .init(path: "/tasks/cmd-root", response: stopJSON(stopFields())),
            .init(path: "/tasks/cmd-root/stop", response: stopJSON(["task": stopFields(receipt: "other", state: "stop_requested")], status: 202), method: "POST")])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); let session = try await stopLogin(client)
        let intent = try TaskStopIntent(snapshot: stopSnapshot(session), requestID: "stop-request"); let journal = try TaskStopJournal(directory: directory)
        await #expect(throws: APIFailure.identityMismatch) { try await client.submitTaskStop(stopPermit(journal, intent)) }
        #expect(try await journal.operation(for: intent)?.state == .attemptedUnknown)
    }

    @Test func preflightUnavailableDoesNotConsumePermitOrPost() async throws {
        let directory = try stopDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
        let transport = StopScriptTransport(stopLoginSteps() + [.init(path: "/auth/me", response: stopAuth()), .init(path: "/tasks/cmd-root", response: stopJSON(stopFields(canStop: false)))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); let session = try await stopLogin(client)
        let intent = try TaskStopIntent(snapshot: stopSnapshot(session), requestID: "stop-request"); let journal = try TaskStopJournal(directory: directory)
        await #expect(throws: APIFailure.server(status: 409, code: "TASK_NOT_READY")) { try await client.submitTaskStop(stopPermit(journal, intent)) }
        #expect(try await journal.operation(for: intent)?.state == .prepared)
        #expect(await transport.requests().filter { $0.url?.path.hasSuffix("/stop") == true }.isEmpty)
    }

    @Test func preparedRootBlocksNewConcurrentNonceAndDifferentRootRemainsIndependent() async throws {
        let directory = try stopDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
        let client = PersonalClient(credentialStore: MemoryStore(), transport: StopScriptTransport(stopLoginSteps())); let session = try await stopLogin(client)
        let journal = try TaskStopJournal(directory: directory)
        let intent = try TaskStopIntent(snapshot: stopSnapshot(session), requestID: "first"); _ = try await journal.persist(intent)
        let concurrent = try TaskStopIntent(snapshot: stopSnapshot(session), requestID: "second")
        await #expect(throws: TaskStopJournalFailure.unresolvedRootStop) { try await journal.persist(concurrent) }
        let other = try TaskStopIntent(snapshot: stopSnapshot(session, stopFields(root: "cmd-other")), requestID: "second")
        #expect(try await journal.persist(other).state == .prepared)
        let changed = try TaskStopIntent(snapshot: stopSnapshot(session, stopFields(root: "cmd-replacement")), requestID: "first")
        await #expect(throws: TaskStopJournalFailure.intentConflict) { try await journal.persist(changed) }
    }

    @Test func known202SurvivesGETActiveAndOnlyNewerConfirmedLifecycleAllowsNewIntent() async throws {
        let directory = try stopDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
        let resumed = stopFields(updated: "2026-10-05T00:02:00Z")
        let transport = StopScriptTransport(stopLoginSteps() + [.init(path: "/auth/me", response: stopAuth()), .init(path: "/tasks/cmd-root", response: stopJSON(stopFields())),
            .init(path: "/tasks/cmd-root/stop", response: stopJSON(["task": stopFields(state: "stop_requested", updated: "2026-10-05T00:01:00Z")], status: 202), method: "POST"),
            .init(path: "/auth/me", response: stopAuth()), .init(path: "/tasks/cmd-root", response: stopJSON(resumed))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); let session = try await stopLogin(client)
        let intent = try TaskStopIntent(snapshot: stopSnapshot(session), requestID: "first"); let journal = try TaskStopJournal(directory: directory)
        _ = try await client.submitTaskStop(stopPermit(journal, intent))
        let observation = try await client.reconcileTaskStop(intent)
        #expect(observation.proofLevel == .taskStateOnly && observation.task.control.state == .active)
        #expect(try await journal.operation(for: intent)?.state == .acknowledged)
        let oldCycle = try TaskStopIntent(snapshot: stopSnapshot(session), requestID: "second")
        await #expect(throws: TaskStopJournalFailure.unresolvedRootStop) { try await journal.persist(oldCycle) }
        let next = try TaskStopIntent(snapshot: observation.task, requestID: "second")
        #expect(try await journal.persist(next).state == .prepared)
    }

    @Test func corruptJournalAndFutureSchemaArePreservedAndCannotMintPermit() async throws {
        let directory = try stopDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
        let journal = try TaskStopJournal(directory: directory)
        let file = directory.appendingPathComponent(TaskStopJournal.fileName)
        let bad = Data("not-json".utf8); try bad.write(to: file); try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        let scope = try LocalAccountScope(server: ServerConfiguration(input: stopOrigin), ownerId: "owner-A")
        await #expect(throws: TaskStopJournalFailure.corruptFile) { try await journal.operations(account: scope) }
        #expect(try Data(contentsOf: file) == bad)
        let future = stopJSON(["schemaVersion": 999, "generation": 0, "records": []]).body; try future.write(to: file)
        await #expect(throws: TaskStopJournalFailure.unsupportedVersion(999)) { try await journal.operations(account: scope) }
        #expect(try Data(contentsOf: file) == future)
    }

    @Test func twoJournalActorsCannotConsumeSameDurablePermitTwice() async throws {
        let directory = try stopDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
        let client = PersonalClient(credentialStore: MemoryStore(), transport: StopScriptTransport(stopLoginSteps())); let session = try await stopLogin(client)
        let intent = try TaskStopIntent(snapshot: stopSnapshot(session), requestID: "first")
        let first = try TaskStopJournal(directory: directory); let second = try TaskStopJournal(directory: directory)
        let permit = try await stopPermit(first, intent)
        let record = try #require(try await second.operation(for: intent))
        let duplicate = try await second.submissionPermit(for: intent, expectedRevision: record.revision)
        try await permit.consume()
        await #expect(throws: TaskStopJournalFailure.submissionAlreadyAttempted) { try await duplicate.consume() }
    }

    @Test func late202CannotAcknowledgeAnotherAccount() async throws {
        let directory = try stopDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
        let transport = StopScriptTransport(stopLoginSteps() + [.init(path: "/auth/me", response: stopAuth()), .init(path: "/tasks/cmd-root", response: stopJSON(stopFields())),
            .init(path: "/tasks/cmd-root/stop", response: stopJSON(["task": stopFields(state: "stop_requested")], status: 202), method: "POST", pause: true),
            .init(path: "/auth/logout", response: stopJSON([:]), method: "POST"), .init(path: "/auth/login", response: stopAuth("owner-B", device: "device-B"), method: "POST"),
            .init(path: "/status", response: stopJSON(["ownerId": "owner-B", "hostId": "host-test"]))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); let session = try await stopLogin(client)
        let intent = try TaskStopIntent(snapshot: stopSnapshot(session), requestID: "first"); let journal = try TaskStopJournal(directory: directory)
        let permit = try await stopPermit(journal, intent)
        let operation = Task { try await client.submitTaskStop(permit) }
        await transport.waitUntilPaused(); try await client.logout(); _ = try await stopLogin(client); await transport.release()
        await #expect(throws: APIFailure.accountChanged) { try await operation.value }
        #expect(try await journal.operation(for: intent)?.state == .attemptedUnknown)
    }

    @Test func changedPreflightSourceAndUnmatchedHTTPStatusDoNotProveSubmission() async throws {
        for changedBefore in [true, false] {
            let directory = try stopDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
            var steps = stopLoginSteps() + [.init(path: "/auth/me", response: stopAuth()),
                .init(path: "/tasks/cmd-root", response: stopJSON(stopFields(receipt: changedBefore ? "changed-before-post" : "receipt-root")))]
            if !changedBefore { steps.append(.init(path: "/tasks/cmd-root/stop", response: stopJSON(["task": stopFields(state: "stop_requested")], status: 200), method: "POST")) }
            let transport = StopScriptTransport(steps)
            let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); let session = try await stopLogin(client)
            let intent = try TaskStopIntent(snapshot: stopSnapshot(session), requestID: "request"); let journal = try TaskStopJournal(directory: directory)
            let expected: APIFailure = changedBefore ? .identityMismatch : .invalidResponse
            await #expect(throws: expected) { try await client.submitTaskStop(stopPermit(journal, intent)) }
            #expect(try await journal.operation(for: intent)?.state == (changedBefore ? .prepared : .attemptedUnknown))
        }
    }

    @Test func journalSymlinkAndRecordLimitFailWithoutDeletingPriorRequests() async throws {
        let directory = try stopDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
        let client = PersonalClient(credentialStore: MemoryStore(), transport: StopScriptTransport(stopLoginSteps())); let session = try await stopLogin(client)
        let journal = try TaskStopJournal(directory: directory)
        for index in 0..<256 {
            let intent = try TaskStopIntent(snapshot: stopSnapshot(session, stopFields(root: "cmd-root-\(index)")), requestID: "request-\(index)")
            _ = try await journal.persist(intent)
        }
        let extra = try TaskStopIntent(snapshot: stopSnapshot(session, stopFields(root: "cmd-extra")), requestID: "extra")
        await #expect(throws: TaskStopJournalFailure.limitExceeded) { try await journal.persist(extra) }
        let scope = try LocalAccountScope(server: session.server, ownerId: session.account.ownerId)
        #expect(try await journal.operations(account: scope).count == 256)
        let linkedDirectory = try stopDirectory(); defer { try? FileManager.default.removeItem(at: linkedDirectory) }
        let linked = try TaskStopJournal(directory: linkedDirectory)
        let target = linkedDirectory.appendingPathComponent("preserved.json"); let original = Data("preserve".utf8); try original.write(to: target)
        try FileManager.default.createSymbolicLink(at: linkedDirectory.appendingPathComponent(TaskStopJournal.fileName), withDestinationURL: target)
        await #expect(throws: TaskStopJournalFailure.unsafeFile) { try await linked.operations(account: scope) }
        #expect(try Data(contentsOf: target) == original)
    }

    @Test func unknownEnvelopeFieldPreservesBytesWhileExactExistingSchemaStillReads() async throws {
        let directory = try stopDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
        let journal = try TaskStopJournal(directory: directory)
        let file = directory.appendingPathComponent(TaskStopJournal.fileName)
        let scope = try LocalAccountScope(server: ServerConfiguration(input: stopOrigin), ownerId: "owner-A")
        let existing = stopJSON(["schemaVersion": 1, "generation": 0, "records": []]).body
        try existing.write(to: file); try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        #expect(try await journal.operations(account: scope).isEmpty)
        #expect(try Data(contentsOf: file) == existing)
        let unknown = stopJSON(["schemaVersion": 1, "generation": 0, "records": [], "unknownFutureField": "PRESERVE-UNKNOWN-STOP-FIELD"]).body
        try unknown.write(to: file)
        await #expect(throws: TaskStopJournalFailure.corruptFile) { try await journal.operations(account: scope) }
        let client = PersonalClient(credentialStore: MemoryStore(), transport: StopScriptTransport(stopLoginSteps()))
        let intent = try TaskStopIntent(snapshot: stopSnapshot(await stopLogin(client)), requestID: "must-not-rewrite")
        await #expect(throws: TaskStopJournalFailure.corruptFile) { try await journal.persist(intent) }
        #expect(try Data(contentsOf: file) == unknown)
    }
}
