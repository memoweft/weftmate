import Foundation
import Testing
@testable import WeftMateCore

private let taskOrigin = "https://task.unit.weftmate.example:8443"
private func taskJSON(_ fields: [String: Any]) -> HTTPResponse {
    .init(status: 200, body: try! JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]))
}
private func taskAuth(_ owner: String = "owner-A", device: String = "device-Mac") -> HTTPResponse {
    let fields: [String: Any] = ["account": ["ownerId": owner, "username": "test", "displayName": "Test"],
        "device": ["id": device, "name": "Mac"], "csrfToken": String(repeating: "b", count: 43)]
    return .init(status: 200, headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)], body: taskJSON(fields).body)
}
private func taskCommand(_ id: String = "cmd-task", kind: String = "session.message", extra: [String: Any] = [:]) -> [String: Any] {
    var fields: [String: Any] = ["commandId": id, "requestId": "request-\(id)", "kind": kind, "targetDeviceId": "host-test",
        "state": "accepted_by_dsh", "sessionId": "session-test", "receiptId": "receipt-\(id)",
        "createdAt": "2026-10-05T00:00:00Z", "updatedAt": "2026-10-05T00:00:00Z"]
    for (key, value) in extra { fields[key] = value }
    return fields
}
private func taskFields() -> [String: Any] {
    ["taskId": "cmd-task", "sessionId": "session-test", "sourceText": "synthetic prompt", "source": taskCommand(),
        "artifacts": [], "steps": [], "sources": [], "supplements": [], "resumes": [],
        "control": ["state": "active", "updatedAt": "2026-10-05T00:00:00Z", "canStop": true, "canSupplement": true, "canResume": false],
        "replyEvidence": ["status": "unconfirmed", "turn": NSNull(), "assistantChunks": 0, "textChunks": 0,
            "reasoningChunks": 0, "assistantMessages": 0, "toolSaveObserved": false]]
}
private func taskArtifact(text: String = "# synthetic\n", changes: [String: Any] = [:]) -> [String: Any] {
    var extra: [String: Any] = ["state": "observed", "taskId": "cmd-task", "artifactId": "artifact-test", "fileName": "Result.md",
        "size": text.utf8.count, "sha256": TaskReadValidation.sha(Data(text.utf8)),
        "verification": ["status": "observed", "method": "sha256_readback", "observedAt": "2026-10-05T00:00:00Z"]]
    for (key, value) in changes { extra[key] = value }
    return taskCommand("cmd-artifact", kind: "desktop.write_artifact", extra: extra)
}
private func taskWebSource(_ text: String = "synthetic webpage") -> [String: Any] {
    let hash = TaskReadValidation.sha(Data(text.utf8))
    return ["snapshotId": "source-test", "kind": "webpage", "title": "Test", "url": "https://public.unit.example/page",
        "requestedUrl": "https://public.unit.example/page", "readAt": "2026-10-05T00:00:00Z", "contentSha256": hash,
        "fileSha256": hash, "truncated": false, "links": [], "text": text]
}
private func taskScope() -> TaskReadScope {
    TaskReadScope(AccountSession(server: try! ServerConfiguration(input: taskOrigin),
        account: AccountProfile(ownerId: "owner-A", username: "test", displayName: "Test", profileRevision: nil),
        device: DeviceRecord(id: "device-Mac", name: "Mac"), hostId: "host-test", verification: .verified))
}
private actor TaskScriptTransport: HTTPTransport {
    struct Step: Sendable { let path: String; let response: HTTPResponse; var method = "GET"; var pause = false }
    private var steps: [Step]
    private var seen: [URLRequest] = []
    private var paused: CheckedContinuation<Void, Never>?
    init(_ steps: [Step]) { self.steps = steps }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        seen.append(request)
        guard !steps.isEmpty else { throw APIFailure.invalidResponse }
        let step = steps.removeFirst()
        guard request.url?.path == "/personal/v1" + step.path && request.httpMethod == step.method else { throw APIFailure.invalidResponse }
        if step.pause { await withCheckedContinuation { paused = $0 } }
        return step.response
    }
    func waitUntilPaused() async { while paused == nil { await Task.yield() } }
    func release() { paused?.resume(); paused = nil }
    func requests() -> [URLRequest] { seen }
}
private func taskLoginSteps() -> [TaskScriptTransport.Step] {
    [.init(path: "/auth/login", response: taskAuth(), method: "POST"), .init(path: "/status", response: taskJSON(["ownerId": "owner-A", "hostId": "host-test"]))]
}
private func taskLogin(_ client: PersonalClient) async throws -> AccountSession {
    try await client.login(server: ServerConfiguration(input: taskOrigin), username: "test", password: "synthetic-only", deviceName: "Mac")
}

struct TaskReadSDKTests {
    @Test func futureToolKeepsBoundIdentityAndIgnoresItsPrivateVerificationSchema() throws {
        var fields = taskFields()
        fields["steps"] = [taskCommand("cmd-generic", kind: "tool.execute", extra: [
            "taskId": "cmd-task", "state": "observed", "verification": ["futureProof": ["opaque": true]],
            "artifactId": ["future": "shape"], "fileName": 42, "size": "future-size", "sha256": false])]
        let value = try TaskSnapshot.decode(taskJSON(fields).body, scope: taskScope(), taskID: "cmd-task")
        let step = try #require(value.steps.first)
        #expect(step.kind.rawValue == "tool.execute" && !step.kind.isKnown)
        #expect(step.state == .observed && step.rawState == "observed")
        #expect(step.verification == nil && step.artifactId == nil && step.fileName == nil && step.sha256 == nil)
        #expect(value.replyEvidence.status == .unconfirmed && value.artifacts.isEmpty)
    }

    @Test func unknownToolStateRemainsUncertainEvenWhenNamedCompleted() throws {
        var fields = taskFields()
        fields["steps"] = [taskCommand("cmd-generic", kind: "tool.execute", extra: ["taskId": "cmd-task", "state": "completed"])]
        let value = try TaskSnapshot.decode(taskJSON(fields).body, scope: taskScope(), taskID: "cmd-task")
        #expect(value.steps[0].rawState == "completed" && value.steps[0].hasUnknownState)
        #expect(value.steps[0].state == .uncertain && value.replyEvidence.status == .unconfirmed)
    }

    @Test func futureStepsMustRemainWithinOriginalHostSessionAndTaskFamily() throws {
        for changes: [String: Any] in [["taskId": "other-task"], ["taskId": NSNull()],
            ["taskId": "cmd-task", "rootTaskId": "other-root"],
            ["taskId": "cmd-task", "targetDeviceId": "other-host"],
            ["taskId": "cmd-task", "sessionId": "other-session"]] {
            var fields = taskFields()
            fields["steps"] = [taskCommand("cmd-generic", kind: "tool.execute", extra: changes)]
            #expect(throws: (any Error).self) { try TaskSnapshot.decode(taskJSON(fields).body, scope: taskScope(), taskID: "cmd-task") }
        }
        var fields = taskFields()
        fields["supplements"] = [taskCommand("cmd-child", extra: ["rootTaskId": "cmd-task", "taskAction": "supplement"])]
        fields["steps"] = [taskCommand("cmd-generic", kind: "tool.execute", extra: ["taskId": "cmd-child", "rootTaskId": "cmd-task"])]
        #expect(try TaskSnapshot.decode(taskJSON(fields).body, scope: taskScope(), taskID: "cmd-task").steps.count == 1)
    }

    @Test func futureKindCannotBecomeRootArtifactOrKnownArtifactProof() throws {
        var fields = taskFields()
        fields["source"] = taskCommand(kind: "tool.execute", extra: ["taskId": "cmd-task"])
        #expect(throws: APIFailure.identityMismatch) { try TaskSnapshot.decode(taskJSON(fields).body, scope: taskScope(), taskID: "cmd-task") }
        fields = taskFields()
        var futureArtifact = taskArtifact(); futureArtifact["kind"] = "tool.execute"
        fields["artifacts"] = [futureArtifact]
        #expect(throws: APIFailure.invalidResponse) { try TaskSnapshot.decode(taskJSON(fields).body, scope: taskScope(), taskID: "cmd-task") }
        fields = taskFields(); fields["steps"] = [taskArtifact()]
        #expect(throws: APIFailure.invalidResponse) { try TaskSnapshot.decode(taskJSON(fields).body, scope: taskScope(), taskID: "cmd-task") }
        var bad = taskArtifact(); bad["verification"] = ["futureProof": true]
        fields = taskFields(); fields["artifacts"] = [bad]
        #expect(throws: APIFailure.invalidResponse) { try TaskSnapshot.decode(taskJSON(fields).body, scope: taskScope(), taskID: "cmd-task") }
    }

    @Test func invalidFutureKindStateAndDuplicateIdentityStillRejectSnapshot() throws {
        for changes: [String: Any] in [["kind": "../tool"], ["kind": String(repeating: "a", count: 129)],
            ["state": "completed\n"], ["state": String(repeating: "a", count: 65)]] {
            var extra: [String: Any] = ["taskId": "cmd-task"]
            extra.merge(changes) { _, next in next }
            var fields = taskFields(); fields["steps"] = [taskCommand("cmd-generic", kind: "tool.execute", extra: extra)]
            #expect(throws: APIFailure.invalidResponse) { try TaskSnapshot.decode(taskJSON(fields).body, scope: taskScope(), taskID: "cmd-task") }
        }
        var fields = taskFields()
        let step = taskCommand("cmd-generic", kind: "tool.execute", extra: ["taskId": "cmd-task"])
        fields["steps"] = [step, step]
        #expect(throws: APIFailure.invalidResponse) { try TaskSnapshot.decode(taskJSON(fields).body, scope: taskScope(), taskID: "cmd-task") }
    }

    @Test func taskReadsServerReportedStateWithoutBackgroundSourcesDownloadsOrActions() async throws {
        let transport = TaskScriptTransport(taskLoginSteps() + [.init(path: "/auth/me", response: taskAuth()), .init(path: "/tasks/cmd-task", response: taskJSON(taskFields()))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        _ = try await taskLogin(client)
        let result = try await client.taskDetail(taskID: "cmd-task")
        #expect(result.scope.ownerId == "owner-A" && result.replyEvidence.status == .unconfirmed)
        #expect(result.control.canStop && result.artifacts.isEmpty)
        #expect(await transport.requests().filter { $0.httpMethod == "POST" }.count == 1)
    }

    @Test func pendingStopRemainsRequestedAndTerminalWithPendingIsRejected() throws {
        var fields = taskFields()
        var control: [String: Any] = ["state": "stop_requested", "updatedAt": "2026-10-05T00:00:00Z", "canStop": false,
            "canSupplement": false, "canResume": false, "stopStatus": "requested", "pendingReceipts": 2]
        fields["control"] = control
        let pending = try TaskSnapshot.decode(taskJSON(fields).body, scope: taskScope(), taskID: "cmd-task")
        #expect(pending.control.stopStatus == .requested && pending.control.pendingReceipts == 2)
        control["stopStatus"] = "stopped"; fields["control"] = control
        #expect(throws: APIFailure.invalidResponse) { try TaskSnapshot.decode(taskJSON(fields).body, scope: taskScope(), taskID: "cmd-task") }
    }

    @Test func wrongRootHostSessionAndChildIdentityNeverEnterTaskSnapshot() throws {
        for source in [taskCommand("other-task"), taskCommand(extra: ["targetDeviceId": "other-host"]), taskCommand(extra: ["sessionId": "other-session"])] {
            var fields = taskFields(); fields["source"] = source
            #expect(throws: APIFailure.identityMismatch) { try TaskSnapshot.decode(taskJSON(fields).body, scope: taskScope(), taskID: "cmd-task") }
        }
        var fields = taskFields()
        fields["supplements"] = [taskCommand("cmd-child", extra: ["rootTaskId": "other-root", "taskAction": "supplement"])]
        #expect(throws: APIFailure.invalidResponse) { try TaskSnapshot.decode(taskJSON(fields).body, scope: taskScope(), taskID: "cmd-task") }
    }

    @Test func replyCountsAreBoundedAndMetadataDoesNotSynthesizeCompletion() throws {
        var fields = taskFields()
        var reply = try #require(fields["replyEvidence"] as? [String: Any]); reply["assistantChunks"] = 7; fields["replyEvidence"] = reply
        #expect(try TaskSnapshot.decode(taskJSON(fields).body, scope: taskScope(), taskID: "cmd-task").replyEvidence.status == .unconfirmed)
        reply["assistantChunks"] = 100_001; fields["replyEvidence"] = reply
        #expect(throws: APIFailure.invalidResponse) { try TaskSnapshot.decode(taskJSON(fields).body, scope: taskScope(), taskID: "cmd-task") }
    }

    @Test func webpagePreviewVerifiesDeliveredBytesAndHashAlias() throws {
        let good = try TaskSourcePreview.decode(taskJSON(["source": taskWebSource()]).body, scope: taskScope(), taskID: "cmd-task", sourceID: "source-test")
        #expect(good.verification == .deliveredTextSHA256Verified)
        for key in ["fileSha256", "contentSha256"] {
            var source = taskWebSource(); source[key] = String(repeating: "0", count: 64)
            #expect(throws: APIFailure.invalidResponse) { try TaskSourcePreview.decode(taskJSON(["source": source]).body, scope: taskScope(), taskID: "cmd-task", sourceID: "source-test") }
        }
    }

    @Test func projectPreviewPreservesOriginalHashWithoutClaimingExcerptHashVerification() throws {
        let source: [String: Any] = ["snapshotId": "source-test", "relativePath": "docs/Guide.md", "lineStart": 2, "lineEnd": 3, "totalLines": 10,
            "fileSha256": String(repeating: "a", count: 64), "readAt": "2026-10-05T00:00:00Z", "hasMore": true,
            "projectId": "project-test", "projectRevision": 1, "text": "a short excerpt"]
        let preview = try TaskSourcePreview.decode(taskJSON(["source": source]).body, scope: taskScope(), taskID: "cmd-task", sourceID: "source-test")
        #expect(preview.verification == .originalFileMetadataOnly && preview.metadata.fileSha256 != TaskReadValidation.sha(Data(preview.text.utf8)))
    }

    @Test func sourceIdentityByteLimitAndUnsafeURIAreRejected() throws {
        #expect(throws: APIFailure.identityMismatch) { try TaskSourcePreview.decode(taskJSON(["source": taskWebSource()]).body, scope: taskScope(), taskID: "cmd-task", sourceID: "other-source") }
        #expect(throws: APIFailure.responseTooLarge) { try TaskSourcePreview.decode(taskJSON(["source": taskWebSource(String(repeating: "a", count: 32_769))]).body, scope: taskScope(), taskID: "cmd-task", sourceID: "source-test") }
        var source = taskWebSource(); source["url"] = "https://user:secret@unit.example"
        #expect(throws: APIFailure.invalidResponse) { try TaskSourcePreview.decode(taskJSON(["source": source]).body, scope: taskScope(), taskID: "cmd-task", sourceID: "source-test") }
        source["url"] = "https://"
        #expect(throws: APIFailure.invalidResponse) { try TaskSourcePreview.decode(taskJSON(["source": source]).body, scope: taskScope(), taskID: "cmd-task", sourceID: "source-test") }
    }

    @Test func explicitArtifactPreviewAndDownloadVerifySameBytesSHAAndOwnerMetadata() async throws {
        let text = "# synthetic\n"
        let artifact = taskArtifact(text: text)
        let transport = TaskScriptTransport(taskLoginSteps() + [.init(path: "/auth/me", response: taskAuth()),
            .init(path: "/artifacts/artifact-test/preview", response: taskJSON(["artifact": artifact, "text": text])),
            .init(path: "/auth/me", response: taskAuth()), .init(path: "/artifacts/artifact-test", response: taskJSON(["artifact": artifact])),
            .init(path: "/artifacts/artifact-test/download", response: .init(status: 200, body: Data(text.utf8)))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        _ = try await taskLogin(client)
        let preview = try await client.taskArtifactPreview(taskID: "cmd-task", artifactID: "artifact-test")
        #expect(preview.text == text)
        let downloaded = try await client.taskArtifactBytes(taskID: "cmd-task", artifactID: "artifact-test")
        #expect(downloaded.data == Data(text.utf8) && downloaded.scope.ownerId == "owner-A")
    }

    @Test func artifactHashSizeFilenameAndOversizeFailWithoutTruncation() throws {
        for name in ["../x.md", ".md", "CON.txt", "result .md"] { #expect(!TaskReadValidation.fileName(name)) }
        #expect(TaskReadValidation.fileName("结果.md"))
        struct Reply: Decodable { let artifact: TaskCommandRecord }
        let record = try JSONDecoder().decode(Reply.self, from: taskJSON(["artifact": taskArtifact()]).body).artifact
        #expect(throws: APIFailure.invalidResponse) { try TaskReadValidation.artifactBytes(Data("different".utf8), record: record) }
        #expect(throws: APIFailure.responseTooLarge) { try TaskReadValidation.artifactBytes(Data(repeating: 32, count: 131_073), record: record) }
    }

    @Test func genericTextNamesAcceptOpenSuffixesAndExtensionlessNamesWithinExistingRules() throws {
        for name in ["结果.csv", "Result.tsv", "Report.CSV", "notes.json", "snapshot.png", "Report.weftunknown", "Report.my ext", "README", "结果", "Result.md", "Result.txt"] {
            #expect(TaskReadValidation.fileName(name))
        }
        for name in ["../x.csv", "folder/result.tsv", "folder\\result.csv", "bad:name.csv", ".csv", "CON", "con.csv", "LPT1.weftunknown",
                     "CON.other.csv", "result .csv", "result.", "result..csv", " result.csv", "result.csv ", "result\n.csv", "result\u{200B}.csv",
                     String(repeating: "a", count: 157) + ".csv"] {
            #expect(!TaskReadValidation.fileName(name))
        }
        #expect(TaskReadValidation.fileName(String(repeating: "a", count: 156) + ".csv"))
    }

    @Test func genericTextPreviewAndDownloadKeepCompleteUTF8ForNewTypesAndLegacyUntypedRecords() async throws {
        let text = "标题,值\r\n中文,42\n原字节不转码\n"
        for (name, mime) in [("结果.csv", "text/csv;charset=utf-8"), ("Cafe\u{301}.csv", "text/csv;charset=utf-8"), ("Result.tsv", "text/tab-separated-values;charset=utf-8"),
                             ("Report.weftunknown", "text/plain;charset=utf-8"), ("snapshot.png", "text/plain;charset=utf-8"),
                             ("README", "text/plain;charset=utf-8"), ("Result.md", "")] {
            var changes: [String: Any] = ["fileName": name]
            if !mime.isEmpty { changes["contentType"] = mime }
            let artifact = taskArtifact(text: text, changes: changes)
            var fields = taskFields(); fields["artifacts"] = [artifact]
            let originalName = try TaskSnapshot.decode(taskJSON(fields).body, scope: taskScope(), taskID: "cmd-task").artifacts[0].fileName
            #expect(originalName.map { $0.utf8.elementsEqual(name.utf8) } == true)
            let transport = TaskScriptTransport(taskLoginSteps() + [.init(path: "/auth/me", response: taskAuth()),
                .init(path: "/artifacts/artifact-test/preview", response: taskJSON(["artifact": artifact, "text": text])),
                .init(path: "/auth/me", response: taskAuth()), .init(path: "/artifacts/artifact-test", response: taskJSON(["artifact": artifact])),
                .init(path: "/artifacts/artifact-test/download", response: .init(status: 200,
                    headers: mime.isEmpty ? [:] : ["content-type": mime], body: Data(text.utf8)))])
            let client = PersonalClient(credentialStore: MemoryStore(), transport: transport); _ = try await taskLogin(client)
            let preview = try await client.taskArtifactPreview(taskID: "cmd-task", artifactID: "artifact-test")
            let download = try await client.taskArtifactBytes(taskID: "cmd-task", artifactID: "artifact-test")
            #expect(Data(preview.text.utf8) == Data(text.utf8) && download.data == Data(text.utf8))
            #expect(download.artifact.fileName.map { $0.utf8.elementsEqual(name.utf8) } == true)
            #expect(download.scope.ownerId == "owner-A" && download.artifact.sha256 == TaskReadValidation.sha(download.data))
            #expect(await transport.requests().filter { $0.httpMethod == "POST" }.count == 1)
        }
    }

    @Test func genericTextSuffixNeverBypassesUTF8NULSizeHashOrTaskScope() throws {
        for bytes in [Data([0xFF, 0xFE]), Data("text\0with NUL".utf8)] {
            let record = try JSONDecoder().decode(TaskCommandRecord.self, from: taskJSON(taskArtifact(changes: [
                "fileName": "snapshot.png", "size": bytes.count, "sha256": TaskReadValidation.sha(bytes)])).body)
            #expect(throws: APIFailure.invalidResponse) { try TaskReadValidation.artifactBytes(bytes, record: record) }
        }
        let largest = Data(repeating: 32, count: 131_072)
        let record = try JSONDecoder().decode(TaskCommandRecord.self, from: taskJSON(taskArtifact(changes: [
            "fileName": "Result.csv", "size": largest.count, "sha256": TaskReadValidation.sha(largest)])).body)
        try TaskReadValidation.artifact(record, scope: taskScope(), taskID: "cmd-task", artifactID: "artifact-test")
        try TaskReadValidation.artifactBytes(largest, record: record)
        #expect(throws: APIFailure.responseTooLarge) { try TaskReadValidation.artifactBytes(Data(repeating: 32, count: 131_073), record: record) }
        #expect(throws: APIFailure.invalidResponse) { try TaskReadValidation.artifactBytes(Data("different".utf8), record: record) }
        #expect(throws: APIFailure.invalidResponse) { try TaskReadValidation.artifact(record, scope: taskScope(), taskID: "other-task", artifactID: "artifact-test") }
        for changes: [String: Any] in [["targetDeviceId": "other-host"], ["sessionId": "other-session"]] {
            var extra = changes; extra["fileName"] = "Result.csv"
            var fields = taskFields(); fields["artifacts"] = [taskArtifact(changes: extra)]
            #expect(throws: APIFailure.identityMismatch) { try TaskSnapshot.decode(taskJSON(fields).body, scope: taskScope(), taskID: "cmd-task") }
        }
    }

    @Test func ownerSwitchDuringArtifactMetadataCannotStartOldDownload() async throws {
        let transport = TaskScriptTransport(taskLoginSteps() + [.init(path: "/auth/me", response: taskAuth()),
            .init(path: "/artifacts/artifact-test", response: taskJSON(["artifact": taskArtifact()]), pause: true),
            .init(path: "/auth/logout", response: taskJSON([:]), method: "POST"), .init(path: "/auth/login", response: taskAuth("owner-B", device: "device-B"), method: "POST"),
            .init(path: "/status", response: taskJSON(["ownerId": "owner-B", "hostId": "host-test"]))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        _ = try await taskLogin(client)
        let operation = Task { try await client.taskArtifactBytes(taskID: "cmd-task", artifactID: "artifact-test") }
        await transport.waitUntilPaused(); try await client.logout(); _ = try await taskLogin(client); await transport.release()
        await #expect(throws: APIFailure.accountChanged) { try await operation.value }
        #expect(await transport.requests().allSatisfy { !($0.url?.path.hasSuffix("/download") ?? false) })
    }

    @Test func cancellationBeforeMetadataFinishesNeverDownloadsBytes() async throws {
        let transport = TaskScriptTransport(taskLoginSteps() + [.init(path: "/auth/me", response: taskAuth()),
            .init(path: "/artifacts/artifact-test", response: taskJSON(["artifact": taskArtifact()]), pause: true)])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        _ = try await taskLogin(client)
        let operation = Task { try await client.taskArtifactBytes(taskID: "cmd-task", artifactID: "artifact-test") }
        await transport.waitUntilPaused(); operation.cancel(); await transport.release()
        await #expect(throws: CancellationError.self) { try await operation.value }
        #expect(await transport.requests().allSatisfy { !($0.url?.path.hasSuffix("/download") ?? false) })
    }

    @Test func unsafeTaskPathFailsBeforeAuthenticationAndNotFoundDoesNotBecomeEmptyTask() async throws {
        let missing = HTTPResponse(status: 404, body: taskJSON(["error": ["code": "NOT_FOUND"]]).body)
        let transport = TaskScriptTransport(taskLoginSteps() + [.init(path: "/auth/me", response: taskAuth()), .init(path: "/tasks/cmd-task", response: missing)])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        _ = try await taskLogin(client)
        await #expect(throws: APIFailure.invalidResponse) { try await client.taskDetail(taskID: "../other") }
        #expect(await transport.requests().count == 2)
        await #expect(throws: APIFailure.server(status: 404, code: "NOT_FOUND")) { try await client.taskDetail(taskID: "cmd-task") }
    }
}
