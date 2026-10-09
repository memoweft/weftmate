import Foundation
import WeftMateCore

private final class DetailCredentials: CredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: Data] = [:]
    func load(key: String) -> Data? { lock.withLock { values[key] } }
    func save(_ value: Data, key: String) { lock.withLock { values[key] = value } }
    func delete(key: String) { lock.withLock { values[key] = nil } }
}
private actor DetailHTTP: HTTPTransport {
    private var gate: CheckedContinuation<Void, Never>?
    private(set) var count = 0
    func release() { gate?.resume(); gate = nil }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let path = request.url!.path
        let body: String
        if path.hasSuffix("/auth/login") || path.hasSuffix("/auth/me") {
            body = #"{"account":{"ownerId":"synthetic","username":"synthetic","displayName":"合成"},"device":{"id":"device","name":"合成 Mac"},"csrfToken":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}"#
        } else if path.hasSuffix("/status") { body = #"{"ownerId":"synthetic","hostId":"host"}"# }
        else if path.hasSuffix("/events/2/detail") {
            count += 1
            await withCheckedContinuation { gate = $0 }
            body = #"{"seq":2,"text":"{\"arguments\":{\"path\":\"notes.md\"},\"output\":\"合成正文\"}"}"#
        } else { throw APIFailure.invalidResponse }
        return .init(status: 200, headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)], body: Data(body.utf8))
    }
}
@main private enum ToolProgressChecks {
    @MainActor static func main() async throws {
        let http = DetailHTTP(), client = PersonalClient(credentialStore: DetailCredentials(), transport: http)
        _ = try await client.login(server: ServerConfiguration(input: "https://detail.example.com"), username: "synthetic", password: "synthetic-password-long", deviceName: "Mac")
        let event = TimelineEvent(seq: 1, type: "step.completed", data: .object(["taskId": .string("turn-1"), "stepId": .string("read"), "toolName": .string("read"), "state": .string("completed"), "detailRef": .object(["seq": .number(2)])]))
        let step = TimelineProjection.entries([event])[0].steps[0], model = ToolProgressModel()
        let first = Task { await model.read(client: client, sessionID: "synthetic-session", step: step) }
        while await http.count == 0 { await Task.yield() }
        let second = Task { await model.read(client: client, sessionID: "synthetic-session", step: step) }
        await Task.yield(); first.cancel(); await http.release()
        await first.value; await second.value
        guard await http.count == 1, model.presentation(step)?.output == "合成正文", model.summary(step) == "读取文件 notes.md" else { throw APIFailure.invalidResponse }
        await model.read(client: client, sessionID: "synthetic-session", step: step)
        guard await http.count == 1 else { throw APIFailure.invalidResponse }
        print("PASS canceled summary reader cannot strand the expanded detail; concurrent readers share one request and cache its result")
    }
}
