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
    let conversationId: String?; let modelProfileId: String?; let unavailable: Bool?; let archived: Bool?
}
private struct SessionsReply: Decodable { let sessions: [RemoteSession] }
private struct OriginalModel: Decodable { let modelId: String; let displayName: String }
private struct SyncPayload: Decodable {
    let title: String?; let messageId: String?; let role: MessageRole?; let text: String?
    let attachments: [OriginalAttachment]?; let originalModel: OriginalModel?
    let originalAttachments: [OriginalAttachment]?
    let attachmentMessageId: String?
    let unpreviewedOriginalImageIds: [String]?
}
private struct SyncEvent: Decodable {
    let seq: Int; let sourceDeviceId: String; let eventId: String; let conversationId: String
    let kind: String; let occurredAt: String; let payload: SyncPayload
}
private struct SyncPage: Decodable { let events: [SyncEvent]; let nextSeq: Int; let hasMore: Bool }
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
private struct AcceptanceCapabilitiesReply: Decodable {
    let deviceId: String
    let platform: String
    let sharedConversations: Int
}

/// Owner-scoped client. Async callbacks are checked against a generation before publishing or persisting.
/// Shared commands reuse a persisted request identity; no Android capability/version is asserted.
public actor PersonalClient {
    private let store: any CredentialStore
    private let transport: any HTTPTransport
    private let platform: ApplePlatform
    private var credential: Credential?
    private var epoch: UInt64 = 0
    private var syncEvents: [SyncEvent] = []
    private var summaries: [ConversationSummary] = []
    private var adoptedSyncMessages: [String: [String: ChatMessage]] = [:]
    private var timelineMessageIDs: [String: [Int: String]] = [:]
    private var timelinePages: [String: TimelinePage] = [:]
    private var historyCache: [String: [ChatMessage]] = [:]
    private var sharedIntentBytes: [String: Data] = [:]
    private var sharedIntentEndpoints: [String: String] = [:]
    private var sharedOperations = Set<String>()
    private var memoryIntentBytes: [String: Data] = [:]
    private var memoryIntentEndpoints: [String: String] = [:]
    private var memoryOperations = Set<String>()
    private var memoryIntentIdentities: [String: MemoryRAMIntentIdentity] = [:]
    private var memoryKnownReceipts: [String: MemoryMutationReceipt] = [:]
    private var memoryRedactedProofs: [String: MemoryCorrectionRedactionProof] = [:]
    private var taskStopIntents: [String: TaskStopIntent] = [:]
    private enum InteractionIntent: Equatable, Sendable { case approval(ApprovalDecisionIntent), question(QuestionAnswerIntent) }
    private var interactionIntents: [String: InteractionIntent] = [:]
    private var interactionOperations = Set<String>()
    private var approvalDecisionReceipts: [String: ApprovalDecisionReceipt] = [:]
    private var questionAnswerReceipts: [String: QuestionAnswerReceipt] = [:]
    private let decoder = JSONDecoder()

    public init(credentialStore: any CredentialStore = KeychainCredentialStore(),
                transport: any HTTPTransport = URLSessionTransport(), platform: ApplePlatform = .current) {
        self.store = credentialStore; self.transport = transport; self.platform = platform
    }
    /// H1 draft: never send to a different account after an asynchronous account switch.
    public func uploadHealthSummary(_ summary: HealthDailySummary, account: LocalAccountScope) async throws -> HealthUploadResult {
        let (auth, generation) = try snapshot()
        guard try LocalAccountScope(server: auth.session.server, ownerId: auth.session.account.ownerId) == account else { throw APIFailure.identityMismatch }
        try await verify(auth, generation)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/health/daily-summaries", method: "POST",
            body: encoder.encode(summary), acceptedErrorStatuses: [404, 501])
        if [404, 501].contains(response.status) { return .deferred }
        guard [200, 201, 204].contains(response.status) else { throw APIFailure.invalidResponse }
        return .uploaded
    }
    public func deleteHealthSummaries(account: LocalAccountScope, date: String? = nil) async throws -> HealthUploadResult {
        let (auth, generation) = try snapshot()
        guard try LocalAccountScope(server: auth.session.server, ownerId: auth.session.account.ownerId) == account else {
            throw APIFailure.identityMismatch
        }
        if let date { guard date.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil else { throw APIFailure.invalidResponse } }
        try await verify(auth, generation)
        let response = try await sharedAuthorizedRequest(auth, generation,
            path: "/health/daily-summaries" + (date.map { "/" + $0 } ?? ""), method: "DELETE",
            body: Data("{}".utf8), acceptedErrorStatuses: [404, 501])
        if [404, 501].contains(response.status) { return .deferred }
        guard [200, 201, 204].contains(response.status) else { throw APIFailure.invalidResponse }
        return .uploaded
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
        guard !name.isEmpty, name.utf16.count <= 128 else { throw ClientInputFailure.deviceNameTooLong }
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

    public func pendingCloudDevices() async throws -> [PendingCloudDevice] {
        struct Reply: Decodable { let devices: [PendingCloudDevice] }
        let (auth, generation) = try snapshot()
        let reply: Reply = try await authorized(auth, generation, path: "/cloud/devices/pending")
        return reply.devices
    }
    public func decideCloudDevice(id: String, allow: Bool) async throws {
        guard validID(id) else { throw APIFailure.invalidResponse }
        let (auth, generation) = try snapshot()
        _ = try await sharedAuthorizedRequest(auth, generation, path: "/cloud/devices/\(id)/decision", method: "POST",
            body: JSONEncoder().encode(["decision": allow ? "allow" : "deny"]))
    }
    public func trustedHostDelivery(requestID: String) async throws -> Data {
        guard validID(requestID) else { throw APIFailure.invalidResponse }
        let (auth, generation) = try snapshot()
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/cloud/devices/\(requestID)/trust", method: "POST", body: Data("{}".utf8))
        return response.body
    }
    public func createCloudPairing() async throws -> HostPairing {
        let (auth, generation) = try snapshot()
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/cloud/pairings", method: "POST", body: Data("{}".utf8))
        return try HostPairing.parse(response.body)
    }
    /// Cloud tokens only enter the dedicated exchange endpoints. Pending never creates a content identity.
    public func exchangeCloudSession(server: ServerConfiguration, hostID: String, accessToken: String,
                                    deviceName: String, key: CloudDeviceKey, pairing: HostPairing? = nil) async throws -> CloudSessionExchange {
        let generation = try transition(server: server, clearSaved: true)
        struct Nonce: Decodable { let nonce: String }
        let nonceResponse = try await rawRequest(server: server, path: "/auth/cloud-nonce", method: "POST", body: Data("{}".utf8))
        try check(generation); try Task.checkCancellation()
        let nonce: Nonce = try decode(nonceResponse.body)
        let path = pairing == nil ? "/auth/cloud-session" : "/cloud/pairings/redeem"
        var body = ["accessToken": accessToken, "deviceName": deviceName]
        if let pairing {
            guard pairing.hostId == hostID else { throw APIFailure.identityMismatch }
            body["challenge"] = pairing.challenge
        }
        let proof = try key.proof(url: URL(string: server.originString + "/personal/v1" + path)!, accessToken: accessToken, nonce: nonce.nonce)
        let response = try await rawRequest(server: server, path: path, method: "POST", body: JSONEncoder().encode(body),
            extraHeaders: ["DPoP": proof])
        try check(generation); try Task.checkCancellation()
        if response.status == 202 {
            struct Pending: Decodable { let status: String; let requestId: String }
            let pending: Pending = try decode(response.body)
            guard pending.status == "pending_approval", validID(pending.requestId) else { throw APIFailure.invalidResponse }
            return .pending(requestID: pending.requestId)
        }
        guard response.status == 200 else { throw APIFailure.invalidResponse }
        let reply: AuthReply = try decode(response.body)
        let cookie = response.headers.first { $0.key.lowercased() == "set-cookie" }?.value.components(separatedBy: ";").first ?? ""
        guard validCookie(cookie), validCSRF(reply.csrfToken), validID(reply.account.ownerId), validID(reply.device.id) else { throw APIFailure.invalidResponse }
        let provisional = Credential(session: AccountSession(server: server, account: reply.account,
            device: currentDevice(reply.device), hostId: hostID, verification: .verified), cookie: cookie, csrf: reply.csrfToken)
        let status: StatusReply = try await request(server: server, path: "/status", auth: provisional)
        try check(generation); try Task.checkCancellation()
        guard status.ownerId == reply.account.ownerId, status.hostId == hostID else { throw APIFailure.identityMismatch }
        try persist(provisional); credential = provisional
        return .authenticated(provisional.session)
    }

    /// A cancelled browser callback may only discard the exact session it just produced.
    public func discardCloudSession(_ expected: AccountSession) async {
        guard credential?.session == expected else { return }
        try? await logout()
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

    public func setSessionArchived(_ archived: Bool, sessionID: String) async throws -> SessionArchiveResult {
        try await parityRequest(path: "/sessions/\(try checkedID(sessionID))/" + (archived ? "archive" : "unarchive"), method: "POST", body: Data("{}".utf8))
    }
    public func deleteSession(sessionID: String, forgetMemories: Bool = false) async throws -> SessionDeleteResult {
        struct Body: Encodable { let forgetMemories: Bool }
        return try await parityRequest(path: "/sessions/\(try checkedID(sessionID))", method: "DELETE", body: JSONEncoder().encode(Body(forgetMemories: forgetMemories)))
    }
    public func cancelQueuedTask(taskID: String, requestID: String) async throws -> TaskSnapshot {
        struct Body: Encodable { let requestId: String }
        let (auth, generation) = try snapshot()
        try await verify(auth, generation)
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/tasks/\(try checkedID(taskID))/cancel", method: "POST", body: JSONEncoder().encode(Body(requestId: requestID)))
        struct Reply: Decodable { let task: JSONValue }
        let reply: Reply = try decode(response.body)
        return try TaskSnapshot.decode(JSONEncoder().encode(reply.task), scope: TaskReadScope(auth.session), taskID: taskID)
    }
    public func usage(month: String? = nil, sessionID: String? = nil, timeZone: String? = nil) async throws -> UsageSummary {
        var query: [String] = []
        if let month {
            guard month.range(of: "^[0-9]{4}-(0[1-9]|1[0-2])$", options: .regularExpression) != nil else { throw APIFailure.invalidResponse }
            query.append("month=" + month)
        }
        if let sessionID { query.append("sessionId=" + (try checkedID(sessionID))) }
        if let timeZone {
            guard TimeZone(identifier: timeZone) != nil, let escaped = timeZone.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&+=?#"))) else { throw APIFailure.invalidResponse }
            query.append("timeZone=" + escaped)
        }
        return try await parityRequest(path: "/usage" + (query.isEmpty ? "" : "?" + query.joined(separator: "&")))
    }
    public func usageSettings() async throws -> UsageSettings { try await parityRequest(path: "/settings/usage") }
    public func setUsageLimit(_ value: Double?, temporary: Bool, timeZone: String? = nil) async throws -> UsageSettings {
        if let value, !value.isFinite || value < 0 { throw APIFailure.invalidResponse }
        var fields: [String: Any] = [temporary ? "temporaryLimit" : "monthlyLimit": value.map { $0 as Any } ?? NSNull()]
        if let timeZone { fields["timeZone"] = timeZone }
        let body = try JSONSerialization.data(withJSONObject: fields)
        return try await parityRequest(path: "/settings/usage", method: "PATCH", body: body)
    }
    public func setUsageTimeZone(_ timeZone: String) async throws -> UsageSettings {
        return try await parityRequest(path: "/settings/usage", method: "PATCH", body: JSONSerialization.data(withJSONObject: ["timeZone": timeZone]))
    }
    public func settingsSchedules() async throws -> ScheduleList { try await parityRequest(path: "/schedules") }
    public func manageSchedule(sessionID: String, id: String, action: ScheduleAction) async throws {
        let path = "/schedules/\(try checkedID(sessionID))/\(try checkedID(id))"
        let _: SettingsActionReply = try await parityRequest(path: path + (action == .delete ? "" : "/" + action.rawValue),
            method: action == .delete ? "DELETE" : "POST", body: action == .delete ? nil : Data("{}".utf8))
    }
    public func settingsStatus() async throws -> HostSettingsStatus { try await parityRequest(path: "/status") }
    public func settingsBackups() async throws -> HostBackups { try await parityRequest(path: "/backups") }
    public func setBackupPreferences(_ preferences: BackupPreferences) async throws {
        struct Reply: Decodable { let settings: BackupPreferences }
        let _: Reply = try await parityRequest(path: "/backups/settings", method: "PATCH", body: JSONEncoder().encode(preferences))
    }
    public func createBackup() async throws -> BackupActionReply {
        try await parityRequest(path: "/backups", method: "POST", body: Data("{}".utf8))
    }
    public func restoreBackup(id: String) async throws -> BackupActionReply {
        struct Body: Encodable { let id: String; let confirm = true }
        return try await parityRequest(path: "/backups/restore", method: "POST", body: JSONEncoder().encode(Body(id: try checkedID(id))))
    }
    private func parityRequest<T: Decodable>(path: String, method: String = "GET", body: Data? = nil) async throws -> T {
        let (auth, generation) = try snapshot()
        try await verify(auth, generation)
        let response = try await sharedAuthorizedRequest(auth, generation, path: path, method: method, body: body)
        return try decode(response.body)
    }

    public func conversations(includeArchived: Bool = false) async throws -> [ConversationSummary] {
        let (auth, generation) = try snapshot()
        try await verify(auth, generation)
        let events = try await readSync(auth, generation)
        let host: SessionsReply = try await authorized(auth, generation, path: includeArchived ? "/sessions?archived=all" : "/sessions")
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
                running: session?.running ?? false, sendAvailable: false, originalModelLabel: nil, archived: session?.archived ?? false))
        }
        for session in host.sessions where session.conversationId == nil || grouped[session.conversationId!] == nil {
            rows.append(.init(id: session.conversationId ?? session.sessionId,
                title: session.title.isEmpty ? "电脑会话" : session.title, conversationId: session.conversationId,
                sessionId: session.sessionId, running: session.running, sendAvailable: false,
                originalModelLabel: session.modelProfileId, archived: session.archived ?? false))
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
                adoptedSyncMessages[binding.sessionId] = try Dictionary(uniqueKeysWithValues: adopted.compactMap { receipt, eventID in
                    guard let original = originals.first(where: { $0.eventId == eventID }) else { return nil }
                    return (receipt, try syncMessage(original, pending: false))
                })
                var shown = Set<String>()
                var mapped: [Int: String] = [:]
                for event in hostEvents {
                    if event.type == "user.message", let receipt = event.data["receiptId"]?.string,
                       let eventID = adopted[receipt], let original = originals.first(where: { $0.eventId == eventID }) {
                        let message = try syncMessage(original, pending: false)
                        result.append(message); mapped[event.seq] = message.id; shown.insert(eventID)
                    } else if let message = try hostMessage(event, sessionID: binding.sessionId) { result.append(message) }
                }
                timelineMessageIDs[binding.sessionId] = mapped
                for original in originals where original.seq > binding.cutoverSyncSeq && !shown.contains(original.eventId) && !adopted.values.contains(original.eventId) {
                    result.append(try syncMessage(original, pending: true))
                }
            }
            try check(generation); syncEvents = events
        } else if let sessionID = conversation.sessionId {
            result = try await readHistory(auth, generation, sessionID: sessionID).compactMap { try hostMessage($0, sessionID: sessionID) }
        } else { throw APIFailure.invalidResponse }
        try check(generation)
        guard Set(result.map(\.id)).count == result.count else { throw APIFailure.invalidResponse }
        historyCache[conversation.id] = result
        return result
    }

    /// Cache belongs only to the currently authenticated generation; no fallback is represented as fresh data.
    public func cachedHistory(conversationID: String) -> [ChatMessage]? { credential == nil ? nil : historyCache[conversationID] }

    public func sharedSessions(includeArchived: Bool = false) async throws -> [SharedSessionRecord] {
        struct Reply: Decodable { let sessions: [SharedSessionRecord] }
        let (auth, generation) = try snapshot()
        try await verify(auth, generation)
        let reply: Reply = try await authorized(auth, generation, path: includeArchived ? "/sessions?archived=all" : "/sessions")
        guard reply.sessions.count <= 20_000,
              Set(reply.sessions.map(\.sessionId)).count == reply.sessions.count else { throw APIFailure.invalidResponse }
        for session in reply.sessions { try session.validate() }
        return reply.sessions
    }

    /// Only explicit user selection or a confirmed original identity may choose from this catalogue.
    public func hostModels() async throws -> [SharedHostModel] {
        struct Reply: Decodable { let models: [SharedHostModel] }
        let (auth, generation) = try snapshot()
        try await verify(auth, generation)
        let reply: Reply = try await authorized(auth, generation, path: "/models")
        guard reply.models.count <= 500, Set(reply.models.map(\.id)).count == reply.models.count else { throw APIFailure.invalidResponse }
        for model in reply.models { try model.validate() }
        return reply.models
    }

    public func memoryStatus() async throws -> MemoryStatusSnapshot {
        let (auth, generation) = try snapshot()
        try await verify(auth, generation)
        let status: MemoryServiceStatus = try await authorized(auth, generation, path: "/memory/status")
        try status.validate()
        return .init(scope: MemoryReadScope(auth.session), status: status)
    }

    /// One page only; no automatic account-wide or source-body reads.
    public func memoryItems(kind: MemoryKind = .cognition, query: String = "", limit: Int = 50,
                            after: MemoryPageCursor? = nil) async throws -> MemoryItemsPage {
        let (auth, generation) = try snapshot()
        let scope = MemoryReadScope(auth.session)
        let normalized = try MemoryValidation.normalizedQuery(query)
        try after?.validate(scope: scope, kind: kind, query: normalized)
        let path = try MemoryValidation.queryPath(kind: kind, rawQuery: query, limit: limit, cursor: after)
        try await verify(auth, generation)
        let response = try await sharedAuthorizedRequest(auth, generation, path: path)
        return try MemoryItemsPage.decode(response.body, scope: scope, kind: kind, query: normalized, limit: limit, previous: after)
    }

    public func memoryDetail(kind: MemoryKind, itemID: String,
                             expectedWorldRevision: Int? = nil) async throws -> MemoryItemDetail {
        let (auth, generation) = try snapshot()
        try MemoryValidation.require(MemoryValidation.itemID(itemID) && (expectedWorldRevision.map(MemoryValidation.revision) ?? true))
        try await verify(auth, generation)
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/memory/items/\(kind.rawValue)/\(itemID)")
        return try MemoryItemDetail.decode(response.body, scope: MemoryReadScope(auth.session), kind: kind,
            itemID: itemID, expectedRevision: expectedWorldRevision)
    }

    /// Explicit item expansion. Source allowCloudRead does not enable or authorize model recall.
    public func memorySources(kind: MemoryKind, itemID: String,
                              expectedWorldRevision: Int? = nil) async throws -> MemorySourcesSnapshot {
        let (auth, generation) = try snapshot()
        try MemoryValidation.require(MemoryValidation.itemID(itemID) && (expectedWorldRevision.map(MemoryValidation.revision) ?? true))
        try await verify(auth, generation)
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/memory/items/\(kind.rawValue)/\(itemID)/sources")
        return try MemorySourcesSnapshot.decode(response.body, scope: MemoryReadScope(auth.session), kind: kind,
            itemID: itemID, expectedRevision: expectedWorldRevision)
    }

    public func conversationResources(sessionID: String, afterSeq: Int = -1) async throws -> ConversationResourcesPage {
        let (auth, generation) = try snapshot()
        let session = try checkedID(sessionID)
        guard afterSeq >= -1, afterSeq <= SharedValidation.maximumSequence else { throw APIFailure.invalidResponse }
        try await verify(auth, generation)
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/sessions/\(session)/resources?afterSeq=\(afterSeq)")
        return try JSONDecoder().decode(ConversationResourcesPage.self, from: response.body)
    }

    /// Paths come from the authorized resource list; only existing read-only source routes are followed.
    public func conversationSourceContent(_ use: ResourceUse, sessionID: String) async throws -> TimelineDetail {
        let (auth, generation) = try snapshot()
        let session = try checkedID(sessionID)
        let components = use.path.split(separator: "/").map(String.init)
        let timeline = components.count == 5 && components[0] == "sessions" && components[1] == session
            && components[2] == "events" && Int(components[3]) != nil && components[4] == "detail"
        let snapshotSource = components.count == 4 && components[0] == "tasks" && components[2] == "sources"
        guard timeline || snapshotSource, !use.path.contains("?"), !use.path.contains("#") else { throw APIFailure.invalidResponse }
        try await verify(auth, generation)
        let response = try await sharedAuthorizedRequest(auth, generation, path: use.path)
        if timeline { return try JSONDecoder().decode(TimelineDetail.self, from: response.body) }
        let value = try JSONDecoder().decode(JSONValue.self, from: response.body)
        guard let source = value["source"], let text = source["text"]?.string else { throw APIFailure.invalidResponse }
        return .init(seq: use.seq ?? 0, text: text, truncated: source["truncated"]?.bool ?? source["hasMore"]?.bool)
    }

    public func taskDetail(taskID: String) async throws -> TaskSnapshot {
        let (auth, generation) = try snapshot()
        let id = try checkedID(taskID)
        try await verify(auth, generation)
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/tasks/\(id)")
        return try TaskSnapshot.decode(response.body, scope: TaskReadScope(auth.session), taskID: id)
    }

    /// Reads exactly one owner-command metadata page and exposes only roots of the selected session.
    public func taskCommands(sessionID: String, limit: Int = 50,
                             before: TaskCommandPageCursor? = nil) async throws -> TaskCommandPage {
        let (auth, generation) = try snapshot()
        let session = try checkedID(sessionID), scope = TaskReadScope(auth.session)
        try SharedValidation.require((1...100).contains(limit))
        try before?.validate(scope: scope, sessionID: session)
        let path = before.map { "/commands?before=\($0.beforeID)&limit=\(limit)" } ?? "/commands?limit=\(limit)"
        try await verify(auth, generation)
        let response = try await sharedAuthorizedRequest(auth, generation, path: path)
        return try TaskCommandPage.decode(response.body, scope: scope, sessionID: session, limit: limit, previous: before)
    }

    /// A nil session addresses the account default, which applies only to new conversations.
    public func approvalMode(sessionID: String? = nil) async throws -> ApprovalModeSettings {
        try await requestApprovalMode(sessionID: sessionID, mode: nil)
    }
    public func setApprovalMode(_ mode: ApprovalMode, sessionID: String? = nil) async throws -> ApprovalModeSettings {
        try await requestApprovalMode(sessionID: sessionID, mode: mode)
    }
    private func requestApprovalMode(sessionID: String?, mode: ApprovalMode?) async throws -> ApprovalModeSettings {
        let (auth, generation) = try snapshot()
        let path: String
        if let sessionID { path = "/sessions/\(try checkedID(sessionID))/approval-mode" }
        else { path = "/settings/approvals" }
        struct Body: Encodable { let mode: ApprovalMode }
        let body = try mode.map { try JSONEncoder().encode(Body(mode: $0)) }
        try await verify(auth, generation)
        let response = try await sharedAuthorizedRequest(auth, generation, path: path,
            method: mode == nil ? "GET" : "PATCH", body: body)
        try SharedValidation.require(response.status == 200)
        return try decode(response.body)
    }

    public func approvals(sessionID: String, limit: Int = 50,
                          before: ApprovalPageCursor? = nil) async throws -> ApprovalPage {
        let (auth, generation) = try snapshot()
        let session = try checkedID(sessionID), scope = try SessionInteractionScope(session: auth.session, sessionID: session)
        try SharedValidation.require((1...100).contains(limit)); try before?.validate(scope: scope)
        let query = try before.map { "before=\(try checkedID($0.beforeID))&limit=\(limit)" } ?? "limit=\(limit)"
        try await verify(auth, generation)
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/sessions/\(session)/approvals?\(query)")
        return try ApprovalPage.decode(response.body, scope: scope, limit: limit, previous: before)
    }

    public func questions(sessionID: String, limit: Int = 50,
                          before: QuestionPageCursor? = nil) async throws -> QuestionPage {
        let (auth, generation) = try snapshot()
        let session = try checkedID(sessionID), scope = try SessionInteractionScope(session: auth.session, sessionID: session)
        try SharedValidation.require((1...100).contains(limit)); try before?.validate(scope: scope)
        let query = try before.map { "before=\(try checkedID($0.beforeID))&limit=\(limit)" } ?? "limit=\(limit)"
        try await verify(auth, generation)
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/sessions/\(session)/questions?\(query)")
        return try QuestionPage.decode(response.body, scope: scope, limit: limit, previous: before)
    }

    /// Submit only after the caller has saved the intent. A duplicate successful request returns its original receipt.
    /// The answered receipt must not overwrite a later resolved/unavailable record; reread the approval list.
    public func submitApproval(_ intent: ApprovalDecisionIntent) async throws -> ApprovalDecisionReceipt {
        let (auth, generation) = try snapshot()
        try intent.scope.validate(session: auth.session)
        let session = try checkedID(intent.sessionId), approval = try checkedID(intent.approvalId)
        try retainInteractionIntent(.approval(intent), requestID: intent.requestId)
        let key = "\(generation)|\(intent.requestId)"
        guard interactionOperations.insert(key).inserted else { throw APIFailure.server(status: 409, code: "REQUEST_IN_PROGRESS") }
        defer { interactionOperations.remove(key) }
        try await verify(auth, generation)
        if let receipt = approvalDecisionReceipts[intent.requestId] { return receipt }
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/sessions/\(session)/approvals/\(approval)",
            method: "POST", body: intent.payload)
        try SharedValidation.require(response.status == 200)
        let receipt = try ApprovalDecisionReceipt.decode(response.body, intent: intent)
        approvalDecisionReceipts[intent.requestId] = receipt
        return receipt
    }

    /// Answers information questions only. An answer never grants permission to a tool.
    /// A 200 is registration; answerAcceptedAt is the separate personal-entry consumption acknowledgment.
    public func submitQuestionAnswer(_ intent: QuestionAnswerIntent) async throws -> QuestionAnswerReceipt {
        let (auth, generation) = try snapshot()
        try intent.scope.validate(session: auth.session)
        let session = try checkedID(intent.sessionId), question = try checkedID(intent.questionRpcId)
        try retainInteractionIntent(.question(intent), requestID: intent.requestId)
        let key = "\(generation)|\(intent.requestId)"
        guard interactionOperations.insert(key).inserted else { throw APIFailure.server(status: 409, code: "REQUEST_IN_PROGRESS") }
        defer { interactionOperations.remove(key) }
        try await verify(auth, generation)
        if let receipt = questionAnswerReceipts[intent.requestId] { return receipt }
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/sessions/\(session)/questions/\(question)",
            method: "POST", body: intent.payload)
        try SharedValidation.require(response.status == 200)
        let receipt = try QuestionAnswerReceipt.decode(response.body, intent: intent)
        questionAnswerReceipts[intent.requestId] = receipt
        return receipt
    }

    private func retainInteractionIntent(_ intent: InteractionIntent, requestID: String) throws {
        if let prior = interactionIntents[requestID] {
            guard prior == intent else { throw APIFailure.server(status: 409, code: "REQUEST_CONFLICT") }
        } else { interactionIntents[requestID] = intent }
    }

    /// Explicit source expansion only. A project file hash is not proof of the excerpt's own bytes.
    public func taskSourcePreview(taskID: String, sourceID: String) async throws -> TaskSourcePreview {
        let (auth, generation) = try snapshot()
        let task = try checkedID(taskID), source = try checkedID(sourceID)
        try await verify(auth, generation)
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/tasks/\(task)/sources/\(source)")
        return try TaskSourcePreview.decode(response.body, scope: TaskReadScope(auth.session), taskID: task, sourceID: source)
    }

    public func taskArtifactPreview(taskID: String, artifactID: String) async throws -> TaskArtifactPreview {
        let (auth, generation) = try snapshot()
        let task = try checkedID(taskID), artifact = try checkedID(artifactID)
        try await verify(auth, generation)
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/artifacts/\(artifact)/preview")
        struct Reply: Decodable { let artifact: TaskCommandRecord; let text: String }
        let reply: Reply = try decode(response.body)
        let scope = TaskReadScope(auth.session)
        try TaskReadValidation.artifact(reply.artifact, scope: scope, taskID: task, artifactID: artifact)
        try TaskReadValidation.artifactBytes(Data(reply.text.utf8), record: reply.artifact)
        return .init(scope: scope, artifact: reply.artifact, text: reply.text)
    }

    /// Metadata supplies the root command key; a timeline turn-N key is never used as a /tasks ID.
    public func timelineArtifactBytes(sessionID: String, artifactID: String) async throws -> TaskArtifactDownload {
        let (auth, generation) = try snapshot()
        let session = try checkedID(sessionID), artifact = try checkedID(artifactID)
        try await verify(auth, generation)
        return try await downloadArtifact(auth, generation, artifactID: artifact, taskID: nil, sessionID: session)
    }
    /// Called by an explicit download action. No file is installed, opened, or executed here.
    public func taskArtifactBytes(taskID: String, artifactID: String) async throws -> TaskArtifactDownload {
        let (auth, generation) = try snapshot()
        let task = try checkedID(taskID), artifact = try checkedID(artifactID)
        try await verify(auth, generation)
        return try await downloadArtifact(auth, generation, artifactID: artifact, taskID: task, sessionID: nil)
    }
    private func downloadArtifact(_ auth: Credential, _ generation: UInt64, artifactID: String,
                                  taskID: String?, sessionID: String?) async throws -> TaskArtifactDownload {
        let scope = TaskReadScope(auth.session)
        struct Reply: Decodable { let artifact: TaskCommandRecord }
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/artifacts/\(artifactID)")
        let reply: Reply = try decode(response.body)
        if let sessionID { guard reply.artifact.sessionId == sessionID else { throw APIFailure.identityMismatch } }
        guard let root = taskID ?? reply.artifact.taskId else { throw APIFailure.invalidResponse }
        try TaskReadValidation.artifact(reply.artifact, scope: scope, taskID: root, artifactID: artifactID)
        let downloaded = try await sharedAuthorizedRequest(auth, generation, path: "/artifacts/\(artifactID)/download")
        try TaskReadValidation.artifactBytes(downloaded.body, record: reply.artifact)
        return .init(scope: scope, artifact: reply.artifact, data: downloaded.body)
    }

    /// Only a durable journal's unused permit may submit. The permit is consumed before the unique POST.
    public func submitTaskStop(_ permit: TaskStopSubmissionPermit) async throws -> TaskStopObservation {
        let intent = permit.intent
        let (auth, generation) = try snapshot()
        try retainTaskStopIntent(intent, auth: auth)
        try await permit.checkPrepared()
        try check(generation)
        try await verify(auth, generation)
        let currentResponse = try await sharedAuthorizedRequest(auth, generation, path: "/tasks/\(intent.rootCommandId)")
        let current = try TaskSnapshot.decode(currentResponse.body, scope: TaskReadScope(auth.session), taskID: intent.rootCommandId)
        try intent.validate(snapshot: current, phase: .preflight)
        guard current.control.canStop else { throw APIFailure.server(status: 409, code: "TASK_NOT_READY") }
        try await permit.consume()
        try check(generation)
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/tasks/\(intent.rootCommandId)/stop", method: "POST", body: intent.payload)
        guard response.status == 202 else { throw APIFailure.invalidResponse }
        guard let fields = (try? JSONSerialization.jsonObject(with: response.body)) as? [String: Any], let task = fields["task"] as? [String: Any] else { throw APIFailure.invalidResponse }
        let stopped = try TaskSnapshot.decode(JSONSerialization.data(withJSONObject: task), scope: TaskReadScope(auth.session), taskID: intent.rootCommandId)
        try intent.validate(snapshot: stopped, phase: .response)
        guard stopped.control.state == .stopRequested, stopped.control.stopStatus != nil else {
            return .init(task: stopped, proofLevel: .taskStateOnly, journalAcknowledgmentSaved: false)
        }
        let acknowledgment = try TaskStopAcknowledgment(stopped, intent: intent)
        var saved = true
        do { try await permit.acknowledge(acknowledgment) } catch { saved = false }
        try check(generation)
        return .init(task: stopped, proofLevel: .response202MatchedRoot, journalAcknowledgmentSaved: saved)
    }

    /// Current task state never proves that this stop request was acknowledged, or that a POST was absent.
    public func reconcileTaskStop(_ intent: TaskStopIntent) async throws -> TaskStopObservation {
        let (auth, generation) = try snapshot()
        try retainTaskStopIntent(intent, auth: auth)
        try await verify(auth, generation)
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/tasks/\(intent.rootCommandId)")
        let task = try TaskSnapshot.decode(response.body, scope: TaskReadScope(auth.session), taskID: intent.rootCommandId)
        try intent.validate(snapshot: task, phase: .observation)
        return .init(task: task, proofLevel: .taskStateOnly, journalAcknowledgmentSaved: false)
    }
    private func retainTaskStopIntent(_ intent: TaskStopIntent, auth: Credential) throws {
        guard intent.server == auth.session.server, intent.ownerId == auth.session.account.ownerId, intent.hostId == auth.session.hostId else { throw APIFailure.accountChanged }
        if let prior = taskStopIntents[intent.requestId] {
            guard prior == intent else { throw APIFailure.server(status: 409, code: "TASK_STOP_REQUEST_CONFLICT") }
        } else {
            guard taskStopIntents.count < 256 else { throw APIFailure.requestLedgerLimit }
            taskStopIntents[intent.requestId] = intent
        }
    }

    /// The caller persists a typed memory intent before explicitly permitting a same-request mutation.
    public func reconcileMemoryMutation(_ intent: MemoryMutationIntent, allowSubmission: Bool = false,
                                        knownReceipt: MemoryMutationReceipt? = nil) async throws -> MemoryMutationReconciliation {
        let (auth, generation) = try snapshot()
        try validateMemoryScope(intent, auth: auth)
        let knownReceipt = knownReceipt ?? memoryKnownReceipts[intent.requestId]
        try knownReceipt?.validate(intent: intent)
        try retainMemoryIntent(intent)
        let key = "\(generation)|\(intent.requestId)"
        guard memoryOperations.insert(key).inserted else { throw APIFailure.server(status: 409, code: "MEMORY_REQUEST_IN_PROGRESS") }
        defer { memoryOperations.remove(key) }
        try await verify(auth, generation)
        if let prior = try await lookupMemoryReceipt(intent, auth: auth, generation: generation, knownReceipt: knownReceipt) { return .found(prior) }
        // A previously proved terminal receipt cannot be downgraded to "never submitted" by a later 404.
        guard knownReceipt == nil, allowSubmission else { return .notFound }
        let response = try await sharedAuthorizedRequest(auth, generation, path: intent.endpointPath, method: intent.httpMethod,
            body: intent.payload, acceptedErrorStatuses: [409])
        return .found(try decodeMemoryReceipt(response, intent: intent, knownReceipt: knownReceipt, submission: true))
    }

    /// Cleanup retries query the original deletion receipt first and only retry storage cleanup, never deletion.
    public func retryMemoryCleanup(_ intent: MemoryMutationIntent, knownReceipt: MemoryMutationReceipt,
                                   allowSubmission: Bool = false) async throws -> MemoryMutationReconciliation {
        let (auth, generation) = try snapshot()
        try validateMemoryScope(intent, auth: auth)
        try SharedValidation.require(intent.operation.isDeletion)
        try knownReceipt.validate(intent: intent)
        try retainMemoryIntent(intent)
        let key = "\(generation)|\(intent.requestId)"
        guard memoryOperations.insert(key).inserted else { throw APIFailure.server(status: 409, code: "MEMORY_REQUEST_IN_PROGRESS") }
        defer { memoryOperations.remove(key) }
        try await verify(auth, generation)
        guard let current = try await lookupMemoryReceipt(intent, auth: auth, generation: generation, knownReceipt: knownReceipt) else { return .notFound }
        guard current.effectApplied, current.cleanupPending, allowSubmission else { return .found(current) }
        let response = try await sharedAuthorizedRequest(auth, generation,
            path: "/memory/commands/by-request/\(intent.requestId)/retry-cleanup", method: "POST", body: Data("{}".utf8))
        return .found(try decodeMemoryReceipt(response, intent: intent, knownReceipt: current, submission: false))
    }

    private func validateMemoryScope(_ intent: MemoryMutationIntent, auth: Credential) throws {
        guard intent.server == auth.session.server, intent.ownerId == auth.session.account.ownerId,
              intent.hostId == auth.session.hostId else { throw APIFailure.accountChanged }
    }
    private func retainMemoryIntent(_ intent: MemoryMutationIntent) throws {
        guard memoryRedactedProofs[intent.requestId] == nil else { throw APIFailure.server(status: 409, code: "MEMORY_LOCAL_REQUEST_REDACTED") }
        let endpoint = intent.httpMethod + " " + intent.endpointPath
        if let prior = memoryIntentBytes[intent.requestId], prior != intent.payload || memoryIntentEndpoints[intent.requestId] != endpoint {
            throw APIFailure.server(status: 409, code: "MEMORY_REQUEST_CONFLICT")
        }
        if memoryIntentBytes[intent.requestId] == nil {
            guard memoryIntentIdentities.count < 256, intent.payload.count <= 16_384,
                  memoryIntentBytes.values.reduce(0, { $0 + $1.count }) + intent.payload.count <= 4_194_304 else { throw APIFailure.requestLedgerLimit }
        }
        memoryIntentBytes[intent.requestId] = intent.payload; memoryIntentEndpoints[intent.requestId] = endpoint
        memoryIntentIdentities[intent.requestId] = MemoryRAMIntentIdentity(intent)
    }
    private func lookupMemoryReceipt(_ intent: MemoryMutationIntent, auth: Credential, generation: UInt64,
                                     knownReceipt: MemoryMutationReceipt?) async throws -> MemoryMutationReceipt? {
        let response: HTTPResponse
        do { response = try await sharedAuthorizedRequest(auth, generation, path: "/memory/commands/by-request/\(intent.requestId)") }
        catch APIFailure.server(404, "NOT_FOUND") { return nil }
        return try decodeMemoryReceipt(response, intent: intent, knownReceipt: knownReceipt, submission: false)
    }
    private func decodeMemoryReceipt(_ response: HTTPResponse, intent: MemoryMutationIntent,
                                     knownReceipt: MemoryMutationReceipt?, submission: Bool) throws -> MemoryMutationReceipt {
        struct Reply: Decodable { let receipt: MemoryMutationReceipt }
        guard response.body.count <= 65_536 else { throw APIFailure.responseTooLarge }
        guard let fields = (try? JSONSerialization.jsonObject(with: response.body)) as? [String: Any], fields["receipt"] != nil else {
            if response.status == 409 { throw serverFailure(response) }
            throw APIFailure.invalidResponse
        }
        let reply: Reply = try decode(response.body)
        try reply.receipt.validate(intent: intent, knownReceipt: knownReceipt)
        if let cached = memoryKnownReceipts[intent.requestId] { try reply.receipt.validate(intent: intent, knownReceipt: cached) }
        if submission {
            try SharedValidation.require(reply.receipt.effectApplied ? response.status == 200 : response.status == 409)
        } else { try SharedValidation.require(response.status == 200) }
        memoryKnownReceipts[intent.requestId] = reply.receipt
        return reply.receipt
    }

    /// Purges only a proved, matching correction body. No body or body hash is retained in the tombstone.
    public func redactMemoryCorrection(_ proof: MemoryCorrectionRedactionProof) throws -> MemoryRAMRedaction {
        let (auth, generation) = try snapshot()
        try check(generation)
        try proof.validate()
        guard try proof.correction.sameScope(server: auth.session.server, ownerID: auth.session.account.ownerId, hostID: auth.session.hostId) else {
            throw APIFailure.accountChanged
        }
        let request = proof.correction.requestId
        if let identity = memoryIntentIdentities[request] {
            guard try identity.matches(proof.correction) else { throw APIFailure.identityMismatch }
        }
        if let known = memoryKnownReceipts[request] { try proof.validateCorrectionReceipt(proof.correctionReceipt, known: known) }
        if let deletion = memoryKnownReceipts[proof.deletionIntent.requestId] { try proof.deletionReceipt.validate(intent: proof.deletionIntent, knownReceipt: deletion) }
        guard !memoryOperations.contains("\(generation)|\(request)") else { return .deferredInFlight }
        if let prior = memoryRedactedProofs[request] {
            try proof.validateCorrectionReceipt(proof.correctionReceipt, known: prior.correctionReceipt)
            return .alreadyRedacted
        }
        if memoryIntentIdentities[request] == nil {
            guard memoryIntentIdentities.count < 256 else { throw APIFailure.requestLedgerLimit }
        }
        memoryIntentBytes[request] = nil
        memoryIntentIdentities[request] = MemoryRAMIntentIdentity(proof.correction)
        memoryIntentEndpoints[request] = "POST /memory/items/\(proof.correction.itemKind.rawValue)/\(proof.correction.targetId)/correct"
        memoryKnownReceipts[request] = proof.correctionReceipt
        memoryRedactedProofs[request] = proof
        return .redacted
    }

    /// A persisted no-body proof can re-establish the RAM tombstone after login and only query the original request.
    public func reconcileRedactedMemoryCorrection(_ proof: MemoryCorrectionRedactionProof) async throws -> MemoryMutationReconciliation {
        let result = try redactMemoryCorrection(proof)
        guard result != .deferredInFlight else { throw APIFailure.server(status: 409, code: "MEMORY_REQUEST_IN_PROGRESS") }
        let (auth, generation) = try snapshot()
        let request = proof.correction.requestId
        let key = "\(generation)|\(request)"
        guard memoryOperations.insert(key).inserted else { throw APIFailure.server(status: 409, code: "MEMORY_REQUEST_IN_PROGRESS") }
        defer { memoryOperations.remove(key) }
        try await verify(auth, generation)
        let response: HTTPResponse
        do { response = try await sharedAuthorizedRequest(auth, generation, path: "/memory/commands/by-request/\(request)") }
        catch APIFailure.server(404, "NOT_FOUND") { return .notFound }
        struct Reply: Decodable { let receipt: MemoryMutationReceipt }
        let reply: Reply = try MemoryValidation.decode(response.body, maximum: 65_536)
        try proof.validateCorrectionReceipt(reply.receipt, known: proof.correctionReceipt)
        return .found(reply.receipt)
    }

    // Non-body diagnostics for privacy-boundary tests; not exported as an application API.
    func memoryRAMRedactionState(requestID: String) -> (holdsBody: Bool, tombstoned: Bool, recordCount: Int) {
        (memoryIntentBytes[requestID] != nil, memoryRedactedProofs[requestID] != nil, memoryIntentIdentities.count)
    }

    public func sharedConversation(conversationID: String) async throws -> SharedConversationProjection {
        let (auth, generation) = try snapshot()
        let id = try checkedID(conversationID)
        try await verify(auth, generation)
        let projection: SharedConversationProjection = try await authorized(auth, generation,
            path: "/sync/conversations/\(id)/shared")
        try projection.validate(conversationID: id, hostID: auth.session.hostId)
        return projection
    }

    /// nextSeq is the backend scan watermark, including omitted non-visible events.
    public func sharedHistory(sessionID: String, afterSeq: Int, limit: Int = 100) async throws -> SharedHistoryPage {
        let (auth, generation) = try snapshot()
        let id = try checkedID(sessionID)
        try SharedValidation.require(afterSeq >= -1 && afterSeq <= SharedValidation.maximumSequence && (1...100).contains(limit))
        try await verify(auth, generation)
        let response = try await sharedAuthorizedRequest(auth, generation,
            path: "/sessions/\(id)/events?afterSeq=\(afterSeq)&limit=\(limit)")
        return try SharedHistoryPage.decode(response.body, sessionID: id, afterSeq: afterSeq, limit: limit)
    }

    /// Absence means exactly the official 404 NOT_FOUND response, never an offline or malformed reply.
    public func commandByRequest(requestID: String) async throws -> SharedCommandReceipt? {
        let (auth, generation) = try snapshot()
        try SharedValidation.require(SharedValidation.request(requestID))
        try await verify(auth, generation)
        return try await lookupSharedCommand(auth, generation, requestID: requestID)
    }

    /// The caller must durably persist intent before permitting a POST. An uncertain POST is never retried here.
    /// A session.cancel payload cancels the session; it is not proof of stopping a specific message receipt.
    public func reconcileCommand(_ intent: SharedCommandIntent,
                                 allowSubmission: Bool = false) async throws -> SharedCommandReconciliation {
        let (auth, generation) = try snapshot()
        guard intent.server == auth.session.server, intent.ownerId == auth.session.account.ownerId,
              intent.hostId == auth.session.hostId else { throw APIFailure.accountChanged }
        let key = "\(generation)|\(intent.requestId)"
        try retainSharedIntent(requestID: intent.requestId, payload: intent.payload, endpoint: "/commands")
        guard sharedOperations.insert(key).inserted else {
            throw APIFailure.server(status: 409, code: "REQUEST_IN_PROGRESS")
        }
        defer { sharedOperations.remove(key) }
        try await verify(auth, generation)
        if let prior = try await lookupSharedCommand(auth, generation, requestID: intent.requestId) {
            try prior.validate(intent: intent)
            return .found(prior)
        }
        guard allowSubmission else { return .notFound }
        try check(generation)
        struct Reply: Decodable { let command: SharedCommandReceipt }
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/commands", method: "POST", body: intent.payload)
        let reply: Reply = try decode(response.body)
        try reply.command.validate(intent: intent)
        return .found(reply.command)
    }

    /// The independently persisted adoption intent is the only body reused for this endpoint.
    public func reconcileAdoption(_ intent: SharedAdoptionIntent, allowSubmission: Bool = false,
                                  knownBindingRevision: Int? = nil) async throws -> SharedAdoptionReconciliation {
        let (auth, generation) = try snapshot()
        guard intent.server == auth.session.server, intent.ownerId == auth.session.account.ownerId,
              intent.hostId == auth.session.hostId else { throw APIFailure.accountChanged }
        try SharedValidation.require(knownBindingRevision.map { $0 > 0 && $0 <= SharedValidation.maximumSequence } ?? true)
        let endpoint = "/sync/conversations/\(intent.conversationId)/shared"
        try retainSharedIntent(requestID: intent.requestId, payload: intent.payload, endpoint: endpoint)
        let key = "\(generation)|\(intent.requestId)"
        guard sharedOperations.insert(key).inserted else { throw APIFailure.server(status: 409, code: "REQUEST_IN_PROGRESS") }
        defer { sharedOperations.remove(key) }
        try await verify(auth, generation)
        if let command = try await lookupSharedCommand(auth, generation, requestID: intent.requestId) {
            let projection: SharedConversationProjection = try await authorized(auth, generation, path: endpoint)
            return .found(try SharedAdoptionReceipt(command: command, projection: projection,
                intent: intent, knownBindingRevision: knownBindingRevision))
        }
        guard allowSubmission else { return .notFound }
        let initial: SharedConversationProjection = try await authorized(auth, generation, path: endpoint)
        try initial.validate(conversationID: intent.conversationId, hostID: intent.hostId)
        guard initial.status == .unbound, initial.canAdopt ||
            (initial.requiresLocalTurnConfirmation && intent.acknowledgeUncertainLocalTurn) else {
            throw APIFailure.server(status: 409, code: initial.reasonCode ?? "CONVERSATION_NOT_READY")
        }
        guard initial.syncThroughSeq == intent.expectedSyncSeq else { throw APIFailure.server(status: 409, code: "CONVERSATION_SYNC_CHANGED") }
        let response = try await sharedAuthorizedRequest(auth, generation, path: endpoint, method: "POST", body: intent.payload)
        struct Reply: Decodable { let command: SharedCommandReceipt }
        let reply: Reply = try decode(response.body)
        let projection: SharedConversationProjection = try decode(response.body)
        return .found(try SharedAdoptionReceipt(command: reply.command, projection: projection,
            intent: intent, knownBindingRevision: knownBindingRevision))
    }

    /// The current API omits session origin. A positive owner-only desktop capability plus
    /// sendAvailable proves personal-remote; shared accounts are forced unavailable by /status.
    public func taskControlSessionIDs(includeArchived: Bool = false) async throws -> Set<String> {
        let (auth, generation) = try snapshot()
        try await verify(auth, generation)
        struct Status: Decodable { let ownerId: String; let hostId: String }
        let status: Status = try await authorized(auth, generation, path: "/status")
        guard status.ownerId == auth.session.account.ownerId, status.hostId == auth.session.hostId else { throw APIFailure.identityMismatch }
        // Root task controls are authorized by /tasks; opening desktop apps is an unrelated capability.
        let sessions: SessionsReply = try await authorized(auth, generation, path: includeArchived ? "/sessions?archived=all" : "/sessions")
        return Set(sessions.sessions.filter { ($0.sendAvailable || ($0.archived == true && $0.running)) && $0.unavailable != true }.map(\.sessionId))
    }

    public func uploadOriginalAttachment(_ metadata: OriginalAttachment, file: URL, conversationID: String,
                                         messageID: String) async throws {
        try metadata.validate()
        try SharedValidation.require(OriginalAttachmentValidation.syncID(conversationID) && OriginalAttachmentValidation.syncID(messageID))
        let path = try attachmentPath("/sync/attachments/" + metadata.id,
            query: ["conversationId": conversationID, "messageId": messageID, "name": metadata.name])
        let response = try await uploadAttachment(path: path, metadata: metadata, file: file)
        struct Reply: Decodable { let attachment: OriginalAttachment }
        let reply: Reply = try decode(response.body)
        guard reply.attachment == metadata else { throw APIFailure.identityMismatch }
    }
    public func uploadSessionAttachment(_ metadata: OriginalAttachment, file: URL, sessionID: String,
                                        requestID: String) async throws {
        try SharedValidation.require(SharedValidation.id(sessionID) && SharedValidation.request(requestID))
        try AttachmentLimits.validate(staged: [metadata], originals: nil, messageID: nil)
        let path = try attachmentPath("/sessions/" + sessionID + "/attachments/" + metadata.id,
            query: ["requestId": requestID, "name": metadata.name])
        let response = try await uploadAttachment(path: path, metadata: metadata, file: file)
        struct Reply: Decodable { let attachment: OriginalAttachment }
        let reply: Reply = try decode(response.body)
        guard reply.attachment == metadata else { throw APIFailure.identityMismatch }
    }
    public func uploadAttachmentDisplay(_ original: OriginalAttachment, file: URL, conversationID: String,
                                        messageID: String) async throws {
        try original.validate()
        try SharedValidation.require(original.isImage && OriginalAttachmentValidation.syncID(conversationID) && OriginalAttachmentValidation.syncID(messageID))
        let metadata = try OriginalAttachment.fromFile(file, name: original.name, contentType: "image/jpeg", attachmentID: original.id)
        guard metadata.size <= AttachmentLimits.displayBytes else { throw ClientInputFailure.attachmentTooLarge }
        let path = try attachmentPath("/sync/attachments/" + original.id,
            query: ["conversationId": conversationID, "messageId": messageID, "variant": "display"])
        let response = try await uploadAttachment(path: path, metadata: metadata, file: file)
        struct Display: Decodable { let attachmentId: String; let contentType: String; let size: Int; let sha256: String }
        struct Reply: Decodable { let display: Display }
        let reply: Reply = try decode(response.body)
        guard reply.display.attachmentId == original.id, reply.display.contentType == metadata.contentType,
              reply.display.size == metadata.size, reply.display.sha256 == metadata.sha256 else { throw APIFailure.identityMismatch }
    }
    public func downloadOriginalAttachment(_ metadata: OriginalAttachment, to file: URL) async throws {
        try metadata.validate()
        try await downloadAttachment(path: "/sync/attachments/" + metadata.id, to: file,
            maximumBytes: metadata.size, contentType: metadata.contentType, expectedHash: metadata.sha256, expectedSize: metadata.size)
    }
    public func downloadAttachmentDisplay(_ metadata: OriginalAttachment, to file: URL) async throws {
        try metadata.validate()
        try await downloadAttachment(path: "/sync/attachments/" + metadata.id + "?variant=display", to: file,
            maximumBytes: AttachmentLimits.displayBytes, contentType: "image/jpeg")
    }
    public func downloadSessionImage(_ image: SharedHistoryImage, sessionID: String, to file: URL) async throws {
        try SharedValidation.require(SharedValidation.id(sessionID) && image.attachmentId.hasPrefix("sha256:") &&
            SharedValidation.hash(String(image.attachmentId.dropFirst(7))) && image.size > 0 && image.size <= AttachmentLimits.imageBytes &&
            ["image/png", "image/jpeg", "image/webp", "image/gif"].contains(image.contentType))
        try await downloadAttachment(path: "/sessions/" + sessionID + "/attachments/" + image.attachmentId.replacingOccurrences(of: ":", with: "%3A"),
            to: file, maximumBytes: image.size, contentType: image.contentType,
            expectedHash: String(image.attachmentId.dropFirst(7)), expectedSize: image.size)
    }
    private func attachmentPath(_ path: String, query: [String: String]) throws -> String {
        var components = URLComponents(); components.path = path
        components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let value = components.string else { throw APIFailure.invalidResponse }; return value
    }
    private func uploadAttachment(path: String, metadata: OriginalAttachment, file: URL) async throws -> HTTPResponse {
        let (auth, generation) = try snapshot()
        try await verify(auth, generation)
        guard try file.resourceValues(forKeys: [.fileSizeKey]).fileSize == metadata.size,
              try AttachmentLimits.sha256(file: file) == metadata.sha256 else { throw ClientInputFailure.invalidAttachment }
        var request = URLRequest(url: URL(string: auth.session.server.originString + "/personal/v1" + path)!)
        request.httpMethod = "PUT"; request.setValue(auth.cookie, forHTTPHeaderField: "Cookie")
        request.setValue(auth.csrf, forHTTPHeaderField: "X-WeftMate-CSRF")
        request.setValue(auth.session.server.originString, forHTTPHeaderField: "Origin")
        request.setValue(metadata.contentType, forHTTPHeaderField: "Content-Type")
        request.setValue(String(metadata.size), forHTTPHeaderField: "Content-Length")
        request.setValue(metadata.sha256, forHTTPHeaderField: "X-WeftMate-SHA256")
        let response = try await attachmentResponse(auth, generation) { try await self.transport.upload(request, file: file) }
        guard [200, 201].contains(response.status) else { throw APIFailure.invalidResponse }
        return response
    }
    private func downloadAttachment(path: String, to file: URL, maximumBytes: Int, contentType: String,
                                     expectedHash: String? = nil, expectedSize: Int? = nil) async throws {
        let (auth, generation) = try snapshot()
        try await verify(auth, generation)
        var request = URLRequest(url: URL(string: auth.session.server.originString + "/personal/v1" + path)!)
        request.setValue(auth.cookie, forHTTPHeaderField: "Cookie")
        var success = false
        defer { if !success { try? FileManager.default.removeItem(at: file) } }
        let response = try await attachmentResponse(auth, generation) {
            try await self.transport.download(request, to: file, maximumBytes: maximumBytes)
        }
        let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard response.status == 200, size > 0, size <= maximumBytes,
              response.headers["content-type"]?.components(separatedBy: ";").first == contentType,
              expectedSize == nil || size == expectedSize,
              try expectedHash == nil || AttachmentLimits.sha256(file: file) == expectedHash else { throw APIFailure.invalidResponse }
        success = true
    }
    private func attachmentResponse(_ auth: Credential, _ generation: UInt64,
                                    operation: () async throws -> HTTPResponse) async throws -> HTTPResponse {
        do {
            try check(generation)
            let response = try await operation(); try check(generation)
            if (300...399).contains(response.status) { throw APIFailure.transport(.redirect) }
            guard (200...299).contains(response.status) else { throw serverFailure(response) }
            return response
        } catch {
            try check(generation)
            if shouldForget(error) {
                credential = nil; clearCaches(); epoch &+= 1
                try store.delete(key: credentialKey(server: auth.session.server, platform: platform))
            }
            throw error
        }
    }

    private func retainSharedIntent(requestID: String, payload: Data, endpoint: String) throws {
        if let prior = sharedIntentBytes[requestID], prior != payload || sharedIntentEndpoints[requestID] != endpoint {
            throw APIFailure.server(status: 409, code: "REQUEST_CONFLICT")
        }
        // Match durable defaults and bind the path too: adoption bodies omit conversation identity.
        if sharedIntentBytes[requestID] == nil {
            guard payload.count <= 131_072, sharedIntentBytes.count < 256,
                  sharedIntentBytes.values.reduce(0, { $0 + $1.count }) + payload.count <= 4_194_304 else { throw APIFailure.requestLedgerLimit }
        }
        sharedIntentBytes[requestID] = payload; sharedIntentEndpoints[requestID] = endpoint
    }

    private func lookupSharedCommand(_ auth: Credential, _ generation: UInt64,
                                     requestID: String) async throws -> SharedCommandReceipt? {
        struct Reply: Decodable { let command: SharedCommandReceipt }
        let response: HTTPResponse
        do { response = try await sharedAuthorizedRequest(auth, generation, path: "/commands/by-request/\(requestID)") }
        catch APIFailure.server(404, "NOT_FOUND") { return nil }
        let reply: Reply = try decode(response.body)
        try reply.command.validateStructure()
        guard reply.command.requestId == requestID, reply.command.targetDeviceId == auth.session.hostId else {
            throw APIFailure.identityMismatch
        }
        return reply.command
    }

    private func sharedAuthorizedRequest(_ auth: Credential, _ generation: UInt64,
                                         path: String, method: String = "GET", body: Data? = nil,
                                         acceptedErrorStatuses: Set<Int> = []) async throws -> HTTPResponse {
        do {
            try check(generation)
            let response = try await rawRequest(server: auth.session.server, path: path, method: method, body: body, auth: auth,
                acceptedErrorStatuses: acceptedErrorStatuses)
            try check(generation)
            return response
        } catch {
            try check(generation)
            if shouldForget(error) {
                credential = nil; clearCaches(); epoch &+= 1
                try store.delete(key: credentialKey(server: auth.session.server, platform: platform))
            }
            throw error
        }
    }

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

    /// Checks the deployed Apple declaration contract for an isolated test device only.
    /// This read milestone does not receive model secrets and therefore never declares transfer capability.
    @_spi(Acceptance) public func declareAcceptanceCapabilities() async throws {
        try await declareSharedCapabilities()
    }

    /// Apple sharing capability only. Model credential transfer is never declared by this method.
    public func declareSharedCapabilities() async throws {
        let (auth, generation) = try snapshot()
        try await verify(auth, generation)
        let platformName = platform.rawValue.lowercased()
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/sync/capabilities", method: "POST",
            body: try JSONSerialization.data(withJSONObject: ["platform": platformName, "sharedConversations": 1], options: [.sortedKeys]))
        let reply: AcceptanceCapabilitiesReply = try decode(response.body)
        guard let fields = try? JSONSerialization.jsonObject(with: response.body) as? [String: Any],
              Set(fields.keys) == Set(["deviceId", "platform", "sharedConversations"]), reply.sharedConversations == 1 else {
            throw APIFailure.invalidResponse
        }
        guard reply.deviceId == auth.session.device.id, reply.platform == platformName else { throw APIFailure.identityMismatch }
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

            if !page.hasMore { return all }
            after = page.nextSeq
        }
    }
    public func timelinePage(sessionID: String, beforeSeq: Int? = nil, afterSeq: Int? = nil, limit: Int = 100) async throws -> TimelinePage {
        let (auth, generation) = try snapshot()
        try await verify(auth, generation)
        return try await readTimeline(auth, generation, sessionID: sessionID, beforeSeq: beforeSeq, afterSeq: afterSeq, limit: limit)
    }
    public func cachedTimelineMessageIDs(sessionID: String) -> [Int: String] { credential == nil ? [:] : timelineMessageIDs[sessionID] ?? [:] }
    public func cachedTimelinePage(sessionID: String) -> TimelinePage? { credential == nil ? nil : timelinePages[sessionID] }
    public func timelineMessages(_ events: [TimelineEvent], sessionID: String) throws -> [ChatMessage] {
        try events.compactMap { event in
            if event.type == "user.message", let receipt = event.data["receiptId"]?.string,
               let message = adoptedSyncMessages[sessionID]?[receipt] {
                timelineMessageIDs[sessionID, default: [:]][event.seq] = message.id
                return message
            }
            return try hostMessage(event, sessionID: sessionID)
        }
    }
    public func timelineDetail(sessionID: String, seq: Int) async throws -> TimelineDetail {
        let (auth, generation) = try snapshot()
        let id = try checkedID(sessionID)
        guard (0...SharedValidation.maximumSequence).contains(seq) else { throw APIFailure.invalidResponse }
        try await verify(auth, generation)
        let reply: TimelineDetail = try await authorized(auth, generation, path: "/sessions/\(id)/events/\(seq)/detail")
        guard reply.seq == seq, reply.text.utf16.count <= 64_000 else { throw APIFailure.invalidResponse }
        return reply
    }
    private func readTimeline(_ auth: Credential, _ generation: UInt64, sessionID: String,
                              beforeSeq: Int? = nil, afterSeq: Int? = nil, limit: Int = 100) async throws -> TimelinePage {
        let id = try checkedID(sessionID)
        let query = try TimelinePage.query(beforeSeq: beforeSeq, afterSeq: afterSeq, limit: limit)
        let response = try await sharedAuthorizedRequest(auth, generation, path: "/sessions/\(id)/events?\(query)")
        let page = try TimelinePage.decode(response.body, beforeSeq: beforeSeq, afterSeq: afterSeq, limit: limit)
        if beforeSeq == nil && afterSeq == nil { timelinePages[id] = page }
        return page
    }
    private func readHistory(_ auth: Credential, _ generation: UInt64, sessionID: String) async throws -> [TimelineEvent] {
        try await readTimeline(auth, generation, sessionID: sessionID).events
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
        try OriginalAttachmentValidation.validate(event.payload.attachments, messageID: nil, unpreviewedIDs: nil, maximumCount: 8)
        let originals = event.payload.originalAttachments ?? event.payload.attachments ?? []
        try OriginalAttachmentValidation.validate(originals, messageID: event.payload.attachmentMessageId,
            unpreviewedIDs: event.payload.unpreviewedOriginalImageIds, maximumCount: 8)
        return .init(id: "sync|\(event.sourceDeviceId)|\(id)", role: role, text: text,
            occurredAt: event.occurredAt, sourceDeviceId: event.sourceDeviceId,
            attachmentCount: OriginalAttachmentValidation.count(originals: originals, previewCount: event.payload.attachments?.count ?? 0,
                unpreviewedIDs: event.payload.unpreviewedOriginalImageIds), truncated: false, pendingContext: pending,
            originalAttachments: originals, attachmentMessageId: event.payload.attachmentMessageId,
            unpreviewedOriginalImageIds: event.payload.unpreviewedOriginalImageIds ?? [])
    }
    private func hostMessage(_ event: TimelineEvent, sessionID: String) throws -> ChatMessage? {
        guard ["user.message", "assistant.message"].contains(event.type) else { return nil }
        let text = event.data["text"]?.string ?? ""
        let imageMetadata: [SharedHistoryImage]? = try optionalHistoryField(event.data["images"])
        let images = imageMetadata?.count ?? 0
        let originals: [OriginalAttachment]? = try optionalHistoryField(event.data["originalAttachments"])
        let messageID: String? = try optionalHistoryField(event.data["attachmentMessageId"])
        let unpreviewedIDs: [String]? = try optionalHistoryField(event.data["unpreviewedOriginalImageIds"])
        try OriginalAttachmentValidation.validate(originals, messageID: messageID, unpreviewedIDs: unpreviewedIDs)
        guard !text.isEmpty || images > 0 || (event.type == "user.message" && !(originals ?? []).isEmpty) else { return nil }
        return .init(id: "host|\(sessionID)|\(event.seq)", role: event.type == "user.message" ? .user : .assistant,
            text: text, occurredAt: event.at, sourceDeviceId: nil,
            attachmentCount: OriginalAttachmentValidation.count(originals: originals, previewCount: images, unpreviewedIDs: unpreviewedIDs),
            truncated: event.data["truncated"]?.bool ?? false, pendingContext: false, images: imageMetadata ?? [], originalAttachments: originals ?? [],
            attachmentMessageId: messageID, unpreviewedOriginalImageIds: unpreviewedIDs ?? [])
    }
    private func optionalHistoryField<T: Decodable>(_ value: JSONValue?) throws -> T? {
        guard let value else { return nil }
        if case .null = value { return nil }
        // Decode only the documented metadata field; no route or download permission is inferred.
        return try decode(JSONEncoder().encode(value))
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
    private func clearCaches() {
        syncEvents = []; summaries = []; historyCache = [:]; timelinePages = [:]; timelineMessageIDs = [:]; adoptedSyncMessages = [:]; sharedIntentBytes = [:]; sharedIntentEndpoints = [:]; sharedOperations = []
        memoryIntentBytes = [:]; memoryIntentEndpoints = [:]; memoryOperations = []
        memoryIntentIdentities = [:]; memoryKnownReceipts = [:]; memoryRedactedProofs = [:]
        taskStopIntents = [:]
        interactionIntents = [:]; interactionOperations = []; approvalDecisionReceipts = [:]; questionAnswerReceipts = [:]
    }
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
                            body: Data? = nil, auth: Credential? = nil, acceptedErrorStatuses: Set<Int> = [], extraHeaders: [String: String] = [:]) async throws -> HTTPResponse {
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
        for (header, value) in extraHeaders { request.setValue(value, forHTTPHeaderField: header) }
        let response: HTTPResponse
        do { response = try await transport.send(request) }
        catch let e as APIFailure { throw e }
        catch is CancellationError { throw APIFailure.transport(.cancelled) }
        catch { throw APIFailure.transport(.unavailable) }
        guard response.body.count <= 1_048_576 else { throw APIFailure.responseTooLarge }
        if (300...399).contains(response.status) { throw APIFailure.transport(.redirect) }
        guard (200...299).contains(response.status) || acceptedErrorStatuses.contains(response.status) else { throw serverFailure(response) }
        return response
    }
    private func serverFailure(_ response: HTTPResponse) -> APIFailure {
        let candidate = (try? decoder.decode(ErrorReply.self, from: response.body))?.error?.code ?? ""
        let code = candidate.range(of: "^[A-Z][A-Z0-9_]{0,63}$", options: .regularExpression) != nil ? candidate : "HTTP_\(response.status)"
        return .server(status: response.status, code: code)
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
