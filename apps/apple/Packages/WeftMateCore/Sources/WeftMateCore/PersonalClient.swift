import Foundation

private struct AuthReply: Codable { let account: AccountProfile; let device: DeviceRecord; let csrfToken: String }
private struct StatusReply: Codable { let ownerId: String; let hostId: String }
private struct Credential: Codable, Sendable {
    var session: AccountSession
    let cookie: String
    var csrf: String
}
private struct DevicesReply: Decodable { let devices: [DeviceRecord] }
private struct RemoteSession: Decodable {
    let sessionId: String; let title: String; let running: Bool; let sendAvailable: Bool
    let conversationId: String?; let modelProfileId: String?; let unavailable: Bool?
}
private struct SessionsReply: Decodable { let sessions: [RemoteSession] }
private struct OriginalModel: Decodable { let modelId: String; let displayName: String }
private struct SyncPayload: Decodable {
    let title: String?; let messageId: String?; let role: MessageRole?; let text: String?
    let attachments: [JSONValue]?; let originalModel: OriginalModel?
}
private struct SyncEvent: Decodable {
    let seq: Int; let sourceDeviceId: String; let eventId: String; let conversationId: String
    let kind: String; let occurredAt: String; let payload: SyncPayload
}
private struct SyncPage: Decodable { let events: [SyncEvent]; let nextSeq: Int; let hasMore: Bool }
private struct HistoryEvent: Decodable {
    let seq: Int; let type: String; let at: String?; let data: JSONValue
}
private struct HistoryPage: Decodable { let events: [HistoryEvent]; let nextSeq: Int; let hasMore: Bool }
private struct Binding: Decodable { let sessionId: String; let cutoverSyncSeq: Int }
private struct AdoptedMessage: Decodable {
    let sourceSyncEventId: String; let state: String; let receiptId: String?
}
private struct SharedProjection: Decodable {
    let conversationId: String; let hostId: String; let source: String
    let binding: Binding?; let adoptedMessages: [AdoptedMessage]?
}
private struct ErrorReply: Decodable { let error: ErrorCode?; struct ErrorCode: Decodable { let code: String? } }
private struct AcceptanceSyncReply: Decodable {
    struct Accepted: Decodable { let eventId: String; let seq: Int }
    let accepted: [Accepted]
}

private enum JSONValue: Decodable {
    case object([String: JSONValue]), array([JSONValue]), string(String), number(Double), bool(Bool), null
    init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let x = try? c.decode(Bool.self) { self = .bool(x) }
        else if let x = try? c.decode(String.self) { self = .string(x) }
        else if let x = try? c.decode(Double.self) { self = .number(x) }
        else if let x = try? c.decode([JSONValue].self) { self = .array(x) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }
    subscript(_ key: String) -> JSONValue? { if case .object(let x) = self { x[key] } else { nil } }
    var string: String? { if case .string(let x) = self { x } else { nil } }
    var count: Int { if case .array(let x) = self { x.count } else { 0 } }
    var bool: Bool { if case .bool(let x) = self { x } else { false } }
}

/// Owner-scoped client. Async callbacks are checked against a generation before publishing or persisting.
/// This first milestone only reads existing conversations; no Android capability/version is asserted.
public actor PersonalClient {
    private let store: any CredentialStore
    private let transport: any HTTPTransport
    private let platform: ApplePlatform
    private var credential: Credential?
    private var epoch: UInt64 = 0
    private var syncEvents: [SyncEvent] = []
    private var summaries: [ConversationSummary] = []
    private var historyCache: [String: [ChatMessage]] = [:]
    private let decoder = JSONDecoder()

    public init(credentialStore: any CredentialStore = KeychainCredentialStore(),
                transport: any HTTPTransport = URLSessionTransport(), platform: ApplePlatform = .current) {
        self.store = credentialStore; self.transport = transport; self.platform = platform
    }
    public func currentSession() -> AccountSession? { credential?.session }

    public func restoreSession(server: ServerConfiguration) async throws -> AccountSession? {
        let generation = try transition(server: server, clearSaved: false)
        guard let data = try store.load(key: credentialKey(server: server, platform: platform)) else { return nil }
        let saved: Credential
        do { saved = try decoder.decode(Credential.self, from: data) }
        catch {
            try store.delete(key: credentialKey(server: server, platform: platform)); throw APIFailure.credentialStorage
        }
        guard saved.session.server == server, validCookie(saved.cookie), validCSRF(saved.csrf) else {
            try store.delete(key: credentialKey(server: server, platform: platform)); throw APIFailure.identityMismatch
        }
        do {
            let me: AuthReply = try await request(server: server, path: "/auth/me", auth: saved)
            try check(generation)
            guard me.account.ownerId == saved.session.account.ownerId, me.device.id == saved.session.device.id else {
                throw APIFailure.identityMismatch
            }
            let status: StatusReply = try await request(server: server, path: "/status", auth: saved)
            try check(generation)
            guard status.ownerId == me.account.ownerId, status.hostId == saved.session.hostId, validCSRF(me.csrfToken) else {
                throw APIFailure.identityMismatch
            }
            let updated = Credential(session: AccountSession(server: server, account: me.account,
                device: currentDevice(me.device), hostId: status.hostId, verification: .verified), cookie: saved.cookie, csrf: me.csrfToken)
            try persist(updated); credential = updated
            return updated.session
        } catch {
            try check(generation)
            if shouldForget(error) { try store.delete(key: credentialKey(server: server, platform: platform)) }
            else if transient(error) {
                // Retain identity for a retry without minting another server device. This is not fresh authentication.
                credential = Credential(session: AccountSession(server: server, account: saved.session.account,
                    device: saved.session.device, hostId: saved.session.hostId, verification: .unverifiedOffline),
                    cookie: saved.cookie, csrf: saved.csrf)
            }
            throw error
        }
    }

    public func login(server: ServerConfiguration, username: String, password: String, deviceName: String) async throws -> AccountSession {
        try await authenticate(server: server, path: "/auth/login", username: username,
                               password: password, deviceName: deviceName, displayName: nil)
    }
    public func register(server: ServerConfiguration, username: String, password: String,
                         deviceName: String, displayName: String? = nil) async throws -> AccountSession {
        try await authenticate(server: server, path: "/auth/register", username: username,
                               password: password, deviceName: deviceName, displayName: displayName)
    }
    private func authenticate(server: ServerConfiguration, path: String, username: String, password: String,
                              deviceName: String, displayName: String?) async throws -> AccountSession {
        let generation = try transition(server: server, clearSaved: true)
        let name = deviceName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 128 else { throw APIFailure.server(status: 400, code: "INVALID_REQUEST") }
        var body = ["username": username, "password": password, "deviceName": name]
        if path == "/auth/register", let displayName, !displayName.isEmpty { body["displayName"] = displayName }
        let response: HTTPResponse
        do { response = try await rawRequest(server: server, path: path, method: "POST", body: try JSONEncoder().encode(body)) }
        catch { try check(generation); throw error }
        try check(generation)
        let reply: AuthReply = try decode(response.body)
        let cookie = response.headers.first { $0.key.lowercased() == "set-cookie" }?.value.components(separatedBy: ";").first ?? ""
        guard validCookie(cookie), validCSRF(reply.csrfToken), validID(reply.account.ownerId), validID(reply.device.id) else {
            throw APIFailure.invalidResponse
        }
        let provisional = Credential(session: AccountSession(server: server, account: reply.account,
            device: currentDevice(reply.device), hostId: "", verification: .verified), cookie: cookie, csrf: reply.csrfToken)
        let status: StatusReply
        do { status = try await request(server: server, path: "/status", auth: provisional) }
        catch { try check(generation); throw error }
        try check(generation)
        guard status.ownerId == reply.account.ownerId, validID(status.hostId) else { throw APIFailure.identityMismatch }
        let verified = Credential(session: AccountSession(server: server, account: reply.account,
            device: currentDevice(reply.device), hostId: status.hostId, verification: .verified), cookie: cookie, csrf: reply.csrfToken)
        try persist(verified); credential = verified
        return verified.session
    }

    /// Immediately removes local access. A network failure reports that server logout remains unconfirmed.
    public func logout() async throws {
        let old = credential
        epoch &+= 1; credential = nil; clearCaches()
        let generation = epoch
        guard let old else { return }
        var removed = true
        do { try store.delete(key: credentialKey(server: old.session.server, platform: platform)) }
        catch { removed = false }
        var confirmed = true
        do { _ = try await rawRequest(server: old.session.server, path: "/auth/logout", method: "POST", body: Data("{}".utf8), auth: old) }
        catch { confirmed = false }
        try check(generation)
        if !removed || !confirmed { throw APIFailure.logoutIncomplete(credentialRemoved: removed, remoteConfirmed: confirmed) }
    }

    public func devices() async throws -> [DeviceRecord] {
        let (auth, generation) = try snapshot()
        try await verify(auth, generation)
        let reply: DevicesReply = try await authorized(auth, generation, path: "/auth/devices")
        guard reply.devices.count <= 200, Set(reply.devices.map(\.id)).count == reply.devices.count,
              reply.devices.allSatisfy({ validID($0.id) }),
              reply.devices.filter(\.current).count == 1,
              reply.devices.first(where: \.current)?.id == auth.session.device.id else { throw APIFailure.identityMismatch }
        return reply.devices
    }

    public func conversations() async throws -> [ConversationSummary] {
        let (auth, generation) = try snapshot()
        try await verify(auth, generation)
        let events = try await readSync(auth, generation)
        let host: SessionsReply = try await authorized(auth, generation, path: "/sessions")
        guard host.sessions.count <= 20_000, host.sessions.allSatisfy({ validID($0.sessionId) }),
              Set(host.sessions.map(\.sessionId)).count == host.sessions.count else { throw APIFailure.invalidResponse }
        let grouped = Dictionary(grouping: events, by: \.conversationId)
        var rows: [ConversationSummary] = []
        for (id, events) in grouped {
            let created = events.filter { $0.kind == "conversation.created" }
            // Two source devices may legally append ambiguous creations. Never invent an adoption identity.
            let title = created.count == 1 ? created.first?.payload.title ?? "对话" : "来源待核对的对话"
            let bound = host.sessions.filter { $0.conversationId == id }
            guard bound.count <= 1 else { throw APIFailure.invalidResponse }
            let session = bound.first
            rows.append(.init(id: id, title: title, conversationId: id, sessionId: session?.sessionId,
                running: session?.running ?? false, sendAvailable: false, originalModelLabel: nil))
        }
        for session in host.sessions where session.conversationId == nil || grouped[session.conversationId!] == nil {
            rows.append(.init(id: session.conversationId ?? session.sessionId,
                title: session.title.isEmpty ? "电脑会话" : session.title, conversationId: session.conversationId,
                sessionId: session.sessionId, running: session.running, sendAvailable: false,
                originalModelLabel: session.modelProfileId))
        }
        try check(generation)
        syncEvents = events
        summaries = rows.sorted { $0.id < $1.id }
        return summaries
    }

    public func history(conversation: ConversationSummary) async throws -> [ChatMessage] {
        let (auth, generation) = try snapshot()
        guard summaries.contains(conversation) else { throw APIFailure.server(status: 404, code: "SESSION_UNAVAILABLE") }
        try await verify(auth, generation)
        var result: [ChatMessage] = []
        if let originalID = conversation.conversationId {
            // Refresh phone records before projecting the adoption cut and late segment.
            let events = try await readSync(auth, generation)
            let originals = events.filter { $0.conversationId == originalID && $0.kind == "message.created" }
            let projection: SharedProjection = try await authorized(auth, generation, path: "/sync/conversations/\(try checkedID(originalID))/shared")
            guard projection.conversationId == originalID, projection.hostId == auth.session.hostId,
                  projection.source == "host" else { throw APIFailure.identityMismatch }
            let cut = projection.binding?.cutoverSyncSeq
            result = try originals.filter { cut == nil || $0.seq <= cut! }.map { try syncMessage($0, pending: false) }
            if let binding = projection.binding {
                guard binding.cutoverSyncSeq >= 0,
                      conversation.sessionId == nil || conversation.sessionId == binding.sessionId else { throw APIFailure.invalidResponse }
                let hostEvents = try await readHistory(auth, generation, sessionID: binding.sessionId)
                var adopted: [String: String] = [:]
                for item in projection.adoptedMessages ?? [] where item.state == "accepted_by_dsh" {
                    guard let receipt = item.receiptId else { continue }
                    if let prior = adopted[receipt], prior != item.sourceSyncEventId { throw APIFailure.invalidResponse }
                    adopted[receipt] = item.sourceSyncEventId
                }
                var shown = Set<String>()
                for event in hostEvents {
                    if event.type == "user.message", let receipt = event.data["receiptId"]?.string,
                       let eventID = adopted[receipt], let original = originals.first(where: { $0.eventId == eventID }) {
                        result.append(try syncMessage(original, pending: false)); shown.insert(eventID)
                    } else if let message = hostMessage(event, sessionID: binding.sessionId) { result.append(message) }
                }
                for original in originals where original.seq > binding.cutoverSyncSeq && !shown.contains(original.eventId) {
                    result.append(try syncMessage(original, pending: true))
                }
            }
            try check(generation); syncEvents = events
        } else if let sessionID = conversation.sessionId {
            result = try await readHistory(auth, generation, sessionID: sessionID).compactMap { hostMessage($0, sessionID: sessionID) }
        } else { throw APIFailure.invalidResponse }
        try check(generation)
        guard Set(result.map(\.id)).count == result.count else { throw APIFailure.invalidResponse }
        historyCache[conversation.id] = result
        return result
    }

    /// Cache belongs only to the currently authenticated generation; no fallback is represented as fresh data.
    public func cachedHistory(conversationID: String) -> [ChatMessage]? { credential == nil ? nil : historyCache[conversationID] }

    /// Only the native acceptance executable imports this SPI. The fixture writes records, not a model request.
    /// IDs are supplied before the POST so a lost reply never causes a new fixture/request identity.
    @_spi(Acceptance) public func seedAcceptanceConversation(conversationID: String, marker: String) async throws {
        let (auth, generation) = try snapshot()
        try await verify(auth, generation)
        guard let uuid = UUID(uuidString: conversationID), !marker.isEmpty, marker.count <= 256 else { throw APIFailure.invalidResponse }
        let c = uuid.uuidString.lowercased()
        // New test device has no other source events. This is deliberately not a user-facing send API.
        let now = ISO8601DateFormatter().string(from: Date())
        // Protocol UUIDs allow one prefix only; derive three UUIDs without relying on suffixes.
        let eventIDs = (1...3).map { index in String(c.dropLast()) + String(index) }
        let message = UUID().uuidString.lowercased(), turn = UUID().uuidString.lowercased()
        let events: [[String: Any]] = [
            ["eventId": eventIDs[0], "conversationId": c, "clientSeq": 1, "kind": "conversation.created", "occurredAt": now,
             "payload": ["title": "Apple 联调测试记录"]],
            ["eventId": eventIDs[1], "conversationId": c, "clientSeq": 2, "kind": "message.created", "occurredAt": now,
             "payload": ["messageId": message, "role": "user", "text": marker]],
            ["eventId": eventIDs[2], "conversationId": c, "clientSeq": 3, "kind": "turn.finished", "occurredAt": now,
             "payload": ["turnId": turn, "status": "interrupted", "errorCode": "ACCEPTANCE_NO_INFERENCE"]]
        ]
        let response = try await rawRequest(server: auth.session.server, path: "/sync/events", method: "POST",
            body: try JSONSerialization.data(withJSONObject: ["events": events], options: [.sortedKeys]), auth: auth)
        try check(generation)
        let reply: AcceptanceSyncReply = try decode(response.body)
        guard reply.accepted.map(\.eventId) == eventIDs, reply.accepted.allSatisfy({ $0.seq > 0 }) else { throw APIFailure.invalidResponse }
    }

    private func readSync(_ auth: Credential, _ generation: UInt64) async throws -> [SyncEvent] {
        var after = 0, all: [SyncEvent] = [], ids = Set<String>()
        while true {
            let page: SyncPage = try await authorized(auth, generation, path: "/sync/events?afterSeq=\(after)&limit=100")
            try validateCursor(page.events.map(\.seq), after: after, next: page.nextSeq, hasMore: page.hasMore)
            for event in page.events {
                guard validID(event.sourceDeviceId), validID(event.eventId), validID(event.conversationId),
                      ids.insert("\(event.sourceDeviceId)|\(event.eventId)").inserted else { throw APIFailure.invalidResponse }
            }
            all.append(contentsOf: page.events)
            guard all.count <= 20_000 else { throw APIFailure.historyLimit }
            if !page.hasMore { return all }
            after = page.nextSeq
        }
    }
    private func readHistory(_ auth: Credential, _ generation: UInt64, sessionID: String) async throws -> [HistoryEvent] {
        let id = try checkedID(sessionID)
        var after = -1, all: [HistoryEvent] = []
        while true {
            let page: HistoryPage = try await authorized(auth, generation, path: "/sessions/\(id)/events?afterSeq=\(after)&limit=100")
            try validateCursor(page.events.map(\.seq), after: after, next: page.nextSeq, hasMore: page.hasMore)
            all.append(contentsOf: page.events)
            guard all.count <= 20_000 else { throw APIFailure.historyLimit }
            if !page.hasMore { return all }
            after = page.nextSeq
        }
    }
    private func validateCursor(_ seqs: [Int], after: Int, next: Int, hasMore: Bool) throws {
        var prior = after
        guard seqs.count <= 100, next >= after, next <= 9_007_199_254_740_991,
              !hasMore || next > after else { throw APIFailure.invalidResponse }
        for seq in seqs { guard seq > prior, seq <= next else { throw APIFailure.invalidResponse }; prior = seq }
    }
    private func syncMessage(_ event: SyncEvent, pending: Bool) throws -> ChatMessage {
        guard let role = event.payload.role, let id = event.payload.messageId, validID(id),
              let text = event.payload.text, text.count <= 16_384 else { throw APIFailure.invalidResponse }
        return .init(id: "sync|\(event.sourceDeviceId)|\(id)", role: role, text: text,
            occurredAt: event.occurredAt, sourceDeviceId: event.sourceDeviceId,
            attachmentCount: event.payload.attachments?.count ?? 0, truncated: false, pendingContext: pending)
    }
    private func hostMessage(_ event: HistoryEvent, sessionID: String) -> ChatMessage? {
        guard ["user.message", "assistant.message"].contains(event.type) else { return nil }
        let text = event.data["text"]?.string ?? ""
        let images = event.data["images"]?.count ?? 0
        guard !text.isEmpty || images > 0 else { return nil }
        return .init(id: "host|\(sessionID)|\(event.seq)", role: event.type == "user.message" ? .user : .assistant,
            text: text, occurredAt: event.at, sourceDeviceId: nil, attachmentCount: images,
            truncated: event.data["truncated"]?.bool ?? false, pendingContext: false)
    }
    private func verify(_ auth: Credential, _ generation: UInt64) async throws {
        let me: AuthReply = try await authorized(auth, generation, path: "/auth/me")
        guard me.account.ownerId == auth.session.account.ownerId, me.device.id == auth.session.device.id,
              validCSRF(me.csrfToken) else {
            credential = nil; clearCaches(); epoch &+= 1
            try store.delete(key: credentialKey(server: auth.session.server, platform: platform))
            throw APIFailure.identityMismatch
        }
        if auth.session.verification == .unverifiedOffline {
            let status: StatusReply = try await authorized(auth, generation, path: "/status")
            guard status.ownerId == me.account.ownerId, status.hostId == auth.session.hostId else {
                credential = nil; clearCaches(); epoch &+= 1
                try store.delete(key: credentialKey(server: auth.session.server, platform: platform))
                throw APIFailure.identityMismatch
            }
            let refreshed = Credential(session: AccountSession(server: auth.session.server, account: me.account,
                device: currentDevice(me.device), hostId: status.hostId, verification: .verified), cookie: auth.cookie, csrf: me.csrfToken)
            try persist(refreshed); credential = refreshed
        }
    }
    private func snapshot() throws -> (Credential, UInt64) {
        guard let credential else { throw APIFailure.notAuthenticated }
        return (credential, epoch)
    }
    private func check(_ generation: UInt64) throws {
        guard epoch == generation else { throw APIFailure.accountChanged }
        try Task.checkCancellation()
    }
    private func transition(server: ServerConfiguration, clearSaved: Bool) throws -> UInt64 {
        let old = credential; epoch &+= 1; credential = nil; clearCaches()
        if let old, clearSaved { try store.delete(key: credentialKey(server: old.session.server, platform: platform)) }
        if clearSaved { try store.delete(key: credentialKey(server: server, platform: platform)) }
        return epoch
    }
    private func clearCaches() { syncEvents = []; summaries = []; historyCache = [:] }
    private func persist(_ auth: Credential) throws {
        try store.save(JSONEncoder().encode(auth), key: credentialKey(server: auth.session.server, platform: platform))
    }
    private func authorized<T: Decodable>(_ auth: Credential, _ generation: UInt64, path: String) async throws -> T {
        do {
            let result: T = try await request(server: auth.session.server, path: path, auth: auth)
            try check(generation); return result
        } catch {
            try check(generation)
            if shouldForget(error) {
                credential = nil; clearCaches(); epoch &+= 1
                try store.delete(key: credentialKey(server: auth.session.server, platform: platform))
            }
            throw error
        }
    }
    private func shouldForget(_ error: any Error) -> Bool {
        if case APIFailure.server(401, _) = error { return true }
        return (error as? APIFailure) == .identityMismatch
    }
    private func transient(_ error: any Error) -> Bool {
        guard let failure = error as? APIFailure else { return false }
        switch failure {
        case .transport(.unavailable), .transport(.timeout): return true
        case .server(let status, _): return status >= 500
        default: return false
        }
    }
    private func request<T: Decodable>(server: ServerConfiguration, path: String, auth: Credential) async throws -> T {
        let response = try await rawRequest(server: server, path: path, auth: auth)
        return try decode(response.body)
    }
    private func decode<T: Decodable>(_ data: Data) throws -> T {
        do { return try decoder.decode(T.self, from: data) } catch { throw APIFailure.invalidResponse }
    }
    private func rawRequest(server: ServerConfiguration, path: String, method: String = "GET",
                            body: Data? = nil, auth: Credential? = nil) async throws -> HTTPResponse {
        guard let url = URL(string: server.originString + "/personal/v1" + path),
              body?.count ?? 0 <= 262_144 else { throw APIFailure.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = method; request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let auth { request.setValue(auth.cookie, forHTTPHeaderField: "Cookie") }
        if method != "GET" {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(server.originString, forHTTPHeaderField: "Origin")
            if let auth { request.setValue(auth.csrf, forHTTPHeaderField: "X-WeftMate-CSRF") }
        }
        let response: HTTPResponse
        do { response = try await transport.send(request) }
        catch let e as APIFailure { throw e }
        catch is CancellationError { throw APIFailure.transport(.cancelled) }
        catch { throw APIFailure.transport(.unavailable) }
        guard response.body.count <= 1_048_576 else { throw APIFailure.responseTooLarge }
        if (300...399).contains(response.status) { throw APIFailure.transport(.redirect) }
        guard (200...299).contains(response.status) else {
            let candidate = (try? decoder.decode(ErrorReply.self, from: response.body))?.error?.code ?? ""
            let code = candidate.range(of: "^[A-Z][A-Z0-9_]{0,63}$", options: .regularExpression) != nil ? candidate : "HTTP_\(response.status)"
            throw APIFailure.server(status: response.status, code: code)
        }
        return response
    }
    private func currentDevice(_ d: DeviceRecord) -> DeviceRecord {
        .init(id: d.id, name: d.name, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt,
              expiresAt: d.expiresAt, revoked: d.revoked, current: true)
    }
    private func validCookie(_ value: String) -> Bool {
        value.range(of: "^wm_personal_session=[A-Za-z0-9_-]{40,128}$", options: .regularExpression) != nil
    }
    private func validCSRF(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9_-]{40,128}$", options: .regularExpression) != nil
    }
    private func validID(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil
    }
    private func checkedID(_ value: String) throws -> String {
        guard validID(value) else { throw APIFailure.invalidResponse }; return value
    }
}
