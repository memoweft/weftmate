// Synthetic Debug UI-test transport: never contacts a host or reads Keychain.
#if DEBUG
import Foundation
import WeftMateCore

enum AppleContractUIFixture {
    static let sessionID = "session-11111111-1111-4111-8111-111111111111"
    static let attachmentID = "attachment-33333333-3333-4333-8333-333333333333"
    static func makeClient() -> PersonalClient { PersonalClient(credentialStore: Credentials(), transport: Transport()) }
    static func selectedFile() throws -> URL {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("A2-测试文件.txt")
        try Data("A2 controlled attachment file 中文\n".utf8).write(to: file)
        return file
    }
    private final class Credentials: CredentialStore, @unchecked Sendable {
        private let lock = NSLock(); private var values: [String: Data] = [:]
        func load(key: String) -> Data? { lock.withLock { values[key] } }
        func save(_ value: Data, key: String) { lock.withLock { values[key] = value } }
        func delete(key: String) { lock.withLock { values[key] = nil } }
    }
    private actor Transport: HTTPTransport {
        private var statusReads = 0
        private let image = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAAEyklEQVR4nO3SAQmAUADFwNfUEIawhg2saIox+Awuwu363hzsub8cbPqwoPRhQU0fFpQ+LKjpw4LShwU1fVhQ+rCgpg8LSh8W1PRhQenDgpo+LCh9WFDThwWlDwtq+rCg9GFBTR8WlD4sqOnDgtKHBTV9WFD6sKCmDwtKHxbU9GFB6cOCmj4sKH1YUNOHBaUPC2r6sKD0YUFNHxaUPiyo6cOC0ocFNX1YUPqwoKYPC0ofFtT0YUHpw4KaPiwofVhQ04cFpQ8LavqwoPRhQU0fFpQ+LKjpw4LShwU1fVhQ+rCgpg8LSh8W1PRhQenDgpo+LCh9WFDThwWlDwtq+rCg9GFBTR8WlD4sqOnDgtKHBTV9WFD6sKCmDwtKHxbU9GFB6cOCmj4sKH1YUNOHBaUPC2r6sKD0YUFNHxaUPiyo6cOC0ocFNX1YUPqwoKYPC0ofFtT0YUHpw4KaPiwofVhQ04cFpQ8LavqwoPRhQU0fFpQ+LKjpw4LShwU1fVhQ+rCgpg8LSh8W1PRhQenDgpo+LCh9WFDThwWlDwtq+rCg9GFBTR8WlD4sqOnDgtKHBTV9WFD6sKCmDwtKHxbU9GFB6cOCmj4sKH1YUNOHBaUPC2r6sKD0YUFNHxaUPiyo6cOC0ocFNX1YUPqwoKYPC0ofFtT0YUHpw4KaPiwofVhQ04cFpQ8LavqwoPRhQU0fFpQ+LKjpw4LShwU1fVhQ+rCgpg8LSh8W1PRhQenDgpo+LCh9WFDThwWlDwtq+rCg9GFBTR8WlD4sqOnDgtKHBTV9WFD6sKCmDwtKHxbU9GFB6cOCmj4sKH1YUNOHBaUPC2r6sKD0YUFNHxaUPiyo6cOC0ocFNX1YUPqwoKYPC0ofFtT0YUHpw4KaPiwofVhQ04cFpQ8LavqwoPRhQU0fFpQ+LKjpw4LShwU1fVhQ+rCgpg8LSh8W1PRhQenDgpo+LCh9WFDThwWlDwtq+rCg9GFBTR8WlD4sqOnDgtKHBTV9WFD6sKCmDwtKHxbU9GFB6cOCmj4sKH1YUNOHBaUPC2r6sKD0YUFNHxaUPiyo6cOC0ocFNX1YUPqwoKYPC0ofFtT0YUHpw4KaPiwofVhQ04cFpQ8LavqwoPRhQU0fFpQ+LKjpw4LShwU1fVhQ+rCgpg8LSh8W1PRhQenDgpo+LCh9WFDThwWlDwtq+rCg9GFBTR8WlD4sqOnDgtKHBTV9WFD6sKCmDwtKHxbU9GFB6cOCmj4sKH1YUNOHBaUPC2r6sKD0YUFNHxaUPiyo6cOC0ocFNX1YUPqwoKYPC0ofFtT0YUHpw4KaPiwofVhQ04cFpQ8LavqwoPRhQU0fFpQ+LKjpw4LShwU1fVhQ+rCgpg8LSh8W1PRhQenDgpo+LCh9WFDThwWlDwtq+rCg9GFBTR8WlD4sqOnDgtKHBTV9WFD6sKCmDwtKHxbU9GFB6cOCmj4sKH1YUNOHBaUPC2r6sKD0YUFNHxaUPiyo6cOC0ocFNX1YUPqwoKYPC0ofFtT0YUHpw4KaPiwofVhQ04cFpQ8LavqwoPRhQU0fFpQ+LKjpw4LShwU1fVhQ+rCgpg8LSh8W1PRhQenDgpo+LCh9WFDThwWlDwtq+rCg9GFBTR8WlD4sqOnDgtKHBfUD0TjRepyspN8AAAAASUVORK5CYII=")!
        private var uploads: [String: Data] = [:]
        private var command: [String: Any]?
        private var sent: [String: Any]?
        func send(_ request: URLRequest) async throws -> HTTPResponse {
            guard request.url?.host == "a2-ui.unit.example" else { throw APIFailure.invalidResponse }
            let path = request.url!.path
            let auth: [String: Any] = ["account": ["ownerId": "owner-fixture", "username": "tester", "displayName": "A2 测试"],
                "device": ["id": "device-fixture", "name": "Fixture"], "csrfToken": String(repeating: "b", count: 43)]
            if request.httpMethod == "PUT" {
                let id = request.url!.lastPathComponent, bytes = request.httpBody!
                let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
                let name = query.first { $0.name == "name" }?.value ?? "image.jpg"
                uploads[path] = bytes
                return try json(["attachment": ["attachmentId": id, "name": name,
                    "contentType": request.value(forHTTPHeaderField: "Content-Type")!, "size": bytes.count,
                    "sha256": request.value(forHTTPHeaderField: "X-WeftMate-SHA256")!], "duplicate": false], status: 201)
            }
            if request.httpMethod == "GET", path.contains("/attachments/") {
                if request.url!.query != nil { return try json(["error": ["code": "NOT_FOUND"]], status: 404) }
                if request.url!.lastPathComponent == AppleContractUIFixture.attachmentID {
                    return .init(status: 200, headers: ["content-type": "image/png"], body: image)
                }
                guard let bytes = uploads[path] else { return try json(["error": ["code": "NOT_FOUND"]], status: 404) }
                return .init(status: 200, headers: ["content-type": "text/plain"], body: bytes)
            }
            switch path {
            case "/personal/v1/auth/login": return try json(auth, headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)])
            case "/personal/v1/auth/me": return try json(auth)
            case "/personal/v1/status":
                statusReads += 1
                var value: [String: Any] = ["ownerId": "owner-fixture", "hostId": "host-fixture", "backend": ["capabilities": ["desktopOpenApp": ["available": false]]]]
                if ProcessInfo.processInfo.arguments.contains("--upd2-about") {
                    value["updates"] = ["layers": [
                        ["layer": "ui", "currentVersion": "0.3.0", "status": "ready"],
                        ["layer": "app", "currentVersion": "0.2.0", "status": "current"],
                        ["layer": "mobile-ui", "currentVersion": "0.9.0", "status": "current"]]]
                    if statusReads > 1 && ProcessInfo.processInfo.arguments.contains("--upd2-incompatible") {
                        value["nativeMinimumVersions"] = ["iOS": "0.2.0", "macOS": "0.2.0"]
                    }
                }
                return try json(value)
            case "/personal/v1/auth/devices": return try json(["devices": [["id": "device-fixture", "name": "Fixture", "current": true]]])
            case "/personal/v1/sync/capabilities":
                let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
                return try json(["deviceId": "device-fixture", "platform": body["platform"]!, "sharedConversations": 1])
            case "/personal/v1/sync/events": return try json(["events": [], "nextSeq": 0, "hasMore": false])
            case "/personal/v1/sessions": return try json(["sessions": [["sessionId": AppleContractUIFixture.sessionID, "title": "A2 附件契约验收",
                "modelProfileId": "fixture", "running": false, "sendAvailable": true]]])
            case "/personal/v1/models": return try json(["models": [["id": "fixture", "name": "测试模型", "model": "fixture", "configured": true]]])
            case "/personal/v1/sessions/" + AppleContractUIFixture.sessionID + "/events":
                let after = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!.first { $0.name == "afterSeq" }?.value.flatMap(Int.init) ?? -1
                let original = try originalImage()
                var events: [[String: Any]] = [["seq": 0, "type": "user.message", "data": ["text": "历史附件 · 点开预览", "originalAttachments": [original],
                    "attachmentMessageId": "22222222-2222-4222-8222-222222222222"]]]
                if let sent {
                    var data: [String: Any] = ["text": sent["text"]!, "receiptId": "receipt-fixture"]
                    data["originalAttachments"] = sent["originalAttachments"]; data["attachmentMessageId"] = sent["attachmentMessageId"]
                    events.append(contentsOf: [["seq": 1, "type": "turn.started", "data": ["turn": 1]], ["seq": 2, "type": "user.message", "data": data],
                        ["seq": 3, "type": "assistant.message", "data": ["text": "已收到测试文件。"]], ["seq": 4, "type": "turn.ended", "data": ["turn": 1, "reason": "completed"]]])
                }
                return try json(["events": events.filter { ($0["seq"] as! Int) > after }, "nextSeq": max(after, events.last!["seq"] as! Int), "hasMore": false])
            case "/personal/v1/commands":
                if request.httpMethod == "GET" { return try json(["commands": [], "hasMore": false]) }
                sent = try JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any]
                command = ["commandId": "cmd-fixture", "kind": "session.message", "targetDeviceId": "host-fixture", "sessionId": AppleContractUIFixture.sessionID,
                    "requestId": sent!["requestId"]!, "state": "accepted_by_dsh", "receiptId": "receipt-fixture"]
                return try json(["command": command!], status: 202)
            case let route where route.hasPrefix("/personal/v1/commands/by-request/"):
                if let command { return try json(["command": command]) }
                return try json(["error": ["code": "NOT_FOUND"]], status: 404)
            default: throw APIFailure.invalidResponse
            }
        }
        private func originalImage() throws -> [String: Any] {
            let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try image.write(to: file); defer { try? FileManager.default.removeItem(at: file) }
            return ["attachmentId": AppleContractUIFixture.attachmentID, "name": "历史图片.png", "contentType": "image/png",
                "size": image.count, "sha256": try AttachmentLimits.sha256(file: file)]
        }
        private func json(_ object: [String: Any], status: Int = 200, headers: [String: String] = [:]) throws -> HTTPResponse {
            .init(status: status, headers: headers, body: try JSONSerialization.data(withJSONObject: object))
        }
    }
}
#endif
