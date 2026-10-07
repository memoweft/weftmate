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
    func saveDraft(account: LocalAccountScope, conversationId: String, text: String) async throws { _ = try await store.saveDraft(account: account, conversationId: conversationId, text: text) }
}
private actor ContractHTTP: HTTPTransport {
    let sessionID = "session-11111111-1111-4111-8111-111111111111"
    private var commandBodies: [Data] = []
    private var uploadRequests: [URLRequest] = []
    private var uploads: [String: Data] = [:]
    private var originalBindings: [String: String] = [:]
    private var loseUpload = false
    private var shared = false
    private var command: [String: Any]?
    private var message: [String: Any]?
    private var taskRequests = 0
    func configure(loseUpload: Bool = false, shared: Bool = false) { self.loseUpload = loseUpload; self.shared = shared }
    func counts() -> (Int, Int, Int) { (commandBodies.count, uploadRequests.count, taskRequests) }
    func submitted() -> [Data] { commandBodies }
    func uploadAttempts() -> [URLRequest] { uploadRequests }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let path = request.url!.path
        let auth: [String: Any] = ["account": ["ownerId": "owner-test", "username": "tester", "displayName": "Test"],
            "device": ["id": "device-test", "name": "Mac"], "csrfToken": String(repeating: "b", count: 43)]
        var object: [String: Any] = [:], status = 200, headers: [String: String] = [:]
        if path.contains("/tasks/") { taskRequests += 1; throw Failed(message: "Unexpected task request for shared-chat") }
        if request.httpMethod == "PUT" {
            uploadRequests.append(request)
            let query = Dictionary(uniqueKeysWithValues: URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value!) })
            let bytes = request.httpBody!, id = request.url!.lastPathComponent
            let storageID = path + (query["variant"] ?? "")
            if path.hasPrefix("/personal/v1/sync/attachments/") {
                let binding = query["conversationId"]! + ":" + query["messageId"]!
                if let original = originalBindings[path] { try check(original == binding, "Original upload retry changed immutable message binding") }
                originalBindings[path] = binding
            }
            let duplicate = uploads[storageID] != nil
            if let old = uploads[storageID] { try check(old == bytes, "Upload retry changed original bytes") }
            uploads[storageID] = bytes
            let meta: [String: Any] = ["attachmentId": id, "name": query["name"] ?? "fixture.png", "contentType": request.value(forHTTPHeaderField: "Content-Type")!,
                "size": bytes.count, "sha256": request.value(forHTTPHeaderField: "X-WeftMate-SHA256")!]
            if loseUpload { loseUpload = false; throw APIFailure.transport(.timeout) }
            return .init(status: duplicate ? 200 : 201, body: try JSONSerialization.data(withJSONObject: ["attachment": meta, "duplicate": duplicate]))
        }
        if request.httpMethod == "GET", path.contains("/attachments/") {
            guard let bytes = uploads[path] else { return .init(status: 404, body: Data("{\"error\":{\"code\":\"NOT_FOUND\"}}".utf8)) }
            return .init(status: 200, headers: ["content-type": "text/plain"], body: bytes)
        }
        switch path {
        case "/personal/v1/auth/login": object = auth; headers["set-cookie"] = "wm_personal_session=" + String(repeating: "a", count: 43)
        case "/personal/v1/auth/me": object = auth
        case "/personal/v1/status": object = ["ownerId": "owner-test", "hostId": "host-test", "backend": ["capabilities": ["desktopOpenApp": ["available": !shared]]]]
        case "/personal/v1/auth/devices": object = ["devices": [["id": "device-test", "name": "Mac", "current": true]]]
        case "/personal/v1/sync/capabilities": object = ["deviceId": "device-test", "platform": "macos", "sharedConversations": 1]
        case "/personal/v1/sync/events": object = ["events": [], "nextSeq": 0, "hasMore": false]
        case "/personal/v1/sessions": object = ["sessions": [["sessionId": sessionID, "title": "Fixture", "running": false, "sendAvailable": true, "modelProfileId": "local"]]]
        case "/personal/v1/models": object = ["models": [["id": "local", "name": "Fixture", "model": "fixture", "configured": true]]]
        case "/personal/v1/commands":
            guard request.httpMethod == "POST", let body = request.httpBody else { throw Failed(message: "Unexpected commands request") }
            commandBodies.append(body)
            let payload = try JSONSerialization.jsonObject(with: body) as! [String: Any]
            command = ["commandId": "cmd-fixture-" + String(commandBodies.count), "requestId": payload["requestId"]!, "kind": "session.message", "sessionId": sessionID,
                "targetDeviceId": "host-test", "state": "accepted_by_dsh", "receiptId": "receipt-fixture"]
            message = ["text": payload["text"]!, "receiptId": "receipt-fixture"]
            for field in ["originalAttachments", "attachmentMessageId"] { message![field] = payload[field] }
            object = ["command": command!]; status = 202
        case let value where value.hasPrefix("/personal/v1/commands/by-request/"):
            if let command, request.url!.lastPathComponent == command["requestId"] as? String { object = ["command": command] }
            else { status = 404; object = ["error": ["code": "NOT_FOUND"]] }
        case "/personal/v1/sessions/" + sessionID + "/events":
            let after = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!.first { $0.name == "afterSeq" }?.value.flatMap(Int.init) ?? -1
            let events: [[String: Any]] = message.map { [
                ["seq": 0, "type": "turn.started", "data": ["turn": 1]], ["seq": 1, "type": "user.message", "data": $0],
                ["seq": 2, "type": "turn.ended", "data": ["turn": 1, "reason": "completed"]]] } ?? []
            object = ["events": events.filter { ($0["seq"] as! Int) > after }, "nextSeq": max(after, events.last?["seq"] as? Int ?? -1), "hasMore": false]
        default: throw Failed(message: "Unexpected isolated fixture route " + path)
        }
        return .init(status: status, headers: headers, body: try JSONSerialization.data(withJSONObject: object))
    }
}
@main private struct AppleContractStateChecks {
    @MainActor static func main() async throws {
        let directory = URL(fileURLWithPath: CommandLine.arguments[1])
        let store = try LocalConversationStore(directory: directory)
        let http = ContractHTTP()
        let client = PersonalClient(credentialStore: Credentials(), transport: http)
        let model = AppleAppModel(client: client, draftPersistence: Drafts(store: store),
            server: try ServerConfiguration(input: "https://a2.unit.example"), commandStore: store,
            endpointStore: try LocalEndpointOperationStore(directory: directory))
        await model.authenticate(username: "tester", password: "synthetic-only", displayName: nil, register: false)
        guard let conversation = model.conversations.first else { throw Failed(message: "No isolated conversation") }
        await model.open(conversation)
        let epoch = model.accountEpoch, key = AppleAppModel.draftKey(for: conversation)
        try check(model.taskSessionID(for: conversation, accountEpoch: epoch) != nil, "personal-remote missing task control")
        model.setDraft(String(repeating: "a", count: 8_193), for: conversation, accountEpoch: epoch)
        await model.send(conversation, accountEpoch: epoch)
        try check(await http.counts().0 == 0 && model.continuationNotices[key]?.contains("太长") == true, "UTF-16 overflow sent command")
        model.setDraft(String(repeating: "中", count: 4_100), for: conversation, accountEpoch: epoch)
        await model.send(conversation, accountEpoch: epoch)
        try check(await http.counts().0 == 0 && model.continuationNotices[key]?.contains("太长") == true, "JSON byte overflow sent command")
        print("PASS message UTF-16 and JSON byte overflow: input notice, no command")

        let file = directory.appendingPathComponent("fixture.txt"); try Data("attachment fixture 中文".utf8).write(to: file)
        model.setDraft("", for: conversation, accountEpoch: epoch)
        await model.addAttachments([file], to: conversation, accountEpoch: epoch)
        let original = model.attachmentDrafts[key]!.first!.original
        try check(model.canSend(conversation), "Attachment-only send unavailable")
        await http.configure(loseUpload: true)
        await model.send(conversation, accountEpoch: epoch)
        try check(await http.counts().0 == 0 && model.attachmentDrafts[key]?.count == 1, "Lost upload reply lost draft or submitted command")
        await model.send(conversation, accountEpoch: epoch)
        let requests = await http.uploadAttempts()
        try check(requests.count == 3 && requests[0].url == requests[1].url && requests[0].httpBody == requests[1].httpBody,
            "Retry changed original identity or bytes")
        let bodies = await http.submitted()
        let body = try JSONSerialization.jsonObject(with: bodies[0]) as! [String: Any]
        let stagedQuery = URLComponents(url: requests[2].url!, resolvingAgainstBaseURL: false)!.queryItems!
        try check(stagedQuery.first { $0.name == "requestId" }!.value == body["requestId"] as? String, "Staged upload not bound to same command request")
        try check(body["text"] as? String == "" && (body["originalAttachments"] as? [[String: Any]])?.count == 1 &&
            (body["attachments"] as? [[String: Any]])?.count == 1, "Attachment references missing")
        try check(model.attachmentDrafts[key] == nil && model.commandRows(for: conversation).count == 1, "Submitted files retained in composer")
        await model.open(conversation)
        try check(model.messages.first?.originalAttachments == [original], "History lost attachment metadata")
        let download = directory.appendingPathComponent("download.txt")
        try await client.downloadOriginalAttachment(original, to: download)
        try check(try Data(contentsOf: file) == Data(contentsOf: download), "Downloaded original did not match")
        print("PASS add file, attachment-only send, upload lost reply retry, original/staged references, history and verified download")

        // Four-file limit and readable text aggregate: no arbitrary binary is staged.
        let more = directory.appendingPathComponent("more.txt"); try Data(String(repeating: "中", count: 10_000).utf8).write(to: more)
        let draft = try ConversationAttachmentDraft.prepare(file: more)
        defer { draft.removeTemporaryFiles() }
        let first = try draft.stage(remainingTextBytes: 16_384, remainingBytes: 10_485_760)!
        try check(first.metadata.size <= 16_384 && (try Data(contentsOf: first.file)).count <= 16_384,
            "Text model prefix exceeded server byte limit")
        try check(try draft.stage(remainingTextBytes: 0, remainingBytes: 10_485_760) == nil, "Text aggregate limit ignored")
        await model.addAttachments([file, file, file, file, file], to: conversation, accountEpoch: epoch)
        try check(model.attachmentDrafts[key] == nil && model.continuationNotices[key]?.contains("4") == true, "Five attachments accepted")
        print("PASS attachment count and UTF-8 model prefix limits")

        await model.addAttachments([file], to: conversation, accountEpoch: epoch)
        await http.configure(loseUpload: true)
        await model.send(conversation, accountEpoch: epoch)
        let beforeEdit = await http.uploadAttempts().last!
        model.setDraft("修改后的文字", for: conversation, accountEpoch: epoch)
        await model.addAttachments([file], to: conversation, accountEpoch: epoch)
        await model.send(conversation, accountEpoch: epoch)
        let editedBodies = await http.submitted()
        try check(editedBodies.count == 2, "Editing text/files after lost upload failed to send")
        let editedBody = try JSONSerialization.jsonObject(with: editedBodies.last!) as! [String: Any]
        let immutableMessageID = URLComponents(url: beforeEdit.url!, resolvingAgainstBaseURL: false)!.queryItems!.first { $0.name == "messageId" }!.value!
        try check(editedBody["text"] as? String == "修改后的文字" && editedBody["attachmentMessageId"] as? String == immutableMessageID &&
            (editedBody["originalAttachments"] as? [[String: Any]])?.count == 2,
            "Edited retry changed original binding or sent stale text")
        print("PASS lost upload followed by edited text and added file retains original binding, sends current draft")

        await http.configure(shared: true)
        await model.refresh(); await model.open(conversation)
        let taskRequests = await http.counts().2
        try check(model.taskSessionID(for: conversation, accountEpoch: epoch) == nil && taskRequests == 0,
            "shared-chat exposed task detail/stop or requested tasks")
        model.closeConversation()
        print("PASS shared-chat has no task entry and no /tasks request; isolated HTTP/account/data only")
    }
}
