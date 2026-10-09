import Foundation
import WeftMateCore

private struct Failed: Error { let message: String }
private func check(_ condition: Bool, _ message: String) throws { if !condition { throw Failed(message: message) } }
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
private actor HTTP: HTTPTransport {
    var offline = false
    var paused = false
    var paths: [String] = []
    var continuation: CheckedContinuation<Void, Never>?
    func setOffline() { offline = true }
    func pauseOlder() { paused = true }
    func release() { continuation?.resume(); continuation = nil }
    func waitForPause() async { while continuation == nil { await Task.yield() } }
    func requests() -> [String] { paths }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        guard !offline else { throw APIFailure.transport(.unavailable) }
        let path = request.url!.path, query = request.url!.query ?? ""
        paths.append(path + "?" + query)
        let auth: [String: Any] = ["account": ["ownerId": "owner-fixture", "username": "tester", "displayName": "Synthetic"],
            "device": ["id": "device-fixture", "name": "Fixture"], "csrfToken": String(repeating: "b", count: 43)]
        var object: [String: Any] = [:], headers: [String: String] = [:]
        switch path {
        case "/personal/v1/auth/login": object = auth; headers["set-cookie"] = "wm_personal_session=" + String(repeating: "a", count: 43)
        case "/personal/v1/auth/me": object = auth
        case "/personal/v1/status": object = ["ownerId": "owner-fixture", "hostId": "host-fixture"]
        case "/personal/v1/auth/devices": object = ["devices": [["id": "device-fixture", "name": "Fixture", "current": true]]]
        case "/personal/v1/sync/capabilities": object = ["deviceId": "device-fixture", "platform": "macos", "sharedConversations": 1]
        case "/personal/v1/sync/events": object = ["events": [], "nextSeq": 0, "hasMore": false]
        case "/personal/v1/session-groups": object = ["groups": []]
        case "/personal/v1/sessions": object = ["sessions": [["sessionId": "session-fixture", "title": "Synthetic", "running": false, "sendAvailable": true]]]
        case "/personal/v1/models": object = ["models": []]
        case "/personal/v1/sessions/session-fixture/events":
            let params = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems ?? []
            let before = params.first { $0.name == "beforeSeq" }?.value.flatMap(Int.init)
            let after = params.first { $0.name == "afterSeq" }?.value.flatMap(Int.init)
            if before != nil && paused { await withCheckedContinuation { continuation = $0 } }
            let seqs: [Int] = before.map { Array(($0 - 100)..<$0) } ?? (after == nil ? Array(22000..<22100) : [])
            object = ["events": seqs.map { ["seq": $0, "type": "assistant.message", "data": ["text": "record \($0)"]] },
                "nextSeq": before == nil && after == nil ? 22099 : 30000, "hasMore": false,
                "hasOlder": before != nil || after == nil, "nextBeforeSeq": seqs.first.map { $0 as Any } ?? NSNull(), "latestSeq": 30000]
        default: throw APIFailure.invalidResponse
        }
        return .init(status: 200, headers: headers, body: try JSONSerialization.data(withJSONObject: object))
    }
}
@main private struct AppleTimelineStateChecks {
    @MainActor static func main() async throws {
        let directory = URL(fileURLWithPath: CommandLine.arguments[1]), http = HTTP()
        let store = try LocalConversationStore(directory: directory)
        let model = AppleAppModel(client: PersonalClient(credentialStore: Credentials(), transport: http),
            draftPersistence: Drafts(store: store), server: try ServerConfiguration(input: "https://timeline-state.unit.example"),
            commandStore: store, stateDirectory: directory)
        await model.authenticate(username: "tester", password: "synthetic-test-only", displayName: nil, register: false)
        guard let conversation = model.conversations.first else { throw Failed(message: "No fixture conversation") }
        await model.open(conversation)
        try check(model.timeline.events.count == 100 && model.timeline.events.first?.seq == 22000,
                  "Opening a long session did not read only its tail")
        await model.loadOlder(conversation)
        try check(model.timeline.events.count == 200 && model.timeline.nextSeq == 22099 && model.timeline.beforeSeq == 21900,
                  "Older metadata overwrote the forward cursor")
        let poll = Task { await model.pollTimeline(conversation) }
        while model.timeline.nextSeq < 30000 { await Task.yield() }
        poll.cancel(); await poll.value
        try check(model.timeline.events.count == 200, "Empty increment appended messages")
        let paths = await http.requests()
        try check(paths.contains("/personal/v1/sessions/session-fixture/events?limit=100") &&
                  paths.contains("/personal/v1/sessions/session-fixture/events?beforeSeq=22000&limit=100") &&
                  paths.contains("/personal/v1/sessions/session-fixture/events?afterSeq=22099&limit=100") &&
                  !paths.contains(where: { $0.contains("afterSeq=-1") }), "Wrong timeline request direction")
        await http.pauseOlder()
        let pending = Task { await model.loadOlder(conversation) }
        await http.waitForPause(); model.closeConversation(); await http.release(); await pending.value
        try check(model.timeline.events.isEmpty && model.messages.isEmpty, "Late older callback published to a closed conversation")
        await http.setOffline(); await model.open(conversation)
        try check(model.historyCachedAt != nil && model.timeline.events.count == 100 && model.timeline.hasOlder,
                  "Offline reopening did not use the cached tail")
        await model.loadOlder(conversation)
        try check(model.timeline.events.count == 200 && !model.timeline.hasOlder, "Offline upward paging lost cached events")
        let resources = ConversationResourcesModel(app: model, sessionID: "session-fixture")
        let output = ResourceTab.output("artifact-a", "result.txt"), source = ResourceTab.source("tool:read", "read")
        resources.open(output); resources.open(source); resources.open(output)
        try check(resources.tabs.count == 2 && resources.selected == output.id, "Reopening a resource duplicated its tab")
        resources.visible = false; resources.open(source)
        try check(resources.tabs.count == 2 && resources.visible && resources.selected == source.id, "Collapsing the panel lost tabs")
        resources.close(output.id)
        try check(resources.tabs.count == 1 && resources.selected == source.id, "Closing an inactive tab lost selection")
        resources.close(source.id)
        try check(resources.tabs.isEmpty && !resources.visible && resources.selected == nil, "Closing the last tab did not close the panel")
        resources.open(output)
        await model.signOut()
        try check(model.session == nil && !resources.current, "Sign-out did not retire the account scope")
        resources.clear(); resources.open(source)
        try check(resources.tabs.isEmpty && !resources.visible, "Previous account could reopen a resource tab")
        print("PASS resource tabs: dedupe; independent close; collapse/reopen; last tab; account isolation")
        print("PASS AppleAppModel: tail-only open beyond 22,000; before/after cursors; empty increment; stale older callback; offline tail/upward cache")
    }
}
