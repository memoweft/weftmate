// Controlled cross-device directory checks. The real SDK reads synthetic authenticated metadata; no local ledger exists.
import Foundation
import WeftMateCore

private struct DirectoryCheckFailure: Error { let message: String }
private func requireDirectory(_ condition: Bool, _ message: String) throws {
    if !condition { throw DirectoryCheckFailure(message: message) }
}
private final class DirectoryCredentials: CredentialStore, @unchecked Sendable {
    private let lock = NSLock(); private var items: [String: Data] = [:]
    func load(key: String) -> Data? { lock.withLock { items[key] } }
    func save(_ data: Data, key: String) { lock.withLock { items[key] = data } }
    func delete(key: String) { lock.withLock { items[key] = nil } }
}
private actor DirectoryHTTP: HTTPTransport {
    var pages: [Data] = []
    var requestedBefore: [String?] = []
    var paths: [String] = []
    var pauseNext = false
    var gate: CheckedContinuation<Void, Never>?
    var cancelledRequests = 0
    var denied = false
    var lastCommandPath: String?
    func setPages(_ pages: [Data]) { self.pages = pages }
    func deny() { denied = true }
    func pause() { pauseNext = true }
    func release() { gate?.resume(); gate = nil }
    func awaitPause() async throws {
        for _ in 0..<1_000 { if gate != nil { return }; try await Task.sleep(nanoseconds: 1_000_000) }
        throw DirectoryCheckFailure(message: "Directory request did not reach controlled pause")
    }
    func counts() -> (commands: Int, details: Int, cancellations: Int) {
        (requestedBefore.count, paths.filter { $0.contains("/tasks/") || $0.contains("/artifacts/") }.count, cancelledRequests)
    }
    func cursors() -> [String?] { requestedBefore }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let path = request.url!.path; paths.append(path)
        if path == "/personal/v1/auth/login" {
            return try response(auth(), headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)])
        }
        guard request.httpMethod == "GET" else { throw DirectoryCheckFailure(message: "Directory attempted a mutation") }
        switch path {
        case "/personal/v1/status": return try response(["ownerId": "owner_A", "hostId": "host_A"])
        case "/personal/v1/auth/me":
            return denied ? try response(["error": ["code": "UNAUTHORIZED"]], status: 401) : try response(auth())
        case "/personal/v1/commands":
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems ?? []
            let before = query.first { $0.name == "before" }?.value
            try requireDirectory(query.first { $0.name == "limit" }?.value == "50", "Unbounded or unexpected directory page size")
            requestedBefore.append(before); lastCommandPath = request.url!.absoluteString
            guard !pages.isEmpty else { throw DirectoryCheckFailure(message: "Directory automatically requested another page") }
            let bytes = pages.removeFirst()
            if pauseNext {
                pauseNext = false; await withCheckedContinuation { gate = $0 }
                if Task.isCancelled { cancelledRequests += 1 }
            }
            return .init(status: 200, body: bytes)
        default: throw DirectoryCheckFailure(message: "Directory fetched a task body or unknown route: " + path)
        }
    }
    private func auth() -> [String: Any] {
        ["account": ["ownerId": "owner_A", "username": "fixture", "displayName": "Fixture"],
         "device": ["id": "device_A", "name": "Fixture Mac"], "csrfToken": String(repeating: "b", count: 43)]
    }
    private func response(_ value: [String: Any], status: Int = 200, headers: [String: String] = [:]) throws -> HTTPResponse {
        .init(status: status, headers: headers, body: try JSONSerialization.data(withJSONObject: value))
    }
}
@MainActor private final class DirectoryContext { var epoch = UUID(); var session: AccountSession? }
private func directoryRow(_ id: String, index: Int, session: String? = "session_A", host: String = "host_A",
                          kind: String = "session.message", state: String = "accepted_by_dsh", root: String? = nil) -> [String: Any] {
    let date = ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: 1_759_622_400 - Double(index)))
    var row: [String: Any] = ["commandId": id, "requestId": "request_" + id, "targetDeviceId": host,
        "kind": kind, "state": state, "createdAt": date, "updatedAt": date]
    row["sessionId"] = session.map { $0 as Any } ?? NSNull()
    if let root { row["rootTaskId"] = root; row["taskAction"] = "supplement" }
    return row
}
private func directoryPage(_ rows: [[String: Any]], more: Bool = false) -> [String: Any] {
    ["commands": rows, "hasMore": more, "nextBefore": more ? rows.last?["commandId"] ?? NSNull() : NSNull()]
}

@main private struct TaskDirectoryChecks {
    @MainActor static func main() async throws {
        let directory = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first
            ?? FileManager.default.temporaryDirectory.appendingPathComponent("TaskDirectory-" + UUID().uuidString).path)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var passed: [String] = []
        func done(_ name: String) { passed.append(name); print("PASS " + name) }
        func make(_ pages: [[String: Any]], host: String = "host_A", sessionId: String = "session_A") async throws
            -> (TaskDirectoryModel, DirectoryHTTP, DirectoryContext) {
            let http = DirectoryHTTP(); await http.setPages(try pages.map { try JSONSerialization.data(withJSONObject: $0) })
            let client = PersonalClient(credentialStore: DirectoryCredentials(), transport: http)
            let context = DirectoryContext()
            context.session = try await client.login(server: ServerConfiguration(input: "https://directory.unit.example:8443"),
                username: "fixture", password: "synthetic-only", deviceName: "Fixture Mac")
            let model = TaskDirectoryModel(client: client, sessionId: sessionId, expectedHostId: host,
                accountEpoch: context.epoch, currentEpoch: { context.epoch }, currentSession: { context.session })
            return (model, http, context)
        }
        do {
            let (model, http, context) = try await make([directoryPage([directoryRow("from_other_device", index: 0)])])
            await model.refresh()
            let counts = await http.counts()
            try requireDirectory(model.rootCommands.map(\.commandId) == ["from_other_device"]
                && model.rootCommands[0].requestId == "request_from_other_device", "Cross-device cloud root missing without local ledger")
            try requireDirectory(counts.commands == 1 && counts.details == 0 && model.hasRead && !model.hasMore,
                                 "Directory auto-fetched task details or extra pages")
            let row = model.rootCommands[0]; try requireDirectory(model.canOpen(row), "Known cloud root cannot open")
            context.epoch = UUID()
            try requireDirectory(!model.canOpen(row), "Captured prior account row can construct a new-account task destination")
            done("cloud task discovery without local ledger and without body reads")
        }
        do {
            let first = [directoryRow("other_session", index: 0, session: "session_B"),
                directoryRow("other_host", index: 1, host: "host_B"),
                directoryRow("child_message", index: 2, root: "original_root"),
                directoryRow("pending_create", index: 3, session: nil, kind: "session.create", state: "pending")]
            let (model, http, _) = try await make([directoryPage(first, more: true),
                directoryPage([directoryRow("matching_older_root", index: 4)])])
            await model.refresh()
            let one = await http.counts()
            try requireDirectory(model.rootCommands.isEmpty && model.canLoadMore && one.commands == 1,
                                 "Filtered empty page lost continuation or automatically scanned")
            await model.loadMore()
            let cursors = await http.cursors(), counts = await http.counts()
            try requireDirectory(model.rootCommands.map(\.commandId) == ["matching_older_root"] && counts.commands == 2
                && cursors[0] == nil && cursors[1] == "pending_create", "Explicit continuation was not bound to last raw metadata ID")
            done("session host child filtering retains empty-page raw continuation")
        }
        do {
            let (model, http, context) = try await make([directoryPage([directoryRow("late_old_owner", index: 0)])])
            await http.pause(); let load = Task { await model.refresh() }; try await http.awaitPause()
            context.epoch = UUID(); context.session = nil; model.cancel(); await http.release(); await load.value
            let counts = await http.counts()
            try requireDirectory(model.rootCommands.isEmpty && !model.hasRead && counts.cancellations == 1,
                                 "Old owner metadata published after cancellation")
            done("owner epoch cancellation blocks late directory publication")
        }
        do {
            let (model, http, _) = try await make([directoryPage([directoryRow("obsolete", index: 0)]),
                directoryPage([directoryRow("fresh", index: 0)])])
            await http.pause(); let old = Task { await model.refresh() }; try await http.awaitPause()
            model.cancel(); model.activate(); await model.refresh(); await http.release(); await old.value
            try requireDirectory(model.rootCommands.map(\.commandId) == ["fresh"] && model.error == nil,
                                 "Late old response disturbed new generation")
            done("cancelled generation cannot replace a fresh directory")
        }
        do {
            let (model, http, _) = try await make([directoryPage([directoryRow("same_root", index: 0)], more: true),
                directoryPage([directoryRow("same_root", index: 1, state: "rejected")])])
            await model.refresh(); await model.loadMore()
            try requireDirectory(model.rootCommands.count == 1 && model.rootCommands[0].state == .acceptedByDSH && model.error != nil,
                                 "Conflicting repeated command altered displayed task identity")
            let counts = await http.counts(); try requireDirectory(counts.details == 0, "Cursor error fetched task bodies")
            done("duplicate cursor conflict preserves original cloud metadata")
        }
        do {
            let (model, http, _) = try await make([directoryPage([directoryRow("before_401", index: 0)], more: true)])
            await model.refresh(); await http.deny(); await model.loadMore()
            try requireDirectory(model.rootCommands.isEmpty && !model.canLoadMore && model.error != nil,
                                 "Authorization failure retained actionable owner directory")
            done("authorization failure clears actionable directory")
        }
        do {
            let (model, http, _) = try await make([directoryPage([directoryRow("navigation_row", index: 0)], more: true),
                directoryPage([directoryRow("late_more", index: 1)])])
            await model.refresh(); await http.pause(); let more = Task { await model.loadMore() }; try await http.awaitPause()
            model.suspend(); await http.release(); await more.value
            let counts = await http.counts()
            try requireDirectory(model.rootCommands.map(\.commandId) == ["navigation_row"] && counts.cancellations == 1 && !model.loading,
                                 "Pushing task detail removed navigation row or appended late page")
            done("detail navigation suspends SDK reads without removing original navigation row")
        }
        do {
            let (model, _, _) = try await make([directoryPage([directoryRow("future_root", index: 0, state: "future_state")])])
            await model.refresh()
            try requireDirectory(model.rootCommands.isEmpty && model.hasRead && model.unsupportedRootCount == 1 && model.error == nil,
                                 "Unsupported root was mistaken for success or a broken entire page")
            done("unsupported root metadata remains explicitly reported")
        }
        do {
            let (model, http, context) = try await make([directoryPage([directoryRow("not_read", index: 0)])], host: "other_host")
            await model.refresh(); let counts = await http.counts()
            try requireDirectory(counts.commands == 0 && model.error != nil && model.rootCommands.isEmpty,
                                 "Captured wrong host sent a directory request")
            context.session = nil; await model.loadMore()
            done("missing or mismatched captured account host refuses metadata reads")
        }
        do {
            var pages: [[String: Any]] = []
            for page in 0..<6 {
                let rows = (0..<50).map { directoryRow("root_\(page)_\($0)", index: page * 50 + $0) }
                pages.append(directoryPage(rows, more: true))
            }
            let (model, http, _) = try await make(pages); await model.refresh()
            for _ in 0..<5 { await model.loadMore() }
            let counts = await http.counts()
            try requireDirectory(model.rootCommands.count == 250 && model.limitReached && !model.canLoadMore
                && model.error != nil && counts.commands == 6 && counts.details == 0,
                "Bounded directory silently truncated metadata or kept reading beyond limit")
            done("directory limit preserves whole prior pages and stops further reads")
        }
        let report: [String: Any] = ["passed": passed.count, "failed": 0, "cases": passed,
            "localSendLedgerCreated": false, "realHTTPRequests": 0, "GUIActions": 0,
            "KeychainQueries": 0, "modelRequests": 0, "mutations": 0]
        try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
            .write(to: directory.appendingPathComponent("task-directory-checks.json"), options: .withoutOverwriting)
        print("Task directory checks: \(passed.count) passed, 0 failed")
    }
}
