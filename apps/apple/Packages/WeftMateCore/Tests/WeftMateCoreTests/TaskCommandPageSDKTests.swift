import Foundation
import Testing
@testable import WeftMateCore

private let directoryOrigin = "https://directory.unit.weftmate.example:8443"
private func directoryJSON(_ fields: [String: Any], status: Int = 200) -> HTTPResponse { .init(status: status, body: try! JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys])) }
private func directoryAuth(_ owner: String = "owner-A", device: String = "device-Mac") -> HTTPResponse {
    let fields: [String: Any] = ["account": ["ownerId": owner, "username": "test", "displayName": "Test"], "device": ["id": device, "name": "Mac"], "csrfToken": String(repeating: "b", count: 43)]
    return .init(status: 200, headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)], body: directoryJSON(fields).body)
}
private func directoryRow(_ id: String, time: String = "2026-10-05T01:00:00.000Z", changes: [String: Any] = [:]) -> [String: Any] {
    var row: [String: Any] = ["commandId": id, "requestId": "request-\(id)", "targetDeviceId": "host-test", "kind": "session.message",
        "state": "accepted_by_dsh", "sessionId": "session-test", "createdAt": time, "updatedAt": time, "receiptId": "receipt-\(id)"]
    for (key, value) in changes { row[key] = value }; return row
}
private func directoryPage(_ rows: [[String: Any]], next: String? = nil) -> HTTPResponse {
    directoryJSON(["commands": rows, "hasMore": next != nil, "nextBefore": next as Any? ?? NSNull()])
}
private actor DirectoryScriptTransport: HTTPTransport {
    struct Step: Sendable { let path: String; let response: HTTPResponse; var method = "GET"; var pause = false }
    private var steps: [Step]; private var seen: [URLRequest] = []; private var paused: CheckedContinuation<Void, Never>?
    init(_ steps: [Step]) { self.steps = steps }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        seen.append(request); guard !steps.isEmpty else { throw APIFailure.invalidResponse }; let step = steps.removeFirst()
        let path = (request.url?.path ?? "") + (request.url?.query.map { "?" + $0 } ?? "")
        guard path == "/personal/v1" + step.path, request.httpMethod == step.method else { throw APIFailure.invalidResponse }
        if step.pause { await withCheckedContinuation { paused = $0 } }; return step.response
    }
    func waitUntilPaused() async { while paused == nil { await Task.yield() } }
    func release() { paused?.resume(); paused = nil }
    func requests() -> [URLRequest] { seen }
}
private func directoryLoginSteps() -> [DirectoryScriptTransport.Step] {
    [.init(path: "/auth/login", response: directoryAuth(), method: "POST"), .init(path: "/status", response: directoryJSON(["ownerId": "owner-A", "hostId": "host-test"]))]
}
private func directoryLogin(_ client: PersonalClient) async throws -> AccountSession {
    try await client.login(server: ServerConfiguration(input: directoryOrigin), username: "test", password: "synthetic-only", deviceName: "Mac")
}
private func directoryScope() -> TaskReadScope {
    TaskReadScope(AccountSession(server: try! ServerConfiguration(input: directoryOrigin), account: AccountProfile(ownerId: "owner-A", username: "test", displayName: "Test", profileRevision: nil),
        device: DeviceRecord(id: "device-Mac", name: "Mac"), hostId: "host-test", verification: .verified))
}

struct TaskCommandPageSDKTests {
    @Test func emptyLocalLedgerStillReadsServerRootsAndIgnoresUnrelatedFutureDetails() async throws {
        let rows = [directoryRow("cmd-z"),
            directoryRow("cmd-y", changes: ["kind": "session.create", "sessionId": NSNull(), "state": "pending", "verification": ["futureMalformed": 42]]),
            directoryRow("cmd-x", changes: ["kind": "desktop.future_tool", "state": "future_state", "verification": 42, "sessionId": 123]),
            directoryRow("cmd-w", changes: ["sessionId": "other-session"]),
            directoryRow("cmd-v", changes: ["rootTaskId": "cmd-z", "taskAction": "supplement"]),
            directoryRow("cmd-u", changes: ["targetDeviceId": "other-host"])]
        let transport = DirectoryScriptTransport(directoryLoginSteps() + [.init(path: "/auth/me", response: directoryAuth()), .init(path: "/commands?limit=50", response: directoryPage(rows))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); _ = try await directoryLogin(client)
        let page = try await client.taskCommands(sessionID: "session-test")
        #expect(page.rootCommands.map(\.commandId) == ["cmd-z"] && page.scannedCount == 6 && !page.hasMore)
        #expect(await transport.requests().count == 4)
        #expect(await transport.requests().allSatisfy { !($0.url?.path.hasPrefix("/personal/v1/tasks/") ?? false) })
    }

    @Test func filteredEmptyPageKeepsGlobalRawCursorAndRequiresExplicitMore() async throws {
        let first = directoryPage([directoryRow("cmd-z", changes: ["sessionId": "other-session"])], next: "cmd-z")
        let transport = DirectoryScriptTransport(directoryLoginSteps() + [.init(path: "/auth/me", response: directoryAuth()), .init(path: "/commands?limit=50", response: first),
            .init(path: "/auth/me", response: directoryAuth()), .init(path: "/commands?before=cmd-z&limit=50", response: directoryPage([directoryRow("cmd-y")]))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); _ = try await directoryLogin(client)
        let page = try await client.taskCommands(sessionID: "session-test")
        #expect(page.rootCommands.isEmpty && page.hasMore && page.nextCursor != nil)
        #expect(await transport.requests().count == 4)
        let next = try await client.taskCommands(sessionID: "session-test", before: page.nextCursor)
        #expect(next.rootCommands.first?.commandId == "cmd-y" && !next.hasMore)
    }

    @Test func nextBeforeDuplicatesAndOrderingCannotLieAboutPagination() throws {
        for response in [directoryPage([directoryRow("cmd-z")], next: "cmd-other"), directoryPage([], next: "cmd-z"),
            directoryPage([directoryRow("cmd-z"), directoryRow("cmd-z")]), directoryPage([directoryRow("cmd-a"), directoryRow("cmd-z")])] {
            #expect(throws: APIFailure.invalidResponse) { try TaskCommandPage.decode(response.body, scope: directoryScope(), sessionID: "session-test", limit: 50, previous: nil) }
        }
        let first = try TaskCommandPage.decode(directoryPage([directoryRow("cmd-z")], next: "cmd-z").body, scope: directoryScope(), sessionID: "session-test", limit: 50, previous: nil)
        #expect(throws: APIFailure.invalidResponse) { try TaskCommandPage.decode(directoryPage([directoryRow("cmd-z")]).body, scope: directoryScope(), sessionID: "session-test", limit: 50, previous: first.nextCursor) }
        #expect(throws: APIFailure.invalidResponse) { try TaskCommandPage.decode(directoryPage([directoryRow("cmd-new", time: "2026-10-05T02:00:00.000Z")]).body, scope: directoryScope(), sessionID: "session-test", limit: 50, previous: first.nextCursor) }
    }

    @Test func unsupportedRootStateIsExplicitAndNotACompletedTask() throws {
        let page = try TaskCommandPage.decode(directoryPage([directoryRow("cmd-z", changes: ["state": "future_state"])]).body,
            scope: directoryScope(), sessionID: "session-test", limit: 50, previous: nil)
        #expect(page.rootCommands.isEmpty && page.unsupportedRootCount == 1 && !page.hasMore)
    }

    @Test func typedCursorCannotCrossSessionOrAccountBeforeRequest() async throws {
        let transport = DirectoryScriptTransport(directoryLoginSteps() + [.init(path: "/auth/me", response: directoryAuth()), .init(path: "/commands?limit=50", response: directoryPage([directoryRow("cmd-z")], next: "cmd-z")),
            .init(path: "/auth/logout", response: directoryJSON([:]), method: "POST"), .init(path: "/auth/login", response: directoryAuth("owner-B", device: "device-B"), method: "POST"),
            .init(path: "/status", response: directoryJSON(["ownerId": "owner-B", "hostId": "host-test"]))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); _ = try await directoryLogin(client)
        let page = try await client.taskCommands(sessionID: "session-test"); let count = await transport.requests().count
        await #expect(throws: APIFailure.invalidResponse) { try await client.taskCommands(sessionID: "other-session", before: page.nextCursor) }
        #expect(await transport.requests().count == count)
        try await client.logout(); _ = try await directoryLogin(client); let switchedCount = await transport.requests().count
        await #expect(throws: APIFailure.accountChanged) { try await client.taskCommands(sessionID: "session-test", before: page.nextCursor) }
        #expect(await transport.requests().count == switchedCount)
    }

    @Test func cancelledPageNeverPublishesOrLoadsAnotherPage() async throws {
        let transport = DirectoryScriptTransport(directoryLoginSteps() + [.init(path: "/auth/me", response: directoryAuth()),
            .init(path: "/commands?limit=50", response: directoryPage([directoryRow("cmd-z")], next: "cmd-z"), pause: true)])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); _ = try await directoryLogin(client)
        let operation = Task { try await client.taskCommands(sessionID: "session-test") }
        await transport.waitUntilPaused(); operation.cancel(); await transport.release()
        await #expect(throws: CancellationError.self) { try await operation.value }
        #expect(await transport.requests().count == 4)
    }

    @Test func invalidLimitsIdentifiersTimesAndBodySizeFailClosed() async throws {
        let transport = DirectoryScriptTransport(directoryLoginSteps()); let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); _ = try await directoryLogin(client)
        await #expect(throws: APIFailure.invalidResponse) { try await client.taskCommands(sessionID: "../escape") }
        await #expect(throws: APIFailure.invalidResponse) { try await client.taskCommands(sessionID: "session-test", limit: 101) }
        #expect(await transport.requests().count == 2)
        for changes in [["commandId": "../escape"], ["createdAt": "bad-time"], ["requestId": "bad/request"], ["targetDeviceId": "bad/host"]] {
            #expect(throws: APIFailure.invalidResponse) { try TaskCommandPage.decode(directoryPage([directoryRow("cmd-z", changes: changes)]).body, scope: directoryScope(), sessionID: "session-test", limit: 50, previous: nil) }
        }
        #expect(throws: APIFailure.responseTooLarge) { try TaskCommandPage.decode(Data(repeating: 32, count: 1_048_577), scope: directoryScope(), sessionID: "session-test", limit: 50, previous: nil) }
    }

    @Test func lateOwnerPageAndServerMissingCursorAreNotEmptySuccess() async throws {
        let transport = DirectoryScriptTransport(directoryLoginSteps() + [.init(path: "/auth/me", response: directoryAuth()),
            .init(path: "/commands?limit=50", response: directoryPage([directoryRow("cmd-z")]), pause: true),
            .init(path: "/auth/logout", response: directoryJSON([:]), method: "POST"), .init(path: "/auth/login", response: directoryAuth("owner-B", device: "device-B"), method: "POST"),
            .init(path: "/status", response: directoryJSON(["ownerId": "owner-B", "hostId": "host-test"]))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); _ = try await directoryLogin(client)
        let operation = Task { try await client.taskCommands(sessionID: "session-test") }
        await transport.waitUntilPaused(); try await client.logout(); _ = try await directoryLogin(client); await transport.release()
        await #expect(throws: APIFailure.accountChanged) { try await operation.value }
        let missing = DirectoryScriptTransport(directoryLoginSteps() + [.init(path: "/auth/me", response: directoryAuth()),
            .init(path: "/commands?limit=50", response: directoryJSON(["error": ["code": "NOT_FOUND"]], status: 404))])
        let fresh = PersonalClient(credentialStore: MemoryStore(), transport: missing); _ = try await directoryLogin(fresh)
        await #expect(throws: APIFailure.server(status: 404, code: "NOT_FOUND")) { try await fresh.taskCommands(sessionID: "session-test") }
    }
}
