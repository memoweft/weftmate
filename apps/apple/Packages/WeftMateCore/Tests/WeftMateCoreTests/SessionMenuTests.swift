import Foundation
import Testing
@testable import WeftMateCore

private func row(_ id: String, pinned: Bool = false, group: String? = nil, archived: Bool = false) -> ConversationSummary {
    .init(id: id, title: id, conversationId: nil, sessionId: id, running: false, sendAvailable: true, originalModelLabel: nil, archived: archived, pinned: pinned, groupId: group)
}
@Test func a7MenuActionsAndScopedShortcutsMatchD34() {
    #expect(SessionMenuAction.allCases.map(\.rawValue) == ["pin", "unread", "rename", "fork", "project", "group", "archive", "delete"])
    #expect(SessionMenuAction.allCases.compactMap(\.shortcut) == ["p", "u", "r", "f", "a", "d"])
    let normal = row("synthetic")
    #expect(SessionMenuAction.allCases.map { $0.title(for: normal) } == ["置顶", "标记为未读", "重命名", "分叉", "移至项目", "移至分组", "归档", "删除"])
    let marked = ConversationSummary(id: "marked", title: "marked", conversationId: nil, sessionId: "marked", running: false, sendAvailable: true, originalModelLabel: nil, archived: true, pinned: true, unread: true)
    #expect(SessionMenuAction.pin.title(for: marked) == "取消置顶")
    #expect(SessionMenuAction.unread.title(for: marked) == "标记为已读")
    #expect(SessionMenuAction.archive.title(for: marked) == "恢复")
}
@Test func a7PinnedGroupAndUngroupedSectionsPreserveHostOrderAndSearch() {
    let rows = [row("plain"), row("grouped", group: "g"), row("pinned", pinned: true, group: "g"), row("removed-group", group: "missing"), row("archived", archived: true)]
    let sections = SessionSidebar.sections(rows: rows, groups: [.init(id: "g", name: "合成资料")])
    #expect(sections.map(\.id) == ["pinned", "g", "ungrouped"])
    #expect(sections.map { $0.rows.map(\.id) } == [["pinned"], ["grouped"], ["plain", "removed-group"]])
    #expect(SessionSidebar.sections(rows: rows, groups: [], query: "GROUPED").flatMap(\.rows).map(\.id) == ["grouped"])
}
private let previewJSON = #"{"worldRevision":4,"itemCount":3,"evidenceCount":1,"evidenceIds":["evidence"],"items":[{"id":"person","kind":"entity","text":"合成人物","itemType":"person"},{"id":"relation","kind":"relationship","text":"合成关系"},{"id":"decision","kind":"cognition","text":"合成决定","itemType":"decision"}]}"#
@Test func fg2ForgetPreviewIncludesCommitmentsWithoutChangingCommandKinds() throws {
    let json = #"{"worldRevision":4,"itemCount":3,"evidenceCount":1,"evidenceIds":["evidence"],"items":[{"id":"promise","kind":"interaction_commitment","text":"合成承诺","itemType":"commitment"},{"id":"recommendation","kind":"interaction_commitment","text":"合成建议","itemType":"recommendation"},{"id":"agreement","kind":"interaction_commitment","text":"合成约定","itemType":"agreement"}]}"#
    let preview = try JSONDecoder().decode(ForgetPreview.self, from: Data(json.utf8))
    try preview.validate(ownerID: "owner", expectedRevision: 4)
    #expect(preview.items.map(\.typeLabel) == ["交互承诺", "交互建议", "共同约定"])
    #expect(preview.items.allSatisfy { $0.kind == .interactionCommitment })
    #expect(MemoryKind(rawValue: "interaction_commitment") == nil)
}
@Test func a7ForgetPreviewShowsCascadeTypesCountsAndStartsUnchecked() throws {
    let preview = try JSONDecoder().decode(ForgetPreview.self, from: Data(previewJSON.utf8))
    try preview.validate(ownerID: "owner", expectedRevision: 4)
    #expect(preview.items.map(\.summary) == ["合成人物（人物）", "合成关系（关系）", "合成决定（决定）"])
    #expect(preview.summary == "将忘掉 3 项记忆，清除 1 条来源。以下内容会一起忘掉：")
    var state = ForgetConfirmationState()
    #expect(!state.canConfirm && !state.deleteConversationSnippets)
    state.preview = preview
    #expect(state.canConfirm)
    state.deleteConversationSnippets = true
    state = .init()
    #expect(!state.canConfirm && !state.deleteConversationSnippets)
    #expect(throws: APIFailure.self) { try preview.validate(ownerID: "owner", expectedRevision: 5) }
}
@Test func a7ForgetPreviewRejectsWrongOwnerAndMalformedCounts() throws {
    for bad in [previewJSON.replacingOccurrences(of: "\"itemCount\":3", with: "\"itemCount\":2"), previewJSON.replacingOccurrences(of: "\"worldRevision\":4", with: "\"ownerId\":\"other\",\"worldRevision\":4")] {
        let preview = try JSONDecoder().decode(ForgetPreview.self, from: Data(bad.utf8))
        #expect(throws: APIFailure.self) { try preview.validate(ownerID: "owner", expectedRevision: 4) }
    }
}
private actor MenuTransport: HTTPTransport {
    var requests: [URLRequest] = []
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let path = request.url!.path
        var json = "{}"
        if path.hasSuffix("/auth/login") || path.hasSuffix("/auth/me") {
            json = #"{"account":{"ownerId":"owner","username":"synthetic","displayName":"合成"},"device":{"id":"device","name":"合成设备"},"csrfToken":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}"#
        } else if path.hasSuffix("/status") { json = #"{"ownerId":"owner","hostId":"host"}"# }
        else {
            requests.append(request)
            if path.hasSuffix("/metadata") { json = #"{"sessionId":"session"}"# }
            else if path.hasSuffix("/fork") { json = #"{"sessionId":"child","title":"合成（分叉）"}"# }
            else if path.hasSuffix("/forget-preview") { json = previewJSON }
            else if path.hasSuffix("/session-groups") { json = request.httpMethod == "POST" ? #"{"group":{"id":"g","name":"合成"}}"# : #"{"groups":[{"id":"g","name":"合成"}]}"# }
            else { json = #"{"sessionId":"session","deleted":true,"forgetMemories":true,"forgottenEvidenceCount":1}"# }
        }
        return .init(status: 200, headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)], body: Data(json.utf8))
    }
    func recorded() -> [URLRequest] { requests }
}
@Test func a7AuthenticatedSessionAndPreviewPathsUseRevisionAndExplicitOption() async throws {
    let transport = MenuTransport(), client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
    let session = try await client.login(server: ServerConfiguration(input: "https://menu.example.com"), username: "synthetic", password: "synthetic-only", deviceName: "Mac")
    _ = try await client.updateSessionMetadata(sessionID: "session", pinned: true, unread: false, title: "新标题", changeGroup: true)
    _ = try await client.sessionGroups(); _ = try await client.createSessionGroup(name: "合成")
    #expect(try await client.forkSession(sessionID: "session").sessionId == "child")
    _ = try await client.sessionForgetPreview(sessionID: "session")
    _ = try await client.memoryForgetPreview(kind: .cognition, itemID: "item", expectedRevision: 4)
    _ = try await client.memoryForgetPreview(kind: .cognition, itemID: "item", evidenceID: "source", expectedRevision: 4)
    _ = try await client.deleteSession(sessionID: "session", forgetMemories: true, memoryWorldRevision: 4)
    let requests = await transport.recorded()
    #expect(requests.allSatisfy { $0.value(forHTTPHeaderField: "Cookie") != nil })
    #expect(requests.filter { $0.httpMethod != "GET" }.allSatisfy { $0.value(forHTTPHeaderField: "X-WeftMate-CSRF") != nil })
    let metadata = try JSONSerialization.jsonObject(with: requests[0].httpBody!) as! [String: Any]
    #expect(metadata["groupId"] is NSNull); #expect(metadata["pinned"] as? Bool == true)
    let deletion = try JSONSerialization.jsonObject(with: requests.last!.httpBody!) as! [String: Any]
    #expect(deletion["memoryWorldRevision"] as? Int == 4 && deletion["deleteConversationSnippets"] as? Bool == false)
    let intent = try MemoryMutationIntent(session: session, operation: .deleteItem, itemKind: .cognition, targetID: "item", requestID: "synthetic-delete", expectedWorldRevision: 4, deleteConversationSnippets: true)
    #expect(try JSONDecoder().decode(MemoryMutationIntent.self, from: JSONEncoder().encode(intent)) == intent)
    #expect(try (JSONSerialization.jsonObject(with: intent.payload) as! [String: Any])["deleteConversationSnippets"] as? Bool == true)
}
