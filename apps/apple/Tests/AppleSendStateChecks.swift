import Foundation
import WeftMateCore

private struct Failed: Error { let message: String }
private func check(_ condition: Bool, _ message: String) throws { if !condition { throw Failed(message: message) } }
private final class Credentials: CredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: Data] = [:]
    func load(key: String) -> Data? { lock.withLock { values[key] } }
    func save(_ value: Data, key: String) { lock.withLock { values[key] = value } }
    func delete(key: String) { lock.withLock { values[key] = nil } }
}
private struct Drafts: AppleDraftPersisting {
    let store: LocalConversationStore
    func loadDrafts(account: LocalAccountScope) async throws -> [String: String] { try await store.loadDrafts(account: account) }
    func saveDraft(account: LocalAccountScope, conversationId: String, text: String) async throws {
        _ = try await store.saveDraft(account: account, conversationId: conversationId, text: text)
    }
}

private actor CommandHTTP: HTTPTransport {
    var configured = true
    var omitProfile = false
    var lostReply = false
    var dropLostRecord = false
    var pausePost = false
    var holdEnd = false
    var offline = false
    var gate: CheckedContinuation<Void, Never>?
    var posts: [Data] = []
    var eventReads = 0
    var lookupReads = 0
    var receipt: [String: String]?
    func options(configured: Bool = true, omitProfile: Bool = false, lostReply: Bool = false,
                 dropLostRecord: Bool = false, pausePost: Bool = false, holdEnd: Bool = false) {
        self.configured = configured; self.omitProfile = omitProfile; self.lostReply = lostReply
        self.dropLostRecord = dropLostRecord; self.pausePost = pausePost; self.holdEnd = holdEnd
    }
    func release() { gate?.resume(); gate = nil }
    func finishTurn() { holdEnd = false }
    func goOffline() { offline = true }
    func forgetReceipt() { receipt = nil }
    func paused() -> Bool { gate != nil }
    func submitted() -> [Data] { posts }
    func eventReadCount() -> Int { eventReads }
    func lookupReadCount() -> Int { lookupReads }
    private var running = false
    func setRunning() { running = true }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        if offline { throw APIFailure.transport(.unavailable) }
        let path = request.url!.path
        var object: [String: Any] = [:]
        var status = 200
        var headers: [String: String] = [:]
        let auth: [String: Any] = ["account": ["ownerId": "ownerA", "username": "ownerA", "displayName": "Synthetic"],
            "device": ["id": "device-Mac", "name": "Fixture"], "csrfToken": String(repeating: "b", count: 43)]
        switch path {
        case "/personal/v1/auth/login":
            object = auth
            headers["set-cookie"] = "wm_personal_session=" + String(repeating: "a", count: 43) + "; Secure; HttpOnly"
        case "/personal/v1/auth/me": object = auth
        case "/personal/v1/status": object = ["ownerId": "ownerA", "hostId": "host-test"]
        case "/personal/v1/auth/devices": object = ["devices": [["id": "device-Mac", "name": "Fixture", "current": true]]]
        case "/personal/v1/sync/events": object = ["events": [], "nextSeq": 0, "hasMore": false]
        case "/personal/v1/session-groups": object = ["groups": []]
        case "/personal/v1/sessions":
            var session: [String: Any] = ["sessionId": "session-host", "title": "Synthetic", "running": running, "sendAvailable": true]
            if !omitProfile { session["modelProfileId"] = "profile-one" }
            object = ["sessions": [session, ["sessionId": "session-other", "title": "Other", "running": false,
                "sendAvailable": true, "modelProfileId": "profile-one"]]]
        case "/personal/v1/models": object = ["models": [["id": "profile-one", "name": "Fixture model", "model": "fixture-model", "configured": configured]]]
        case "/personal/v1/sync/capabilities": object = ["deviceId": "device-Mac", "platform": "macos", "sharedConversations": 1]
        case "/personal/v1/commands":
            let bytes = request.httpBody!
            posts.append(bytes)
            let payload = try JSONSerialization.jsonObject(with: bytes) as! [String: String]
            receipt = ["commandId": "command-one", "requestId": payload["requestId"]!, "kind": "session.message",
                "targetDeviceId": "host-test", "sessionId": "session-host", "state": "accepted_by_dsh", "receiptId": "receipt-one"]
            if pausePost { pausePost = false; await withCheckedContinuation { gate = $0 } }
            if lostReply {
                lostReply = false
                if dropLostRecord { receipt = nil }
                throw APIFailure.transport(.timeout)
            }
            object = ["command": receipt!]
        case let value where value.hasPrefix("/personal/v1/commands/by-request/"):
            lookupReads += 1
            if let receipt { object = ["command": receipt] }
            else { status = 404; object = ["error": ["code": "NOT_FOUND"]] }
        case "/personal/v1/sessions/session-host/events":
            eventReads += 1
            let after = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!.first { $0.name == "afterSeq" }?.value.flatMap(Int.init) ?? -1
            var events: [[String: Any]] = []
            if let bytes = posts.first {
                let payload = try JSONSerialization.jsonObject(with: bytes) as! [String: String]
                events = [["seq": 0, "type": "turn.started", "data": ["turn": 1]],
                    ["seq": 1, "type": "user.message", "data": ["text": payload["text"]!, "receiptId": "receipt-one"]],
                    ["seq": 2, "type": "assistant.message", "data": ["text": "synthetic answer"]]]
                if !holdEnd { events.append(["seq": 3, "type": "turn.ended", "data": ["turn": 1, "reason": "completed"]]) }
            }
            object = ["events": events.filter { ($0["seq"] as! Int) > after }, "nextSeq": max(after, events.last?["seq"] as? Int ?? -1), "hasMore": false]
        case "/personal/v1/sessions/session-other/events": object = ["events": [], "nextSeq": -1, "hasMore": false]
        case "/personal/v1/auth/logout": object = [:]
        default: throw Failed(message: "Unexpected mock route")
        }
        return HTTPResponse(status: status, headers: headers, body: try JSONSerialization.data(withJSONObject: object))
    }
}

@main private struct AppleSendChecks {
    @MainActor static func main() async throws {
        let server = try ServerConfiguration(input: "https://unit.weftmate.example:8443")
        let base = URL(fileURLWithPath: CommandLine.arguments[1])
        func model(_ http: CommandHTTP, directory: URL, credentials: Credentials = Credentials(), preferences: UserDefaults? = nil) throws -> AppleAppModel {
            let store = try LocalConversationStore(directory: directory)
            return AppleAppModel(client: PersonalClient(credentialStore: credentials, transport: http),
                draftPersistence: Drafts(store: store), server: server, commandStore: store, preferences: preferences)
        }
        func opened(_ model: AppleAppModel) async throws -> ConversationSummary {
            await model.authenticate(username: "ownerA", password: "synthetic-test-only", displayName: nil, register: false)
            guard let conversation = model.conversations.first(where: { $0.sessionId == "session-host" }) else { throw Failed(message: "No fixture session") }
            await model.open(conversation)
            return conversation
        }
        func wait(_ predicate: () async -> Bool) async throws {
            let deadline = Date().addingTimeInterval(6)
            while Date() < deadline {
                if await predicate() { return }
                try await Task.sleep(nanoseconds: 5_000_000)
            }
            throw Failed(message: "Timed out waiting for logic postcondition")
        }

        let http = CommandHTTP()
        await http.options(holdEnd: true)
        let credentialStore = Credentials()
        let normalDirectory = base.appendingPathComponent("normal")
        let normal = try model(http, directory: normalDirectory, credentials: credentialStore)
        let conversation = try await opened(normal)
        normal.setDraft("first message", for: conversation, accountEpoch: normal.accountEpoch)
        await normal.send(conversation, accountEpoch: normal.accountEpoch)
        try await wait { normal.commandRows(for: conversation).first?.progress == .running }
        try check(normal.commandRows(for: conversation).first?.record.state == .accepted, "Receipt was not durably accepted")
        try check(normal.draftText(for: conversation, accountEpoch: normal.accountEpoch).isEmpty, "Accepted matching draft remained")
        await http.finishTurn()
        try await wait { normal.commandRows(for: conversation).first?.progress == .completed }
        try check(normal.optimisticRows(for: conversation).isEmpty, "Confirmed user message duplicated optimistic row")
        try check(normal.messages.contains { $0.text == "synthetic answer" }, "Projected assistant message missing")
        try check(await http.submitted().count == 1, "Normal request duplicated")
        print("PASS durable send, accepted is not completed, true turn-ended correlation")

        let delayedHTTP = CommandHTTP()
        await delayedHTTP.options(pausePost: true)
        let delayed = try model(delayedHTTP, directory: base.appendingPathComponent("typing"))
        let delayedConversation = try await opened(delayed)
        delayed.setDraft("submitted", for: delayedConversation, accountEpoch: delayed.accountEpoch)
        let send = Task { await delayed.send(delayedConversation, accountEpoch: delayed.accountEpoch) }
        try await wait { await delayedHTTP.paused() }
        try check(delayed.optimisticRows(for: delayedConversation).first?.record.intent.text == "submitted", "Immediate optimistic message missing before receipt")
        try check(delayed.draftText(for: delayedConversation, accountEpoch: delayed.accountEpoch) == "submitted", "Pending request discarded draft")
        delayed.setDraft("newly typed", for: delayedConversation, accountEpoch: delayed.accountEpoch)
        await delayedHTTP.release(); await send.value
        try check(delayed.draftText(for: delayedConversation, accountEpoch: delayed.accountEpoch) == "newly typed", "Accepted old text cleared new draft")
        print("PASS typing during request preserves the new draft")

        let lostHTTP = CommandHTTP()
        await lostHTTP.options(lostReply: true)
        let lostDirectory = base.appendingPathComponent("lost-found")
        let lost = try model(lostHTTP, directory: lostDirectory)
        let lostConversation = try await opened(lost)
        lost.setDraft("lost response", for: lostConversation, accountEpoch: lost.accountEpoch)
        await lost.send(lostConversation, accountEpoch: lost.accountEpoch)
        try check(lost.commandRows(for: lostConversation).first?.record.state == .uncertain, "Lost POST looked successful")
        let originalID = lost.commandRows(for: lostConversation).first!.id
        let restarted = try model(lostHTTP, directory: lostDirectory)
        let restartedConversation = try await opened(restarted)
        try check(restarted.commandRows(for: restartedConversation).first?.id == originalID, "Restart replaced request identity")
        try check(await lostHTTP.submitted().count == 1, "Restart reposted an already accepted request")
        print("PASS unknown restart looks up original ID without duplicate POST")

        let absentHTTP = CommandHTTP()
        await absentHTTP.options(lostReply: true, dropLostRecord: true)
        let absentDirectory = base.appendingPathComponent("lost-absent")
        let absent = try model(absentHTTP, directory: absentDirectory)
        let absentConversation = try await opened(absent)
        absent.setDraft("same bytes", for: absentConversation, accountEpoch: absent.accountEpoch)
        await absent.send(absentConversation, accountEpoch: absent.accountEpoch)
        let recovered = try model(absentHTTP, directory: absentDirectory)
        let recoveredConversation = try await opened(recovered)
        let row = recovered.commandRows(for: recoveredConversation).first!
        try check(row.lookupNotFound, "Official NOT_FOUND was not explicit")
        try check(await absentHTTP.submitted().count == 1, "Lookup-only restart sent without user intent")
        await recovered.continueSavedRequest(row.id, accountEpoch: recovered.accountEpoch)
        let posts = await absentHTTP.submitted()
        try check(posts.count == 2 && posts[0] == posts[1], "Retry changed ID or original body")
        print("PASS explicit retry reuses identical persisted bytes after NOT_FOUND")

        let disabledHTTP = CommandHTTP()
        await disabledHTTP.options(configured: false)
        let disabled = try model(disabledHTTP, directory: base.appendingPathComponent("unconfigured"))
        let disabledConversation = try await opened(disabled)
        disabled.setDraft("keep", for: disabledConversation, accountEpoch: disabled.accountEpoch)
        await disabled.send(disabledConversation, accountEpoch: disabled.accountEpoch)
        try check(await disabledHTTP.submitted().isEmpty && !disabled.canSend(disabledConversation), "Unconfigured model was treated as usable")
        print("PASS unconfigured model cannot submit")

        let missingHTTP = CommandHTTP()
        await missingHTTP.options(omitProfile: true)
        let missing = try model(missingHTTP, directory: base.appendingPathComponent("missing-model"))
        let missingConversation = try await opened(missing)
        missing.setDraft("keep", for: missingConversation, accountEpoch: missing.accountEpoch)
        try check(!missing.canSend(missingConversation) && missing.continuationNotices[AppleAppModel.draftKey(for: missingConversation)] != nil,
                  "Missing identity silently selected a model")
        print("PASS missing model identity remains explicit")

        let account = try LocalAccountScope(server: server, ownerId: "ownerA")
        let cachedStore = try LocalConversationStore(directory: normalDirectory)
        try await wait {
            (try? await cachedStore.cachedHistory(account: account, conversationKey: "session:session-host",
                hostId: "host-test", sessionId: "session-host"))?.messages.contains { $0.text == "synthetic answer" } == true
        }
        await http.goOffline()
        let offline = try model(http, directory: normalDirectory, credentials: credentialStore)
        await offline.start()
        try check(offline.verificationPending && offline.conversationsCachedAt != nil, "Offline list was not identified as cache")
        let offlineConversation = offline.conversations.first!
        try check(!offlineConversation.running && !offlineConversation.sendAvailable, "Cache asserted live permission/activity")
        await offline.open(offlineConversation)
        try check(offline.historyCachedAt != nil && offline.messages.contains { $0.text == "synthetic answer" }, "Offline original history missing")
        try check(!offline.canSend(offlineConversation), "Offline cache elevated cloud send permission")
        offline.setDraft("offline continuation", for: offlineConversation, accountEpoch: offline.accountEpoch)
        try check(await offline.flushDrafts(), "Offline draft edit failed")
        try check(await http.submitted().count == 1, "Offline reopen posted another command")
        print("PASS offline reopen restores original list/history/intent without claiming live state")
        var policy = ConversationPollingPolicy()
        for _ in 0..<200 {
            try check(policy.delayNanoseconds(madeProgress: false) <= 20_000_000_000,
                      "Quiet polling did not remain bounded")
            try check(ConversationPollingPolicy.remainsVisible(ownerMatches: true, selectedMatches: true,
                foreground: true, cancelled: false), "Old tick limit still terminates a visible task")
        }
        try check(policy.delayNanoseconds(madeProgress: true) == 2_000_000_000, "New events did not reset backoff")
        try check(!ConversationPollingPolicy.remainsVisible(ownerMatches: true, selectedMatches: true,
            foreground: false, cancelled: false), "Background observation remained enabled")
        try check(!ConversationPollingPolicy.remainsVisible(ownerMatches: false, selectedMatches: true,
            foreground: true, cancelled: false), "Changed owner remained enabled")
        print("PASS observation continues beyond old tick boundary with bounded backoff and lifecycle cancellation")

        let lifecycleHTTP = CommandHTTP()
        await lifecycleHTTP.options(holdEnd: true)
        let lifecycle = try model(lifecycleHTTP, directory: base.appendingPathComponent("lifecycle"))
        let lifecycleConversation = try await opened(lifecycle)
        lifecycle.setDraft("visible task", for: lifecycleConversation, accountEpoch: lifecycle.accountEpoch)
        await lifecycle.send(lifecycleConversation, accountEpoch: lifecycle.accountEpoch)
        try await wait { lifecycle.commandRows(for: lifecycleConversation).first?.progress == .running }
        lifecycle.setForeground(false)
        try check(lifecycle.commandRows(for: lifecycleConversation).first?.observationPaused == true,
                  "Background status still claimed current generation")
        let pausedReads = await lifecycleHTTP.eventReadCount()
        await lifecycleHTTP.finishTurn()
        try await Task.sleep(nanoseconds: 25_000_000)
        try check(await lifecycleHTTP.eventReadCount() == pausedReads, "Background kept querying history")
        lifecycle.setForeground(true)
        try await wait { lifecycle.commandRows(for: lifecycleConversation).first?.progress == .completed }
        try check(await lifecycleHTTP.submitted().count == 1, "Foreground resume reposted the command")
        print("PASS actual model pauses reads in background and resumes receipt correlation without re-send")
        let terminalID = lifecycle.commandRows(for: lifecycleConversation).first!.id
        await lifecycleHTTP.forgetReceipt()
        await lifecycle.reconcileSavedRequest(terminalID, accountEpoch: lifecycle.accountEpoch)
        await lifecycle.continueSavedRequest(terminalID, accountEpoch: lifecycle.accountEpoch)
        try check(await lifecycleHTTP.submitted().count == 1,
                  "Known accepted receipt was replayed when registry became unavailable")
        try check(lifecycle.commandRows(for: lifecycleConversation).first?.lookupNotFound == false,
                  "Known accepted request incorrectly offered resume submission")
        print("PASS known accepted receipt never replays after a later registry NOT_FOUND")

        let aRequest = recovered.commandRows(for: recoveredConversation).first!.id
        let otherConversation = recovered.conversations.first { $0.sessionId == "session-other" }!
        await recovered.open(otherConversation)
        recovered.setDraft("same bytes", for: otherConversation, accountEpoch: recovered.accountEpoch)
        let queriesBefore = await absentHTTP.lookupReadCount()
        await recovered.reconcileSavedRequest(aRequest, accountEpoch: recovered.accountEpoch)
        try check(await absentHTTP.lookupReadCount() == queriesBefore, "Old A command queried after selecting B")
        try check(recovered.draftText(for: otherConversation, accountEpoch: recovered.accountEpoch) == "same bytes",
                  "Old A receipt cleared B draft")
        print("PASS old A message action cannot query or clear selected B draft")
        let namespace = "a9-send-" + UUID().uuidString
        let preferences = UserDefaults(suiteName: namespace)!
        defer { preferences.removePersistentDomain(forName: namespace) }
        for mode in RunningMessageMode.allCases {
            let transport = CommandHTTP(); await transport.setRunning()
            let app = try model(transport, directory: base.appendingPathComponent("a9-" + mode.rawValue), preferences: preferences)
            let active = try await opened(app)
            try check(active.running, "Fixture must be running to verify D36")
            app.runningMessageMode = mode
            app.setDraft("synthetic " + mode.rawValue, for: active, accountEpoch: app.accountEpoch)
            await app.send(active, accountEpoch: app.accountEpoch)
            let bytes = await transport.submitted()
            let body = try JSONSerialization.jsonObject(with: bytes[0]) as! [String: String]
            try check(body["intent"] == mode.rawValue, "D36 did not reach the actual command body")
            app.setForeground(false)
        }
        print("PASS D36 account preference reaches actual queue and steer command bodies")
        print("12 controlled send-flow checks passed; real HTTP/model/GUI/Keychain: 0")
    }
}
