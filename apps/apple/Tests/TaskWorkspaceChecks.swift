// Standalone controlled Model checks. Uses the real Private SDK and synthetic HTTP, never the GUI/network/Keychain.
import CryptoKit
import Foundation
import UniformTypeIdentifiers
import WeftMateCore

private struct TaskCheckFailure: Error { let message: String }
private func check(_ value: Bool, _ message: String) throws { if !value { throw TaskCheckFailure(message: message) } }
private func taskCheckSHA(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
private final class TaskFixtureCredentials: CredentialStore, @unchecked Sendable {
    private let lock = NSLock(); private var values: [String: Data] = [:]
    func load(key: String) -> Data? { lock.withLock { values[key] } }
    func save(_ data: Data, key: String) { lock.withLock { values[key] = data } }
    func delete(key: String) { lock.withLock { values[key] = nil } }
}
private actor TaskFixtureHTTP: HTTPTransport {
    let original = Data("# 原成果\r\n文本保持原字节\n".utf8)
    var paths: [String] = []
    var methods: [String] = []
    var pausePath: String?
    var gate: CheckedContinuation<Void, Never>?
    var cancelledRequests = 0
    var badBytes = false
    var changedArtifact = false
    var noSaveProof = false
    var denied = false
    var wrongRequest = false
    var sourceVersion = 0
    var taskMissing = false
    var stopOutcome = "acknowledged"
    var stopBodies: [Data] = []
    var controlState = "active"
    var controlTime = "2026-10-05T00:00:00Z"
    var canStop = true
    var artifactFileName = "Result.md"
    var artifactContentType: String?
    func configureTextArtifact(name: String, contentType: String?) {
        artifactFileName = name; artifactContentType = contentType
    }
    func configure(pause: String? = nil, badBytes: Bool = false, changedArtifact: Bool = false,
                   noSaveProof: Bool = false, denied: Bool = false, wrongRequest: Bool = false,
                   sourceVersion: Int = 0, taskMissing: Bool = false, stopOutcome: String = "acknowledged",
                   controlState: String? = nil, controlTime: String? = nil, canStop: Bool? = nil) {
        pausePath = pause; self.badBytes = badBytes; self.changedArtifact = changedArtifact
        self.noSaveProof = noSaveProof; self.denied = denied; self.wrongRequest = wrongRequest
        self.sourceVersion = sourceVersion; self.taskMissing = taskMissing
        self.stopOutcome = stopOutcome
        if let controlState { self.controlState = controlState }
        if let controlTime { self.controlTime = controlTime }
        if let canStop { self.canStop = canStop }
    }
    func waitForPause() async throws {
        for _ in 0..<1_000 { if gate != nil { return }; try await Task.sleep(nanoseconds: 1_000_000) }
        throw TaskCheckFailure(message: "Controlled route never paused")
    }
    func release() { gate?.resume(); gate = nil }
    func count(_ suffix: String) -> Int { paths.filter { $0.hasSuffix(suffix) }.count }
    func cancellations() -> Int { cancelledRequests }
    func allMethods() -> [String] { methods }
    func submittedStops() -> [Data] { stopBodies }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let path = request.url!.path
        paths.append(path); methods.append(request.httpMethod ?? "")
        if pausePath == path {
            pausePath = nil; await withCheckedContinuation { gate = $0 }
            if Task.isCancelled { cancelledRequests += 1 }
        }
        if path == "/personal/v1/auth/login" {
            return try response(auth(), headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)])
        }
        if path == "/personal/v1/tasks/task_A/stop", request.httpMethod == "POST" {
            guard let body = request.httpBody, let fields = try JSONSerialization.jsonObject(with: body) as? [String: String],
                  Set(fields.keys) == ["requestId"], UUID(uuidString: fields["requestId"] ?? "") != nil else {
                throw TaskCheckFailure(message: "Stop did not use typed immutable request-only body")
            }
            stopBodies.append(body)
            if stopOutcome == "unknown" { throw URLError(.networkConnectionLost) }
            if stopOutcome != "active" { controlState = "stop_requested"; controlTime = "2026-10-05T00:01:00Z"; canStop = false }
            return try response(["task": task()], status: 202)
        }
        guard request.httpMethod == "GET" else { throw TaskCheckFailure(message: "A task page attempted a mutation") }
        if path == "/personal/v1/status" { return try response(["ownerId": "owner_A", "hostId": "host_A"]) }
        if path == "/personal/v1/auth/me" {
            return denied ? try response(["error": ["code": "UNAUTHORIZED"]], status: 401) : try response(auth())
        }
        switch path {
        case "/personal/v1/tasks/task_A":
            return taskMissing ? try response(["error": ["code": "NOT_FOUND"]], status: 404) : try response(task())
        case "/personal/v1/tasks/task_A/sources/web_A":
            var source = webSource(); source["text"] = "web fixture text"
            return try response(["source": source])
        case "/personal/v1/tasks/task_A/sources/project_A":
            var source = projectSource(); source["text"] = "project excerpt"
            return try response(["source": source])
        case "/personal/v1/artifacts/artifact_A/preview":
            return try response(["artifact": artifact(), "text": String(decoding: artifactData, as: UTF8.self)])
        case "/personal/v1/artifacts/artifact_A": return try response(["artifact": artifact()])
        case "/personal/v1/artifacts/artifact_A/download":
            return .init(status: 200, body: badBytes ? Data("corrupt bytes".utf8) : artifactData)
        default: throw TaskCheckFailure(message: "Unexpected controlled route: " + path)
        }
    }
    private func auth() -> [String: Any] {
        ["account": ["ownerId": "owner_A", "username": "fixture", "displayName": "Fixture"],
         "device": ["id": "device_A", "name": "Test Mac"], "csrfToken": String(repeating: "b", count: 43)]
    }
    private func command(_ id: String, kind: String = "session.message") -> [String: Any] {
        ["commandId": id, "requestId": id == "task_A" && !wrongRequest ? "request_A" : "request_" + id,
         "kind": kind, "targetDeviceId": "host_A", "state": "accepted_by_dsh", "sessionId": "session_A",
         "createdAt": "2026-10-05T00:00:00Z", "updatedAt": "2026-10-05T00:00:00Z"]
    }
    private func artifact() -> [String: Any] {
        var row = command("artifact_command_A", kind: "desktop.write_artifact")
        row["state"] = "observed"; row["taskId"] = "task_A"; row["artifactId"] = "artifact_A"
        row["fileName"] = artifactFileName; row["size"] = artifactData.count
        if let artifactContentType { row["contentType"] = artifactContentType }
        row["sha256"] = taskCheckSHA(artifactData)
        if !noSaveProof { row["verification"] = ["status": "observed", "method": "sha256_readback", "observedAt": "2026-10-05T00:00:00Z"] }
        return row
    }
    private var artifactData: Data { changedArtifact ? Data("new bytes".utf8) : original }
    private func webSource() -> [String: Any] {
        let sha = taskCheckSHA(Data("web fixture text".utf8))
        return ["snapshotId": "web_A", "kind": "webpage", "title": sourceVersion == 0 ? "Web A" : "Web updated",
                "url": "https://source.unit.example/page", "requestedUrl": "https://source.unit.example/page",
                "readAt": "2026-10-05T00:00:00Z", "contentSha256": sha, "fileSha256": sha, "truncated": false, "links": []]
    }
    private func projectSource() -> [String: Any] {
        ["snapshotId": "project_A", "relativePath": "docs/Guide.md", "lineStart": 2, "lineEnd": 3, "totalLines": 10,
         "fileSha256": String(repeating: "a", count: 64), "readAt": "2026-10-05T00:00:00Z", "hasMore": true,
         "projectId": "project_A", "projectRevision": 1]
    }
    private func task() -> [String: Any] {
        var control: [String: Any] = ["state": controlState, "updatedAt": controlTime, "canStop": canStop,
                                      "canSupplement": controlState != "stop_requested", "canResume": false]
        if controlState == "stop_requested" { control["stopStatus"] = "requested"; control["pendingReceipts"] = 1 }
        return ["taskId": "task_A", "sessionId": "session_A", "sourceText": "Original controlled goal", "source": command("task_A"),
         "artifacts": [artifact()], "steps": [], "sources": [webSource(), projectSource()], "supplements": [], "resumes": [],
         "control": control,
         "replyEvidence": ["status": "unconfirmed", "assistantChunks": 0, "textChunks": 0, "reasoningChunks": 0,
                           "assistantMessages": 0, "toolSaveObserved": true]]
    }
    private func response(_ object: [String: Any], status: Int = 200, headers: [String: String] = [:]) throws -> HTTPResponse {
        .init(status: status, headers: headers, body: try JSONSerialization.data(withJSONObject: object))
    }
}
@MainActor private final class TaskFixtureContext {
    var epoch = UUID()
    var session: AccountSession?
}

@main private struct TaskWorkspaceChecks {
    @MainActor static func main() async throws {
        let textOnly = CommandLine.arguments.contains("--generic-text-only")
        let root = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first(where: { $0 != "--generic-text-only" })
            ?? FileManager.default.temporaryDirectory.appendingPathComponent("TaskWorkspaceChecks-" + UUID().uuidString).path)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var passed: [String] = []
        func done(_ name: String) { passed.append(name); print("PASS " + name) }
        func make(sessionID: String = "session_A", noProof: Bool = false, directory: URL? = nil) async throws -> (TaskWorkspaceModel, TaskFixtureHTTP, TaskFixtureContext) {
            let http = TaskFixtureHTTP(); await http.configure(noSaveProof: noProof)
            let client = PersonalClient(credentialStore: TaskFixtureCredentials(), transport: http)
            let session = try await client.login(server: ServerConfiguration(input: "https://task.unit.example:8443"),
                                                 username: "fixture", password: "synthetic-test-only", deviceName: "Fixture Mac")
            let context = TaskFixtureContext(); context.session = session
            let model = TaskWorkspaceModel(client: client, taskId: "task_A", expectedHostId: "host_A", expectedSessionId: sessionID,
                expectedRequestId: "request_A", accountEpoch: context.epoch,
                stateDirectory: directory ?? root.appendingPathComponent("case-" + UUID().uuidString, isDirectory: true),
                currentEpoch: { context.epoch }, currentSession: { context.session })
            return (model, http, context)
        }

        if textOnly {
            let cases = [("结果.csv", "csv", "text/csv;charset=utf-8"), ("Cafe\u{301}.csv", "csv", "text/csv;charset=utf-8"), ("Result.tsv", "tsv", "text/tab-separated-values;charset=utf-8"),
                         ("Report.CSV", "csv", "text/csv;charset=utf-8"), ("Report.weftunknown", "weftunknown", "text/plain;charset=utf-8"),
                         ("snapshot.png", "png", "text/plain;charset=utf-8"), ("Report.pdf", "pdf", "text/plain;charset=utf-8"),
                         ("notes.json", "json", "text/plain;charset=utf-8"), ("Report.my ext", "", "text/plain;charset=utf-8"),
                         ("README", "", "text/plain;charset=utf-8"), ("Result.md", "md", "")]
            for (name, suffix, mime) in cases {
                let (model, http, _) = try await make()
                await http.configureTextArtifact(name: name, contentType: mime.isEmpty ? nil : mime)
                await model.refresh(); await model.previewArtifact("artifact_A")
                let original = http.original
                try check(model.artifactPreviews["artifact_A"].map { Data($0.text.utf8) } == original, "Text preview changed bytes for " + name)
                guard let export = await model.prepareArtifactExport("artifact_A") else { throw TaskCheckFailure(message: "Verified text export absent for " + name) }
                try check(export.fileName.utf8.elementsEqual(name.utf8) && export.data == original && export.sha256 == taskCheckSHA(original), "Text export changed original name/bytes for " + name)
                let type = export.contentType
                try check(type.conforms(to: .text) && !type.conforms(to: .image) && !type.conforms(to: .pdf), "Text export acquired binary type for " + name)
                if suffix.isEmpty {
                    try check(type.preferredFilenameExtension == nil, "Extensionless text acquired an export suffix")
                } else {
                    try check((type.tags[.filenameExtension] ?? []).contains { $0.caseInsensitiveCompare(suffix) == .orderedSame }, "Original suffix absent from export type for " + name)
                }
                if suffix == "csv" { try check(type == .commaSeparatedText && type.preferredMIMEType == "text/csv", "CSV export MIME/type mismatch") }
                else if suffix == "tsv" { try check(type == .tabSeparatedText && type.preferredMIMEType == "text/tab-separated-values", "TSV export MIME/type mismatch") }
                else { try check(type.conforms(to: .utf8PlainText), "Generic artifact was not exported as UTF-8 text") }
                done("controlled UTF-8 export " + name)
            }
            try JSONSerialization.data(withJSONObject: ["fixture": "controlled in-memory HTTP; no GUI or real service", "passed": passed, "failed": []], options: [.prettyPrinted, .sortedKeys])
                .write(to: root.appendingPathComponent("generic-text-workspace-checks.json"), options: .withoutOverwriting)
            print("Controlled UTF-8 artifact checks: \(passed.count) passed, 0 failed")
            return
        }

        do {
            let (model, http, _) = try await make(); await model.refresh()
            try check(model.snapshot?.replyEvidence.status == .unconfirmed, "Saved file incorrectly implied reply completion")
            let sourceCount = await http.count("/sources/web_A"), downloadCount = await http.count("/download")
            try check(sourceCount == 0 && downloadCount == 0, "Detail auto-expanded/downloaded private data")
            done("root task state read without automatic sources/downloads")
        }
        do {
            let (model, _, _) = try await make(sessionID: "other_session"); await model.refresh()
            try check(model.snapshot == nil && model.error != nil, "Wrong original session entered task page")
            done("expected original session binding")
        }
        do {
            let (model, http, _) = try await make(); await http.configure(wrongRequest: true); await model.refresh()
            try check(model.snapshot == nil && model.scopeInvalidated, "Wrong original request entered task page")
            done("expected original request binding")
        }
        do {
            let (model, _, _) = try await make(); await model.refresh(); await model.loadSource("web_A"); await model.loadSource("project_A")
            try check(model.sourcePreviews["web_A"]?.verification == .deliveredTextSHA256Verified, "Web source proof missing")
            try check(model.sourcePreviews["project_A"]?.verification == .originalFileMetadataOnly, "Project excerpt claimed full content verification")
            done("explicit source and meaningful verification levels")
        }
        do {
            let (model, http, _) = try await make(); await model.refresh(); await http.configure(pause: "/personal/v1/tasks/task_A/sources/web_A")
            let loading = Task { await model.loadSource("web_A") }; try await http.waitForPause()
            model.closeSource("web_A"); await http.release(); await loading.value
            let cancelled = await http.cancellations()
            try check(model.sourcePreviews["web_A"] == nil && cancelled == 1, "Source fold did not cancel actual SDK worker")
            done("source collapse cancels SDK and blocks late preview")
        }
        do {
            let (model, http, _) = try await make(); await model.refresh(); await http.configure(pause: "/personal/v1/artifacts/artifact_A")
            let saving = Task { await model.prepareArtifactExport("artifact_A") }; try await http.waitForPause()
            model.cancel(); await http.release(); let export = await saving.value
            let downloads = await http.count("/download")
            try check(export == nil && downloads == 0, "Closing task allowed second-stage download")
            done("closing task during metadata prevents download bytes")
        }
        do {
            let (model, http, _) = try await make(); await model.refresh(); await http.configure(pause: "/personal/v1/artifacts/artifact_A")
            let saving = Task { await model.prepareArtifactExport("artifact_A") }; try await http.waitForPause()
            saving.cancel(); await http.release(); let export = await saving.value
            let downloads = await http.count("/download")
            try check(export == nil && downloads == 0, "Caller cancellation did not reach SDK worker")
            done("outer cancellation propagates through worker")
        }
        do {
            let (model, http, context) = try await make(); await http.configure(pause: "/personal/v1/tasks/task_A")
            let refresh = Task { await model.refresh() }; try await http.waitForPause(); context.epoch = UUID()
            await http.release(); await refresh.value
            try check(model.snapshot == nil && model.scopeInvalidated, "Late account epoch published old task")
            done("account epoch rejects delayed detail")
        }
        do {
            let (model, http, _) = try await make(); await model.refresh(); await model.previewArtifact("artifact_A")
            let original = http.original
            try check(model.artifactPreviews["artifact_A"]?.text == String(decoding: original, as: UTF8.self), "Verified preview bytes changed")
            done("complete artifact preview correlation")
        }
        do {
            let (model, http, _) = try await make(); await model.refresh()
            guard let export = await model.prepareArtifactExport("artifact_A") else { throw TaskCheckFailure(message: "Verified export absent") }
            let original = http.original
            try check(export.data == original && export.fileName == "Result.md", "Explicit export recoded/truncated bytes")
            let file = root.appendingPathComponent("controlled-saved-result.md"); try export.data.write(to: file)
            try check(try Data(contentsOf: file) == export.data, "Controlled explicit save bytes changed")
            model.recordExportResult(.success(file), export: export)
            try check(model.exportNotes["artifact_A"] == "已保存到你选择的位置。", "Save completion not attributed")
            done("explicit verified export preserves original Data")
        }
        do {
            let (model, http, _) = try await make(); await model.refresh(); await http.configure(badBytes: true)
            let export = await model.prepareArtifactExport("artifact_A")
            try check(export == nil && model.artifactErrors["artifact_A"] != nil, "Wrong SHA produced export")
            done("corrupt download cannot produce export")
        }
        do {
            let (model, http, _) = try await make(); await model.refresh(); await http.configure(changedArtifact: true)
            let export = await model.prepareArtifactExport("artifact_A")
            try check(export == nil, "Artifact from changed metadata entered old task snapshot")
            done("artifact immutable snapshot association")
        }
        do {
            let (model, http, _) = try await make(); await model.refresh(); await model.loadSource("web_A")
            await http.configure(denied: true); await model.refresh()
            try check(model.snapshot == nil && model.sourcePreviews.isEmpty && model.scopeInvalidated, "Revoked session retained visible private task")
            done("authentication failure clears task and expanded data")
        }
        do {
            let (model, http, context) = try await make(); context.session = nil
            let count = await http.count("/tasks/task_A"); await model.refresh()
            try check(await http.count("/tasks/task_A") == count && model.snapshot == nil, "Absent current account started network read")
            done("missing scope refuses reads before SDK")
        }
        do {
            let (model, http, _) = try await make(); await model.refresh(); await http.configure(pause: "/personal/v1/tasks/task_A/sources/web_A")
            let source = Task { await model.loadSource("web_A") }; try await http.waitForPause()
            await http.configure(sourceVersion: 1); await model.refresh(); await http.release(); await source.value
            try check(model.snapshot?.sources[0].title == "Web updated" && model.sourcePreviews.isEmpty, "Old source disturbed refreshed snapshot")
            done("snapshot change cancels old source worker")
        }
        do {
            let (model, http, _) = try await make(noProof: true); await model.refresh()
            try check(!model.canExport("artifact_A"), "Observed enum alone claimed verified save")
            let export = await model.prepareArtifactExport("artifact_A")
            let artifactReads = await http.count("/artifacts/artifact_A")
            try check(export == nil && artifactReads == 0, "Missing save proof started download")
            done("observed state without verification remains pending")
        }
        do {
            let (model, http, _) = try await make(); await model.refresh(); await model.loadSource("other_source")
            let export = await model.prepareArtifactExport("other_artifact")
            let sourceReads = await http.count("/sources/other_source"), artifactReads = await http.count("/artifacts/other_artifact")
            try check(export == nil && sourceReads == 0 && artifactReads == 0, "Foreign IDs requested unrelated resources")
            done("source and artifact membership before request")
        }
        do {
            let (model, http, _) = try await make(); await model.refresh()
            try check(model.canRequestStop, "Validated active task could not accept explicit stop")
            await model.requestStop()
            let posts = await http.submittedStops()
            try check(posts.count == 1 && model.stopRecord?.state == .acknowledged && model.stopAcknowledgedInMemory,
                      "Explicit stop did not persist matched 202 acknowledgment")
            try check(model.snapshot?.control.stopStatus == .requested && !model.canRequestStop,
                      "Request acceptance was presented as stopped or permitted another POST")
            await model.requestStop(); await model.reconcileStop()
            let repeated = await http.submittedStops()
            try check(repeated.count == 1 && model.stopRecord?.state == .acknowledged, "Read-only reconcile lost known acknowledgment or repeated POST")
            done("explicit durable stop acknowledgment remains distinct from stopped")
        }
        do {
            let directory = root.appendingPathComponent("stop-unknown", isDirectory: true)
            let (model, http, _) = try await make(directory: directory); await model.refresh()
            await http.configure(stopOutcome: "unknown"); await model.requestStop()
            let original = model.stopRecord?.intent
            try check(model.stopRecord?.state == .attemptedUnknown && !model.canRequestStop && model.stopError != nil,
                      "Unknown stop was reset to unattempted")
            await model.reconcileStop(); await model.requestStop()
            let posts = await http.submittedStops()
            try check(posts.count == 1 && model.stopRecord?.intent == original && model.snapshot?.control.state == .active,
                      "Unknown active lookup generated a second stop or changed intent")
            model.cancel()
            let (reopened, newHTTP, _) = try await make(directory: directory); await reopened.refresh()
            await reopened.reconcileStop(); await reopened.requestStop()
            let reopenedPosts = await newHTTP.submittedStops()
            try check(reopened.stopRecord?.intent == original && reopened.stopRecord?.state == .attemptedUnknown
                        && reopenedPosts.isEmpty && !reopened.canRequestStop,
                      "Durable unknown reopened with a new ID or permission to replay")
            done("unknown stop reopen is same-identity lookup only")
        }
        do {
            let directory = root.appendingPathComponent("stop-prepared", isDirectory: true)
            let (initial, _, _) = try await make(directory: directory); await initial.refresh()
            let intent = try TaskStopIntent(snapshot: initial.snapshot!, requestID: UUID().uuidString.lowercased())
            let journal = try TaskStopJournal(directory: directory.appendingPathComponent("TaskStop", isDirectory: true))
            _ = try await journal.persist(intent); initial.cancel()
            let (reopened, http, _) = try await make(directory: directory); await reopened.refresh()
            try check(reopened.stopRecord?.state == .prepared && reopened.canRequestStop, "Prepared intent not restored")
            await reopened.requestStop()
            let posts = await http.submittedStops()
            try check(posts == [intent.payload] && reopened.stopRecord?.state == .acknowledged,
                      "Explicit prepared continuation changed original request bytes")
            done("never-attempted stop reopens and explicitly continues original body")
        }
        do {
            let (model, http, _) = try await make(); await model.refresh(); await model.requestStop()
            await http.configure(controlState: "active", controlTime: "2026-10-05T00:00:00Z", canStop: true)
            await model.reconcileStop(); await model.requestStop()
            let priorPosts = await http.submittedStops()
            try check(model.stopRecord?.state == .acknowledged && !model.canRequestStop && priorPosts.count == 1,
                      "Older active GET erased acknowledgment or justified a fresh stop")
            await http.configure(controlState: "active", controlTime: "2026-10-05T00:02:00Z", canStop: true)
            await model.refresh()
            try check(model.canRequestStop, "Strictly later resumed task could not accept a new explicit stop")
            await model.requestStop()
            let posts = await http.submittedStops()
            try check(posts.count == 2 && posts[0] != posts[1], "New explicit active lifecycle reused prior request")
            done("known acknowledgment survives old GET and later active lifecycle is explicit")
        }
        do {
            let directory = root.appendingPathComponent("stop-close-preflight", isDirectory: true)
            let (model, http, _) = try await make(directory: directory); await model.refresh()
            await http.configure(pause: "/personal/v1/tasks/task_A")
            let stopping = Task { await model.requestStop() }; try await http.waitForPause()
            model.cancel(); await http.release(); await stopping.value
            let posts = await http.submittedStops()
            try check(posts.isEmpty && model.snapshot == nil && model.stopRecord == nil, "Closing page allowed late stop POST or visible state")
            let (reopened, _, _) = try await make(directory: directory); await reopened.refresh()
            try check(reopened.stopRecord?.state == .prepared && reopened.canRequestStop,
                      "Cancelled preflight lost never-attempted durable request")
            done("closing stop preflight cancels SDK before POST and preserves prepared intent")
        }
        do {
            let directory = root.appendingPathComponent("stop-close-submission", isDirectory: true)
            let (model, http, context) = try await make(directory: directory); await model.refresh()
            await http.configure(pause: "/personal/v1/tasks/task_A/stop")
            let stopping = Task { await model.requestStop() }; try await http.waitForPause()
            context.epoch = UUID(); model.cancel(); await http.release(); await stopping.value
            try check(model.snapshot == nil && model.stopRecord == nil, "Old account stop response republished content")
            let (reopened, newHTTP, _) = try await make(directory: directory); await reopened.refresh(); await reopened.requestStop()
            let posts = await newHTTP.submittedStops()
            try check(reopened.stopRecord?.state == .attemptedUnknown && posts.isEmpty,
                      "Cancelled possibly submitted stop acquired another POST after reopen")
            done("account/page cancellation after submission preserves durable unknown without replay")
        }
        do {
            let (model, http, _) = try await make(); await model.refresh()
            await http.configure(stopOutcome: "active"); await model.requestStop()
            try check(model.stopRecord?.state == .attemptedUnknown && !model.stopAcknowledgedInMemory && !model.canRequestStop,
                      "202 active task alone was called an acknowledged stop")
            await model.reconcileStop()
            let posts = await http.submittedStops()
            try check(posts.count == 1 && model.stopRecord?.state == .attemptedUnknown, "Active 202 reconciliation replayed a stop")
            done("202 without stop state stays unknown rather than claiming own acceptance")
        }
        do {
            let directory = root.appendingPathComponent("stop-corrupt", isDirectory: true)
            let (model, http, _) = try await make(directory: directory); await model.refresh()
            let file = directory.appendingPathComponent("TaskStop/" + TaskStopJournal.fileName)
            let bytes = Data("broken-stop-proof".utf8); try bytes.write(to: file)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            await model.refresh(); await model.requestStop()
            let posts = await http.submittedStops()
            try check(model.snapshot != nil && model.stopError != nil && !model.canRequestStop && posts.isEmpty,
                      "Corrupt local stop proof was ignored before mutation")
            try check(try Data(contentsOf: file) == bytes, "Corrupt stop journal was replaced")
            done("corrupt stop journal blocks submission and preserves original file")
        }
        do {
            let (model, http, _) = try await make(); await http.configure(canStop: false); await model.refresh()
            await model.requestStop()
            let posts = await http.submittedStops()
            try check(!model.canRequestStop && model.stopRecord == nil && posts.isEmpty, "Service-disabled stop was submitted")
            done("actual canStop gates explicit action")
        }
        do {
            let (model, http, _) = try await make(); await model.refresh()
            let version = model.contentVersion
            guard let export = await model.prepareArtifactExport("artifact_A") else { throw TaskCheckFailure(message: "Verified export absent") }
            await http.configure(sourceVersion: 1); await model.refresh()
            model.recordExportResult(.success(root.appendingPathComponent("obsolete-save.md")), export: export)
            try check(model.contentVersion != version && model.exportNotes.isEmpty,
                      "Changed task snapshot kept old file-save context")
            done("snapshot revision invalidates prepared native export context")
        }
        let report: [String: Any] = ["passed": passed.count, "failed": 0, "cases": passed,
            "realHTTPRequests": 0, "GUIActions": 0, "KeychainQueries": 0, "modelRequests": 0,
            "fileSaving": "controlled explicit private-file Data write; native FileExporter panel not exercised",
            "stopSubmission": "synthetic HTTP via real Private SDK and real isolated journal; no real task mutation"]
        try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
            .write(to: root.appendingPathComponent("task-workspace-checks.json"), options: .withoutOverwriting)
        print("Task workspace checks: \(passed.count) passed, 0 failed")
    }
}
