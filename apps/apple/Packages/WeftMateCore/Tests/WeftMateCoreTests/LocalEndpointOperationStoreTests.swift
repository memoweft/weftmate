import Foundation
import Testing
@testable import WeftMateCore

private func endpointDirectory() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("weftmate-endpoint-" + UUID().uuidString, isDirectory: true)
}
private func endpointIntent(_ request: String = "adopt.request_A", owner: String = "owner_A", host: String = "host_A",
                            conversation: String = "conversation_A", profile: String = "profile_A", sequence: Int = 10,
                            origin: String = "https://unit.weftmate.example:8443") throws -> SharedAdoptionIntent {
    let session = AccountSession(server: try ServerConfiguration(input: origin),
        account: .init(ownerId: owner, username: "fixture", displayName: "Fixture", profileRevision: 0),
        device: .init(id: "device_A", name: "Test Mac", current: true), hostId: host, verification: .verified)
    return try SharedAdoptionIntent(session: session, conversationID: conversation, requestID: request,
                                    modelProfileID: profile, expectedSyncSeq: sequence)
}
private func endpointReceipt(_ intent: SharedAdoptionIntent, state: SharedCommandState = .pending,
                             commandId: String = "command_A", sessionId: String = "session_A", revision: Int = 1,
                             rejectedWithoutBinding: Bool = false) throws -> SharedAdoptionReceipt {
    let command = SharedCommandReceipt(commandId: commandId, requestId: intent.requestId, kind: .create,
        targetDeviceId: intent.hostId, state: state, sessionId: sessionId, conversationId: intent.conversationId,
        sourceSyncEventId: nil, receiptId: nil, errorCode: state == .rejected ? "MODEL_UNAVAILABLE" : nil)
    let binding: SharedConversationBinding? = rejectedWithoutBinding ? nil : .init(conversationId: intent.conversationId,
        sessionId: sessionId, modelProfileId: intent.modelProfileId, revision: revision, cutoverSyncSeq: intent.expectedSyncSeq,
        contextHash: String(repeating: "a", count: 64), historyMessageCount: 1, truncated: false,
        omittedImages: 0, adoptCommandId: commandId)
    let projection = SharedConversationProjection(source: "host", conversationId: intent.conversationId,
        hostId: intent.hostId, syncThroughSeq: intent.expectedSyncSeq, originalModel: nil,
        status: rejectedWithoutBinding ? .unbound : .creating, canAdopt: rejectedWithoutBinding,
        reasonCode: nil, binding: binding, adoptedMessages: nil)
    return try SharedAdoptionReceipt(command: command, projection: projection, intent: intent)
}
private func endpointOverwrite(_ bytes: Data, file: URL) throws {
    try bytes.write(to: file); try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
}

@Test func endpointStoreUnknownReopenRetainsTypedEndpointAndExactBody() async throws {
    let directory = endpointDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalEndpointOperationStore(directory: directory), intent = try endpointIntent()
    let prepared = try await store.persist(intent)
    let unknown = try await store.markUncertain(intent, expectedRevision: prepared.revision, errorCode: "NETWORK_UNAVAILABLE")
    let reopened = try LocalEndpointOperationStore(directory: directory)
    let restored = try await reopened.persist(intent)
    #expect(restored.endpoint == .sharedAdoption && restored.state == .uncertain)
    #expect(restored.intent.payload == intent.payload && restored.intent.requestId == intent.requestId)
    #expect(restored.revision == unknown.revision && restored.payloadSHA256 == prepared.payloadSHA256)
    let body = try #require(JSONSerialization.jsonObject(with: restored.intent.payload) as? [String: Any])
    #expect(Set(body.keys) == ["requestId", "modelProfileId", "expectedSyncSeq"])
    #expect(body["kind"] == nil && body["targetDeviceId"] == nil && body["cookie"] == nil)
}

@Test func endpointStoreIdentityIncludesConversationAndHostOutsidePayload() async throws {
    let directory = endpointDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalEndpointOperationStore(directory: directory), original = try endpointIntent()
    _ = try await store.persist(original)
    let otherConversation = try endpointIntent(conversation: "conversation_B")
    let otherHost = try endpointIntent(host: "host_B")
    #expect(original.payload == otherConversation.payload && original.payload == otherHost.payload)
    for conflict in [otherConversation, otherHost, try endpointIntent(profile: "profile_B"), try endpointIntent(sequence: 11)] {
        await #expect(throws: LocalEndpointOperationFailure.intentConflict) { try await store.persist(conflict) }
    }
    #expect(try await store.operation(for: original)?.intent == original)
}

@Test func endpointStoreOwnerAndOriginNeverCrossReadSameRequest() async throws {
    let directory = endpointDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalEndpointOperationStore(directory: directory)
    let a = try endpointIntent(), b = try endpointIntent(owner: "owner_B"), other = try endpointIntent(origin: "https://other.example")
    _ = try await store.persist(a); _ = try await store.persist(b); _ = try await store.persist(other)
    let aScope = try LocalAccountScope(server: a.server, ownerId: a.ownerId)
    let bScope = try LocalAccountScope(server: b.server, ownerId: b.ownerId)
    let otherScope = try LocalAccountScope(server: other.server, ownerId: other.ownerId)
    #expect(try await store.operations(account: aScope).map(\.intent.ownerId) == ["owner_A"])
    #expect(try await store.operations(account: bScope).map(\.intent.ownerId) == ["owner_B"])
    #expect(try await store.operations(account: otherScope).count == 1)
}

@Test func endpointStoreUnknownKeepsKnownBindingAndRejectCommandOnlyDoesNotProveCurrentProfile() async throws {
    let directory = endpointDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalEndpointOperationStore(directory: directory), intent = try endpointIntent()
    _ = try await store.persist(intent)
    let pending = try await store.recordReceipt(endpointReceipt(intent), for: intent, expectedRevision: 0)
    let unknown = try await store.markUncertain(intent, expectedRevision: pending.revision, errorCode: "NETWORK_UNAVAILABLE")
    #expect(unknown.knownCommandId == "command_A" && unknown.knownSessionId == "session_A" && unknown.knownBindingRevision == 1)
    let reopened = try LocalEndpointOperationStore(directory: directory)
    let rejected = try await reopened.recordReceipt(endpointReceipt(intent, state: .rejected, rejectedWithoutBinding: true),
                                                    for: intent, expectedRevision: unknown.revision)
    #expect(rejected.state == .rejected && rejected.validationLevel == .rejectedCommandOnly)
    #expect(rejected.lastReceiptBindingMatched == false && rejected.receipt?.bindingRevision == nil)
    #expect(rejected.knownCommandId == "command_A" && rejected.knownSessionId == "session_A" && rejected.knownBindingRevision == 1)
    let again = try await LocalEndpointOperationStore(directory: directory).operation(for: intent)
    #expect(again?.knownBindingRevision == 1 && again?.lastReceiptBindingMatched == false)
}

@Test func endpointStoreImmutableCommandSessionAndBindingRevisionRejectRebinding() async throws {
    let directory = endpointDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalEndpointOperationStore(directory: directory), intent = try endpointIntent()
    _ = try await store.persist(intent)
    let known = try await store.recordReceipt(endpointReceipt(intent), for: intent, expectedRevision: 0)
    await #expect(throws: LocalEndpointOperationFailure.immutableAcknowledgement) {
        try await store.recordReceipt(endpointReceipt(intent, commandId: "command_B"), for: intent, expectedRevision: known.revision)
    }
    await #expect(throws: LocalEndpointOperationFailure.immutableAcknowledgement) {
        try await store.recordReceipt(endpointReceipt(intent, sessionId: "session_B"), for: intent, expectedRevision: known.revision)
    }
    await #expect(throws: LocalEndpointOperationFailure.invalidReceipt) {
        try await store.recordReceipt(endpointReceipt(intent, revision: 2), for: intent, expectedRevision: known.revision)
    }
    let unchanged = try await store.operation(for: intent)
    #expect(unchanged?.knownCommandId == "command_A" && unchanged?.knownSessionId == "session_A" && unchanged?.knownBindingRevision == 1)
}

@Test func endpointStoreCASAndTypedAcceptedRejectionAreDistinctFromTransportFailure() async throws {
    let directory = endpointDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalEndpointOperationStore(directory: directory), intent = try endpointIntent()
    _ = try await store.persist(intent)
    let accepted = try await store.recordReceipt(endpointReceipt(intent, state: .acceptedByDSH), for: intent, expectedRevision: 0)
    await #expect(throws: LocalEndpointOperationFailure.staleRevision) { try await store.markUncertain(intent, expectedRevision: 0) }
    await #expect(throws: LocalEndpointOperationFailure.invalidTransition) { try await store.markUncertain(intent, expectedRevision: accepted.revision) }
    await #expect(throws: LocalEndpointOperationFailure.invalidTransition) {
        try await store.markRejected(intent, expectedRevision: accepted.revision, errorCode: "UNAUTHORIZED")
    }
    let rejected = try await store.recordReceipt(endpointReceipt(intent, state: .rejected, rejectedWithoutBinding: true),
                                                for: intent, expectedRevision: accepted.revision)
    #expect(rejected.state == .rejected && rejected.knownBindingRevision == 1)
    await #expect(throws: LocalEndpointOperationFailure.invalidTransition) {
        try await store.recordReceipt(endpointReceipt(intent, state: .acceptedByDSH), for: intent, expectedRevision: rejected.revision)
    }
}

@Test func endpointStoreDefinitePreRegistrationRejectionPersistsWithoutNewID() async throws {
    let directory = endpointDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalEndpointOperationStore(directory: directory), intent = try endpointIntent()
    _ = try await store.persist(intent)
    let rejected = try await store.markRejected(intent, expectedRevision: 0, errorCode: "INVALID_REQUEST")
    let reopened = try LocalEndpointOperationStore(directory: directory)
    #expect(try await reopened.persist(intent).state == .rejected)
    #expect(try await reopened.operation(for: intent)?.intent.requestId == intent.requestId)
    await #expect(throws: LocalEndpointOperationFailure.invalidTransition) { try await reopened.markUncertain(intent, expectedRevision: rejected.revision) }
}

@Test func endpointStoreUnknownKindCorruptHashAndFutureSchemaRetainFile() async throws {
    let directory = endpointDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalEndpointOperationStore(directory: directory), intent = try endpointIntent()
    _ = try await store.persist(intent)
    let file = directory.appendingPathComponent(LocalEndpointOperationStore.fileName), original = try Data(contentsOf: file)
    for change in ["unknownKind", "hash", "future"] {
        var object = try #require(JSONSerialization.jsonObject(with: original) as? [String: Any])
        var rows = try #require(object["records"] as? [[String: Any]])
        if change == "unknownKind" { rows[0]["endpoint"] = "arbitraryURL"; object["records"] = rows }
        if change == "hash" { rows[0]["payloadSHA256"] = String(repeating: "0", count: 64); object["records"] = rows }
        if change == "future" { object["schemaVersion"] = 99 }
        let malformed = try JSONSerialization.data(withJSONObject: object); try endpointOverwrite(malformed, file: file)
        if change == "future" {
            #expect(throws: LocalEndpointOperationFailure.unsupportedVersion(99)) { try LocalEndpointOperationStore(directory: directory) }
        } else {
            #expect(throws: LocalEndpointOperationFailure.corruptFile) { try LocalEndpointOperationStore(directory: directory) }
        }
        #expect(try Data(contentsOf: file) == malformed)
    }
}

@Test func endpointStoreLimitsFailBeforeReplacingKnownIntent() async throws {
    let directory = endpointDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let original = try LocalEndpointOperationStore(directory: directory), intent = try endpointIntent()
    _ = try await original.persist(intent)
    let file = directory.appendingPathComponent(LocalEndpointOperationStore.fileName), old = try Data(contentsOf: file)
    let limited = try LocalEndpointOperationStore(directory: directory, limits: .init(recordCount: 1, fileBytes: old.count + 1))
    await #expect(throws: LocalEndpointOperationFailure.recordLimit) { try await limited.persist(endpointIntent("adopt.request_B")) }
    await #expect(throws: LocalEndpointOperationFailure.fileLimit) {
        try await limited.recordReceipt(endpointReceipt(intent), for: intent, expectedRevision: 0)
    }
    #expect(try Data(contentsOf: file) == old)
    let tinyDirectory = endpointDirectory(); defer { try? FileManager.default.removeItem(at: tinyDirectory) }
    let tiny = try LocalEndpointOperationStore(directory: tinyDirectory, limits: .init(payloadBytes: 1))
    await #expect(throws: LocalEndpointOperationFailure.payloadLimit) { try await tiny.persist(intent) }
}

@Test func endpointStorePermissionsAndSymlinkNeverModifyOutsideTarget() async throws {
    let directory = endpointDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalEndpointOperationStore(directory: directory)
    _ = try await store.persist(endpointIntent())
    let file = directory.appendingPathComponent(LocalEndpointOperationStore.fileName)
    let attrs = try FileManager.default.attributesOfItem(atPath: file.path)
    #expect((attrs[.posixPermissions] as? NSNumber)?.intValue == 0o600)
    let other = directory.appendingPathComponent("owned-target.json"), original = Data("preserve target".utf8)
    try endpointOverwrite(original, file: other); try FileManager.default.removeItem(at: file)
    try FileManager.default.createSymbolicLink(at: file, withDestinationURL: other)
    #expect(throws: LocalEndpointOperationFailure.unsafeFile) { try LocalEndpointOperationStore(directory: directory) }
    #expect(try Data(contentsOf: other) == original)
}

@Test func endpointStoreTwoActorsKeepIndependentRequests() async throws {
    let directory = endpointDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let first = try LocalEndpointOperationStore(directory: directory), second = try LocalEndpointOperationStore(directory: directory)
    try await withThrowingTaskGroup(of: Void.self) { group in
        for number in 0..<12 {
            let intent = try endpointIntent("adopt.\(number)")
            group.addTask { _ = try await (number.isMultiple(of: 2) ? first : second).persist(intent) }
        }
        try await group.waitForAll()
    }
    let intent = try endpointIntent(), scope = try LocalAccountScope(server: intent.server, ownerId: intent.ownerId)
    #expect(try await LocalEndpointOperationStore(directory: directory).operations(account: scope).count == 12)
}

@Test func endpointStoreSidecarDoesNotRewriteSchemaTwoCacheOrDraftFile() async throws {
    let directory = endpointDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let cache = try LocalConversationStore(directory: directory), intent = try endpointIntent()
    let scope = try LocalAccountScope(server: intent.server, ownerId: intent.ownerId)
    _ = try await cache.saveDraft(account: scope, conversationId: "conversation:conversation_A", text: "still editing")
    let file = directory.appendingPathComponent(LocalConversationStore.fileName), original = try Data(contentsOf: file)
    let sidecar = try LocalEndpointOperationStore(directory: directory)
    _ = try await sidecar.persist(intent)
    _ = try await sidecar.markUncertain(intent, expectedRevision: 0)
    #expect(try Data(contentsOf: file) == original)
    #expect(try await cache.loadDrafts(account: scope)["conversation:conversation_A"] == "still editing")
    let object = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent(LocalEndpointOperationStore.fileName))) as? [String: Any])
    #expect(object["schemaVersion"] as? Int == 1)
}
