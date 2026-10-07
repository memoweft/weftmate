import CryptoKit
import Darwin
import Foundation

public enum LocalConversationStoreLimit: String, Codable, Sendable {
    case draftBytes, payloadBytes, fileBytes, draftCount, commandCount, cursorCount
    case conversationCount, historyCount, historyMessages, historyBytes, cacheBytes
}

public enum LocalConversationStoreFailure: Error, Equatable, Sendable, LocalizedError {
    case invalidScope, invalidPayload, invalidReceipt, invalidCache, corruptFile, unsupportedVersion(Int)
    case storageUnavailable, unsafeFile, busy, intentConflict, staleRevision, invalidTransition, staleCursor
    case limitExceeded(LocalConversationStoreLimit)
    public var errorDescription: String? {
        switch self {
        case .invalidScope: "本机记录的账户或会话身份无效。"
        case .invalidPayload: "发送意图格式无效，尚未发送。"
        case .invalidReceipt: "服务器回执与原发送意图不一致。"
        case .invalidCache: "会话缓存的身份或来源格式不一致，旧缓存已保留。"
        case .corruptFile: "本机记录格式损坏，已保留原文件，不能继续覆盖。"
        case .unsupportedVersion: "本机记录版本暂不支持，已保留原文件。"
        case .storageUnavailable, .unsafeFile: "无法安全保存本机记录，请检查应用存储目录。"
        case .busy: "本机记录正由另一实例使用，请稍后重试。"
        case .intentConflict: "这个请求标识已绑定另一份发送内容，不能替换。"
        case .staleRevision, .invalidTransition: "本机发送状态已更新，请重新读取原请求。"
        case .staleCursor: "历史读取进度不能倒退，请重新核对会话。"
        case .limitExceeded: "本机记录达到保存上限，未截断或删除已有内容。"
        }
    }
}

public struct LocalConversationStoreLimits: Equatable, Sendable {
    public let draftUTF8Bytes: Int
    public let payloadBytes: Int
    public let fileBytes: Int
    public let draftCount: Int
    public let commandCount: Int
    public let cursorCount: Int
    public let conversationCount: Int
    public let historyCount: Int
    public let historyMessageCount: Int
    public let historyBytes: Int
    public let cacheBytes: Int
    public init(draftUTF8Bytes: Int = 65_536, payloadBytes: Int = 131_072,
                fileBytes: Int = 4_194_304, draftCount: Int = 256,
                commandCount: Int = 256, cursorCount: Int = 256,
                conversationCount: Int = 256, historyCount: Int = 32,
                historyMessageCount: Int = 1_024, historyBytes: Int = 1_048_576,
                cacheBytes: Int = 2_097_152) {
        self.draftUTF8Bytes = draftUTF8Bytes; self.payloadBytes = payloadBytes
        self.fileBytes = fileBytes; self.draftCount = draftCount
        self.commandCount = commandCount; self.cursorCount = cursorCount
        self.conversationCount = conversationCount; self.historyCount = historyCount
        self.historyMessageCount = historyMessageCount; self.historyBytes = historyBytes
        self.cacheBytes = cacheBytes
    }
    public static let `default` = Self()
    func validate() throws {
        guard [draftUTF8Bytes, payloadBytes, fileBytes, draftCount, commandCount, cursorCount,
               conversationCount, historyCount, historyMessageCount, historyBytes, cacheBytes].allSatisfy({ $0 > 0 }),
              fileBytes <= 67_108_864 else { throw LocalConversationStoreFailure.invalidScope }
    }
}

/// A local cache scope; it grants no access to the cloud account.
public struct LocalAccountScope: Codable, Hashable, Sendable {
    public let originString: String
    public let ownerId: String
    public var cacheKey: String { localHash(Data((originString + "\u{0}" + ownerId).utf8)) }
    public init(server: ServerConfiguration, ownerId: String) throws {
        guard SharedValidation.id(ownerId), var parts = URLComponents(url: server.origin, resolvingAgainstBaseURL: false),
              let scheme = parts.scheme?.lowercased(), let host = parts.host?.lowercased() else {
            throw LocalConversationStoreFailure.invalidScope
        }
        parts.scheme = scheme; parts.host = host
        if (scheme == "https" && parts.port == 443) || (scheme == "http" && parts.port == 80) { parts.port = nil }
        guard let url = parts.url else { throw LocalConversationStoreFailure.invalidScope }
        originString = url.absoluteString; self.ownerId = ownerId
    }
    enum CodingKeys: String, CodingKey { case originString, ownerId }
    public init(from decoder: any Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        let origin = try box.decode(String.self, forKey: .originString)
        try self.init(server: ServerConfiguration(input: origin, allowLoopbackHTTP: true),
                      ownerId: box.decode(String.self, forKey: .ownerId))
        guard origin == originString else { throw LocalConversationStoreFailure.corruptFile }
    }
}

public struct LocalDraftRecord: Codable, Equatable, Sendable {
    public let account: LocalAccountScope
    public let conversationId: String
    public let text: String
    public let revision: UInt64
    private let updatedAtMilliseconds: Int64
    public var updatedAt: Date { Date(timeIntervalSince1970: Double(updatedAtMilliseconds) / 1_000) }
    fileprivate init(account: LocalAccountScope, conversationId: String, text: String, revision: UInt64) {
        self.account = account; self.conversationId = conversationId; self.text = text; self.revision = revision
        updatedAtMilliseconds = localNow()
    }
    fileprivate var key: String { account.cacheKey + "|" + conversationId }
    fileprivate func validate(_ limits: LocalConversationStoreLimits) throws {
        guard localConversationID(conversationId), revision > 0, updatedAtMilliseconds >= 0,
              text.utf8.count <= limits.draftUTF8Bytes else { throw LocalConversationStoreFailure.corruptFile }
    }
}

public enum LocalCommandState: String, Codable, Sendable { case queued, accepted, rejected, uncertain }

/// This records local intent and the last known receipt. Accepted is not a completed turn.
public struct LocalCommandRecord: Codable, Equatable, Sendable {
    public let intent: SharedCommandIntent
    public let payloadSHA256: String
    public let state: LocalCommandState
    public let revision: UInt64
    public let receipt: SharedCommandReceipt?
    public let errorCode: String?
    fileprivate let createdAtMilliseconds: Int64
    private let updatedAtMilliseconds: Int64
    public var createdAt: Date { Date(timeIntervalSince1970: Double(createdAtMilliseconds) / 1_000) }
    public var updatedAt: Date { Date(timeIntervalSince1970: Double(updatedAtMilliseconds) / 1_000) }
    public var commandId: String? { receipt?.commandId }
    public var receiptId: String? { receipt?.receiptId }
    public var serverState: SharedCommandState? { receipt?.state }
    fileprivate init(intent: SharedCommandIntent, state: LocalCommandState = .queued,
                     revision: UInt64 = 0, receipt: SharedCommandReceipt? = nil,
                     errorCode: String? = nil, created: Int64? = nil) {
        self.intent = intent; payloadSHA256 = localHash(intent.payload)
        self.state = state; self.revision = revision; self.receipt = receipt; self.errorCode = errorCode
        createdAtMilliseconds = created ?? localNow(); updatedAtMilliseconds = localNow()
    }
    fileprivate func validate(_ limits: LocalConversationStoreLimits) throws {
        try localValidate(intent, limits)
        guard payloadSHA256 == localHash(intent.payload), createdAtMilliseconds >= 0,
              updatedAtMilliseconds >= 0, errorCode.map(localErrorCode) ?? true else {
            throw LocalConversationStoreFailure.corruptFile
        }
        if let receipt {
            do { try receipt.validate(intent: intent) } catch { throw LocalConversationStoreFailure.corruptFile }
            guard state == .uncertain || localState(receipt.state) == state else { throw LocalConversationStoreFailure.corruptFile }
        } else if state == .accepted || (state == .rejected && errorCode == nil) {
            throw LocalConversationStoreFailure.corruptFile
        }
    }
    fileprivate var account: LocalAccountScope { get throws { try LocalAccountScope(server: intent.server, ownerId: intent.ownerId) } }
    fileprivate var key: String { get throws { try account.cacheKey + "|" + intent.requestId } }
}

private struct LocalCursor: Codable {
    let account: LocalAccountScope
    let hostId: String
    let sessionId: String
    let throughSeq: Int
    var key: String { account.cacheKey + "|" + hostId + "|" + sessionId }
}
private struct LocalEnvelope: Codable {
    var schemaVersion = 2
    var generation: UInt64 = 0
    var drafts: [LocalDraftRecord] = []
    var commands: [LocalCommandRecord] = []
    var cursors: [LocalCursor] = []
    var conversationLists: [LocalCachedConversationList] = []
    var histories: [LocalCachedHistory] = []
    func validate(_ limits: LocalConversationStoreLimits) throws {
        guard schemaVersion == 2 else { throw LocalConversationStoreFailure.unsupportedVersion(schemaVersion) }
        guard drafts.count <= limits.draftCount, commands.count <= limits.commandCount,
              cursors.count <= limits.cursorCount else { throw LocalConversationStoreFailure.corruptFile }
        var draftKeys = Set<String>(), commandKeys = Set<String>(), cursorKeys = Set<String>()
        for draft in drafts {
            try draft.validate(limits)
            guard draftKeys.insert(draft.key).inserted else { throw LocalConversationStoreFailure.corruptFile }
        }
        for command in commands {
            try command.validate(limits)
            guard try commandKeys.insert(command.key).inserted else { throw LocalConversationStoreFailure.corruptFile }
        }
        for cursor in cursors {
            guard SharedValidation.id(cursor.hostId), SharedValidation.id(cursor.sessionId),
                  (-1...SharedValidation.maximumSequence).contains(cursor.throughSeq),
                  cursorKeys.insert(cursor.key).inserted else { throw LocalConversationStoreFailure.corruptFile }
        }
        guard conversationLists.count <= limits.conversationCount,
              conversationLists.reduce(0, { $0 + $1.conversations.count }) <= limits.conversationCount else {
            throw LocalConversationStoreFailure.limitExceeded(.conversationCount)
        }
        guard histories.count <= limits.historyCount else { throw LocalConversationStoreFailure.limitExceeded(.historyCount) }
        var listKeys = Set<String>(), historyKeys = Set<String>()
        for list in conversationLists {
            try list.validate(limits)
            guard listKeys.insert(list.key).inserted else { throw LocalConversationStoreFailure.invalidCache }
        }
        for history in histories {
            try history.validate(limits)
            guard historyKeys.insert(history.key).inserted else { throw LocalConversationStoreFailure.invalidCache }
        }
        guard try localCacheBytes(conversationLists) + localCacheBytes(histories) <= limits.cacheBytes else {
            throw LocalConversationStoreFailure.limitExceeded(.cacheBytes)
        }
    }
}

/// Schema 1 is this app's own B1 format. Reads preserve its bytes; the next real mutation writes schema 2.
private struct LocalEnvelopeV1: Decodable {
    let schemaVersion: Int
    let generation: UInt64
    let drafts: [LocalDraftRecord]
    let commands: [LocalCommandRecord]
    let cursors: [LocalCursor]
    func upgraded() -> LocalEnvelope {
        .init(schemaVersion: 2, generation: generation, drafts: drafts, commands: commands, cursors: cursors)
    }
}

/// File-locked on every operation, so independent app instances do not overwrite each other's scopes.
/// Unknown commands are only read; this type never submits or retries network requests.
public actor LocalConversationStore {
    public static let fileName = "conversations-v1.json"
    public static let schemaVersion = 2
    private let files: LocalConversationFiles
    public let limits: LocalConversationStoreLimits
    public init(directory: URL? = nil, limits: LocalConversationStoreLimits = .default) throws {
        try limits.validate()
        let location: URL
        if let directory { location = directory }
        else {
            guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
                throw LocalConversationStoreFailure.storageUnavailable
            }
            location = support.appendingPathComponent("WeftMate/LocalState", isDirectory: true)
        }
        let files = LocalConversationFiles(directory: location.standardizedFileURL)
        try files.prepare()
        try files.withLock { _ = try files.read(limits) }
        self.files = files; self.limits = limits
    }

    public func loadDrafts(account: LocalAccountScope) throws -> [String: String] {
        try read { state in Dictionary(uniqueKeysWithValues: state.drafts.filter { $0.account == account }.map { ($0.conversationId, $0.text) }) }
    }
    public func draft(account: LocalAccountScope, conversationId: String) throws -> LocalDraftRecord? {
        try requireConversation(conversationId)
        return try read { $0.drafts.first { $0.account == account && $0.conversationId == conversationId } }
    }
    @discardableResult
    public func saveDraft(account: LocalAccountScope, conversationId: String, text: String) throws -> LocalDraftRecord {
        try requireConversation(conversationId)
        guard text.utf8.count <= limits.draftUTF8Bytes else { throw LocalConversationStoreFailure.limitExceeded(.draftBytes) }
        try Task.checkCancellation()
        return try mutate { state in
            let index = state.drafts.firstIndex { $0.account == account && $0.conversationId == conversationId }
            if let index, state.drafts[index].text == text { return (state.drafts[index], false) }
            guard index != nil || state.drafts.count < limits.draftCount else { throw LocalConversationStoreFailure.limitExceeded(.draftCount) }
            let previous = index.map { state.drafts[$0].revision } ?? 0
            guard previous < UInt64.max else { throw LocalConversationStoreFailure.staleRevision }
            let record = LocalDraftRecord(account: account, conversationId: conversationId, text: text, revision: previous + 1)
            if let index { state.drafts[index] = record } else { state.drafts.append(record) }
            return (record, true)
        }
    }
    /// A confirmed send removes only its submitted text; later edits stay on disk.
    @discardableResult
    public func clearDraft(account: LocalAccountScope, conversationId: String, ifMatchingText: String? = nil) throws -> Bool {
        try requireConversation(conversationId)
        return try mutate { state in
            guard let index = state.drafts.firstIndex(where: { $0.account == account && $0.conversationId == conversationId }),
                  ifMatchingText.map({ $0 == state.drafts[index].text }) ?? true else { return (false, false) }
            state.drafts.remove(at: index); return (true, true)
        }
    }

    public func cachedConversationList(account: LocalAccountScope) throws -> LocalCachedConversationList? {
        try read { $0.conversationLists.first { $0.account == account } }
    }
    /// Call only with a complete list obtained under the caller's verified account epoch.
    @discardableResult
    public func cacheConversationList(account: LocalAccountScope, hostId: String,
                                      conversations: [ConversationSummary],
                                      originalModels: [String: SharedOriginalModel] = [:]) throws -> LocalCachedConversationList {
        guard conversations.count <= limits.conversationCount else {
            throw LocalConversationStoreFailure.limitExceeded(.conversationCount)
        }
        let values = try conversations.map {
            try LocalCachedConversationSummary(conversation: $0, hostId: hostId, originalModel: originalModels[$0.id])
        }
        let list = LocalCachedConversationList(account: account, hostId: hostId, conversations: values)
        try list.validate(limits)
        return try mutate { state in
            if let index = state.conversationLists.firstIndex(where: { $0.account == account }) {
                state.conversationLists[index] = list
            } else { state.conversationLists.append(list) }
            return (list, true)
        }
    }
    public func cachedHistory(account: LocalAccountScope, conversationKey: String,
                              hostId: String, sessionId: String?) throws -> LocalCachedHistory? {
        try requireCacheHistory(conversationKey, hostId, sessionId)
        return try read { state in
            state.histories.first { $0.account == account && $0.conversationKey == conversationKey
                && $0.hostId == hostId && $0.sessionId == sessionId }
        }
    }
    /// Saves a full display projection. The online SDK must still rebuild events from -1.
    @discardableResult
    public func cacheHistory(account: LocalAccountScope, conversationKey: String, hostId: String,
                              sessionId: String?, messages: [ChatMessage],
                              observedThroughSeq: Int? = nil) throws -> LocalCachedHistory {
        try requireCacheHistory(conversationKey, hostId, sessionId)
        guard messages.count <= limits.historyMessageCount else {
            throw LocalConversationStoreFailure.limitExceeded(.historyMessages)
        }
        let history = LocalCachedHistory(account: account, conversationKey: conversationKey, hostId: hostId,
            sessionId: sessionId, messages: messages, observedThroughSeq: observedThroughSeq)
        try history.validate(limits)
        return try mutate { state in
            if let index = state.histories.firstIndex(where: { $0.key == history.key }) { state.histories[index] = history }
            else { state.histories.append(history) }
            return (history, true)
        }
    }

    @discardableResult
    public func persist(_ intent: SharedCommandIntent) throws -> LocalCommandRecord {
        try localValidate(intent, limits)
        let key = try localCommandKey(intent)
        return try mutate { state in
            if let previous = try state.commands.first(where: { try $0.key == key }) {
                guard localSameIntent(previous.intent, intent) else { throw LocalConversationStoreFailure.intentConflict }
                return (previous, false)
            }
            guard state.commands.count < limits.commandCount else { throw LocalConversationStoreFailure.limitExceeded(.commandCount) }
            let record = LocalCommandRecord(intent: intent); state.commands.append(record)
            return (record, true)
        }
    }
    public func command(for intent: SharedCommandIntent) throws -> LocalCommandRecord? {
        try localValidate(intent, limits)
        let key = try localCommandKey(intent)
        return try read { state in
            let found = try state.commands.first { try $0.key == key }
            if let found, !localSameIntent(found.intent, intent) { throw LocalConversationStoreFailure.intentConflict }
            return found
        }
    }
    public func commands(account: LocalAccountScope) throws -> [LocalCommandRecord] {
        try read { state in try state.commands.filter { try $0.account == account } }
    }
    @discardableResult
    public func recordReceipt(_ receipt: SharedCommandReceipt, for intent: SharedCommandIntent,
                              expectedRevision: UInt64) throws -> LocalCommandRecord {
        do { try receipt.validate(intent: intent) } catch { throw LocalConversationStoreFailure.invalidReceipt }
        return try change(intent, expectedRevision: expectedRevision, to: localState(receipt.state), receipt: receipt, errorCode: receipt.errorCode)
    }
    /// Used only for a lost result or a definite HTTP rejection. No receipt-free acceptance exists.
    @discardableResult
    public func transition(_ intent: SharedCommandIntent, expectedRevision: UInt64,
                           to state: LocalCommandState, errorCode: String? = nil) throws -> LocalCommandRecord {
        guard state == .uncertain || state == .rejected, state != .rejected || errorCode != nil,
              errorCode.map(localErrorCode) ?? true else { throw LocalConversationStoreFailure.invalidTransition }
        return try change(intent, expectedRevision: expectedRevision, to: state, receipt: nil, errorCode: errorCode)
    }

    /// A cursor is metadata, not a cached transcript. Rebuild the history/tracker before skipping older events.
    public func historyCursor(account: LocalAccountScope, hostId: String, sessionId: String) throws -> Int? {
        try requireHistory(hostId, sessionId)
        return try read { $0.cursors.first { $0.account == account && $0.hostId == hostId && $0.sessionId == sessionId }?.throughSeq }
    }
    public func saveHistoryCursor(account: LocalAccountScope, hostId: String, sessionId: String, throughSeq: Int) throws {
        try requireHistory(hostId, sessionId)
        guard (-1...SharedValidation.maximumSequence).contains(throughSeq) else { throw LocalConversationStoreFailure.invalidScope }
        try mutate { state in
            let index = state.cursors.firstIndex { $0.account == account && $0.hostId == hostId && $0.sessionId == sessionId }
            if let index {
                guard state.cursors[index].throughSeq <= throughSeq else { throw LocalConversationStoreFailure.staleCursor }
                if state.cursors[index].throughSeq == throughSeq { return ((), false) }
            } else if state.cursors.count >= limits.cursorCount { throw LocalConversationStoreFailure.limitExceeded(.cursorCount) }
            let cursor = LocalCursor(account: account, hostId: hostId, sessionId: sessionId, throughSeq: throughSeq)
            if let index { state.cursors[index] = cursor } else { state.cursors.append(cursor) }
            return ((), true)
        }
    }

    private func change(_ intent: SharedCommandIntent, expectedRevision: UInt64, to next: LocalCommandState,
                        receipt: SharedCommandReceipt?, errorCode: String?) throws -> LocalCommandRecord {
        try localValidate(intent, limits)
        let key = try localCommandKey(intent)
        return try mutate { state in
            guard let index = try state.commands.firstIndex(where: { try $0.key == key }) else { throw LocalConversationStoreFailure.invalidTransition }
            let previous = state.commands[index]
            guard localSameIntent(previous.intent, intent) else { throw LocalConversationStoreFailure.intentConflict }
            guard previous.revision == expectedRevision, previous.revision < UInt64.max else { throw LocalConversationStoreFailure.staleRevision }
            guard (previous.state != .accepted || next == .accepted) && (previous.state != .rejected || next == .rejected),
                  !(next == .rejected && receipt == nil && previous.receipt != nil),
                  previous.commandId == nil || receipt == nil || previous.commandId == receipt?.commandId else {
                throw LocalConversationStoreFailure.invalidTransition
            }
            let retainedReceipt = receipt ?? (next == .uncertain ? previous.receipt : nil)
            guard previous.receiptId == nil || retainedReceipt?.receiptId == previous.receiptId else {
                throw LocalConversationStoreFailure.invalidTransition
            }
            if previous.state == next && previous.receipt == retainedReceipt && previous.errorCode == errorCode { return (previous, false) }
            let updated = LocalCommandRecord(intent: previous.intent, state: next, revision: previous.revision + 1,
                receipt: retainedReceipt, errorCode: errorCode, created: previous.createdAtMilliseconds)
            state.commands[index] = updated; return (updated, true)
        }
    }
    private func read<T>(_ operation: (LocalEnvelope) throws -> T) throws -> T {
        let descriptor = try files.acquireLock()
        defer { files.releaseLock(descriptor) }
        return try operation(files.read(limits))
    }
    private func mutate<T>(_ operation: (inout LocalEnvelope) throws -> (T, Bool)) throws -> T {
        let descriptor = try files.acquireLock()
        defer { files.releaseLock(descriptor) }
        var state = try files.read(limits)
        let (result, changed) = try operation(&state)
        if changed {
            guard state.generation < UInt64.max else { throw LocalConversationStoreFailure.staleRevision }
            state.generation += 1; try files.write(state, limits)
        }
        return result
    }
    private func requireConversation(_ id: String) throws {
        guard localConversationID(id) else { throw LocalConversationStoreFailure.invalidScope }
    }
    private func requireHistory(_ host: String, _ session: String) throws {
        guard SharedValidation.id(host), SharedValidation.id(session) else { throw LocalConversationStoreFailure.invalidScope }
    }
    private func requireCacheHistory(_ conversation: String, _ host: String, _ session: String?) throws {
        guard localCacheConversationKey(conversation), SharedValidation.id(host), session.map(SharedValidation.id) ?? true,
              !conversation.hasPrefix("session:") || session == String(conversation.dropFirst("session:".count)) else {
            throw LocalConversationStoreFailure.invalidScope
        }
    }
}

private func localHash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
private func localNow() -> Int64 { Int64(Date().timeIntervalSince1970 * 1_000) }
private func localConversationID(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 256 && value == value.trimmingCharacters(in: .whitespacesAndNewlines)
        && value.unicodeScalars.allSatisfy { !CharacterSet.controlCharacters.contains($0) }
}
private func localErrorCode(_ value: String) -> Bool { SharedValidation.matches(value, "^[A-Z][A-Z0-9_]{0,63}$") }
private func localCommandKey(_ intent: SharedCommandIntent) throws -> String {
    try LocalAccountScope(server: intent.server, ownerId: intent.ownerId).cacheKey + "|" + intent.requestId
}
private func localSameIntent(_ left: SharedCommandIntent, _ right: SharedCommandIntent) -> Bool {
    (try? LocalAccountScope(server: left.server, ownerId: left.ownerId)) == (try? LocalAccountScope(server: right.server, ownerId: right.ownerId))
        && left.hostId == right.hostId && left.payload == right.payload
}
private func localValidate(_ intent: SharedCommandIntent, _ limits: LocalConversationStoreLimits) throws {
    guard intent.payload.count <= limits.payloadBytes else { throw LocalConversationStoreFailure.limitExceeded(.payloadBytes) }
    do {
        _ = try LocalAccountScope(server: intent.server, ownerId: intent.ownerId)
        _ = try SharedCommandIntent(server: intent.server, ownerId: intent.ownerId, hostId: intent.hostId, payload: intent.payload)
    } catch { throw LocalConversationStoreFailure.invalidPayload }
}
private func localState(_ state: SharedCommandState) -> LocalCommandState {
    switch state {
    case .pending, .dispatching: .queued
    case .acceptedByDSH, .acceptedByHost, .observed: .accepted
    case .uncertain: .uncertain
    case .rejected: .rejected
    }
}

private struct LocalConversationFiles: Sendable {
    let directory: URL
    var data: URL { directory.appendingPathComponent(LocalConversationStore.fileName) }
    var lock: URL { directory.appendingPathComponent(".conversations.lock") }
    func prepare() throws {
        do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
        catch { throw LocalConversationStoreFailure.storageUnavailable }
        let descriptor = Darwin.open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw LocalConversationStoreFailure.unsafeFile }
        defer { Darwin.close(descriptor) }
        var status = stat()
        guard fstat(descriptor, &status) == 0, status.st_uid == geteuid(), status.st_mode & 0o777 == 0o700 else {
            throw LocalConversationStoreFailure.unsafeFile
        }
    }
    func withLock<T>(_ body: () throws -> T) throws -> T {
        let descriptor = try acquireLock()
        defer { releaseLock(descriptor) }
        return try body()
    }
    func acquireLock() throws -> Int32 {
        let descriptor = Darwin.open(lock.path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw LocalConversationStoreFailure.unsafeFile }
        var acquired = false
        defer { if !acquired { Darwin.close(descriptor) } }
        try validateFile(descriptor)
        let deadline = Date().addingTimeInterval(2)
        while flock(descriptor, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EWOULDBLOCK || errno == EINTR else { throw LocalConversationStoreFailure.storageUnavailable }
            guard Date() < deadline else { throw LocalConversationStoreFailure.busy }
            usleep(10_000)
        }
        acquired = true
        return descriptor
    }
    func releaseLock(_ descriptor: Int32) { flock(descriptor, LOCK_UN); Darwin.close(descriptor) }
    func validateFile(_ descriptor: Int32) throws {
        var status = stat()
        guard fstat(descriptor, &status) == 0, status.st_uid == geteuid(), status.st_nlink == 1,
              status.st_mode & S_IFMT == S_IFREG, status.st_mode & 0o777 == 0o600 else {
            throw LocalConversationStoreFailure.unsafeFile
        }
    }
    func read(_ limits: LocalConversationStoreLimits) throws -> LocalEnvelope {
        let descriptor = Darwin.open(data.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        if descriptor < 0 {
            if errno == ENOENT { return LocalEnvelope() }
            throw LocalConversationStoreFailure.unsafeFile
        }
        defer { Darwin.close(descriptor) }
        try validateFile(descriptor)
        var result = Data(), buffer = [UInt8](repeating: 0, count: 16_384)
        while true {
            let count = buffer.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, $0.count) }
            if count < 0 { if errno == EINTR { continue }; throw LocalConversationStoreFailure.storageUnavailable }
            if count == 0 { break }
            guard result.count + count <= limits.fileBytes else { throw LocalConversationStoreFailure.limitExceeded(.fileBytes) }
            result.append(contentsOf: buffer.prefix(count))
        }
        let state: LocalEnvelope
        do {
            guard let top = try JSONSerialization.jsonObject(with: result) as? [String: Any],
                  let version = top["schemaVersion"] as? Int else {
                throw LocalConversationStoreFailure.corruptFile
            }
            switch version {
            case 1:
                guard Set(top.keys) == ["schemaVersion", "generation", "drafts", "commands", "cursors"] else {
                    throw LocalConversationStoreFailure.corruptFile
                }
                state = try JSONDecoder().decode(LocalEnvelopeV1.self, from: result).upgraded()
            case 2:
                guard Set(top.keys) == ["schemaVersion", "generation", "drafts", "commands", "cursors", "conversationLists", "histories"] else {
                    throw LocalConversationStoreFailure.corruptFile
                }
                state = try JSONDecoder().decode(LocalEnvelope.self, from: result)
            default: throw LocalConversationStoreFailure.unsupportedVersion(version)
            }
            try state.validate(limits)
        } catch let error as LocalConversationStoreFailure { throw error }
        catch { throw LocalConversationStoreFailure.corruptFile }
        return state
    }
    func write(_ state: LocalEnvelope, _ limits: LocalConversationStoreLimits) throws {
        try state.validate(limits)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let bytes = try encoder.encode(state)
        guard bytes.count <= limits.fileBytes else { throw LocalConversationStoreFailure.limitExceeded(.fileBytes) }
        let temporary = directory.appendingPathComponent(".conversations-" + UUID().uuidString + ".tmp")
        let descriptor = Darwin.open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw LocalConversationStoreFailure.storageUnavailable }
        defer { Darwin.close(descriptor); Darwin.unlink(temporary.path) }
        try bytes.withUnsafeBytes { raw in
            guard let pointer = raw.baseAddress else { throw LocalConversationStoreFailure.storageUnavailable }
            var offset = 0
            while offset < raw.count {
                let written = Darwin.write(descriptor, pointer.advanced(by: offset), raw.count - offset)
                if written < 0 { if errno == EINTR { continue }; throw LocalConversationStoreFailure.storageUnavailable }
                guard written > 0 else { throw LocalConversationStoreFailure.storageUnavailable }; offset += written
            }
        }
        guard fsync(descriptor) == 0, Darwin.rename(temporary.path, data.path) == 0 else {
            throw LocalConversationStoreFailure.storageUnavailable
        }
        let directoryFD = Darwin.open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard directoryFD >= 0 else { throw LocalConversationStoreFailure.storageUnavailable }
        defer { Darwin.close(directoryFD) }
        guard fsync(directoryFD) == 0 else { throw LocalConversationStoreFailure.storageUnavailable }
    }
}
