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
private actor ReadOnlyHTTP: HTTPTransport {
    private var writes = 0
    func mutationCount() -> Int { writes }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let path = request.url!.path
        let auth: [String: Any] = ["account": ["ownerId": "owner-A", "username": "test", "displayName": "Synthetic"],
            "device": ["id": "device-Mac", "name": "Fixture"], "csrfToken": String(repeating: "b", count: 43)]
        var object: [String: Any] = [:]
        var headers: [String: String] = [:]
        switch path {
        case "/personal/v1/auth/login": object = auth; headers["set-cookie"] = "wm_personal_session=" + String(repeating: "a", count: 43)
        case "/personal/v1/auth/me": object = auth
        case "/personal/v1/status": object = ["ownerId": "owner-A", "hostId": "host-test", "backend": ["capabilities": ["desktopOpenApp": ["available": true]]]]
        case "/personal/v1/auth/devices": object = ["devices": [["id": "device-Mac", "name": "Fixture", "current": true]]]
        case "/personal/v1/sync/capabilities": object = ["deviceId": "device-Mac", "platform": "macos", "sharedConversations": 1]
        case "/personal/v1/sync/events": object = ["events": [], "nextSeq": 0, "hasMore": false]
        case "/personal/v1/session-groups": object = ["groups": []]
        case "/personal/v1/sessions":
            object = ["sessions": [
                ["sessionId": "session-remote", "title": "From another device", "running": false, "sendAvailable": true],
                ["sessionId": "session-other", "title": "Other", "running": false, "sendAvailable": true]]]
        case "/personal/v1/sessions/session-remote/events", "/personal/v1/sessions/session-other/events":
            object = ["events": [], "nextSeq": -1, "hasMore": false]
        default:
            if request.httpMethod != "GET" { writes += 1 }
            throw Failed(message: "Unexpected task-entry request")
        }
        return .init(status: 200, headers: headers, body: try JSONSerialization.data(withJSONObject: object))
    }
}
@main private struct AppleTaskEntryChecks {
    @MainActor static func main() async throws {
        let directory = URL(fileURLWithPath: CommandLine.arguments[1])
        let store = try LocalConversationStore(directory: directory)
        let http = ReadOnlyHTTP()
        let model = AppleAppModel(client: PersonalClient(credentialStore: Credentials(), transport: http),
            draftPersistence: Drafts(store: store), server: try ServerConfiguration(input: "https://task-entry.unit.example:8443"),
            commandStore: store, endpointStore: try LocalEndpointOperationStore(directory: directory))
        await model.authenticate(username: "test", password: "synthetic-only", displayName: nil, register: false)
        guard let original = model.conversations.first(where: { $0.sessionId == "session-remote" }),
              let other = model.conversations.first(where: { $0.sessionId == "session-other" }) else { throw Failed(message: "Remote session metadata missing") }
        await model.open(original)
        let epoch = model.accountEpoch
        try check(model.commandRows(for: original).isEmpty && model.sendTargets.isEmpty && !model.canSend(original),
            "Controlled fixture unexpectedly has local commands or send eligibility")
        try check(model.taskSessionID(for: original, accountEpoch: epoch) == "session-remote",
            "No-ledger remote conversation task entry required model/send readiness")
        try check(model.taskSessionID(for: original, accountEpoch: UUID()) == nil,
            "Old account epoch opened task directory")
        await model.open(other)
        try check(model.taskSessionID(for: original, accountEpoch: epoch) == nil &&
            model.taskSessionID(for: other, accountEpoch: epoch) == "session-other", "Task entry retargeted stale selected conversation")
        model.closeConversation()
        try check(model.taskSessionID(for: other, accountEpoch: epoch) == nil, "Closed conversation retained task navigation eligibility")
        try check(await http.mutationCount() == 0, "Read-only navigation wrote a command or adopted model")
        print("PASS actual AppleAppModel: remote task session available with no local ledger/model/send readiness; selected conversation/epoch/close guards")
        print("1 controlled task-entry workflow passed; actual HTTP/model/GUI/Keychain: 0")
    }
}
