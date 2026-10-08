import Foundation
import Testing
@testable import WeftMateCore

@Suite struct ConversationResourcesTests {
    @Test func oldHostsEmptyArraysAndActualReferences() throws {
        func event(_ json: String, type: String = "assistant.message") throws -> TimelineEvent {
            .init(seq: 1, type: type, data: try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)))
        }
        #expect(UsedMemory.references(in: try event(#"{"text":"old host"}"#)).isEmpty)
        #expect(UsedMemory.references(in: try event(#"{"memoryUsed":[]}"#)).isEmpty)
        let value = try event(#"{"memoryUsed":[{"id":"memory-a","kind":"cognition","summary":"用中文"},{"id":"memory-a","kind":"cognition","summary":"重复"},{"id":"person-a","kind":"entity","summary":"朋友"}]}"#)
        #expect(UsedMemory.references(in: value).map(\.summary) == ["用中文", "朋友"])
        #expect(UsedMemory.references(in: try event(#"{"memoryUsed":[{"id":"a","kind":"cognition","summary":"x"}]}"#, type: "user.message")).isEmpty)
    }
    @Test func pagesMergeCallsPreferSnapshotsAndKeepNewestNamedOutput() throws {
        func page(_ json: String) throws -> ConversationResourcesPage { try JSONDecoder().decode(ConversationResourcesPage.self, from: Data(json.utf8)) }
        var window = ConversationResourcesWindow()
        try window.apply(page(#"{"outputs":[{"artifactId":"old","fileName":"result.txt","createdAt":"2026-10-07T00:00:00Z"}],"sources":[{"key":"file:a","kind":"file","name":"a.txt","uses":[{"id":"start","callId":"a","summary":"读取 a.txt","path":"/sessions/s/events/1/detail"}]}],"nextSeq":5,"hasMore":true}"#))
        try window.apply(page(#"{"outputs":[{"artifactId":"new","fileName":"result.txt","createdAt":"2026-10-07T00:01:00Z"}],"sources":[{"key":"file:a","kind":"file","name":"a.txt","uses":[{"id":"snapshot","callId":"a","summary":"读取 a.txt","path":"/tasks/t/sources/snapshot"},{"id":"end","callId":"a","summary":"完成读取","path":"/sessions/s/events/4/detail"},{"id":"second","callId":"b","summary":"再读 a.txt","path":"/sessions/s/events/6/detail"}]}],"nextSeq":7,"hasMore":false}"#))
        #expect(window.outputs.map(\.id) == ["new"])
        #expect(window.sources[0].uses.count == 2)
        #expect(window.sources[0].uses[0].path == "/tasks/t/sources/snapshot")
        #expect(window.nextSeq == 7)
        #expect(throws: APIFailure.invalidResponse) { try window.apply(page(#"{"outputs":[],"sources":[],"nextSeq":7,"hasMore":true}"#)) }
    }
}

private actor ResourceTransport: HTTPTransport {
    private var seen: [String] = []
    var owner = "owner-test"
    func changeOwner() { owner = "owner-other" }
    func paths() -> [String] { seen }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let path = request.url!.path.replacingOccurrences(of: "/personal/v1", with: "")
            + (request.url!.query.map { "?" + $0 } ?? "")
        seen.append(path)
        let json: String
        var headers: [String: String] = [:]
        if path == "/auth/login" || path == "/auth/me" {
            json = "{\"account\":{\"ownerId\":\"\(owner)\",\"username\":\"synthetic\",\"displayName\":\"Test\"},\"device\":{\"id\":\"device-test\",\"name\":\"Mac\"},\"csrfToken\":\"\(String(repeating: "b", count: 43))\"}"
            headers["set-cookie"] = "wm_personal_session=" + String(repeating: "a", count: 43)
        } else if path == "/status" { json = #"{"ownerId":"owner-test","hostId":"host-test"}"# }
        else if path == "/sessions/session-test/resources?afterSeq=-1" {
            json = #"{"outputs":[],"sources":[],"nextSeq":20,"hasMore":false}"#
        } else if path == "/sessions/session-test/events/10/detail" {
            json = #"{"seq":10,"text":"raw call result","truncated":true}"#
        } else if path == "/tasks/task-test/sources/source-test" {
            json = #"{"source":{"text":"authorized captured body","truncated":true}}"#
        } else { throw APIFailure.invalidResponse }
        return .init(status: 200, headers: headers, body: Data(json.utf8))
    }
}
extension ConversationResourcesTests {
    @Test func clientUsesContractReadRoutesAndCurrentAccount() async throws {
        let transport = ResourceTransport()
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        _ = try await client.login(server: ServerConfiguration(input: "https://resource.unit.weftmate.example"),
            username: "synthetic", password: "synthetic-only", deviceName: "Mac")
        let page = try await client.conversationResources(sessionID: "session-test")
        #expect(page.nextSeq == 20)
        let use = ResourceUse(id: "call", callId: nil, seq: 10, at: nil, summary: "Read", path: "/sessions/session-test/events/10/detail", verb: nil)
        let detail = try await client.conversationSourceContent(use, sessionID: "session-test")
        #expect(detail.text == "raw call result" && detail.truncated == true)
        let snapshot = ResourceUse(id: "snapshot", callId: nil, seq: nil, at: nil, summary: "Read", path: "/tasks/task-test/sources/source-test", verb: nil)
        let body = try await client.conversationSourceContent(snapshot, sessionID: "session-test")
        #expect(body.text == "authorized captured body" && body.truncated == true)
        for path in ["/sessions/session-other/events/10/detail", "https://external.example/", "/settings/approvals"] {
            let invalid = ResourceUse(id: "bad", callId: nil, seq: nil, at: nil, summary: "bad", path: path, verb: nil)
            await #expect(throws: APIFailure.invalidResponse) { try await client.conversationSourceContent(invalid, sessionID: "session-test") }
        }
        let paths = await transport.paths()
        #expect(!paths.contains { $0.contains("session-other") || $0.contains("settings") })
        await transport.changeOwner()
        await #expect(throws: APIFailure.identityMismatch) { try await client.conversationResources(sessionID: "session-test", afterSeq: 20) }
        #expect(await !transport.paths().contains("/sessions/session-test/resources?afterSeq=20"))
    }
}
