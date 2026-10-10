import Foundation
import Testing
@testable import WeftMateCore

private func event(_ id: String, _ key: String, _ at: String = "2026-10-09T01:00:00Z", revision: Int = 1, text: String = "合成正文") throws -> ChatEvent {
    let value: [String: Any] = ["eventId":id,"chatId":"chat-main","orderKey":key,"revision":revision,"type":"user.message","at":at,"sourceRef":["kind":"native","hostId":"host-a","sessionId":"session-a","seq":1],"data":["text":text]]
    return try JSONDecoder().decode(ChatEvent.self, from: JSONSerialization.data(withJSONObject: value))
}
private func page(_ rows: [ChatEvent], sync: String = "sync-1", revision: Int = 1) throws -> ChatPage {
    let data = try JSONEncoder().encode(rows), items = try JSONSerialization.jsonObject(with: data)
    let value: [String: Any] = ["items":items,"olderCursor":"history-older","newerCursor":"history-newer","hasOlder":true,"hasNewer":false,"syncCursor":sync,"contentRevision":revision,"indexState":"ready","timeZone":"America/Los_Angeles"]
    return try JSONDecoder().decode(ChatPage.self, from: JSONSerialization.data(withJSONObject: value))
}
@Test func a16ExactNumericVersions() {
    for value: JSONValue in [.number(0), .number(2), .bool(true), .string("1"), .null] {
        #expect(!ChatCapabilities(["chats": value, "chatTimeline": .number(1)]).timeline)
    }
    #expect(!ChatCapabilities(["chats": .number(1), "chatTimeline": .number(1), "chatSend": .number(2)]).timeline)
    #expect(!ChatCapabilities(["chats": .number(1)]).timeline)
    #expect(ChatCapabilities(["chats": .number(1), "chatTimeline": .number(1)]).timeline)
}
@Test func a16AccountDayAcrossDSTAndMidnight() throws {
    let row = try event("a", "1", "2026-11-01T06:59:59Z")
    #expect(ChatDay.key(row, timeZone: "America/Los_Angeles") == "2026-10-31")
    let before = try event("b", "2", "2026-11-01T08:30:00Z"), after = try event("c", "3", "2026-11-01T09:30:00Z")
    #expect(ChatDay.key(before, timeZone: "America/Los_Angeles") == ChatDay.key(after, timeZone: "America/Los_Angeles"))
    #expect(ChatDay.key(row, timeZone: "Asia/Shanghai") == "2026-11-01")
}
@Test func a16OrderKeyIgnoresDeviceClockAndLateSegment() throws {
    var window = ChatWindow()
    try window.apply(page([event("new", "002:s:001", "2020-01-01T00:00:00Z"), event("late", "001:s:099", "2030-01-01T00:00:00Z")]), replace: true)
    #expect(window.events.map(\.id) == ["late", "new"])
}
@Test func a16HistoryNeverRewindsSyncAndEventRevisionDeduplicates() throws {
    var window = ChatWindow(); try window.apply(page([event("a", "01")]), replace: true)
    try window.apply(page([event("a", "01", revision: 2, text: "新版")], sync: "older-sync"), older: true)
    try window.apply(page([event("a", "01", revision: 1, text: "旧版")], sync: "new-history"))
    #expect(window.syncCursor == "sync-1"); #expect(window.events.count == 1); #expect(window.events.first?.text == "新版")
}
@Test func a16IncrementalWatermarkAndRemovalDoNotInventSequence() throws {
    var window = ChatWindow(); try window.apply(page([event("a", "01")]), replace: true)
    let value: [String: Any] = ["upserts":[],"removals":[["eventId":"a","revision":2]],"nextCursor":"sync-next","hasMore":false,"contentRevision":1,"indexState":"ready","timeZone":"UTC"]
    window.anchor = .init(eventID: "a", pixelOffset: 13.25)
    try window.apply(JSONDecoder().decode(ChatChanges.self, from: JSONSerialization.data(withJSONObject: value)))
    #expect(window.events.isEmpty); #expect(window.anchor == nil); #expect(window.syncCursor == "sync-next")
}
@Test func a16ContentRevisionRequiresResetAndRejectsOldCallbackGeneration() throws {
    var window = ChatWindow(); try window.apply(page([event("a", "01")]), replace: true)
    let generation = window.generation
    #expect(throws: APIFailure.server(status: 409, code: "CURSOR_RESET_REQUIRED")) { try window.apply(page([], revision: 2)) }
    window.reset()
    #expect(window.generation != generation); #expect(window.events.isEmpty); #expect(window.syncCursor == nil)
    try window.apply(page([], revision: 2), replace: true); #expect(window.contentRevision == 2)
}
@Test func a16BoundedWindowPreservesVisibleIDAndPixelAnchor() throws {
    var window = ChatWindow(); let rows = try (0..<1000).map { try event("e\($0)", String(format:"%06d",$0)) }
    try window.apply(page(rows), replace: true); window.anchor = .init(eventID:"e500",pixelOffset:17.5)
    try window.apply(page([event("e1000", "001000")]))
    #expect(window.events.count == 1000); #expect(window.events.contains { $0.id == "e500" }); #expect(window.anchor?.pixelOffset == 17.5)
}
@Test func a16NativeIdentityDoesNotOverwriteMemoWeftSource() throws {
    let object: [String: Any] = ["chatId":"chat-main","kind":"main","title":"WeftMate","activeSessionId":"session-native","conversationId":"conversation-original","timeZone":"UTC","revision":1,"contentRevision":1,"running":false,"sendAvailable":true,"pinned":true,"archived":false,"unread":false]
    let chat = try JSONDecoder().decode(LogicalChat.self, from: JSONSerialization.data(withJSONObject: object))
    let projected = chat.summary(hostID: "host-native", updatedAt: "2026-10-09T00:00:00Z")
    #expect(projected.hostId == "host-native"); #expect(projected.updatedAt == "2026-10-09T00:00:00Z"); #expect(projected.chatContentRevision == 1)
    #expect(chat.summary.id == "chat-main"); #expect(chat.summary.sessionId == "session-native"); #expect(chat.summary.conversationId == "conversation-original")
}
@Test func a16TemporaryStateNeverCachesMixedHistoryAfterRestore() {
    var state = TemporaryChatState(temporary:true,memoryMode:"off",recallEnabled:true,autoDeleteDays:30,hasTemporaryContent:true)
    #expect(!state.cacheAllowed); #expect(state.recallEnabled)
    state.memoryMode = "on"; state.temporary = false; state.expiresAt = nil
    #expect(!state.cacheAllowed); #expect(state.notice().isEmpty)
}
@Test func a16TemporaryExpiryAndNoDeleteSelection() {
    let date = ChatDay.date("2026-10-09T00:00:00Z")!
    let state = TemporaryChatState(temporary:true,memoryMode:"off",autoDeleteDays:30,expiresAt:"2026-10-10T12:00:00Z")
    #expect(state.notice(now:date).contains("2 天"))
    #expect(TemporaryChatState(temporary:true,memoryMode:"off").notice().contains("不自动删除"))
}
@Test func a16PendingCommandMayHaveNoNativeSessionAndReceiptMustMatchOriginal() throws {
    let object: [String:Any] = ["commandId":"command-a","requestId":"request-a","kind":"chat.message","targetDeviceId":"host-a","state":"pending","chatId":"chat-main"]
    let command = try JSONDecoder().decode(LogicalCommand.self, from: JSONSerialization.data(withJSONObject: object))
    let body: JSONValue = .object(["requestId":.string("request-a"),"kind":.string("chat.message"),"chatId":.string("chat-main")])
    try command.validate(request:body,hostID:"host-a")
    #expect(throws: APIFailure.identityMismatch) { try command.validate(request:body,hostID:"host-b") }
}
@Test func a16ExpiredDisplayCacheActuallyRemoved() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at:directory) }
    let store = try LocalConversationStore(directory:directory), account = try LocalAccountScope(server:.init(input:"https://a16.unit.example"),ownerId:"owner-a")
    _ = try await store.cacheHistory(account:account,conversationKey:"session:session-a",hostId:"host-a",sessionId:"session-a",messages:[])
    try await store.removeCachedHistory(account:account,conversationKey:"session:session-a")
    #expect(try await store.cachedHistory(account:account,conversationKey:"session:session-a",hostId:"host-a",sessionId:"session-a") == nil)
}

@Test func a16DayLabelsPreserveNonMonotonicNativeOrder() throws {
    let rows = try [event("a","01","2026-10-08T00:00:00Z"),event("b","02","2026-10-09T00:00:00Z"),event("c","03","2026-10-08T01:00:00Z")]
    let sections = ChatDay.sections(rows,timeZone:"UTC")
    #expect(sections.count == 3); #expect(sections.flatMap(\.events).map(\.id) == ["a","b","c"])
}

private final class A16Credentials: CredentialStore, @unchecked Sendable {
    private let lock = NSLock(); private var values: [String: Data] = [:]
    func load(key: String) -> Data? { lock.withLock { values[key] } }
    func save(_ value: Data, key: String) { lock.withLock { values[key] = value } }
    func delete(key: String) { lock.withLock { values[key] = nil } }
}
private actor A16HTTP: HTTPTransport {
    var posted: Data?
    var posts = 0
    var temporary = false
    func count() -> Int { posts }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let auth: [String: Any] = ["account": ["ownerId": "owner-a", "username": "tester", "displayName": "Synthetic"], "device": ["id": "device-a", "name": "Fixture"], "csrfToken": String(repeating: "b", count: 43)]
        let path = request.url!.path
        var object = auth, headers: [String: String] = [:]
        if path.hasSuffix("/auth/login") { headers["set-cookie"] = "wm_personal_session=" + String(repeating: "a", count: 43) }
        else if path.hasSuffix("/status") { object = ["ownerId": "owner-a", "hostId": "host-a"] }
        else if path.contains("/commands/by-request/") {
            if posted == nil { return .init(status: 404, body: Data("{\"error\":{\"code\":\"NOT_FOUND\"}}".utf8)) }
            let body = try JSONDecoder().decode(JSONValue.self, from: posted!)
            object = ["command": ["commandId":"command-a", "requestId":body["requestId"]!.string!, "kind":temporary ? "session.create":"chat.message", "targetDeviceId":"host-a", "state":"accepted_by_dsh", "sessionId":"session-bound", "receiptId":"receipt-a", "chatId":"chat-main"]]
        } else if path.hasSuffix("/commands") || path.hasSuffix("/sessions/temporary") {
            posts += 1; posted = request.httpBody; temporary = path.hasSuffix("/temporary")
            let body = try JSONDecoder().decode(JSONValue.self, from: posted!)
            object = ["command": ["commandId":"command-a", "requestId":body["requestId"]!.string!, "kind":temporary ? "session.create":"chat.message", "targetDeviceId":"host-a", "state":"pending", "chatId":"chat-main"]]
        }
        return .init(status:200, headers:headers, body:try JSONSerialization.data(withJSONObject:object))
    }
}
@Test func a16LogicalRequestRetainsCanonicalOriginalAndOnlyPostsOnce() async throws {
    let http = A16HTTP(), client = PersonalClient(credentialStore:A16Credentials(),transport:http)
    _ = try await client.login(server:.init(input:"https://a16-command.unit.example"),username:"tester",password:"synthetic-test-only",deviceName:"Fixture")
    let body: JSONValue = .object(["requestId":.string("request-a"),"kind":.string("chat.message"),"targetDeviceId":.string("host-a"),"chatId":.string("chat-main"),"text":.string("合成首句"),"mode":.string("queue")])
    let first = try await client.logicalCommand(request:body,submit:true)
    #expect(first?.state == "pending"); #expect(first?.sessionId == nil)
    let second = try await client.logicalCommand(request:body,submit:true)
    #expect(second?.sessionId == "session-bound"); #expect(second?.receiptId == "receipt-a")
    #expect(await http.count() == 1)
}
@Test func a16TemporaryCreationUsesNativeOriginalRequestReceipt() async throws {
    let http = A16HTTP(), client = PersonalClient(credentialStore:A16Credentials(),transport:http)
    _ = try await client.login(server:.init(input:"https://a16-temp.unit.example"),username:"tester",password:"synthetic-test-only",deviceName:"Fixture")
    let body: JSONValue = .object(["requestId":.string("request-temp"),"modelProfileId":.string("model-a"),"autoDeleteDays":.number(7)])
    _ = try await client.logicalCommand(request:body,temporary:true,submit:true)
    let receipt = try await client.logicalCommand(request:body,temporary:true)
    #expect(receipt?.kind == "session.create"); #expect(receipt?.sessionId == "session-bound")
    #expect(await http.count() == 1)
}
@Test func a16CacheAllowedFalseSurvivesBothNativeHistoryDecoders() throws {
    let data = Data("{\"events\":[],\"nextSeq\":1,\"hasMore\":false,\"cacheAllowed\":false}".utf8)
    #expect(try TimelinePage.decode(data).cacheAllowed == false)
    #expect(try SharedHistoryPage.decode(data,sessionID:"session-a",afterSeq:1).cacheAllowed == false)
}
