import Foundation
import WeftMateCore

private struct Failed: Error { let message: String }
private func check(_ value: Bool, _ message: String) throws { if !value { throw Failed(message: message) } }
private final class Credentials: CredentialStore, @unchecked Sendable {
    private let lock = NSLock(); private var values: [String: Data] = [:]
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
private actor AdoptionHTTP: HTTPTransport {
    var posts: [Data] = []
    var command: [String: String]?
    var profile = "chosen-profile"
    var through = 3
    var active = false
    var loseReply = false
    var discardLostRecord = false
    var reject = false
    var configured = true
    var lookupCalls = 0
    var uncertainLocalTurn = false
    var creating = false
    var pauseLookup = false
    var lookupGate: CheckedContinuation<Void, Never>?
    func options(lose: Bool = false, discard: Bool = false, reject: Bool = false, configured: Bool = true,
                 creating: Bool = false, pauseLookup: Bool = false, uncertainLocalTurn: Bool = false) {
        loseReply = lose; discardLostRecord = discard; self.reject = reject; self.configured = configured
        self.uncertainLocalTurn = uncertainLocalTurn
        self.creating = creating
        self.pauseLookup = pauseLookup
    }
    func changeSequence() { through = 4 }
    func completeCreation() { creating = false }
    func submitted() -> [Data] { posts }
    func lookups() -> Int { lookupCalls }
    func lookupPaused() -> Bool { lookupGate != nil }
    func releaseLookup() { lookupGate?.resume(); lookupGate = nil }
    func projection() -> [String: Any] {
        var result: [String: Any] = ["source": "host", "hostId": "host-test", "conversationId": "original-conversation",
            "syncThroughSeq": through, "status": active ? (creating ? "creating" : "active") : "unbound", "canAdopt": !active && !uncertainLocalTurn, "originalModel": NSNull()]
        if !active && uncertainLocalTurn { result["reasonCode"] = "LOCAL_TURN_UNCONFIRMED" }
        if active {
            result["binding"] = ["conversationId": "original-conversation", "sessionId": "session-adopted", "modelProfileId": profile,
                "revision": 1, "cutoverSyncSeq": 3, "contextHash": String(repeating: "a", count: 64),
                "historyMessageCount": 1, "truncated": false, "omittedImages": 0, "adoptCommandId": "command-adopt"]
        }
        return result
    }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let path = request.url!.path
        var object: [String: Any] = [:]; var status = 200; var headers: [String: String] = [:]
        let auth: [String: Any] = ["account": ["ownerId": "ownerA", "username": "ownerA", "displayName": "Synthetic"],
            "device": ["id": "device-Mac", "name": "Fixture"], "csrfToken": String(repeating: "b", count: 43)]
        switch path {
        case "/personal/v1/auth/login":
            object = auth; headers["set-cookie"] = "wm_personal_session=" + String(repeating: "a", count: 43)
        case "/personal/v1/auth/me": object = auth
        case "/personal/v1/status": object = ["ownerId": "ownerA", "hostId": "host-test"]
        case "/personal/v1/auth/devices": object = ["devices": [["id": "device-Mac", "name": "Fixture", "current": true]]]
        case "/personal/v1/sync/events":
            object = ["events": [["seq": 1, "sourceDeviceId": "source-device", "eventId": "event-created",
                "conversationId": "original-conversation", "kind": "conversation.created", "occurredAt": "2026-10-05T00:00:00Z",
                "payload": ["title": "Original synthetic conversation"]],
                ["seq": 2, "sourceDeviceId": "source-device", "eventId": "event-other", "conversationId": "other-conversation",
                 "kind": "conversation.created", "occurredAt": "2026-10-05T00:00:00Z", "payload": ["title": "Other"]]],
                "nextSeq": through, "hasMore": false]
        case "/personal/v1/sessions":
            object = ["sessions": active && !creating ? [["sessionId": "session-adopted", "title": "Original", "conversationId": "original-conversation",
                "running": false, "sendAvailable": true, "modelProfileId": profile]] : []]
        case "/personal/v1/models":
            object = ["models": [["id": "first-profile", "name": "First", "model": "first-model", "configured": true],
                ["id": "chosen-profile", "name": "Chosen", "model": "chosen-model", "configured": configured]]]
        case "/personal/v1/sync/capabilities": object = ["deviceId": "device-Mac", "platform": "macos", "sharedConversations": 1]
        case "/personal/v1/sync/conversations/original-conversation/shared":
            if request.httpMethod == "POST" {
                let bytes = request.httpBody!; posts.append(bytes)
                let payload = try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
                if uncertainLocalTurn { try check(payload["acknowledgeUncertainLocalTurn"] as? Bool == true, "Uncertain turn submitted without user confirmation") }
                profile = payload["modelProfileId"] as! String
                command = ["commandId": "command-adopt", "requestId": payload["requestId"] as! String,
                    "kind": "session.create", "targetDeviceId": "host-test", "sessionId": "session-adopted",
                    "conversationId": "original-conversation", "state": reject ? "rejected" : "accepted_by_dsh"]
                active = !reject
                if loseReply {
                    loseReply = false
                    if discardLostRecord { command = nil; active = false }
                    throw APIFailure.transport(.timeout)
                }
                object = projection(); object["command"] = command!
            } else { object = projection() }
        case let route where route.hasPrefix("/personal/v1/commands/by-request/"):
            lookupCalls += 1
            if command != nil, pauseLookup {
                pauseLookup = false
                await withCheckedContinuation { lookupGate = $0 }
            }
            if let command { object = ["command": command] }
            else { status = 404; object = ["error": ["code": "NOT_FOUND"]] }
        case "/personal/v1/sessions/session-adopted/events": object = ["events": [], "nextSeq": -1, "hasMore": false]
        case "/personal/v1/sync/conversations/other-conversation/shared":
            object = ["source": "sync", "hostId": "host-test", "conversationId": "other-conversation",
                "syncThroughSeq": through, "status": "unbound", "canAdopt": true, "originalModel": NSNull()]
        case "/personal/v1/auth/logout": object = [:]
        default: throw Failed(message: "Unexpected controlled route")
        }
        return HTTPResponse(status: status, headers: headers, body: try JSONSerialization.data(withJSONObject: object))
    }
}

@main private struct AppleAdoptionChecks {
    @MainActor static func main() async throws {
        let server = try ServerConfiguration(input: "https://unit.weftmate.example:8443")
        let base = URL(fileURLWithPath: CommandLine.arguments[1])
        func model(_ http: AdoptionHTTP, directory: URL) throws -> AppleAppModel {
            let store = try LocalConversationStore(directory: directory)
            return AppleAppModel(client: PersonalClient(credentialStore: Credentials(), transport: http),
                draftPersistence: Drafts(store: store), server: server, commandStore: store,
                endpointStore: try LocalEndpointOperationStore(directory: directory))
        }
        func open(_ model: AppleAppModel) async throws -> ConversationSummary {
            await model.authenticate(username: "ownerA", password: "synthetic-test-only", displayName: nil, register: false)
            guard let conversation = model.conversations.first(where: { $0.conversationId == "original-conversation" }) else { throw Failed(message: "Missing original record") }
            await model.open(conversation); return conversation
        }

        let http = AdoptionHTTP()
        let first = try model(http, directory: base.appendingPathComponent("choice"))
        let conversation = try await open(first)
        try check(await http.submitted().isEmpty && first.sendTargets.isEmpty, "Open automatically picked a model/adopted")
        try check(first.adoptionChoices[AppleAppModel.draftKey(for: conversation)]?.count == 2, "Explicit candidates missing")
        await first.adopt(conversation, profileID: "chosen-profile", accountEpoch: first.accountEpoch)
        let bytes = await http.submitted().first!
        let body = try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
        try check(body["modelProfileId"] as? String == "chosen-profile", "Directory first item replaced explicit choice")
        try check(first.adoptionRows(for: conversation).first?.record.lastReceiptBindingMatched == true &&
            first.sendTargets[AppleAppModel.draftKey(for: conversation)]?.modelProfileID == "chosen-profile", "Active binding not freshly rechecked")
        print("PASS no default model, exact explicit choice and fresh active projection")

        let lostHTTP = AdoptionHTTP(); await lostHTTP.options(lose: true)
        let lostDirectory = base.appendingPathComponent("lost-found")
        let lost = try model(lostHTTP, directory: lostDirectory)
        let lostConversation = try await open(lost)
        await lost.adopt(lostConversation, profileID: "chosen-profile", accountEpoch: lost.accountEpoch)
        try check(lost.adoptionRows(for: lostConversation).first?.record.state == .uncertain, "Lost reply claimed known adoption")
        let originalID = lost.adoptionRows(for: lostConversation).first!.id
        let reopened = try model(lostHTTP, directory: lostDirectory)
        let reopenedConversation = try await open(reopened)
        try check(reopened.adoptionRows(for: reopenedConversation).first?.id == originalID &&
            reopened.adoptionRows(for: reopenedConversation).first?.freshlyVerified == true, "Restart lost original identity/projection lookup")
        try check(await lostHTTP.submitted().count == 1, "Restart automatically re-adopted")
        print("PASS unknown restart only looks up original adoption ID")

        let absentHTTP = AdoptionHTTP(); await absentHTTP.options(lose: true, discard: true)
        let absentDirectory = base.appendingPathComponent("lost-absent")
        let absent = try model(absentHTTP, directory: absentDirectory)
        let absentConversation = try await open(absent)
        await absent.adopt(absentConversation, profileID: "chosen-profile", accountEpoch: absent.accountEpoch)
        let retry = try model(absentHTTP, directory: absentDirectory)
        let retryConversation = try await open(retry)
        let row = retry.adoptionRows(for: retryConversation).first!
        let missingPostCount = await absentHTTP.submitted().count
        try check(row.lookupNotFound && missingPostCount == 1, "Lookup-only missing request submitted")
        await retry.continueAdoptionRequest(row.id, accountEpoch: retry.accountEpoch)
        let retries = await absentHTTP.submitted()
        try check(retries.count == 2 && retries[0] == retries[1], "Explicit retry changed adoption ID/body")
        print("PASS explicit adoption retry preserves exact bytes after NOT_FOUND")

        let changedHTTP = AdoptionHTTP()
        let changed = try model(changedHTTP, directory: base.appendingPathComponent("sequence"))
        let changedConversation = try await open(changed)
        await changedHTTP.changeSequence()
        await changed.adopt(changedConversation, profileID: "chosen-profile", accountEpoch: changed.accountEpoch)
        try check(await changedHTTP.submitted().isEmpty, "Changed sync context was submitted with stale body")
        try check(changed.adoptionRows(for: changedConversation).first?.record.state == .rejected &&
            changed.adoptionRows(for: changedConversation).first?.record.intent.expectedSyncSeq == 3, "Conflict rewrote immutable context")
        print("PASS sync conflict preserves rejected original body without new automatic request")

        let rejectedHTTP = AdoptionHTTP(); await rejectedHTTP.options(reject: true)
        let rejected = try model(rejectedHTTP, directory: base.appendingPathComponent("rejected"))
        let rejectedConversation = try await open(rejected)
        await rejected.adopt(rejectedConversation, profileID: "chosen-profile", accountEpoch: rejected.accountEpoch)
        let rejectedRow = rejected.adoptionRows(for: rejectedConversation).first!
        try check(rejectedRow.record.validationLevel == .rejectedCommandOnly && !rejectedRow.record.lastReceiptBindingMatched &&
            rejected.sendTargets.isEmpty, "Rejected-command-only became an active profile proof")
        print("PASS rejected command does not prove an active binding")

        let configuredHTTP = AdoptionHTTP(); await configuredHTTP.options(configured: false)
        let configured = try model(configuredHTTP, directory: base.appendingPathComponent("unconfigured"))
        let configuredConversation = try await open(configured)
        await configured.adopt(configuredConversation, profileID: "chosen-profile", accountEpoch: configured.accountEpoch)
        try check(await configuredHTTP.submitted().isEmpty, "Unconfigured selection was adopted")
        print("PASS unavailable profile cannot be selected through a stale action")

        let creatingHTTP = AdoptionHTTP(); await creatingHTTP.options(creating: true)
        let creating = try model(creatingHTTP, directory: base.appendingPathComponent("creating"))
        let creatingConversation = try await open(creating)
        await creating.adopt(creatingConversation, profileID: "chosen-profile", accountEpoch: creating.accountEpoch)
        try check(creating.adoptionRows(for: creatingConversation).first?.record.state == .accepted && creating.sendTargets.isEmpty,
                  "Accepted creation became ready before active projection")
        creating.setForeground(false)
        await creatingHTTP.completeCreation()
        try check(creating.adoptionRows(for: creatingConversation).first?.freshlyVerified == false, "Background called saved projection current")
        creating.setForeground(true)
        let deadline = Date().addingTimeInterval(4)
        while creating.sendTargets.isEmpty, Date() < deadline { try await Task.sleep(nanoseconds: 5_000_000) }
        if creating.sendTargets.isEmpty {
            print("Creating restore diagnostic: " + (creating.adoptionRows(for: creatingConversation).first?.note ?? "no note"))
            print("Continuation diagnostic: " + (creating.continuationNotices[AppleAppModel.draftKey(for: creatingConversation)] ?? "no continuation notice"))
            fflush(stdout)
        }
        try check(creating.sendTargets[AppleAppModel.draftKey(for: creatingConversation)]?.modelProfileID == "chosen-profile", "Foreground failed fresh projection recheck")
        try check(await creatingHTTP.submitted().count == 1, "Creating foreground resume re-posted adoption")
        print("PASS accepted creation waits for active projection; foreground resumes lookup without second POST")

        let staleHTTP = AdoptionHTTP(); await staleHTTP.options(lose: true, discard: true)
        let staleDirectory = base.appendingPathComponent("stale-target")
        let staleOriginal = try model(staleHTTP, directory: staleDirectory)
        let staleConversation = try await open(staleOriginal)
        await staleOriginal.adopt(staleConversation, profileID: "chosen-profile", accountEpoch: staleOriginal.accountEpoch)
        let stale = try model(staleHTTP, directory: staleDirectory)
        let staleRestoredConversation = try await open(stale)
        let staleRow = stale.adoptionRows(for: staleRestoredConversation).first!
        try check(staleRow.lookupNotFound && staleRow.record.knownCommandId == nil, "Fixture did not have resumable A request")
        guard let other = stale.conversations.first(where: { $0.conversationId == "other-conversation" }) else {
            throw Failed(message: "Other same-owner conversation missing")
        }
        await stale.open(other)
        let lookupsBefore = await staleHTTP.lookups()
        let postsBefore = await staleHTTP.submitted().count
        await stale.reconcileAdoptionRequest(staleRow.id, accountEpoch: stale.accountEpoch)
        await stale.continueAdoptionRequest(staleRow.id, accountEpoch: stale.accountEpoch)
        try check(await staleHTTP.lookups() == lookupsBefore, "Old A action queried while B selected")
        try check(await staleHTTP.submitted().count == postsBefore, "Old A action posted while B selected")
        try check(stale.sendTargets[AppleAppModel.draftKey(for: other)] == nil,
                  "A receipt granted B model qualification")
        print("PASS stale A adoption actions cannot query, submit or qualify selected B")

        let inflightHTTP = AdoptionHTTP(); await inflightHTTP.options(creating: true, pauseLookup: true)
        let inflight = try model(inflightHTTP, directory: base.appendingPathComponent("inflight-lifecycle"))
        let inflightConversation = try await open(inflight)
        await inflight.adopt(inflightConversation, profileID: "chosen-profile", accountEpoch: inflight.accountEpoch)
        let pauseDeadline = Date().addingTimeInterval(2)
        while !(await inflightHTTP.lookupPaused()), Date() < pauseDeadline { try await Task.sleep(nanoseconds: 2_000_000) }
        try check(await inflightHTTP.lookupPaused(), "Old observer did not enter inflight fixture")
        inflight.setForeground(false)
        await inflightHTTP.completeCreation()
        inflight.setForeground(true)
        let priorLookups = await inflightHTTP.lookups()
        try await Task.sleep(nanoseconds: 15_000_000)
        try check(await inflightHTTP.lookups() == priorLookups, "New observer overlapped old request lock")
        await inflightHTTP.releaseLookup()
        let activeDeadline = Date().addingTimeInterval(2)
        while inflight.sendTargets.isEmpty, Date() < activeDeadline { try await Task.sleep(nanoseconds: 2_000_000) }
        try check(inflight.sendTargets[AppleAppModel.draftKey(for: inflightConversation)] != nil,
                  "Serialized observer restart failed to establish fresh binding")
        try check(await inflightHTTP.submitted().count == 1, "Observer lock recovery re-posted adoption")
        print("PASS foreground observer waits for retired inflight request without overlapping SDK lock")
        let uncertainHTTP = AdoptionHTTP(); await uncertainHTTP.options(uncertainLocalTurn: true)
        let uncertain = try model(uncertainHTTP, directory: base.appendingPathComponent("uncertain-local-turn"))
        let uncertainConversation = try await open(uncertain)
        try check(uncertain.canAdopt(uncertainConversation) && uncertain.adoptionNeedsConfirmation(uncertainConversation),
            "Uncertain local turn lacked confirmation path")
        await uncertain.adopt(uncertainConversation, profileID: "chosen-profile", accountEpoch: uncertain.accountEpoch)
        try check(await uncertainHTTP.submitted().isEmpty && uncertain.adoptionRows(for: uncertainConversation).isEmpty,
            "Unconfirmed user action persisted or submitted adoption")
        await uncertain.adopt(uncertainConversation, profileID: "chosen-profile", accountEpoch: uncertain.accountEpoch,
            acknowledgeUncertainLocalTurn: true)
        let uncertainPosts = await uncertainHTTP.submitted()
        try check(uncertainPosts.count == 1 &&
            (try JSONSerialization.jsonObject(with: uncertainPosts[0]) as! [String: Any])["acknowledgeUncertainLocalTurn"] as? Bool == true,
            "Explicit confirmation was not transmitted")
        try check(uncertain.adoptionRows(for: uncertainConversation).first?.record.intent.acknowledgeUncertainLocalTurn == true,
            "Journal lost confirmation for replay")
        print("PASS uncertain local turn: explicit confirmation required before persistence and HTTP; confirmation survives journal")
        print("10 controlled adoption-flow checks passed; actual HTTP/model/GUI/Keychain: 0")
    }
}
