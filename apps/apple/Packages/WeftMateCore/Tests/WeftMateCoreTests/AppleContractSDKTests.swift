import Foundation
import Testing
@testable import WeftMateCore

private let sessionID = "session-11111111-1111-4111-8111-111111111111"
private let messageID = "22222222-2222-4222-8222-222222222222"
private let attachmentID = "attachment-33333333-3333-4333-8333-333333333333"
private func json(_ value: [String: Any], status: Int = 200, headers: [String: String] = [:]) -> HTTPResponse {
    .init(status: status, headers: headers, body: try! JSONSerialization.data(withJSONObject: value))
}
private actor ContractHTTP: HTTPTransport {
    private var recorded: [URLRequest] = []
    var bytes = Data("sample".utf8)
    var wrongHash = false
    var shared = false
    func options(shared: Bool = false, wrongHash: Bool = false, bytes: Data = Data("sample".utf8)) {
        self.shared = shared; self.wrongHash = wrongHash; self.bytes = bytes
    }
    func requests() -> [URLRequest] { recorded }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        recorded.append(request)
        let path = request.url!.path
        let auth: [String: Any] = ["account": ["ownerId": "owner-test", "username": "tester", "displayName": "Test"],
            "device": ["id": "device-test", "name": "Mac"], "csrfToken": String(repeating: "b", count: 43)]
        switch path {
        case "/personal/v1/auth/login": return json(auth, headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)])
        case "/personal/v1/auth/me": return json(auth)
        case "/personal/v1/status": return json(["ownerId": "owner-test", "hostId": "host-test", "backend": ["capabilities": ["desktopOpenApp": ["available": !shared]]]])
        case "/personal/v1/sessions": return json(["sessions": [["sessionId": sessionID, "title": "Test", "running": false, "sendAvailable": true]]])
        default:
            if request.httpMethod == "PUT" {
                let query = Dictionary(uniqueKeysWithValues: URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value!) })
                let metadata: [String: Any] = ["attachmentId": attachmentID, "name": query["name"] ?? "sample.txt",
                    "contentType": request.value(forHTTPHeaderField: "Content-Type")!, "size": request.httpBody!.count,
                    "sha256": wrongHash ? String(repeating: "0", count: 64) : request.value(forHTTPHeaderField: "X-WeftMate-SHA256")!]
                if query["variant"] == "display" {
                    var display = metadata; display["name"] = nil
                    return json(["display": display, "duplicate": false], status: 201)
                }
                return json(["attachment": metadata, "duplicate": false], status: 201)
            }
            if path.contains("/attachments/") { return .init(status: 200, headers: ["content-type": request.url!.query == "variant=display" ? "image/jpeg" : path.contains("/sessions/") ? "image/png" : "text/plain"], body: bytes) }
            return json(["error": ["code": "NOT_FOUND"]], status: 404)
        }
    }
}
private func login(_ http: ContractHTTP, deviceName: String = "Mac") async throws -> (PersonalClient, AccountSession) {
    let client = PersonalClient(credentialStore: MemoryStore(), transport: http)
    let session = try await client.login(server: ServerConfiguration(input: "https://contract.unit.example"), username: "tester", password: "synthetic-only", deviceName: deviceName)
    return (client, session)
}
private func file(_ bytes: Data = Data("sample".utf8)) throws -> URL {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let url = directory.appendingPathComponent("sample.txt"); try bytes.write(to: url); return url
}
struct AppleContractSDKTests {
    @Test func exactUTF16MessageAndJSONByteLimits() throws {
        func payload(_ text: String) throws -> SharedCommandPayload {
            try .init(requestId: "request-test", kind: .message, targetDeviceId: "host-test", sessionId: sessionID, text: text)
        }
        #expect(try payload(String(repeating: "a", count: 8_192)).encoded().count <= 12_288)
        #expect(throws: ClientInputFailure.messageTooLong) { try payload(String(repeating: "a", count: 8_193)) }
        #expect(try payload(String(repeating: "😀", count: 4_096)).text?.utf16.count == 8_192)
        #expect(throws: ClientInputFailure.requestTooLarge) { try payload(String(repeating: "😀", count: 4_096)).encoded() }
        #expect(throws: ClientInputFailure.requestTooLarge) { try payload(String(repeating: "中", count: 4_100)).encoded() }
        #expect(throws: ClientInputFailure.requestTooLarge) { try payload(String(repeating: "\u{1}", count: 2_050)).encoded() }
        let small = try payload("hello").encoded()
        var boundary = small; boundary.append(Data(repeating: 32, count: 12_288 - small.count))
        #expect(try SharedCommandIntent(server: ServerConfiguration(input: "https://contract.unit.example"), ownerId: "owner-test", hostId: "host-test", payload: boundary).payload == boundary)
        boundary.append(32)
        #expect(throws: APIFailure.invalidResponse) { try SharedCommandIntent(server: ServerConfiguration(input: "https://contract.unit.example"), ownerId: "owner-test", hostId: "host-test", payload: boundary) }
    }
    @Test func deviceNameUsesUTF16AndFailsBeforeNetwork() async throws {
        let http = ContractHTTP()
        let (client, _) = try await login(http, deviceName: String(repeating: "😀", count: 64))
        let before = await http.requests().count
        await #expect(throws: ClientInputFailure.deviceNameTooLong) {
            try await client.login(server: ServerConfiguration(input: "https://contract.unit.example"), username: "tester", password: "test", deviceName: String(repeating: "😀", count: 65))
        }
        #expect(await http.requests().count == before)
    }
    @Test func correctionBody12KiBIncludesEscapesAndKeepsRequestBytes() async throws {
        let (_, session) = try await login(ContractHTTP())
        let accepted = try MemoryMutationIntent(session: session, operation: .correct, itemKind: .cognition, targetID: "memory.1", requestID: "correct-1", expectedWorldRevision: 1, correction: String(repeating: "中", count: 4_000))
        #expect(accepted.payload.count <= 12_288)
        #expect(try JSONDecoder().decode(MemoryMutationIntent.self, from: JSONEncoder().encode(accepted)) == accepted)
        #expect(throws: ClientInputFailure.correctionTooLarge) {
            try MemoryMutationIntent(session: session, operation: .correct, itemKind: .cognition, targetID: "memory.1", requestID: "correct-2", expectedWorldRevision: 1, correction: String(repeating: "\u{1}", count: 2_050))
        }
    }
    @Test func attachmentsOnlyPayloadPersistsReferencesAndLimits() async throws {
        let (_, session) = try await login(ContractHTTP())
        let source = try file(); defer { try? FileManager.default.removeItem(at: source.deletingLastPathComponent()) }
        let metadata = try OriginalAttachment.fromFile(source, name: "sample.txt", contentType: "text/plain", attachmentID: attachmentID)
        let payload = try SharedCommandPayload(requestId: "send-test", kind: .message, targetDeviceId: "host-test", sessionId: sessionID,
            text: "", attachments: [metadata], originalAttachments: [metadata], attachmentMessageId: messageID)
        let intent = try SharedCommandIntent(session: session, command: payload)
        #expect(try JSONDecoder().decode(SharedCommandIntent.self, from: JSONEncoder().encode(intent)).parsedPayload == payload)
        #expect(throws: APIFailure.invalidResponse) { try SharedCommandPayload(requestId: "empty", kind: .message, targetDeviceId: "host-test", sessionId: sessionID, text: "") }
        #expect(throws: APIFailure.invalidResponse) { try SharedCommandPayload(requestId: "bad", kind: .message, targetDeviceId: "host-test", sessionId: sessionID, text: "", originalAttachments: [metadata]) }
        let large = try OriginalAttachment(attachmentID: attachmentID, name: "sample.txt", contentType: "text/plain", size: 16_385, sha256: metadata.sha256)
        #expect(throws: APIFailure.invalidResponse) { try AttachmentLimits.validate(staged: [large], originals: nil, messageID: nil) }
        let two = try OriginalAttachment(attachmentID: "attachment-44444444-4444-4444-8444-444444444444", name: "two.txt", contentType: "text/plain", size: 10_000, sha256: metadata.sha256)
        #expect(throws: APIFailure.invalidResponse) { try AttachmentLimits.validate(staged: [two, OriginalAttachment(attachmentID: attachmentID, name: "one.txt", contentType: "text/plain", size: 10_000, sha256: metadata.sha256)], originals: nil, messageID: nil) }
    }
    @Test func binaryUploadsCarryScopeAuthenticationHashAndExactMetadata() async throws {
        let http = ContractHTTP(); let (client, _) = try await login(http)
        let source = try file(); defer { try? FileManager.default.removeItem(at: source.deletingLastPathComponent()) }
        let metadata = try OriginalAttachment.fromFile(source, name: "sample + 中文.txt", contentType: "text/plain", attachmentID: attachmentID)
        try await client.uploadOriginalAttachment(metadata, file: source, conversationID: sessionID, messageID: messageID)
        try await client.uploadSessionAttachment(metadata, file: source, sessionID: sessionID, requestID: "send-test")
        let uploads = await http.requests().filter { $0.httpMethod == "PUT" }
        #expect(uploads.count == 2)
        for request in uploads {
            #expect(request.httpBody == Data("sample".utf8))
            #expect(request.value(forHTTPHeaderField: "Cookie")?.hasPrefix("wm_personal_session=") == true)
            #expect(request.value(forHTTPHeaderField: "X-WeftMate-CSRF") == String(repeating: "b", count: 43))
            #expect(request.value(forHTTPHeaderField: "X-WeftMate-SHA256") == metadata.sha256)
            #expect(request.value(forHTTPHeaderField: "Content-Type") == "text/plain")
        }
        let queries = uploads.map { Dictionary(uniqueKeysWithValues: URLComponents(url: $0.url!, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value!) }) }
        #expect(queries[0]["conversationId"] == sessionID && queries[0]["messageId"] == messageID && queries[0]["name"] == metadata.name)
        #expect(queries[1]["requestId"] == "send-test")
        await http.options(wrongHash: true)
        await #expect(throws: APIFailure.identityMismatch) { try await client.uploadOriginalAttachment(metadata, file: source, conversationID: sessionID, messageID: messageID) }
    }
    @Test func originalDownloadsVerifyBytesAndRemoveCorruptOutput() async throws {
        let http = ContractHTTP(); let (client, _) = try await login(http)
        let source = try file(); defer { try? FileManager.default.removeItem(at: source.deletingLastPathComponent()) }
        let metadata = try OriginalAttachment.fromFile(source, name: "sample.txt", contentType: "text/plain", attachmentID: attachmentID)
        let destination = source.deletingLastPathComponent().appendingPathComponent("download.txt")
        try await client.downloadOriginalAttachment(metadata, to: destination)
        #expect(try Data(contentsOf: destination) == Data("sample".utf8))
        await http.options(bytes: Data("badbad".utf8))
        await #expect(throws: APIFailure.invalidResponse) { try await client.downloadOriginalAttachment(metadata, to: destination) }
        #expect(!FileManager.default.fileExists(atPath: destination.path))
        await http.options(bytes: Data(repeating: 42, count: 7))
        await #expect(throws: APIFailure.responseTooLarge) { try await client.downloadOriginalAttachment(metadata, to: destination) }
        #expect(!FileManager.default.fileExists(atPath: destination.path))
    }
    @Test func ownerOnlyDesktopCapabilityRequiredForTasks() async throws {
        let http = ContractHTTP(); let (client, _) = try await login(http)
        #expect(try await client.taskControlSessionIDs() == [sessionID])
        await http.options(shared: true)
        #expect(try await client.taskControlSessionIDs().isEmpty)
        #expect(await http.requests().allSatisfy { !$0.url!.path.contains("/tasks/") })
    }
}


extension AppleContractSDKTests {
    @Test func displayUploadDownloadAndLegacyImageRoute() async throws {
        let http = ContractHTTP(); let (client, _) = try await login(http)
        let source = try file(Data([0xff, 0xd8, 0xff, 0xd9]))
        defer { try? FileManager.default.removeItem(at: source.deletingLastPathComponent()) }
        let image = try OriginalAttachment.fromFile(source, name: "image.jpg", contentType: "image/jpeg", attachmentID: attachmentID)
        try await client.uploadAttachmentDisplay(image, file: source, conversationID: sessionID, messageID: messageID)
        let upload = await http.requests().last!
        #expect(upload.httpMethod == "PUT")
        #expect(URLComponents(url: upload.url!, resolvingAgainstBaseURL: false)?.queryItems?.contains(URLQueryItem(name: "variant", value: "display")) == true)
        await http.options(bytes: Data([0xff, 0xd8, 0xff, 0xd9]))
        let display = source.deletingLastPathComponent().appendingPathComponent("display.jpg")
        try await client.downloadAttachmentDisplay(image, to: display)
        #expect(try Data(contentsOf: display) == Data([0xff, 0xd8, 0xff, 0xd9]))
        let legacy = SharedHistoryImage(attachmentId: "sha256:" + image.sha256, contentType: "image/png", size: 4, width: 1, height: 1, name: "legacy.png")
        let downloaded = source.deletingLastPathComponent().appendingPathComponent("legacy.png")
        try await client.downloadSessionImage(legacy, sessionID: sessionID, to: downloaded)
        #expect(await http.requests().last?.url?.absoluteString.contains("sha256%3A") == true)
        #expect(try Data(contentsOf: downloaded) == Data(contentsOf: source))
    }
}
