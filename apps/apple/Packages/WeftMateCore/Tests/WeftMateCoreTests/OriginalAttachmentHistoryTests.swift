import Foundation
import Testing
@testable import WeftMateCore

private let originalFileID = "attachment-11111111-1111-4111-8111-111111111111"
private let originalMessageID = "message-22222222-2222-4222-8222-222222222222"
private func originalFile(_ changes: [String: Any] = [:]) -> [String: Any] {
    var value: [String: Any] = ["attachmentId": originalFileID, "name": "notes.csv",
        "contentType": "text/csv", "size": 12, "sha256": String(repeating: "a", count: 64)]
    value.merge(changes) { _, new in new }; return value
}
private func attachmentPage(_ data: [String: Any], type: String = "user.message") throws -> Data {
    try JSONSerialization.data(withJSONObject: ["events": [["seq": 0, "type": type, "data": data]],
        "nextSeq": 0, "hasMore": false], options: [.sortedKeys])
}
private func attachmentJSON(_ object: [String: Any]) throws -> Data {
    try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
}
private func originalImage() -> [String: Any] {
    originalFile(["name": "原始图片.png", "contentType": "image/png", "size": 1_073_741_824])
}
private func imagePreview() -> [String: Any] {
    ["attachmentId": "sha256:" + String(repeating: "a", count: 64), "contentType": "image/png",
     "size": 12, "width": 1, "height": 1, "name": "preview.png"]
}
private let attachmentOrigin = "https://attachment-history.example"
private let attachmentConversationID = "conversation-33333333-3333-4333-8333-333333333333"
private func attachmentAuth() throws -> HTTPResponse {
    .init(status: 200, headers: ["Set-Cookie": "wm_personal_session=" + String(repeating: "a", count: 43) + "; HttpOnly; Secure"],
        body: try attachmentJSON(["account": ["ownerId": "owner-A", "username": "test", "displayName": "Test", "profileRevision": 0],
            "device": ["id": "device-Mac", "name": "Mac", "expiresAt": "2027-01-01T00:00:00Z"],
            "csrfToken": String(repeating: "b", count: 43)]))
}
private actor AttachmentHistoryTransport: HTTPTransport {
    struct Step: Sendable { let path: String; let response: HTTPResponse }
    private var steps: [Step]
    private var recorded: [URLRequest] = []
    init(_ steps: [Step]) { self.steps = steps }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        recorded.append(request)
        guard !steps.isEmpty else { throw APIFailure.invalidResponse }
        let step = steps.removeFirst()
        let actual = (request.url?.path ?? "") + (request.url?.query.map { "?" + $0 } ?? "")
        guard actual == "/personal/v1" + step.path else { throw APIFailure.invalidResponse }
        return step.response
    }
    func requests() -> [URLRequest] { recorded }
    func remaining() -> Int { steps.count }
}
private func attachmentLegacyClient(hostPage: Data? = nil, syncPage: Data? = nil) async throws
    -> (PersonalClient, ConversationSummary, AttachmentHistoryTransport) {
    let auth = try attachmentAuth()
    func step(_ path: String, _ data: Data) -> AttachmentHistoryTransport.Step {
        .init(path: path, response: .init(status: 200, headers: [:], body: data))
    }
    let sync = try syncPage ?? attachmentJSON(["events": [], "nextSeq": 0, "hasMore": false])
    let sessions: Data = try attachmentJSON(["sessions": hostPage == nil ? [] : [
        ["sessionId": "session-test", "title": "Host", "running": false, "sendAvailable": false]]])
    var steps: [AttachmentHistoryTransport.Step] = [
        .init(path: "/auth/login", response: auth),
        step("/status", try attachmentJSON(["ownerId": "owner-A", "hostId": "host-test"])),
        .init(path: "/auth/me", response: auth), step("/sync/events?afterSeq=0&limit=100", sync),
        step("/sessions", sessions), .init(path: "/auth/me", response: auth)]
    if let hostPage {
        steps.append(step("/sessions/session-test/events?afterSeq=-1&limit=100", hostPage))
    } else {
        steps.append(step("/sync/events?afterSeq=0&limit=100", sync))
        steps.append(step("/sync/conversations/\(attachmentConversationID)/shared",
            try attachmentJSON(["source": "host", "conversationId": attachmentConversationID, "hostId": "host-test"])))
    }
    let transport = AttachmentHistoryTransport(steps)
    let client = PersonalClient(credentialStore: MemoryStore(), transport: transport, platform: .macOS)
    _ = try await client.login(server: ServerConfiguration(input: attachmentOrigin),
        username: "test", password: "synthetic-fixture-only", deviceName: "Mac")
    let conversations = try await client.conversations()
    return (client, try #require(conversations.first), transport)
}
private func attachmentCacheDirectory() throws -> URL {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("weftmate-attachment-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
        attributes: [.posixPermissions: 0o700])
    return directory
}
private func attachmentScope(_ owner: String = "owner-A") throws -> LocalAccountScope {
    try .init(server: ServerConfiguration(input: attachmentOrigin), ownerId: owner)
}

@Suite("Original attachment history compatibility")
struct OriginalAttachmentHistoryTests {
    @Test func fileOnlyHistoryKeepsItsMessage() throws {
        let raw = try attachmentPage(["text": "", "originalAttachments": [originalFile()],
            "attachmentMessageId": originalMessageID])
        let page = try SharedHistoryPage.decode(raw, sessionID: "session-test", afterSeq: -1)
        #expect(page.messages.count == 1)
        #expect(page.messages.first?.text == "")
        #expect(page.messages.first?.attachmentCount == 1)
    }

    @Test func largeOriginalImageWithoutPreviewKeepsFallbackMetadata() throws {
        let raw = try attachmentPage(["text": "", "images": [], "originalAttachments": [originalImage()],
            "attachmentMessageId": originalMessageID, "unpreviewedOriginalImageIds": [originalFileID]])
        let page = try SharedHistoryPage.decode(raw, sessionID: "session-test", afterSeq: -1)
        let message = try #require(page.messages.first)
        #expect(message.text.isEmpty && message.attachmentCount == 1)
        #expect(message.originalAttachments.first?.size == 1_073_741_824)
        #expect(message.originalAttachments.first?.isImage == true)
        #expect(message.unpreviewedOriginalImageIds == [originalFileID])
        #expect(message.attachmentMessageId == originalMessageID)
        #expect(message.id == "host|session-test|0")
    }

    @Test func previewAndOriginalAreNotCountedTwiceAndOldPreviewStillWorks() throws {
        let combined = try attachmentPage(["text": "", "images": [imagePreview()],
            "originalAttachments": [originalImage()], "attachmentMessageId": originalMessageID])
        let combinedMessage = try #require(SharedHistoryPage.decode(combined, sessionID: "session-test", afterSeq: -1).messages.first)
        #expect(combinedMessage.attachmentCount == 1)
        #expect(combinedMessage.originalAttachments.count == 1)
        let old = try attachmentPage(["text": "", "images": [imagePreview(), imagePreview()]])
        let oldMessage = try #require(SharedHistoryPage.decode(old, sessionID: "session-test", afterSeq: -1).messages.first)
        #expect(oldMessage.attachmentCount == 2)
        #expect(oldMessage.originalAttachments.isEmpty && oldMessage.unpreviewedOriginalImageIds.isEmpty)
        #expect(oldMessage.attachmentMessageId == nil)
    }

    @Test func invalidOriginalMetadataFailsInsteadOfGrantingDisplayOrDownloadIdentity() throws {
        let invalid: [[String: Any]] = [
            originalFile(["attachmentId": "not-a-sync-id"]), originalFile(["name": "../notes.csv"]),
            originalFile(["name": "bad\u{7f}.csv"]), originalFile(["name": String(repeating: "界", count: 129)]),
            originalFile(["contentType": "text/csv; charset=utf-8"]), originalFile(["size": 0]),
            originalFile(["size": 1_073_741_825]), originalFile(["size": 1.5]),
            originalFile(["sha256": String(repeating: "A", count: 64)])]
        for file in invalid {
            let raw = try attachmentPage(["text": "message", "originalAttachments": [file]])
            #expect(throws: APIFailure.invalidResponse) { try SharedHistoryPage.decode(raw, sessionID: "session-test", afterSeq: -1) }
        }
        for files in [[originalFile(), originalFile()], Array(repeating: originalFile(), count: 5)] {
            let raw = try attachmentPage(["text": "message", "originalAttachments": files])
            #expect(throws: APIFailure.invalidResponse) { try SharedHistoryPage.decode(raw, sessionID: "session-test", afterSeq: -1) }
        }
        // The documented filename limit counts Unicode scalars, rather than UTF-8 bytes.
        let boundary = try attachmentPage(["text": "", "originalAttachments": [originalFile(["name": String(repeating: "界", count: 128)])]])
        #expect(try SharedHistoryPage.decode(boundary, sessionID: "session-test", afterSeq: -1).messages.count == 1)
    }

    @Test func newOptionalFieldsRejectMalformedValuesAndAcceptNullOrMissing() throws {
        let invalid: [[String: Any]] = [
            ["attachmentMessageId": "message-not-a-uuid"], ["attachmentMessageId": 123],
            ["unpreviewedOriginalImageIds": ["invalid"]], ["unpreviewedOriginalImageIds": originalFileID],
            ["unpreviewedOriginalImageIds": [originalFileID, originalFileID]], ["originalAttachments": "not-an-array"]]
        for addition in invalid {
            var data: [String: Any] = ["text": "old message"]
            data.merge(addition) { _, new in new }
            let raw = try attachmentPage(data)
            #expect(throws: APIFailure.invalidResponse) { try SharedHistoryPage.decode(raw, sessionID: "session-test", afterSeq: -1) }
        }
        for addition in [[:], ["originalAttachments": NSNull(), "attachmentMessageId": NSNull(),
                               "unpreviewedOriginalImageIds": NSNull()]] as [[String: Any]] {
            var data: [String: Any] = ["text": "old message"]; data.merge(addition) { _, new in new }
            let page = try SharedHistoryPage.decode(attachmentPage(data), sessionID: "session-test", afterSeq: -1)
            #expect(page.messages.first?.text == "old message")
            #expect(page.messages.first?.attachmentCount == 0)
        }
    }

    @Test func legacyDirectHistoryPreservesFileOnlyLargeImageAndExistingPreviewCounts() async throws {
        let events: [[String: Any]] = [
            ["seq": 0, "type": "user.message", "data": ["text": "", "originalAttachments": [originalFile()], "attachmentMessageId": originalMessageID]],
            ["seq": 1, "type": "user.message", "data": ["text": "", "images": [], "originalAttachments": [originalImage()],
                "attachmentMessageId": originalMessageID, "unpreviewedOriginalImageIds": [originalFileID]]],
            ["seq": 2, "type": "user.message", "data": ["text": "", "images": [imagePreview()],
                "originalAttachments": [originalImage()]]],
            ["seq": 3, "type": "assistant.message", "data": ["text": "old answer", "images": [imagePreview(), imagePreview()], "truncated": true]]]
        let (client, conversation, transport) = try await attachmentLegacyClient(
            hostPage: attachmentJSON(["events": events, "nextSeq": 3, "hasMore": false]))
        let messages = try await client.history(conversation: conversation)
        #expect(messages.map(\.id) == (0...3).map { "host|session-test|\($0)" })
        #expect(messages.map(\.attachmentCount) == [1, 1, 1, 2])
        #expect(messages[0].text.isEmpty && messages[0].originalAttachments.first?.name == "notes.csv")
        #expect(messages[1].unpreviewedOriginalImageIds == [originalFileID])
        #expect(messages[1].originalAttachments.first?.size == 1_073_741_824)
        #expect(messages[3].truncated && messages.allSatisfy { !$0.pendingContext })
        #expect(await client.cachedHistory(conversationID: conversation.id) == messages)
        #expect(await transport.remaining() == 0)
        let requests = await transport.requests()
        #expect(requests.dropFirst().allSatisfy { $0.httpMethod == "GET" })
        #expect(!requests.contains { $0.url?.path.contains("/attachments") == true })
    }

    @Test func legacySyncFileOnlyKeepsOriginalMetadataWithoutChangingSourceIdentity() async throws {
        let payload: [String: Any] = ["messageId": originalMessageID, "role": "user", "text": "",
            "attachments": [originalFile()], "attachmentMessageId": originalMessageID]
        let events: [[String: Any]] = [
            ["seq": 1, "sourceDeviceId": "device-Phone", "eventId": "event-created", "conversationId": attachmentConversationID,
             "kind": "conversation.created", "occurredAt": "2026-10-05T00:00:00Z", "payload": ["title": "Phone"]],
            ["seq": 2, "sourceDeviceId": "device-Phone", "eventId": "event-file", "conversationId": attachmentConversationID,
             "kind": "message.created", "occurredAt": "2026-10-05T00:00:01Z", "payload": payload]]
        let (client, conversation, transport) = try await attachmentLegacyClient(
            syncPage: attachmentJSON(["events": events, "nextSeq": 2, "hasMore": false]))
        let messages = try await client.history(conversation: conversation)
        let message = try #require(messages.first)
        #expect(messages.count == 1 && message.text.isEmpty && message.attachmentCount == 1)
        #expect(message.id == "sync|device-Phone|" + originalMessageID)
        #expect(message.sourceDeviceId == "device-Phone" && !message.pendingContext)
        #expect(message.originalAttachments.first?.name == "notes.csv")
        #expect(message.attachmentMessageId == originalMessageID)
        #expect(await transport.remaining() == 0)
    }

    @Test func syncHistoryRetainsEightOriginalsWhileCommandsStayAtFour() async throws {
        let originals = (0..<8).map { index in originalFile(["attachmentId": "attachment-" + UUID().uuidString.lowercased(), "name": "file-\(index).csv"]) }
        let payload: [String: Any] = ["messageId": originalMessageID, "role": "user", "text": "", "attachments": originals]
        let events: [[String: Any]] = [
            ["seq": 1, "sourceDeviceId": "device-Phone", "eventId": "event-created", "conversationId": attachmentConversationID,
             "kind": "conversation.created", "occurredAt": "2026-10-05T00:00:00Z", "payload": ["title": "Phone"]],
            ["seq": 2, "sourceDeviceId": "device-Phone", "eventId": "event-eight", "conversationId": attachmentConversationID,
             "kind": "message.created", "occurredAt": "2026-10-05T00:00:01Z", "payload": payload]]
        let (client, conversation, _) = try await attachmentLegacyClient(syncPage: attachmentJSON(["events": events, "nextSeq": 2, "hasMore": false]))
        let messages = try await client.history(conversation: conversation)
        let message = try #require(messages.first)
        #expect(message.originalAttachments.count == 8 && message.attachmentCount == 8)
        let directory = try attachmentCacheDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
        let store = try LocalConversationStore(directory: directory), account = try attachmentScope()
        _ = try await store.cacheHistory(account: account, conversationKey: "conversation:" + attachmentConversationID, hostId: "host-test", sessionId: nil, messages: messages)
        let reopened = try LocalConversationStore(directory: directory)
        #expect(try await reopened.cachedHistory(account: account, conversationKey: "conversation:" + attachmentConversationID, hostId: "host-test", sessionId: nil)?.messages.first?.originalAttachments.count == 8)
        #expect(throws: APIFailure.invalidResponse) { try AttachmentLimits.validate(staged: nil, originals: message.originalAttachments, messageID: originalMessageID) }
    }

    @Test func legacyInvalidNewMetadataFailsWithoutCachingPartialHistory() async throws {
        for invalid in [["originalAttachments": [originalFile(["size": 1.5])]],
                        ["attachmentMessageId": 123], ["unpreviewedOriginalImageIds": ["invalid"]]] as [[String: Any]] {
            var data: [String: Any] = ["text": "do not cache malformed"]; data.merge(invalid) { _, new in new }
            let (client, conversation, transport) = try await attachmentLegacyClient(hostPage: attachmentPage(data))
            await #expect(throws: APIFailure.invalidResponse) { try await client.history(conversation: conversation) }
            #expect(await client.cachedHistory(conversationID: conversation.id) == nil)
            #expect(await transport.remaining() == 0)
        }
    }

    @Test func actualCacheReopenPreservesAllAttachmentFieldsAndOwnerIsolation() async throws {
        let directory = try attachmentCacheDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
        let account = try attachmentScope()
        let page = try SharedHistoryPage.decode(attachmentPage(["text": "", "images": [], "originalAttachments": [originalImage()],
            "attachmentMessageId": originalMessageID, "unpreviewedOriginalImageIds": [originalFileID]]),
            sessionID: "session-test", afterSeq: -1)
        let store = try LocalConversationStore(directory: directory)
        _ = try await store.cacheHistory(account: account, conversationKey: "session:session-test", hostId: "host-test",
            sessionId: "session-test", messages: page.messages, observedThroughSeq: 0)
        let restarted = try LocalConversationStore(directory: directory)
        let cached = try #require(await restarted.cachedHistory(account: account, conversationKey: "session:session-test",
            hostId: "host-test", sessionId: "session-test"))
        #expect(cached.messages == page.messages)
        #expect(cached.cachedMessages.first?.hostSequence == 0 && cached.rebuildAfterSeq == -1)
        #expect(cached.messages.first?.attachmentCount == 1)
        #expect(try await restarted.cachedHistory(account: attachmentScope("owner-B"), conversationKey: "session:session-test",
            hostId: "host-test", sessionId: "session-test") == nil)
        #expect(try await restarted.cachedHistory(account: account, conversationKey: "session:session-test",
            hostId: "host-other", sessionId: "session-test") == nil)
        let raw = try Data(contentsOf: directory.appendingPathComponent(LocalConversationStore.fileName))
        let text = String(decoding: raw, as: UTF8.self)
        #expect(text.contains("originalAttachments") && text.contains("attachmentMessageId") && text.contains("unpreviewedOriginalImageIds"))
        #expect(!text.contains("Cookie") && !text.contains("csrfToken"))
    }

    @Test func oldSchemaTwoCacheWithoutOptionalFieldsReopensAndRoundTrips() async throws {
        let directory = try attachmentCacheDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
        let account = try attachmentScope()
        let store = try LocalConversationStore(directory: directory)
        let old = ChatMessage(id: "host|session-test|0", role: .user, text: "old snapshot", occurredAt: nil,
            sourceDeviceId: nil, attachmentCount: 2, truncated: true, pendingContext: false)
        _ = try await store.cacheHistory(account: account, conversationKey: "session:session-test", hostId: "host-test",
            sessionId: "session-test", messages: [old], observedThroughSeq: 0)
        let file = directory.appendingPathComponent(LocalConversationStore.fileName)
        var envelope = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        var histories = try #require(envelope["histories"] as? [[String: Any]])
        var messages = try #require(histories[0]["cachedMessages"] as? [[String: Any]])
        for key in ["originalAttachments", "attachmentMessageId", "unpreviewedOriginalImageIds"] {
            messages[0].removeValue(forKey: key)
        }
        histories[0]["cachedMessages"] = messages; envelope["histories"] = histories
        #expect(envelope["schemaVersion"] as? Int == 2)
        try attachmentJSON(envelope).write(to: file)
        let oldBytes = try Data(contentsOf: file)
        let restarted = try LocalConversationStore(directory: directory)
        let cached = try #require(await restarted.cachedHistory(account: account, conversationKey: "session:session-test",
            hostId: "host-test", sessionId: "session-test"))
        #expect(cached.messages == [old])
        #expect(cached.messages[0].originalAttachments.isEmpty && cached.messages[0].attachmentMessageId == nil)
        #expect(cached.messages[0].unpreviewedOriginalImageIds.isEmpty && cached.messages[0].attachmentCount == 2)
        #expect(try Data(contentsOf: file) == oldBytes)
        _ = try await restarted.cacheHistory(account: account, conversationKey: "session:session-test", hostId: "host-test",
            sessionId: "session-test", messages: cached.messages, observedThroughSeq: cached.observedThroughSeq)
        let reopened = try LocalConversationStore(directory: directory)
        #expect(try await reopened.cachedHistory(account: account, conversationKey: "session:session-test",
            hostId: "host-test", sessionId: "session-test")?.messages == [old])
    }
}
