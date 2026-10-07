import Foundation
import Testing
@_spi(Acceptance) @testable import WeftMateCore

final class MemoryStore: CredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: Data] = [:]
    private var rejectDelete = false
    func load(key: String) -> Data? { lock.withLock { values[key] } }
    func save(_ data: Data, key: String) { lock.withLock { values[key] = data } }
    func delete(key: String) throws {
        try lock.withLock {
            if rejectDelete { throw APIFailure.credentialStorage }
            values[key] = nil
        }
    }
    func failDeletions() { lock.withLock { rejectDelete = true } }
    var count: Int { lock.withLock { values.count } }
}

private let origin = "https://unit.weftmate.example:8443"
private let cookie = "wm_personal_session=" + String(repeating: "a", count: 43)
private let csrf = String(repeating: "b", count: 43)
private let conversationID = "conversation-00000000-0000-0000-0000-000000000001"

private func json(_ body: String, status: Int = 200, headers: [String: String] = [:]) -> HTTPResponse {
    .init(status: status, headers: headers, body: Data(body.utf8))
}
private func auth(_ owner: String = "owner-A", device: String = "device-Mac") -> HTTPResponse {
    json("{\"account\":{\"ownerId\":\"\(owner)\",\"username\":\"test\",\"displayName\":\"Test\",\"profileRevision\":0},\"device\":{\"id\":\"\(device)\",\"name\":\"Mac\",\"expiresAt\":\"2027-01-01T00:00:00Z\"},\"csrfToken\":\"\(csrf)\"}", headers: ["set-cookie": cookie + "; HttpOnly; Secure"])
}
private func status(_ owner: String = "owner-A") -> HTTPResponse { json("{\"ownerId\":\"\(owner)\",\"hostId\":\"host-test\"}") }

private actor ScriptTransport: HTTPTransport {
    struct Step: Sendable { let path: String; let response: HTTPResponse; var pause: Bool = false }
    private var steps: [Step]
    private var recorded: [URLRequest] = []
    private var paused: CheckedContinuation<Void, Never>?
    init(_ steps: [Step]) { self.steps = steps }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        recorded.append(request)
        guard !steps.isEmpty else { throw APIFailure.invalidResponse }
        let step = steps.removeFirst()
        let path = (request.url?.path ?? "") + (request.url?.query.map { "?" + $0 } ?? "")
        guard path == "/personal/v1" + step.path else { throw APIFailure.invalidResponse }
        if step.pause { await withCheckedContinuation { paused = $0 } }
        return step.response
    }
    func waitUntilPaused() async { while paused == nil { await Task.yield() } }
    func release() { paused?.resume(); paused = nil }
    func requests() -> [URLRequest] { recorded }
    func remaining() -> Int { steps.count }
}

private func step(_ path: String, _ response: HTTPResponse, pause: Bool = false) -> ScriptTransport.Step {
    .init(path: path, response: response, pause: pause)
}
private func login(_ client: PersonalClient) async throws -> AccountSession {
    try await client.login(server: ServerConfiguration(input: origin), username: "test", password: "fixture-password-only", deviceName: "Mac")
}

@Test func canonicalServerRejectsCredentialsAndNonHTTPS() throws {
    let server = try ServerConfiguration(input: " HTTPS://Example.COM:8443/personal/v1/ui/ ")
    #expect(server.originString == "https://example.com:8443")
    for invalid in ["http://example.com", "https://u:p@example.com", "https://example.com?token=x", "https://example.com#fragment", "https://example.com/v1", "https://example.com:99999"] {
        #expect(throws: APIFailure.invalidServer) { try ServerConfiguration(input: invalid) }
    }
    #expect(throws: APIFailure.invalidServer) { try ServerConfiguration(input: "http://127.0.0.1:18186") }
    #expect(try ServerConfiguration(input: "http://127.0.0.1:18186", allowLoopbackHTTP: true).originString == "http://127.0.0.1:18186")
}

@Test func installationIdentityPersistsAndDiffersByPlatform() throws {
    let store = MemoryStore()
    let mac = try DeviceIdentity.load(platform: .macOS, store: store)
    #expect(try DeviceIdentity.load(platform: .macOS, store: store) == mac)
    let phone = try DeviceIdentity.load(platform: .iOS, store: store)
    let watch = try DeviceIdentity.load(platform: .watchOS, store: store)
    #expect(Set([mac.identifier, phone.identifier, watch.identifier]).count == 3)
    #expect(watch.defaultName.hasPrefix("Apple Watch"))
}

@Test func loginAndRestartRetainIssuedDeviceAndExplicitCookie() async throws {
    let store = MemoryStore()
    let transport = ScriptTransport([step("/auth/login", auth()), step("/status", status()),
        step("/auth/me", auth()), step("/status", status()), step("/auth/logout", json("{}"))])
    let client = PersonalClient(credentialStore: store, transport: transport, platform: .macOS)
    let first = try await login(client)
    #expect(first.device.current)
    let restarted = PersonalClient(credentialStore: store, transport: transport, platform: .macOS)
    let restored = try await restarted.restoreSession(server: ServerConfiguration(input: origin))
    #expect(restored?.device.id == first.device.id)
    #expect(restored?.account.ownerId == first.account.ownerId)
    let requests = await transport.requests()
    #expect(requests[0].value(forHTTPHeaderField: "Origin") == origin)
    #expect(requests[0].value(forHTTPHeaderField: "Cookie") == nil)
    #expect(requests[1].value(forHTTPHeaderField: "Cookie") == cookie)
    try await restarted.logout()
    #expect(store.count == 0)
    let last = await transport.requests().last!
    #expect(last.value(forHTTPHeaderField: "X-WeftMate-CSRF") == csrf)
    #expect(last.value(forHTTPHeaderField: "Origin") == origin)
}

@Test func ownerMismatchNeverPersistsSession() async throws {
    let store = MemoryStore()
    let transport = ScriptTransport([step("/auth/login", auth()), step("/status", status("owner-B"))])
    let client = PersonalClient(credentialStore: store, transport: transport)
    await #expect(throws: APIFailure.identityMismatch) { try await login(client) }
    #expect(await client.currentSession() == nil)
    #expect(store.count == 0)
}

@Test func malformedCookieDoesNotBecomeAuthentication() async throws {
    let store = MemoryStore()
    let reply = auth()
    let transport = ScriptTransport([step("/auth/login", .init(status: 200, headers: ["Set-Cookie": "wm_personal_session=bad"], body: reply.body))])
    let client = PersonalClient(credentialStore: store, transport: transport)
    await #expect(throws: APIFailure.invalidResponse) { try await login(client) }
    #expect(store.count == 0)
    #expect(await transport.remaining() == 0)
}

@Test func delayedAccountADevicesCannotPublishAfterLogoutAndAccountBLogin() async throws {
    let store = MemoryStore()
    let transport = ScriptTransport([step("/auth/login", auth()), step("/status", status()),
        step("/auth/me", auth()), step("/auth/devices", json("{\"devices\":[{\"id\":\"device-Mac\",\"name\":\"Mac A\",\"current\":true}]}"), pause: true),
        step("/auth/logout", json("{}")), step("/auth/login", auth("owner-B", device: "device-B")), step("/status", status("owner-B"))])
    let client = PersonalClient(credentialStore: store, transport: transport)
    _ = try await login(client)
    let read = Task { try await client.devices() }
    await transport.waitUntilPaused()
    try await client.logout()
    let second = try await login(client)
    #expect(second.account.ownerId == "owner-B")
    await transport.release()
    await #expect(throws: APIFailure.accountChanged) { try await read.value }
    #expect(await client.currentSession()?.account.ownerId == "owner-B")
}

@Test func revokedDeviceClearsLocalCredentialInsteadOfShowingEmptySuccess() async throws {
    let store = MemoryStore()
    let transport = ScriptTransport([step("/auth/login", auth()), step("/status", status()),
        step("/auth/me", json("{\"error\":{\"code\":\"UNAUTHORIZED\"}}", status: 401))])
    let client = PersonalClient(credentialStore: store, transport: transport)
    _ = try await login(client)
    await #expect(throws: APIFailure.server(status: 401, code: "UNAUTHORIZED")) { try await client.devices() }
    #expect(await client.currentSession() == nil)
    #expect(store.count == 0)
}

@Test func originalPhoneAndBoundHostHistoryMergeByReceiptAndKeepLateRecords() async throws {
    let store = MemoryStore()
    let events = """
    [{"seq":1,"sourceDeviceId":"device-Phone","eventId":"event-1","conversationId":"\(conversationID)","kind":"conversation.created","occurredAt":"2026-10-04T00:00:00Z","payload":{"title":"Original"}},
    {"seq":2,"sourceDeviceId":"device-Phone","eventId":"event-2","conversationId":"\(conversationID)","kind":"message.created","occurredAt":"2026-10-04T00:00:01Z","payload":{"messageId":"message-2","role":"user","text":"before handoff"}},
    {"seq":3,"sourceDeviceId":"device-Phone","eventId":"event-3","conversationId":"\(conversationID)","kind":"message.created","occurredAt":"2026-10-04T00:00:02Z","payload":{"messageId":"message-3","role":"assistant","text":"phone answer"}},
    {"seq":4,"sourceDeviceId":"device-Phone","eventId":"event-4","conversationId":"\(conversationID)","kind":"message.created","occurredAt":"2026-10-04T00:00:03Z","payload":{"messageId":"message-4","role":"user","text":"adopted user"}},
    {"seq":5,"sourceDeviceId":"device-Phone","eventId":"event-5","conversationId":"\(conversationID)","kind":"message.created","occurredAt":"2026-10-04T00:00:04Z","payload":{"messageId":"message-5","role":"assistant","text":"late branch"}}]
    """
    let sync = json("{\"events\":\(events),\"nextSeq\":5,\"hasMore\":false}")
    let sessions = json("{\"sessions\":[{\"sessionId\":\"session-host\",\"conversationId\":\"\(conversationID)\",\"title\":\"Host\",\"running\":false,\"sendAvailable\":true}]}")
    let projection = json("{\"source\":\"host\",\"conversationId\":\"\(conversationID)\",\"hostId\":\"host-test\",\"binding\":{\"sessionId\":\"session-host\",\"cutoverSyncSeq\":3},\"adoptedMessages\":[{\"sourceSyncEventId\":\"event-4\",\"state\":\"accepted_by_dsh\",\"receiptId\":\"receipt-4\"}]}")
    let hostPage = json("{\"events\":[{\"seq\":0,\"type\":\"user.message\",\"data\":{\"text\":\"adopted user truncated\",\"receiptId\":\"receipt-4\"}},{\"seq\":1,\"type\":\"assistant.message\",\"data\":{\"text\":\"host answer\"}}],\"nextSeq\":1,\"hasMore\":false}")
    let transport = ScriptTransport([step("/auth/login", auth()), step("/status", status()),
        step("/auth/me", auth()), step("/sync/events?afterSeq=0&limit=100", sync), step("/sessions", sessions),
        step("/auth/me", auth()), step("/sync/events?afterSeq=0&limit=100", sync),
        step("/sync/conversations/\(conversationID)/shared", projection), step("/sessions/session-host/events?limit=100", hostPage)])
    let client = PersonalClient(credentialStore: store, transport: transport)
    _ = try await login(client)
    let conversations = try await client.conversations()
    #expect(conversations.count == 1)
    #expect(conversations[0].id == conversationID)
    #expect(conversations[0].sendAvailable == false)
    let messages = try await client.history(conversation: conversations[0])
    #expect(messages.map(\.text) == ["before handoff", "phone answer", "adopted user", "host answer", "late branch"])
    #expect(messages.last?.pendingContext == true)
    #expect(messages.filter { $0.text == "adopted user" }.count == 1)
    #expect(await transport.remaining() == 0)
}

@Test func malformedPaginationFailsWithoutClaimingCompleteHistory() async throws {
    let store = MemoryStore()
    let transport = ScriptTransport([step("/auth/login", auth()), step("/status", status()), step("/auth/me", auth()),
        step("/sync/events?afterSeq=0&limit=100", json("{\"events\":[],\"nextSeq\":0,\"hasMore\":true}"))])
    let client = PersonalClient(credentialStore: store, transport: transport)
    _ = try await login(client)
    await #expect(throws: APIFailure.invalidResponse) { try await client.conversations() }
}

@Test func unsafeErrorBodyNeverBecomesDisplayText() async throws {
    let transport = ScriptTransport([step("/auth/login", json("{\"error\":{\"code\":\"private password and API key\"}}", status: 502))])
    let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
    await #expect(throws: APIFailure.server(status: 502, code: "HTTP_502")) { try await login(client) }
}

@Test func offlineRestoreRetainsUnverifiedIdentityAndRetriesWithoutMintingDevice() async throws {
    let store = MemoryStore()
    let transport = ScriptTransport([step("/auth/login", auth()), step("/status", status()),
        step("/auth/me", json("{\"error\":{\"code\":\"BACKEND_UNAVAILABLE\"}}", status: 503)),
        step("/auth/me", auth()), step("/status", status())])
    let first = PersonalClient(credentialStore: store, transport: transport)
    _ = try await login(first)
    let restarted = PersonalClient(credentialStore: store, transport: transport)
    await #expect(throws: APIFailure.server(status: 503, code: "BACKEND_UNAVAILABLE")) {
        try await restarted.restoreSession(server: ServerConfiguration(input: origin))
    }
    #expect(await restarted.currentSession()?.device.id == "device-Mac")
    #expect(await restarted.currentSession()?.verification == .unverifiedOffline)
    #expect(store.count == 1)
    let restored = try await restarted.restoreSession(server: ServerConfiguration(input: origin))
    #expect(restored?.verification == .verified)
    #expect(restored?.device.id == "device-Mac")
    #expect(await transport.requests().filter { $0.url?.path.hasSuffix("/auth/login") == true }.count == 1)
}

@Test func deletionFailureStillAttemptsRemoteLogoutAndReportsPrecisely() async throws {
    let store = MemoryStore()
    let transport = ScriptTransport([step("/auth/login", auth()), step("/status", status()), step("/auth/logout", json("{}"))])
    let client = PersonalClient(credentialStore: store, transport: transport)
    _ = try await login(client)
    store.failDeletions()
    await #expect(throws: APIFailure.logoutIncomplete(credentialRemoved: false, remoteConfirmed: true)) { try await client.logout() }
    #expect(await client.currentSession() == nil)
    #expect(store.count == 1)
    #expect(await transport.remaining() == 0)
}

@Test func deletionFailureAndOfflineLogoutCannotClaimPersistentCredentialsRemoved() async throws {
    let store = MemoryStore()
    let transport = ScriptTransport([step("/auth/login", auth()), step("/status", status()),
        step("/auth/logout", json("{\"error\":{\"code\":\"BACKEND_UNAVAILABLE\"}}", status: 503))])
    let client = PersonalClient(credentialStore: store, transport: transport)
    _ = try await login(client)
    store.failDeletions()
    await #expect(throws: APIFailure.logoutIncomplete(credentialRemoved: false, remoteConfirmed: false)) { try await client.logout() }
    #expect(store.count == 1)
    #expect(await transport.remaining() == 0)
}

@Test func serverLogoutOutageStillClearsLocalPersistence() async throws {
    let store = MemoryStore()
    let transport = ScriptTransport([step("/auth/login", auth()), step("/status", status()),
        step("/auth/logout", json("{}", status: 503))])
    let client = PersonalClient(credentialStore: store, transport: transport)
    _ = try await login(client)
    await #expect(throws: APIFailure.logoutIncomplete(credentialRemoved: true, remoteConfirmed: false)) { try await client.logout() }
    #expect(store.count == 0)
    #expect(await client.currentSession() == nil)
}

@Test func delayedInvalidPasswordResultCannotOverrideNewSuccessfulLogin() async throws {
    let store = MemoryStore()
    let transport = ScriptTransport([step("/auth/login", json("{\"error\":{\"code\":\"INVALID_CREDENTIALS\"}}", status: 401), pause: true),
        step("/auth/login", auth("owner-B", device: "device-B")), step("/status", status("owner-B"))])
    let client = PersonalClient(credentialStore: store, transport: transport)
    let old = Task { try await login(client) }
    await transport.waitUntilPaused()
    let latest = try await login(client)
    #expect(latest.account.ownerId == "owner-B")
    await transport.release()
    await #expect(throws: APIFailure.accountChanged) { try await old.value }
    #expect(await client.currentSession()?.account.ownerId == "owner-B")
    #expect(store.count == 1)
}

@Test func validSyncPaginationUsesServerCursorAndShowsAllOriginalConversations() async throws {
    let id2 = "conversation-00000000-0000-0000-0000-000000000002"
    func event(_ seq: Int, _ id: String, _ title: String) -> String {
        "{\"seq\":\(seq),\"sourceDeviceId\":\"device-Phone\",\"eventId\":\"event-\(seq)\",\"conversationId\":\"\(id)\",\"kind\":\"conversation.created\",\"occurredAt\":\"2026-10-04T00:00:00Z\",\"payload\":{\"title\":\"\(title)\"}}"
    }
    let transport = ScriptTransport([step("/auth/login", auth()), step("/status", status()), step("/auth/me", auth()),
        step("/sync/events?afterSeq=0&limit=100", json("{\"events\":[\(event(1, conversationID, "first"))],\"nextSeq\":1,\"hasMore\":true}")),
        step("/sync/events?afterSeq=1&limit=100", json("{\"events\":[\(event(2, id2, "second"))],\"nextSeq\":2,\"hasMore\":false}")),
        step("/sessions", json("{\"sessions\":[]}"))])
    let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
    _ = try await login(client)
    let rows = try await client.conversations()
    #expect(rows.map(\.title) == ["first", "second"])
    #expect(await transport.remaining() == 0)
}

#if DEBUG
@Test func developmentProxyPortRequiresExplicitUnprivilegedTCPPort() throws {
    for invalid in [-1, 0, 80, 1023, 65536, Int.max] {
        #expect(throws: APIFailure.invalidServer) { try DevelopmentProxyRoute(port: invalid) }
    }
    #expect(try DevelopmentProxyRoute(port: 1024).port == 1024)
    #expect(try DevelopmentProxyRoute(port: 65535).port == 65535)
}

@Test func developmentProxyRejectsOtherOriginsBeforeConnecting() async throws {
    let route = try DevelopmentProxyRoute(port: 64834)
    try route.validate(URL(string: "https://home.weftmate.com:8443/personal/v1/auth/state"))
    try route.validate(URL(string: "https://HOME.WEFTMATE.COM:8443/personal/v1/sync/events?afterSeq=0&limit=100"))
    let transport = try URLSessionTransport(developmentProxyPort: 64834)
    for invalid in ["http://home.weftmate.com:8443/personal/v1/auth/state", "https://home.weftmate.com/personal/v1/auth/state",
                    "https://home.weftmate.com:443/personal/v1/auth/state", "https://192.168.31.91:8443/personal/v1/auth/state",
                    "https://home.weftmate.com.evil.example:8443/personal/v1/auth/state", "https://user:password@home.weftmate.com:8443/personal/v1/auth/state",
                    "https://home.weftmate.com:8443/personal/v1/auth/state#fragment"] {
        #expect(throws: APIFailure.invalidServer) { try route.validate(URL(string: invalid)) }
        await #expect(throws: APIFailure.invalidServer) { try await transport.send(URLRequest(url: URL(string: invalid)!)) }
    }
    #expect(throws: APIFailure.invalidServer) { try route.validate(nil) }
}
#endif

@Test func isolatedAppleCapabilitiesUseIssuedDeviceAndNeverDeclareAndroidOrSecretTransfer() async throws {
    for platform in ApplePlatform.allCases {
        let platformName = platform.rawValue.lowercased()
        let transport = ScriptTransport([step("/auth/login", auth()), step("/status", status()), step("/auth/me", auth()),
            step("/sync/capabilities", json("{\"deviceId\":\"device-Mac\",\"platform\":\"\(platformName)\",\"sharedConversations\":1}"))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport, platform: platform)
        _ = try await login(client)
        try await client.declareAcceptanceCapabilities()
        let sent = await transport.requests().last!
        let body = try JSONSerialization.jsonObject(with: sent.httpBody!) as! [String: Any]
        #expect(sent.httpMethod == "POST")
        #expect(sent.value(forHTTPHeaderField: "Origin") == origin)
        #expect(sent.value(forHTTPHeaderField: "Cookie") == cookie)
        #expect(sent.value(forHTTPHeaderField: "X-WeftMate-CSRF") == csrf)
        #expect(Set(body.keys) == Set(["platform", "sharedConversations"]))
        #expect(body["platform"] as? String == platformName)
        #expect(body["sharedConversations"] as? Int == 1)
        #expect(await transport.remaining() == 0)
    }
}

@Test func capabilityReplyCannotSubstituteDevicePlatformOrUnimplementedCapability() async throws {
    let rejected: [(String, APIFailure)] = [
        ("{\"deviceId\":\"device-Other\",\"platform\":\"macos\",\"sharedConversations\":1}", .identityMismatch),
        ("{\"deviceId\":\"device-Mac\",\"platform\":\"ios\",\"sharedConversations\":1}", .identityMismatch),
        ("{\"deviceId\":\"device-Mac\",\"platform\":\"macos\",\"sharedConversations\":2}", .invalidResponse),
        ("{\"deviceId\":\"device-Mac\",\"platform\":\"macos\",\"sharedConversations\":1,\"nativeVersionCode\":11}", .invalidResponse),
        ("{\"deviceId\":\"device-Mac\",\"platform\":\"macos\",\"sharedConversations\":1,\"accountModelTransfer\":1}", .invalidResponse)
    ]
    for (body, failure) in rejected {
        let transport = ScriptTransport([step("/auth/login", auth()), step("/status", status()), step("/auth/me", auth()),
            step("/sync/capabilities", json(body))])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        _ = try await login(client)
        await #expect(throws: failure) { try await client.declareAcceptanceCapabilities() }
    }
}

@Test func capabilityResponseFromOldAccountCannotCompleteAfterAccountSwitch() async throws {
    let transport = ScriptTransport([step("/auth/login", auth()), step("/status", status()), step("/auth/me", auth()),
        step("/sync/capabilities", json("{\"deviceId\":\"device-Mac\",\"platform\":\"macos\",\"sharedConversations\":1}"), pause: true),
        step("/auth/logout", json("{}")), step("/auth/login", auth("owner-B", device: "device-B")), step("/status", status("owner-B"))])
    let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
    _ = try await login(client)
    let old = Task { try await client.declareAcceptanceCapabilities() }
    await transport.waitUntilPaused()
    try await client.logout()
    _ = try await login(client)
    await transport.release()
    await #expect(throws: APIFailure.accountChanged) { try await old.value }
    #expect(await client.currentSession()?.account.ownerId == "owner-B")
}
