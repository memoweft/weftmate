// Standalone logic checks: compile with AppleAppModel.swift and the built Core objects.
// No app activation, Keychain calls, external HTTP or model requests are performed.
import Foundation
import WeftMateCore

private struct CheckFailure: Error { let message: String }
private func require(_ value: Bool, _ message: String) throws {
    if !value { throw CheckFailure(message: message) }
}

private final class FixtureCredentials: CredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: Data] = [:]
    func load(key: String) -> Data? { lock.withLock { values[key] } }
    func save(_ data: Data, key: String) { lock.withLock { values[key] = data } }
    func delete(key: String) { lock.withLock { values[key] = nil } }
}

private actor FixtureHTTP: HTTPTransport {
    var owner = "ownerA"
    var offline = false
    func makeOffline() { offline = true }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        if offline { throw APIFailure.transport(.unavailable) }
        let path = request.url!.path
        var headers: [String: String] = [:]
        let object: [String: Any]
        switch path {
        case "/personal/v1/auth/login":
            let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
            owner = body["username"] as! String
            headers["set-cookie"] = "wm_personal_session=" + String(repeating: "a", count: 43) + "; Secure; HttpOnly"
            object = auth()
        case "/personal/v1/auth/me": object = auth()
        case "/personal/v1/status": object = ["ownerId": owner, "hostId": "host-test"]
        case "/personal/v1/auth/devices": object = ["devices": [["id": "device-" + owner, "name": "Fixture", "current": true]]]
        case "/personal/v1/sync/events":
            object = ["events": [["seq": 1, "sourceDeviceId": "device-source", "eventId": "event-one",
                "conversationId": "same-conversation", "kind": "conversation.created",
                "occurredAt": "2026-10-05T00:00:00Z", "payload": ["title": "Synthetic"]]],
                "nextSeq": 1, "hasMore": false]
        case "/personal/v1/sessions": object = ["sessions": []]
        case "/personal/v1/auth/logout": object = [:]
        default: throw CheckFailure(message: "Unexpected mock route")
        }
        return HTTPResponse(status: 200, headers: headers, body: try JSONSerialization.data(withJSONObject: object))
    }
    private func auth() -> [String: Any] {
        ["account": ["ownerId": owner, "username": owner, "displayName": "Synthetic " + owner],
         "device": ["id": "device-" + owner, "name": "Fixture"],
         "csrfToken": String(repeating: "b", count: 43)]
    }
}

private struct RealDrafts: AppleDraftPersisting {
    let store: LocalConversationStore
    func loadDrafts(account: LocalAccountScope) async throws -> [String: String] { try await store.loadDrafts(account: account) }
    func saveDraft(account: LocalAccountScope, conversationId: String, text: String) async throws {
        _ = try await store.saveDraft(account: account, conversationId: conversationId, text: text)
    }
}

private actor ControlledDrafts: AppleDraftPersisting {
    var values: [LocalAccountScope: [String: String]] = [:]
    var failLoad = false
    var failSave = false
    var pauseSave = false
    var saveGate: CheckedContinuation<Void, Never>?
    func configure(loadFailure: Bool = false, saveFailure: Bool = false, pause: Bool = false) {
        failLoad = loadFailure; failSave = saveFailure; pauseSave = pause
    }
    func loadDrafts(account: LocalAccountScope) async throws -> [String: String] {
        if failLoad { throw LocalConversationStoreFailure.corruptFile }
        return values[account] ?? [:]
    }
    func saveDraft(account: LocalAccountScope, conversationId: String, text: String) async throws {
        if pauseSave {
            pauseSave = false
            await withCheckedContinuation { saveGate = $0 }
        }
        if failSave { throw LocalConversationStoreFailure.storageUnavailable }
        values[account, default: [:]][conversationId] = text
    }
    func paused() -> Bool { saveGate != nil }
    func release() { saveGate?.resume(); saveGate = nil }
    func value(account: LocalAccountScope, key: String) -> String? { values[account]?[key] }
}

@main
private struct AppleDraftChecks {
    @MainActor static func main() async throws {
        let server = try ServerConfiguration(input: "https://unit.weftmate.example:8443")
        let output = ProcessInfo.processInfo.arguments.dropFirst().first.map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.temporaryDirectory.appendingPathComponent("AppleDraftChecks-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

        func make(_ persistence: any AppleDraftPersisting, http: FixtureHTTP = FixtureHTTP()) -> AppleAppModel {
            AppleAppModel(client: PersonalClient(credentialStore: FixtureCredentials(), transport: http),
                          draftPersistence: persistence, server: server)
        }
        func login(_ model: AppleAppModel, owner: String = "ownerA") async throws -> ConversationSummary {
            await model.authenticate(username: owner, password: "synthetic-test-only", displayName: nil, register: false)
            try require(model.session?.account.ownerId == owner && model.draftsReady, "Mock login/load did not complete")
            guard let conversation = model.conversations.first else { throw CheckFailure(message: "Fixture conversation absent") }
            return conversation
        }

        // Real file round-trip across newly created model/store instances.
        let disk = output.appendingPathComponent("round-trip")
        let first = make(RealDrafts(store: try LocalConversationStore(directory: disk)))
        let conversation = try await login(first)
        first.setDraft("durable draft", for: conversation, accountEpoch: first.accountEpoch)
        await first.signOut()
        try require(first.session == nil, "Normal sign-out did not complete")
        let reopened = make(RealDrafts(store: try LocalConversationStore(directory: disk)))
        let reopenedConversation = try await login(reopened)
        try require(reopened.draftText(for: reopenedConversation, accountEpoch: reopened.accountEpoch) == "durable draft", "Restart lost saved draft")
        print("PASS file-backed restart and normal sign-out preservation")

        // Deliberately identical conversation IDs in separate accounts still cannot cross scopes.
        let oldEpoch = reopened.accountEpoch
        await reopened.signOut()
        let otherConversation = try await login(reopened, owner: "ownerB")
        reopened.setDraft("late A callback", for: reopenedConversation, accountEpoch: oldEpoch)
        try require(reopened.draftText(for: otherConversation, accountEpoch: reopened.accountEpoch).isEmpty, "Old account callback reached new owner")
        reopened.setDraft("B draft", for: otherConversation, accountEpoch: reopened.accountEpoch)
        try require(await reopened.flushDrafts(), "B flush failed")
        let persisted = try LocalConversationStore(directory: disk)
        let a = try LocalAccountScope(server: server, ownerId: "ownerA")
        let b = try LocalAccountScope(server: server, ownerId: "ownerB")
        let key = AppleAppModel.draftKey(for: otherConversation)
        try require(try await persisted.loadDrafts(account: a)[key] == "durable draft", "A persisted value changed")
        try require(try await persisted.loadDrafts(account: b)[key] == "B draft", "B persisted value missing")
        print("PASS owner separation and stale binding epoch")

        // A blocked first write cannot overwrite a later edit when sign-out flushes.
        let controlled = ControlledDrafts()
        let coalesced = make(controlled)
        let c = try await login(coalesced)
        await controlled.configure(pause: true)
        coalesced.setDraft("first", for: c, accountEpoch: coalesced.accountEpoch)
        for _ in 0..<1_000 {
            if await controlled.paused() { break }
            try await Task.sleep(nanoseconds: 2_000_000)
        }
        try require(await controlled.paused(), "Write did not reach pause fixture")
        coalesced.setDraft("latest", for: c, accountEpoch: coalesced.accountEpoch)
        let exit = Task { await coalesced.signOut() }
        await Task.yield()
        await controlled.release()
        await exit.value
        try require(await controlled.value(account: a, key: key) == "latest", "Flush persisted stale edit")
        print("PASS bounded worker ordering and latest-edit flush")

        let failed = ControlledDrafts()
        let failureModel = make(failed)
        let failureConversation = try await login(failureModel)
        failureModel.setDraft("previous", for: failureConversation, accountEpoch: failureModel.accountEpoch)
        try require(await failureModel.flushDrafts(), "Initial persistence failed")
        await failed.configure(saveFailure: true)
        failureModel.setDraft("unsaved", for: failureConversation, accountEpoch: failureModel.accountEpoch)
        await failureModel.signOut()
        try require(failureModel.session != nil && failureModel.needsUnsavedDraftDecision, "Save failure pretended successful exit")
        try require(failureModel.unsavedDraftTextForCopy.contains("unsaved"), "Unsaved copy omitted text")
        await failureModel.signOut(discardUnsavedChanges: true)
        try require(failureModel.session == nil, "Explicit unsaved exit failed")
        try require(await failed.value(account: a, key: key) == "previous", "Explicit exit deleted prior saved draft")
        print("PASS save failure and explicit discard preserve prior saved version")

        let corrupt = ControlledDrafts()
        await corrupt.configure(loadFailure: true)
        let loadModel = make(corrupt)
        await loadModel.authenticate(username: "ownerA", password: "synthetic-test-only", displayName: nil, register: false)
        try require(!loadModel.draftsReady && loadModel.draftError != nil, "Corrupt load became successful empty draft")
        print("PASS corrupt-load error blocks editing")

        let bytesModel = make(ControlledDrafts())
        let bytesConversation = try await login(bytesModel)
        bytesModel.setDraft("before", for: bytesConversation, accountEpoch: bytesModel.accountEpoch)
        bytesModel.setDraft(String(repeating: "织", count: 21_846), for: bytesConversation, accountEpoch: bytesModel.accountEpoch)
        try require(bytesModel.draftText(for: bytesConversation, accountEpoch: bytesModel.accountEpoch) == "before" && bytesModel.draftError != nil,
                    "UTF8 overflow was accepted or silently truncated")
        print("PASS UTF8 byte limit")

        // Valid saved credentials permit their local scope while cloud verification is offline.
        let http = FixtureHTTP()
        let credentials = FixtureCredentials()
        let offlineClient = PersonalClient(credentialStore: credentials, transport: http)
        _ = try await offlineClient.login(server: server, username: "ownerA", password: "synthetic-test-only", deviceName: "Fixture")
        await http.makeOffline()
        let offlineModel = AppleAppModel(client: offlineClient, draftPersistence: RealDrafts(store: persisted), server: server)
        await offlineModel.start()
        try require(offlineModel.verificationPending && offlineModel.draftsReady, "Offline restored scope could not load drafts")
        offlineModel.setDraft("offline edit", for: conversation, accountEpoch: offlineModel.accountEpoch)
        try require(await offlineModel.flushDrafts(), "Offline local save incorrectly required cloud verification")
        try require(try await persisted.loadDrafts(account: a)[key] == "offline edit", "Offline local value missing")
        print("PASS offline cached identity supports local drafts without cloud privilege")
        print("7 checks passed; external HTTP/model requests: 0; GUI: not run")
    }
}
