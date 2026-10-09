import Foundation
import Testing
@testable import WeftMateCore

private let projectJSON = #"{"projectId":"project-synthetic","name":"合成资料","instructions":"只使用合成内容。","permission":"write","revision":3,"revoked":false,"createdAt":"2050-01-01T00:00:00Z"}"#
private func project() throws -> Project { try JSONDecoder().decode(Project.self, from: Data(projectJSON.utf8)) }
@Test func a11ProjectModelsLegacyDefaultsAndTransientFolderDraft() throws {
    let p = try project()
    #expect(p.permission == .write && p.instructions == "只使用合成内容。" && p.revision == 3)
    let old = try JSONDecoder().decode(Project.self, from: Data(#"{"projectId":"old","name":"旧资料","revision":1,"revoked":false,"createdAt":"2050-01-01"}"#.utf8))
    #expect(old.permission == .readOnly && old.instructions.isEmpty)
    var draft = ProjectDraft(); draft.selectFolder(URL(fileURLWithPath: "/Synthetic/A11Folder", isDirectory: true))
    #expect(draft.name == "A11Folder" && draft.permission == .write && draft.valid)
    draft.name = "指定名称"; draft.selectFolder(URL(fileURLWithPath: "/Synthetic/Other"))
    #expect(draft.name == "指定名称")
    #expect(!String(decoding: try JSONEncoder().encode(p), as: UTF8.self).contains("rootPath"))
}
@Test func a11LocalFolderRequiresTrustedHostIdentityAndManagement() {
    #expect(!ProjectPresentation.canChooseLocalFolder(canManage: true, hostID: "windows-host", localHostID: nil, platform: .macOS))
    #expect(!ProjectPresentation.canChooseLocalFolder(canManage: true, hostID: "windows-host", localHostID: "mac-host", platform: .macOS))
    #expect(!ProjectPresentation.canChooseLocalFolder(canManage: false, hostID: "mac-host", localHostID: "mac-host", platform: .macOS))
    #expect(!ProjectPresentation.canChooseLocalFolder(canManage: true, hostID: "mac-host", localHostID: "mac-host", platform: .iOS))
    #expect(ProjectPresentation.canChooseLocalFolder(canManage: true, hostID: "mac-host", localHostID: "mac-host", platform: .macOS))
}
@Test func a11PinnedProjectConversationStaysOutOfOrdinaryGroupsAndCachesMetadata() throws {
    let row = ConversationSummary(id: "project-row", title: "合成", conversationId: "phone-conversation", sessionId: "session", running: false, sendAvailable: true, originalModelLabel: nil, pinned: true, projectId: "project-synthetic", projectName: "合成资料", projectNotice: ProjectPresentation.moveNotice, taskAvailable: false)
    #expect(SessionSidebar.sections(rows: [row], groups: []).isEmpty)
    let cached = try LocalCachedConversationSummary(conversation: row, hostId: "host")
    let restored = try JSONDecoder().decode(LocalCachedConversationSummary.self, from: JSONEncoder().encode(cached)).conversation
    #expect(restored.projectId == row.projectId && restored.projectNotice == row.projectNotice && restored.taskAvailable == false)
    #expect(restored.conversationId == "phone-conversation" && restored.sessionId == "session")
}
@Test func a11RestrictedPresentationAndOldHostCompatibility() {
    #expect(!ProjectPresentation.taskEnabled(taskAvailable: false, executionAccount: nil))
    #expect(!ProjectPresentation.taskEnabled(taskAvailable: nil, executionAccount: false))
    #expect(ProjectPresentation.taskEnabled(taskAvailable: nil, executionAccount: nil))
    #expect(ProjectPresentation.restrictedNotice == "这台电脑已有执行账号。当前账号仅可聊天，不能操作电脑或读取原账号资料；请在电脑退出后登录原账号。")
    #expect(ProjectPresentation.removalNotice.contains("不删除文件夹里的任何文件"))
}
private actor ProjectHTTP: HTTPTransport {
    var requests: [URLRequest] = []
    var receipt: [String: Any]? // actor-isolated synthetic response
    var loseReply = false
    var conflict = false
    var executionAccount = true
    func options(loseReply: Bool = false, conflict: Bool = false, executionAccount: Bool = true) { self.loseReply = loseReply; self.conflict = conflict; self.executionAccount = executionAccount }
    func recorded() -> [URLRequest] { requests }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        requests.append(request)
        let path = request.url!.path, method = request.httpMethod ?? "GET"
        var status = 200
        var data = Data("{}".utf8)
        if path.hasSuffix("/auth/login") || path.hasSuffix("/auth/me") {
            data = Data(#"{"account":{"ownerId":"owner","username":"synthetic","displayName":"合成"},"device":{"id":"device","name":"Mac"},"csrfToken":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}"#.utf8)
        } else if path.hasSuffix("/status") {
            data = try JSONSerialization.data(withJSONObject: ["ownerId":"owner", "hostId":"host", "executionAccount":executionAccount])
        } else if path.hasSuffix("/sync/events") { data = Data(#"{"events":[],"nextSeq":0,"hasMore":false}"#.utf8) }
        else if path.hasSuffix("/sessions") && method == "GET" {
            data = Data(#"{"sessions":[{"sessionId":"session","title":"合成","running":false,"sendAvailable":true,"taskAvailable":false,"projectId":"project-synthetic","projectName":"合成资料","projectNotice":"从下一回合使用项目文件夹","modelProfileId":"m"},{"sessionId":"legacy","title":"旧会话","running":false,"sendAvailable":true,"modelProfileId":"m"}]}"#.utf8)
        } else if path.contains("/commands/by-request/") {
            if let receipt { data = try JSONSerialization.data(withJSONObject: ["command":receipt]) }
            else { status = 404; data = Data(#"{"error":{"code":"NOT_FOUND"}}"#.utf8) }
        } else if path.hasSuffix("/projects/project-synthetic/sessions") {
            let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
            receipt = ["requestId":body["requestId"]!,"commandId":"command","kind":"session.create","targetDeviceId":"host","sessionId":"session","state":"accepted_by_dsh"]
            if loseReply { loseReply = false; throw APIFailure.transport(.timeout) }
            data = try JSONSerialization.data(withJSONObject: ["command":receipt!])
        } else if path.hasSuffix("/metadata") { data = Data(#"{"sessionId":"session","projectId":"project-synthetic","projectNotice":"从下一回合使用项目文件夹"}"#.utf8) }
        else if path.contains("/projects") {
            if conflict && method == "PATCH" { status = 409; data = Data(#"{"error":{"code":"PROJECT_REVISION_CHANGED"}}"#.utf8) }
            else if method == "DELETE" { data = Data(#"{"deleted":true,"projectId":"project-synthetic"}"#.utf8) }
            else if method == "GET" { data = Data(("{\"projects\":[" + projectJSON + "],\"canManage\":true}").utf8) }
            else { data = Data(("{\"project\":" + projectJSON + "}").utf8) }
        }
        return .init(status: status, headers: ["set-cookie":"wm_personal_session=" + String(repeating: "a", count: 43)], body: data)
    }
}
private func logged(_ http: ProjectHTTP) async throws -> (PersonalClient, AccountSession) {
    let client = PersonalClient(credentialStore: MemoryStore(), transport: http)
    let session = try await client.login(server: ServerConfiguration(input: "https://projects.example.com"), username: "synthetic", password: "synthetic-only", deviceName: "Mac")
    return (client, session)
}
@Test func a11ProjectWritesUseCookieCSRFAndExpectedRevisionWithoutPublishingPaths() async throws {
    let http = ProjectHTTP(), (client, _) = try await logged(http)
    let p = try project(); var draft = ProjectDraft(project: p); draft.rootPath = "/Synthetic/A11Folder"
    #expect(try await client.projects().canManage)
    _ = try await client.createProject(draft); _ = try await client.updateProject(p, draft: draft); _ = try await client.removeProject(p)
    let writes = await http.recorded().filter { ["POST", "PATCH", "DELETE"].contains($0.httpMethod) && $0.url!.path.contains("/projects") }
    #expect(writes.count == 3 && writes.allSatisfy { $0.value(forHTTPHeaderField: "Cookie") != nil && $0.value(forHTTPHeaderField: "X-WeftMate-CSRF") != nil })
    let patch = try JSONSerialization.jsonObject(with: writes[1].httpBody!) as! [String: Any]
    #expect(patch["expectedRevision"] as? Int == 3 && patch["rootPath"] == nil)
    await http.options(conflict: true)
    await #expect(throws: APIFailure.server(status: 409, code: "PROJECT_REVISION_CHANGED")) { try await client.updateProject(p, draft: draft) }
    #expect(ProjectPresentation.error(APIFailure.server(status: 409, code: "PROJECT_REVISION_CHANGED")) == "项目已在其他设备更新，请关闭并重新打开设置。")
}
@Test func a11MoveProjectAndMoveOutEncodeExplicitNullAndPreserveNotice() async throws {
    let http = ProjectHTTP(), (client, _) = try await logged(http)
    let moved = try await client.updateSessionMetadata(sessionID: "session", projectID: "project-synthetic", changeProject: true)
    _ = try await client.updateSessionMetadata(sessionID: "session", changeProject: true)
    #expect(moved.projectId == "project-synthetic" && moved.projectNotice?.contains("下一回合") == true)
    let writes = await http.recorded().filter { $0.url!.path.hasSuffix("/metadata") }
    #expect(try (JSONSerialization.jsonObject(with: writes[0].httpBody!) as! [String: Any])["projectId"] as? String == "project-synthetic")
    #expect(try (JSONSerialization.jsonObject(with: writes[1].httpBody!) as! [String: Any])["projectId"] is NSNull)
}
@Test func a11ProjectCreationLostReplyRecoversOriginalPersistedRequestWithoutDuplicatePost() async throws {
    let http = ProjectHTTP(), (client, session) = try await logged(http)
    let intent = try SharedCommandIntent(session: session, command: SharedCommandPayload(requestId: "project-create-original", kind: .create, targetDeviceId: "host", modelProfileId: "m", projectId: "project-synthetic"))
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("a11-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: folder) }
    let local = try LocalConversationStore(directory: folder)
    _ = try await local.persist(intent)
    await http.options(loseReply: true)
    await #expect(throws: APIFailure.transport(.timeout)) { try await client.reconcileCommand(intent, allowSubmission: true) }
    let reopened = try LocalConversationStore(directory: folder)
    let record = try await reopened.commands(account: LocalAccountScope(server: session.server, ownerId: session.account.ownerId)).first!
    #expect(record.intent == intent)
    let result = try await client.reconcileCommand(record.intent, allowSubmission: true)
    guard case .found(let receipt) = result else { Issue.record("Missing original receipt"); return }
    #expect(receipt.sessionId == "session")
    #expect(await http.recorded().filter { $0.httpMethod == "POST" && $0.url!.path.hasSuffix("/projects/project-synthetic/sessions") }.count == 1)
    let post = await http.recorded().first { $0.httpMethod == "POST" && $0.url!.path.hasSuffix("/projects/project-synthetic/sessions") }!
    #expect(try Set((JSONSerialization.jsonObject(with: post.httpBody!) as! [String: Any]).keys) == ["requestId", "modelProfileId"])
}
@Test func a11RestrictedSessionExcludedFromTaskControlsWithStatusFallback() async throws {
    let http = ProjectHTTP(), (client, _) = try await logged(http)
    #expect(try await client.taskControlSessionIDs() == ["legacy"])
    let rows = try await client.conversations()
    #expect(rows.first { $0.sessionId == "session" }?.taskAvailable == false)
    #expect(rows.first { $0.sessionId == "session" }?.projectId == "project-synthetic")
    await http.options(executionAccount: false)
    #expect(try await client.taskControlSessionIDs().isEmpty)
    #expect(try await client.nativeUpdateStatus().executionAccount == false)
    #expect(await http.recorded().allSatisfy { !$0.url!.path.contains("/tasks/") })
}
