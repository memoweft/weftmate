import Foundation
import Testing
@testable import WeftMateCore

private func localTestDirectory() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("weftmate-local-store-" + UUID().uuidString, isDirectory: true)
}
private func localScope(_ owner: String = "owner_A", origin: String = "https://unit.weftmate.example:8443") throws -> LocalAccountScope {
    try LocalAccountScope(server: ServerConfiguration(input: origin), ownerId: owner)
}
private func localIntent(_ request: String = "request.same", owner: String = "owner_A", host: String = "host_A",
                         session: String = "session_A", source: String? = "event_A", text: String = "hello",
                         origin: String = "https://unit.weftmate.example:8443") throws -> SharedCommandIntent {
    let command = try SharedCommandPayload(requestId: request, kind: .message, targetDeviceId: host,
                                           sessionId: session, text: text, sourceSyncEventId: source)
    return try SharedCommandIntent(server: ServerConfiguration(input: origin), ownerId: owner,
                                   hostId: host, payload: command.encoded())
}
private func localReceipt(_ intent: SharedCommandIntent, state: SharedCommandState = .acceptedByDSH,
                          commandId: String = "command_A", receiptId: String? = "receipt_A") -> SharedCommandReceipt {
    .init(commandId: commandId, requestId: intent.requestId, kind: intent.kind, targetDeviceId: intent.hostId,
          state: state, sessionId: intent.sessionId, conversationId: "conversation_A",
          sourceSyncEventId: intent.sourceSyncEventId, receiptId: receiptId,
          errorCode: state == .rejected ? "MODEL_UNAVAILABLE" : nil)
}
private func overwriteLocalFixture(_ data: Data, at url: URL) throws {
    try data.write(to: url)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
}

@Test func localStoreDraftSurvivesReopenAndCanonicalDefaultPort() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let first = try LocalConversationStore(directory: directory)
    let a = try localScope(origin: "https://EXAMPLE.com:443/personal/v1/ui")
    let same = try localScope(origin: "https://example.com")
    #expect(a == same && a.cacheKey == same.cacheKey)
    _ = try await first.saveDraft(account: a, conversationId: "conversation:original_A", text: "尚未发送\n第二行")
    let reopened = try LocalConversationStore(directory: directory)
    #expect(try await reopened.loadDrafts(account: same) == ["conversation:original_A": "尚未发送\n第二行"])
    #expect(try await reopened.draft(account: same, conversationId: "conversation:original_A")?.revision == 1)
    let attributes = try FileManager.default.attributesOfItem(atPath: directory.path)
    let file = try FileManager.default.attributesOfItem(atPath: directory.appendingPathComponent(LocalConversationStore.fileName).path)
    #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o700)
    #expect((file[.posixPermissions] as? NSNumber)?.intValue == 0o600)
}

@Test func localStoreDraftOwnerAndServerNeverCrossRead() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalConversationStore(directory: directory)
    let a = try localScope(), b = try localScope("owner_B"), otherServer = try localScope("owner_A", origin: "https://other.example")
    _ = try await store.saveDraft(account: a, conversationId: "session:same", text: "A private")
    _ = try await store.saveDraft(account: b, conversationId: "session:same", text: "B private")
    _ = try await store.saveDraft(account: otherServer, conversationId: "session:same", text: "Other server")
    let reopened = try LocalConversationStore(directory: directory)
    #expect(try await reopened.loadDrafts(account: a) == ["session:same": "A private"])
    #expect(try await reopened.loadDrafts(account: b) == ["session:same": "B private"])
    #expect(try await reopened.loadDrafts(account: otherServer) == ["session:same": "Other server"])
    #expect(Set([a.cacheKey, b.cacheKey, otherServer.cacheKey]).count == 3)
}

@Test func localStoreConfirmedSendClearsOnlySubmittedDraft() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalConversationStore(directory: directory), scope = try localScope()
    _ = try await store.saveDraft(account: scope, conversationId: "conversation:A", text: "submitted")
    _ = try await store.saveDraft(account: scope, conversationId: "conversation:A", text: "typed while waiting")
    #expect(try await store.clearDraft(account: scope, conversationId: "conversation:A", ifMatchingText: "submitted") == false)
    #expect(try await store.draft(account: scope, conversationId: "conversation:A")?.text == "typed while waiting")
    #expect(try await store.clearDraft(account: scope, conversationId: "conversation:A", ifMatchingText: "typed while waiting"))
    _ = try await store.saveDraft(account: scope, conversationId: "conversation:A", text: "")
    #expect(try await store.draft(account: scope, conversationId: "conversation:A")?.text == "")
    #expect(try await store.clearDraft(account: scope, conversationId: "conversation:A"))
    #expect(try await LocalConversationStore(directory: directory).loadDrafts(account: scope).isEmpty)
}

@Test func localStoreIntentExactBytesAndUnknownSurviveReopen() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalConversationStore(directory: directory), intent = try localIntent()
    let initial = try await store.persist(intent)
    let unknown = try await store.transition(intent, expectedRevision: initial.revision, to: .uncertain, errorCode: "NETWORK_UNAVAILABLE")
    #expect(unknown.state == .uncertain && unknown.revision == 1)
    let reopened = try LocalConversationStore(directory: directory)
    let restored = try await reopened.command(for: intent)
    #expect(restored?.intent.requestId == intent.requestId)
    #expect(restored?.intent.payload == intent.payload)
    #expect(restored?.intent.hostId == "host_A" && restored?.intent.sessionId == "session_A")
    #expect(restored?.intent.sourceSyncEventId == "event_A")
    #expect(restored?.payloadSHA256 == initial.payloadSHA256)
    #expect(restored?.state == .uncertain && restored?.revision == unknown.revision)
    let retryPreparation = try await reopened.persist(intent)
    #expect(retryPreparation.state == .uncertain && retryPreparation.revision == 1)
    #expect(try await reopened.commands(account: localScope()).count == 1)
}

@Test func localStoreIntentConflictsProtectBodyHostSessionAndSource() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalConversationStore(directory: directory), original = try localIntent()
    _ = try await store.persist(original)
    for conflict in [try localIntent(text: "different"), try localIntent(host: "host_B"),
                     try localIntent(session: "session_B"), try localIntent(source: "event_B")] {
        await #expect(throws: LocalConversationStoreFailure.intentConflict) { try await store.persist(conflict) }
    }
    let object = try JSONSerialization.jsonObject(with: original.payload)
    let reformatted = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
    let sameMeaning = try SharedCommandIntent(server: original.server, ownerId: original.ownerId,
                                              hostId: original.hostId, payload: reformatted)
    #expect(sameMeaning.payload != original.payload)
    await #expect(throws: LocalConversationStoreFailure.intentConflict) { try await store.persist(sameMeaning) }
    #expect(try await store.command(for: original)?.intent.payload == original.payload)
}

@Test func localStoreSameRequestBelongsToIndependentOwnerAndOrigin() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalConversationStore(directory: directory)
    let a = try localIntent(), b = try localIntent(owner: "owner_B"), other = try localIntent(origin: "https://other.example")
    _ = try await store.persist(a); _ = try await store.persist(b); _ = try await store.persist(other)
    #expect(try await store.commands(account: localScope()).map(\.intent.ownerId) == ["owner_A"])
    #expect(try await store.commands(account: localScope("owner_B")).map(\.intent.ownerId) == ["owner_B"])
    #expect(try await store.commands(account: localScope("owner_A", origin: "https://other.example")).count == 1)
}

@Test func localStoreReceiptRevisionAndTerminalAcceptanceGuardLateCallbacks() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalConversationStore(directory: directory), intent = try localIntent()
    let initial = try await store.persist(intent)
    let accepted = try await store.recordReceipt(localReceipt(intent), for: intent, expectedRevision: initial.revision)
    #expect(accepted.state == .accepted && accepted.receiptId == "receipt_A")
    await #expect(throws: LocalConversationStoreFailure.staleRevision) {
        try await store.transition(intent, expectedRevision: initial.revision, to: .uncertain)
    }
    await #expect(throws: LocalConversationStoreFailure.invalidTransition) {
        try await store.transition(intent, expectedRevision: accepted.revision, to: .uncertain)
    }
    await #expect(throws: LocalConversationStoreFailure.invalidTransition) {
        try await store.recordReceipt(localReceipt(intent, receiptId: "receipt_changed"), for: intent, expectedRevision: accepted.revision)
    }
    await #expect(throws: LocalConversationStoreFailure.invalidTransition) {
        try await store.recordReceipt(localReceipt(intent, commandId: "command_changed"), for: intent, expectedRevision: accepted.revision)
    }
    let reopened = try LocalConversationStore(directory: directory)
    #expect(try await reopened.command(for: intent)?.state == .accepted)
    #expect(try await reopened.command(for: intent)?.receiptId == "receipt_A")
}

@Test func localStoreUncertainRetainsEarlierPendingReceiptAndRejectsFalseHTTPFinality() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalConversationStore(directory: directory), intent = try localIntent()
    let initial = try await store.persist(intent)
    let pending = try await store.recordReceipt(localReceipt(intent, state: .pending, receiptId: nil), for: intent, expectedRevision: initial.revision)
    await #expect(throws: LocalConversationStoreFailure.invalidTransition) {
        try await store.transition(intent, expectedRevision: pending.revision, to: .rejected, errorCode: "UNAUTHORIZED")
    }
    let unknown = try await store.transition(intent, expectedRevision: pending.revision, to: .uncertain, errorCode: "NETWORK_UNAVAILABLE")
    #expect(unknown.commandId == "command_A" && unknown.serverState == .pending)
    let reopened = try LocalConversationStore(directory: directory)
    #expect(try await reopened.command(for: intent)?.state == .uncertain)
    #expect(try await reopened.command(for: intent)?.commandId == "command_A")
    let found = try await reopened.recordReceipt(localReceipt(intent), for: intent, expectedRevision: unknown.revision)
    #expect(found.state == .accepted)
}

@Test func localStoreMismatchedReceiptCannotAcknowledgeAnotherIntent() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalConversationStore(directory: directory), intent = try localIntent()
    _ = try await store.persist(intent)
    await #expect(throws: LocalConversationStoreFailure.invalidReceipt) {
        try await store.recordReceipt(localReceipt(try localIntent("request.other")), for: intent, expectedRevision: 0)
    }
    #expect(try await store.command(for: intent)?.state == .queued)
}

@Test func localStoreExplicitRejectionPersistsWithoutResubmission() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalConversationStore(directory: directory), intent = try localIntent()
    let pending = try await store.persist(intent)
    let rejected = try await store.transition(intent, expectedRevision: pending.revision, to: .rejected, errorCode: "INVALID_REQUEST")
    #expect(rejected.state == .rejected)
    let reopened = try LocalConversationStore(directory: directory)
    #expect(try await reopened.persist(intent).state == .rejected)
    await #expect(throws: LocalConversationStoreFailure.invalidTransition) {
        try await reopened.recordReceipt(localReceipt(intent), for: intent, expectedRevision: rejected.revision)
    }
}

@Test func localStoreMalformedStateAndUnsupportedSchemaNeverClearExistingBytes() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalConversationStore(directory: directory), scope = try localScope()
    _ = try await store.saveDraft(account: scope, conversationId: "conversation:A", text: "preserve")
    let file = directory.appendingPathComponent(LocalConversationStore.fileName)
    let original = try Data(contentsOf: file)
    let corrupt = Data("{broken".utf8)
    try overwriteLocalFixture(corrupt, at: file)
    #expect(throws: LocalConversationStoreFailure.corruptFile) { try LocalConversationStore(directory: directory) }
    await #expect(throws: LocalConversationStoreFailure.corruptFile) { try await store.saveDraft(account: scope, conversationId: "conversation:B", text: "new") }
    #expect(try Data(contentsOf: file) == corrupt)
    var object = try #require(JSONSerialization.jsonObject(with: original) as? [String: Any])
    object["schemaVersion"] = 99
    let future = try JSONSerialization.data(withJSONObject: object)
    try overwriteLocalFixture(future, at: file)
    #expect(throws: LocalConversationStoreFailure.unsupportedVersion(99)) { try LocalConversationStore(directory: directory) }
    #expect(try Data(contentsOf: file) == future)
}

@Test func localStoreLimitsFailAtomicallyWithoutPruningOldData() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let limits = LocalConversationStoreLimits(draftUTF8Bytes: 4_096, payloadBytes: 1_024, fileBytes: 2_048,
                                              draftCount: 2, commandCount: 1, cursorCount: 1)
    let store = try LocalConversationStore(directory: directory, limits: limits), scope = try localScope()
    _ = try await store.saveDraft(account: scope, conversationId: "conversation:A", text: "preserve")
    let file = directory.appendingPathComponent(LocalConversationStore.fileName), before = try Data(contentsOf: file)
    await #expect(throws: LocalConversationStoreFailure.limitExceeded(.fileBytes)) {
        try await store.saveDraft(account: scope, conversationId: "conversation:A", text: String(repeating: "x", count: 2_048))
    }
    #expect(try Data(contentsOf: file) == before)
    await #expect(throws: LocalConversationStoreFailure.limitExceeded(.draftBytes)) {
        try await store.saveDraft(account: scope, conversationId: "conversation:A", text: String(repeating: "😀", count: 1_025))
    }
    _ = try await store.persist(localIntent())
    await #expect(throws: LocalConversationStoreFailure.limitExceeded(.commandCount)) { try await store.persist(localIntent("request.two")) }
    #expect(try await store.loadDrafts(account: scope)["conversation:A"] == "preserve")
}

@Test func localStoreCorruptedIntentHashFailsAndPartialTempDoesNotReplaceState() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalConversationStore(directory: directory), intent = try localIntent()
    _ = try await store.persist(intent)
    let partial = directory.appendingPathComponent(".conversations-interrupted.tmp")
    try overwriteLocalFixture(Data("incomplete".utf8), at: partial)
    #expect(try await LocalConversationStore(directory: directory).command(for: intent)?.intent.payload == intent.payload)
    let file = directory.appendingPathComponent(LocalConversationStore.fileName)
    var object = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
    var commands = try #require(object["commands"] as? [[String: Any]])
    commands[0]["payloadSHA256"] = String(repeating: "0", count: 64); object["commands"] = commands
    let corrupt = try JSONSerialization.data(withJSONObject: object)
    try overwriteLocalFixture(corrupt, at: file)
    #expect(throws: LocalConversationStoreFailure.corruptFile) { try LocalConversationStore(directory: directory) }
    #expect(try Data(contentsOf: file) == corrupt)
    #expect(try Data(contentsOf: partial) == Data("incomplete".utf8))
}

@Test func localStoreTwoActorsSerializeDifferentScopesWithoutLostUpdates() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let first = try LocalConversationStore(directory: directory), second = try LocalConversationStore(directory: directory)
    let a = try localScope(), b = try localScope("owner_B")
    try await withThrowingTaskGroup(of: Void.self) { group in
        for number in 0..<24 {
            group.addTask {
                _ = try await (number.isMultiple(of: 2) ? first : second).saveDraft(account: number.isMultiple(of: 2) ? a : b,
                                                                                  conversationId: "conversation:\(number)", text: "draft \(number)")
            }
        }
        try await group.waitForAll()
    }
    let reopened = try LocalConversationStore(directory: directory)
    #expect(try await reopened.loadDrafts(account: a).count == 12)
    #expect(try await reopened.loadDrafts(account: b).count == 12)
    for number in 0..<24 {
        #expect(try await reopened.draft(account: number.isMultiple(of: 2) ? a : b, conversationId: "conversation:\(number)")?.text == "draft \(number)")
    }
}

@Test func localStoreHistoryCursorIsScopedMonotonicAndDurableMetadata() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalConversationStore(directory: directory), a = try localScope(), b = try localScope("owner_B")
    try await store.saveHistoryCursor(account: a, hostId: "host_A", sessionId: "session_A", throughSeq: 4)
    try await store.saveHistoryCursor(account: a, hostId: "host_A", sessionId: "session_A", throughSeq: 10)
    await #expect(throws: LocalConversationStoreFailure.staleCursor) {
        try await store.saveHistoryCursor(account: a, hostId: "host_A", sessionId: "session_A", throughSeq: 9)
    }
    let reopened = try LocalConversationStore(directory: directory)
    #expect(try await reopened.historyCursor(account: a, hostId: "host_A", sessionId: "session_A") == 10)
    #expect(try await reopened.historyCursor(account: b, hostId: "host_A", sessionId: "session_A") == nil)
    #expect(try await reopened.historyCursor(account: a, hostId: "host_B", sessionId: "session_A") == nil)
}

@Test func localStoreSymlinkCannotRedirectStateToAnotherFile() throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let other = directory.appendingPathComponent("owned-test-target.json")
    let original = Data("preserved target".utf8); try overwriteLocalFixture(original, at: other)
    try FileManager.default.createSymbolicLink(at: directory.appendingPathComponent(LocalConversationStore.fileName), withDestinationURL: other)
    #expect(throws: LocalConversationStoreFailure.unsafeFile) { try LocalConversationStore(directory: directory) }
    #expect(try Data(contentsOf: other) == original)
}

private func localCacheConversation(_ id: String = "conversation_A", title: String = "Original conversation",
                                    sessionId: String? = "session_A", hasConversation: Bool = true) -> ConversationSummary {
    .init(id: id, title: title, conversationId: hasConversation ? id : nil, sessionId: sessionId,
          running: true, sendAvailable: true, originalModelLabel: "Model A")
}
private func localCacheMessage(_ id: String = "host|session_A|7", text: String = "Original reply") -> ChatMessage {
    .init(id: id, role: .assistant, text: text, occurredAt: "2026-10-05T00:00:00Z",
          sourceDeviceId: nil, attachmentCount: 0, truncated: false, pendingContext: false)
}

@Test func localStoreCacheReopensOriginalTextAndNeverProjectsLivePermissions() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalConversationStore(directory: directory), scope = try localScope()
    let summary = localCacheConversation()
    let model = SharedOriginalModel(modelId: "model_A", displayName: "Model A", routeFingerprint: nil, hostProfileId: "profile_A")
    _ = try await store.cacheConversationList(account: scope, hostId: "host_A", conversations: [summary], originalModels: [summary.id: model])
    let first = ChatMessage(id: "sync|device_Phone|message_A", role: .user, text: "原话\n```swift\nprint(1)\n```",
                            occurredAt: "2026-10-04T12:00:00Z", sourceDeviceId: "device_Phone",
                            attachmentCount: 1, truncated: true, pendingContext: true)
    let messages = [first, localCacheMessage()]
    _ = try await store.cacheHistory(account: scope, conversationKey: "conversation:conversation_A", hostId: "host_A",
                                    sessionId: "session_A", messages: messages, observedThroughSeq: 12)
    let reopened = try LocalConversationStore(directory: directory)
    let readList = try await reopened.cachedConversationList(account: scope)
    let list = try #require(readList)
    #expect(list.isCached && list.cachedAt.timeIntervalSince1970 > 0)
    #expect(list.conversations[0].conversationKey == "conversation:conversation_A")
    #expect(list.conversations[0].conversation.running == false && list.conversations[0].conversation.sendAvailable == false)
    #expect(list.conversations[0].originalModel == model && list.conversations[0].originalModelLabel == "Model A")
    let readHistory = try await reopened.cachedHistory(account: scope, conversationKey: "conversation:conversation_A",
                                                       hostId: "host_A", sessionId: "session_A")
    let history = try #require(readHistory)
    #expect(history.messages == messages)
    #expect(history.cachedMessages[0].hostSequence == nil)
    #expect(history.cachedMessages[0].truncated && history.cachedMessages[0].pendingContext)
    #expect(history.cachedMessages[0].sourceDeviceId == "device_Phone")
    #expect(history.cachedMessages[1].hostSequence == 7 && history.cachedMessages[1].hostSessionId == "session_A")
    #expect(history.observedThroughSeq == 12 && history.rebuildAfterSeq == -1)
}

@Test func localStoreCacheOwnerOriginHostAndSessionCannotCrossHistory() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalConversationStore(directory: directory)
    let a = try localScope(), b = try localScope("owner_B"), other = try localScope(origin: "https://other.example")
    _ = try await store.cacheConversationList(account: a, hostId: "host_A", conversations: [localCacheConversation(title: "A")])
    _ = try await store.cacheConversationList(account: b, hostId: "host_A", conversations: [localCacheConversation(title: "B")])
    _ = try await store.cacheHistory(account: a, conversationKey: "conversation:conversation_A", hostId: "host_A",
                                    sessionId: "session_A", messages: [localCacheMessage(text: "A history")])
    let reopened = try LocalConversationStore(directory: directory)
    #expect(try await reopened.cachedConversationList(account: a)?.conversations[0].title == "A")
    #expect(try await reopened.cachedConversationList(account: b)?.conversations[0].title == "B")
    #expect(try await reopened.cachedConversationList(account: other) == nil)
    #expect(try await reopened.cachedHistory(account: b, conversationKey: "conversation:conversation_A", hostId: "host_A", sessionId: "session_A") == nil)
    #expect(try await reopened.cachedHistory(account: other, conversationKey: "conversation:conversation_A", hostId: "host_A", sessionId: "session_A") == nil)
    #expect(try await reopened.cachedHistory(account: a, conversationKey: "conversation:conversation_A", hostId: "host_B", sessionId: "session_A") == nil)
    #expect(try await reopened.cachedHistory(account: a, conversationKey: "conversation:conversation_A", hostId: "host_A", sessionId: "session_B") == nil)
}

@Test func localStoreCacheSchemaOneReadAndAtomicMigrationPreserveDraftIntentAndCursor() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalConversationStore(directory: directory), scope = try localScope(), intent = try localIntent()
    _ = try await store.saveDraft(account: scope, conversationId: "conversation:conversation_A", text: "old draft")
    _ = try await store.persist(intent)
    _ = try await store.transition(intent, expectedRevision: 0, to: .uncertain, errorCode: "NETWORK_UNAVAILABLE")
    try await store.saveHistoryCursor(account: scope, hostId: "host_A", sessionId: "session_A", throughSeq: 20)
    let file = directory.appendingPathComponent(LocalConversationStore.fileName)
    var object = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
    object["schemaVersion"] = 1; object.removeValue(forKey: "conversationLists"); object.removeValue(forKey: "histories")
    let schemaOne = try JSONSerialization.data(withJSONObject: object, options: .sortedKeys)
    try overwriteLocalFixture(schemaOne, at: file)
    let reopened = try LocalConversationStore(directory: directory)
    #expect(try await reopened.loadDrafts(account: scope)["conversation:conversation_A"] == "old draft")
    #expect(try await reopened.command(for: intent)?.state == .uncertain)
    #expect(try await reopened.cachedConversationList(account: scope) == nil)
    #expect(try Data(contentsOf: file) == schemaOne)
    _ = try await reopened.cacheConversationList(account: scope, hostId: "host_A", conversations: [localCacheConversation()])
    let migrated = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
    #expect(migrated["schemaVersion"] as? Int == 2)
    let again = try LocalConversationStore(directory: directory)
    #expect(try await again.loadDrafts(account: scope)["conversation:conversation_A"] == "old draft")
    #expect(try await again.command(for: intent)?.intent.payload == intent.payload)
    #expect(try await again.command(for: intent)?.intent.requestId == intent.requestId)
    #expect(try await again.command(for: intent)?.state == .uncertain)
    #expect(try await again.historyCursor(account: scope, hostId: "host_A", sessionId: "session_A") == 20)
}

@Test func localStoreCacheCursorNeverSkipsRebuildingReceiptAssociations() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalConversationStore(directory: directory), scope = try localScope()
    try await store.saveHistoryCursor(account: scope, hostId: "host_A", sessionId: "session_A", throughSeq: 100)
    _ = try await store.cacheHistory(account: scope, conversationKey: "conversation:conversation_A", hostId: "host_A",
                                    sessionId: "session_A", messages: [localCacheMessage()], observedThroughSeq: 100)
    let reopened = try LocalConversationStore(directory: directory)
    let readHistory = try await reopened.cachedHistory(account: scope, conversationKey: "conversation:conversation_A",
                                                       hostId: "host_A", sessionId: "session_A")
    let history = try #require(readHistory)
    #expect(history.observedThroughSeq == 100)
    #expect(history.rebuildAfterSeq == -1)
    let tracker = try SharedTurnTracker(sessionID: "session_A")
    #expect(tracker.nextSeq == history.rebuildAfterSeq)
}

@Test func localStoreCacheLimitsKeepPreviousMessagesWithoutSilentTruncation() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let limits = LocalConversationStoreLimits(historyCount: 1, historyMessageCount: 1, historyBytes: 1_024)
    let store = try LocalConversationStore(directory: directory, limits: limits), scope = try localScope()
    _ = try await store.cacheHistory(account: scope, conversationKey: "conversation:conversation_A", hostId: "host_A",
                                    sessionId: "session_A", messages: [localCacheMessage(text: "old text")])
    let file = directory.appendingPathComponent(LocalConversationStore.fileName), oldBytes = try Data(contentsOf: file)
    await #expect(throws: LocalConversationStoreFailure.limitExceeded(.historyMessages)) {
        try await store.cacheHistory(account: scope, conversationKey: "conversation:conversation_A", hostId: "host_A", sessionId: "session_A",
                                     messages: [localCacheMessage(), localCacheMessage("host|session_A|8")])
    }
    await #expect(throws: LocalConversationStoreFailure.limitExceeded(.historyBytes)) {
        try await store.cacheHistory(account: scope, conversationKey: "conversation:conversation_A", hostId: "host_A", sessionId: "session_A",
                                     messages: [localCacheMessage(text: String(repeating: "x", count: 2_048))])
    }
    await #expect(throws: LocalConversationStoreFailure.limitExceeded(.historyCount)) {
        try await store.cacheHistory(account: scope, conversationKey: "conversation:conversation_B", hostId: "host_A", sessionId: "session_A",
                                     messages: [localCacheMessage()])
    }
    #expect(try Data(contentsOf: file) == oldBytes)
    #expect(try await store.cachedHistory(account: scope, conversationKey: "conversation:conversation_A", hostId: "host_A", sessionId: "session_A")?.messages[0].text == "old text")
}

@Test func localStoreCacheTotalBudgetAndListCountPreserveOtherOwnerSnapshot() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let limits = LocalConversationStoreLimits(conversationCount: 2, cacheBytes: 1_000)
    let store = try LocalConversationStore(directory: directory, limits: limits), a = try localScope(), b = try localScope("owner_B")
    _ = try await store.cacheConversationList(account: a, hostId: "host_A", conversations: [localCacheConversation(title: "old")])
    let file = directory.appendingPathComponent(LocalConversationStore.fileName), before = try Data(contentsOf: file)
    await #expect(throws: LocalConversationStoreFailure.limitExceeded(.cacheBytes)) {
        try await store.cacheConversationList(account: b, hostId: "host_A", conversations: [localCacheConversation(title: String(repeating: "x", count: 700))])
    }
    await #expect(throws: LocalConversationStoreFailure.limitExceeded(.conversationCount)) {
        try await store.cacheConversationList(account: a, hostId: "host_A", conversations: [localCacheConversation(), localCacheConversation("conversation_B"), localCacheConversation("conversation_C")])
    }
    #expect(try Data(contentsOf: file) == before)
    #expect(try await store.cachedConversationList(account: b) == nil)
}

@Test func localStoreCacheSourceMismatchAndDuplicatesCannotOverwriteValidHistory() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalConversationStore(directory: directory), scope = try localScope()
    _ = try await store.cacheHistory(account: scope, conversationKey: "conversation:conversation_A", hostId: "host_A",
                                    sessionId: "session_A", messages: [localCacheMessage()])
    let file = directory.appendingPathComponent(LocalConversationStore.fileName), before = try Data(contentsOf: file)
    await #expect(throws: LocalConversationStoreFailure.invalidCache) {
        try await store.cacheHistory(account: scope, conversationKey: "conversation:conversation_A", hostId: "host_A", sessionId: "session_A",
                                     messages: [localCacheMessage("host|session_B|7")])
    }
    await #expect(throws: LocalConversationStoreFailure.invalidCache) {
        try await store.cacheHistory(account: scope, conversationKey: "conversation:conversation_A", hostId: "host_A", sessionId: "session_A",
                                     messages: [localCacheMessage(), localCacheMessage()])
    }
    await #expect(throws: LocalConversationStoreFailure.invalidScope) {
        try await store.cacheHistory(account: scope, conversationKey: "session:session_B", hostId: "host_A", sessionId: "session_A", messages: [])
    }
    #expect(try Data(contentsOf: file) == before)
}

@Test func localStoreCacheCorruptionAndFutureSchemaRetainOriginalFile() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalConversationStore(directory: directory), scope = try localScope()
    _ = try await store.cacheHistory(account: scope, conversationKey: "conversation:conversation_A", hostId: "host_A", sessionId: "session_A", messages: [localCacheMessage()])
    let file = directory.appendingPathComponent(LocalConversationStore.fileName), valid = try Data(contentsOf: file)
    var object = try #require(JSONSerialization.jsonObject(with: valid) as? [String: Any])
    var histories = try #require(object["histories"] as? [[String: Any]])
    histories[0]["sessionId"] = "session_B"; object["histories"] = histories
    let corrupt = try JSONSerialization.data(withJSONObject: object); try overwriteLocalFixture(corrupt, at: file)
    #expect(throws: LocalConversationStoreFailure.invalidCache) { try LocalConversationStore(directory: directory) }
    #expect(try Data(contentsOf: file) == corrupt)
    object = try #require(JSONSerialization.jsonObject(with: valid) as? [String: Any]); object["schemaVersion"] = 3
    let future = try JSONSerialization.data(withJSONObject: object); try overwriteLocalFixture(future, at: file)
    #expect(throws: LocalConversationStoreFailure.unsupportedVersion(3)) { try LocalConversationStore(directory: directory) }
    #expect(try Data(contentsOf: file) == future)
}

@Test func localStoreCacheEmptyVerifiedSnapshotKeepsHistoryAndOtherOwner() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalConversationStore(directory: directory), a = try localScope(), b = try localScope("owner_B")
    _ = try await store.cacheConversationList(account: a, hostId: "host_A", conversations: [localCacheConversation()])
    _ = try await store.cacheConversationList(account: b, hostId: "host_A", conversations: [localCacheConversation(title: "B")])
    _ = try await store.cacheHistory(account: a, conversationKey: "conversation:conversation_A", hostId: "host_A", sessionId: "session_A", messages: [localCacheMessage()])
    _ = try await store.cacheConversationList(account: a, hostId: "host_B", conversations: [])
    let reopened = try LocalConversationStore(directory: directory)
    #expect(try await reopened.cachedConversationList(account: a)?.conversations.isEmpty == true)
    #expect(try await reopened.cachedConversationList(account: a)?.hostId == "host_B")
    #expect(try await reopened.cachedConversationList(account: b)?.conversations[0].title == "B")
    #expect(try await reopened.cachedHistory(account: a, conversationKey: "conversation:conversation_A", hostId: "host_A", sessionId: "session_A")?.messages.count == 1)
}

@Test func localStoreCacheConcurrentSnapshotAndDraftDoNotEraseIntentOrEachOther() async throws {
    let directory = localTestDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let first = try LocalConversationStore(directory: directory), second = try LocalConversationStore(directory: directory)
    let scope = try localScope(), intent = try localIntent()
    _ = try await first.persist(intent)
    async let cached = first.cacheConversationList(account: scope, hostId: "host_A", conversations: [localCacheConversation()])
    async let drafted = second.saveDraft(account: scope, conversationId: "conversation:conversation_A", text: "still editing")
    _ = try await (cached, drafted)
    let reopened = try LocalConversationStore(directory: directory)
    #expect(try await reopened.cachedConversationList(account: scope)?.conversations.count == 1)
    #expect(try await reopened.loadDrafts(account: scope)["conversation:conversation_A"] == "still editing")
    #expect(try await reopened.command(for: intent)?.intent.payload == intent.payload)
}
