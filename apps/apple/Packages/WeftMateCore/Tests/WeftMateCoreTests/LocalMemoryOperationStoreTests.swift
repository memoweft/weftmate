import Foundation
import Testing
@testable import WeftMateCore

private func memoryJournalDirectory() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("weftmate-memory-journal-" + UUID().uuidString, isDirectory: true)
}
private func memoryJournalSession(owner: String = "owner_A", host: String = "host_A",
                                  origin: String = "https://unit.weftmate.example:8443") throws -> AccountSession {
    .init(server: try ServerConfiguration(input: origin),
          account: .init(ownerId: owner, username: "fixture", displayName: "Fixture", profileRevision: 0),
          device: .init(id: "device_A", name: "Fixture Mac", current: true), hostId: host, verification: .verified)
}
private func memoryJournalIntent(_ request: String = "memory.request_A", owner: String = "owner_A", host: String = "host_A",
                                 origin: String = "https://unit.weftmate.example:8443", operation: MemoryMutationKind = .correct,
                                 kind: MemoryKind? = .cognition, target: String = "memory:item_A", world: Int = 5,
                                 correction: String? = nil) throws -> MemoryMutationIntent {
    try MemoryMutationIntent(session: memoryJournalSession(owner: owner, host: host, origin: origin), operation: operation,
        itemKind: kind, targetID: target, requestID: request, expectedWorldRevision: world,
        correction: operation == .correct ? correction ?? "Corrected fixture" : correction)
}
private func memoryJournalReceipt(_ intent: MemoryMutationIntent, command: String = "memory_command_A",
                                  state: MemoryMutationState = .applied, world: Int = 6,
                                  cleanup: MemoryStorageCleanup? = nil) -> MemoryMutationReceipt {
    .init(commandId: command, requestId: intent.requestId, state: state, worldRevision: world,
          reasonCode: state == .revisionConflict ? "MEMORY_REVISION_CHANGED" : state == .rejected ? "INVALID_REQUEST" : nil,
          storageCleanup: cleanup)
}
private let journalPending = MemoryStorageCleanup(state: .pending, detailCode: "wal_reader_busy")
private let journalComplete = MemoryStorageCleanup(state: .complete, detailCode: "current_wal_truncated")
private func memoryJournalOverwrite(_ data: Data, file: URL) throws {
    try data.write(to: file); try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
}

@Test func memoryJournalUnknownReopenKeepsTypedBodyTargetAndWorldRevision() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory), intent = try memoryJournalIntent()
    _ = try await store.persist(intent)
    let unknown = try await store.markUncertain(intent, expectedRevision: 0, errorCode: "NETWORK_UNAVAILABLE")
    let reopened = try LocalMemoryOperationStore(directory: directory)
    let record = try await reopened.persist(intent)
    #expect(record.state == .uncertain && record.revision == unknown.revision)
    #expect(record.intent?.payload == intent.payload && record.intent?.requestId == intent.requestId)
    #expect(record.intent?.targetId == "memory:item_A" && record.intent?.itemKind == .cognition)
    #expect(record.intent?.expectedWorldRevision == 5 && record.intent?.correction == "Corrected fixture")
    #expect(record.effectApplied == false && record.serverStorageCleanupConfirmedComplete == false)
    let object = try #require(JSONSerialization.jsonObject(with: intent.payload) as? [String: Any])
    #expect(Set(object.keys) == ["requestId", "expectedWorldRevision", "text"])
    #expect(object["cookie"] == nil && object["modelKey"] == nil)
}

@Test func memoryJournalSameBodyDifferentOperationTargetKindOrHostCannotReuseRequest() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory), original = try memoryJournalIntent(operation: .mute)
    _ = try await store.persist(original)
    let target = try memoryJournalIntent(operation: .mute, target: "memory:item_B")
    let host = try memoryJournalIntent(host: "host_B", operation: .mute)
    let kind = try memoryJournalIntent(operation: .mute, kind: .event)
    let deletion = try memoryJournalIntent(operation: .deleteItem)
    let evidence = try memoryJournalIntent(operation: .deleteEvidence, kind: nil)
    #expect([target, host, kind, deletion, evidence].allSatisfy { $0.payload == original.payload })
    for changed in [target, host, kind, deletion, evidence, try memoryJournalIntent(operation: .mute, world: 7)] {
        await #expect(throws: LocalMemoryOperationFailure.intentConflict) { try await store.persist(changed) }
    }
    #expect(try await store.operation(for: original)?.intent == original)
}

@Test func memoryJournalOwnerAndOriginIsolationForSameRequest() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory)
    let a = try memoryJournalIntent(), b = try memoryJournalIntent(owner: "owner_B"), other = try memoryJournalIntent(origin: "https://other.example")
    _ = try await store.persist(a); _ = try await store.persist(b); _ = try await store.persist(other)
    let aScope = try LocalAccountScope(server: a.server, ownerId: a.ownerId), bScope = try LocalAccountScope(server: b.server, ownerId: b.ownerId)
    let otherScope = try LocalAccountScope(server: other.server, ownerId: other.ownerId)
    #expect(try await store.operations(account: aScope).map(\.intent?.ownerId) == ["owner_A"])
    #expect(try await store.operations(account: bScope).map(\.intent?.ownerId) == ["owner_B"])
    #expect(try await store.operations(account: otherScope).count == 1)
}

@Test func memoryJournalRevisionConflictNeverSubstitutesNewIdOrExpectedRevision() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory), intent = try memoryJournalIntent()
    _ = try await store.persist(intent)
    let conflict = try await store.recordReceipt(memoryJournalReceipt(intent, state: .revisionConflict, world: 8), for: intent, expectedRevision: 0)
    #expect(conflict.state == .revisionConflict && !conflict.effectApplied)
    let reopened = try LocalMemoryOperationStore(directory: directory)
    let restored = try await reopened.persist(intent)
    #expect(restored.state == .revisionConflict && restored.intent?.requestId == intent.requestId)
    #expect(restored.intent?.expectedWorldRevision == 5 && restored.intent?.payload == intent.payload)
    await #expect(throws: LocalMemoryOperationFailure.intentConflict) { try await reopened.persist(memoryJournalIntent(world: 8)) }
    await #expect(throws: LocalMemoryOperationFailure.invalidReceipt) {
        try await reopened.recordReceipt(memoryJournalReceipt(intent, state: .applied, world: 8), for: intent, expectedRevision: restored.revision)
    }
}

@Test func memoryJournalKnownReceiptCommandStateAndWorldCannotChange() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory), intent = try memoryJournalIntent()
    _ = try await store.persist(intent)
    let known = try await store.recordReceipt(memoryJournalReceipt(intent), for: intent, expectedRevision: 0)
    for wrong in [memoryJournalReceipt(intent, command: "memory_command_B"), memoryJournalReceipt(intent, state: .noChange),
                  memoryJournalReceipt(intent, world: 7)] {
        await #expect(throws: LocalMemoryOperationFailure.invalidReceipt) { try await store.recordReceipt(wrong, for: intent, expectedRevision: known.revision) }
    }
    #expect(try await store.operation(for: intent)?.receipt == known.receipt)
}

@Test func memoryJournalStaleErrorCannotEraseAppliedResult() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory), intent = try memoryJournalIntent()
    _ = try await store.persist(intent)
    let known = try await store.recordReceipt(memoryJournalReceipt(intent), for: intent, expectedRevision: 0)
    await #expect(throws: LocalMemoryOperationFailure.staleRevision) { try await store.markUncertain(intent, expectedRevision: 0) }
    await #expect(throws: LocalMemoryOperationFailure.invalidTransition) { try await store.markUncertain(intent, expectedRevision: known.revision) }
    #expect(try await store.operation(for: intent)?.state == .applied)
}

@Test func memoryJournalDeletionPendingIsNotServerCleanupComplete() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory), intent = try memoryJournalIntent(operation: .deleteItem)
    _ = try await store.persist(intent)
    let result = try await store.recordReceipt(memoryJournalReceipt(intent, cleanup: journalPending), for: intent, expectedRevision: 0)
    #expect(result.effectApplied && result.cleanupPending && !result.serverStorageCleanupConfirmedComplete)
    #expect(result.cleanupRetry == nil)
    let reopened = try await LocalMemoryOperationStore(directory: directory).operation(for: intent)
    #expect(reopened?.state == .applied && reopened?.cleanupPending == true)
    #expect(reopened?.serverStorageCleanupConfirmedComplete == false)
}

@Test func memoryJournalCleanupUnknownReopenMustLookupBeforeAnotherExplicitRetry() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory), intent = try memoryJournalIntent(operation: .deleteEvidence, kind: nil, target: "evidence_A")
    _ = try await store.persist(intent)
    let applied = try await store.recordReceipt(memoryJournalReceipt(intent, cleanup: journalPending), for: intent, expectedRevision: 0)
    let prepared = try await store.prepareCleanupRetry(for: intent, expectedRevision: applied.revision)
    #expect(prepared.cleanupRetry?.state == .prepared && prepared.cleanupRetry?.payload == Data("{}".utf8))
    #expect(prepared.cleanupRetry?.attempts == 1 && prepared.intent?.payload == intent.payload)
    let unknown = try await store.markCleanupUncertain(for: intent, expectedRevision: prepared.revision, errorCode: "NETWORK_UNAVAILABLE")
    let reopened = try LocalMemoryOperationStore(directory: directory)
    await #expect(throws: LocalMemoryOperationFailure.invalidTransition) { try await reopened.prepareCleanupRetry(for: intent, expectedRevision: unknown.revision) }
    #expect(try await reopened.persist(intent).cleanupRetry?.state == .uncertain)
    let checked = try await reopened.recordReceipt(memoryJournalReceipt(intent, cleanup: journalPending), for: intent, expectedRevision: unknown.revision)
    #expect(checked.cleanupRetry?.state == .pending && checked.cleanupRetry?.attempts == 1)
    let explicit = try await reopened.prepareCleanupRetry(for: intent, expectedRevision: checked.revision)
    #expect(explicit.cleanupRetry?.state == .prepared && explicit.cleanupRetry?.attempts == 2)
    #expect(explicit.intent?.requestId == intent.requestId && explicit.intent?.payload == intent.payload)
}

@Test func memoryJournalCleanupCompletePreservesPrimaryOutcomeAndKnownWorld() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory), intent = try memoryJournalIntent(operation: .deleteItem)
    _ = try await store.persist(intent)
    let pending = try await store.recordReceipt(memoryJournalReceipt(intent, cleanup: journalPending), for: intent, expectedRevision: 0)
    let retry = try await store.prepareCleanupRetry(for: intent, expectedRevision: pending.revision)
    let complete = try await store.recordReceipt(memoryJournalReceipt(intent, cleanup: journalComplete), for: intent, expectedRevision: retry.revision)
    #expect(complete.state == .applied && complete.cleanupRetry?.state == .complete)
    #expect(complete.effectApplied && complete.serverStorageCleanupConfirmedComplete && !complete.cleanupPending)
    #expect(complete.receipt?.worldRevision == pending.receipt?.worldRevision && complete.receipt?.commandId == pending.receipt?.commandId)
    #expect(try await LocalMemoryOperationStore(directory: directory).operation(for: intent)?.serverStorageCleanupConfirmedComplete == true)
    await #expect(throws: LocalMemoryOperationFailure.invalidTransition) { try await store.prepareCleanupRetry(for: intent, expectedRevision: complete.revision) }
}

@Test func memoryJournalCleanupProofCannotDisappearRegressOrUseBusyAsComplete() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory), intent = try memoryJournalIntent(operation: .deleteItem)
    _ = try await store.persist(intent)
    let complete = try await store.recordReceipt(memoryJournalReceipt(intent, cleanup: journalComplete), for: intent, expectedRevision: 0)
    let wrong = [memoryJournalReceipt(intent, cleanup: journalPending), memoryJournalReceipt(intent),
                 memoryJournalReceipt(intent, cleanup: .init(state: .complete, detailCode: "wal_reader_busy"))]
    for receipt in wrong {
        await #expect(throws: LocalMemoryOperationFailure.invalidReceipt) { try await store.recordReceipt(receipt, for: intent, expectedRevision: complete.revision) }
    }
    #expect(try await store.operation(for: intent)?.serverStorageCleanupConfirmedComplete == true)
}

@Test func memoryJournalCleanupRetryRequiresSuccessfulDeletionAndExplicitPending() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory)
    let correct = try memoryJournalIntent(), queuedDelete = try memoryJournalIntent("memory.delete_queued", operation: .deleteItem)
    let conflictDelete = try memoryJournalIntent("memory.delete_conflict", operation: .deleteItem)
    _ = try await store.persist(correct); _ = try await store.persist(queuedDelete); _ = try await store.persist(conflictDelete)
    let appliedCorrect = try await store.recordReceipt(memoryJournalReceipt(correct), for: correct, expectedRevision: 0)
    let conflict = try await store.recordReceipt(memoryJournalReceipt(conflictDelete, state: .revisionConflict, world: 9), for: conflictDelete, expectedRevision: 0)
    await #expect(throws: LocalMemoryOperationFailure.invalidTransition) { try await store.prepareCleanupRetry(for: correct, expectedRevision: appliedCorrect.revision) }
    await #expect(throws: LocalMemoryOperationFailure.invalidTransition) { try await store.prepareCleanupRetry(for: queuedDelete, expectedRevision: 0) }
    await #expect(throws: LocalMemoryOperationFailure.invalidTransition) { try await store.prepareCleanupRetry(for: conflictDelete, expectedRevision: conflict.revision) }
}

@Test func memoryJournalNoChangeDoesNotInferCleanupFromMissingField() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory), intent = try memoryJournalIntent(operation: .deleteItem)
    _ = try await store.persist(intent)
    let unchanged = try await store.recordReceipt(memoryJournalReceipt(intent, state: .noChange), for: intent, expectedRevision: 0)
    #expect(unchanged.effectApplied && unchanged.state == .noChange)
    #expect(!unchanged.cleanupPending && !unchanged.serverStorageCleanupConfirmedComplete)
    await #expect(throws: LocalMemoryOperationFailure.invalidTransition) { try await store.prepareCleanupRetry(for: intent, expectedRevision: unchanged.revision) }
}

@Test func memoryJournalMalformedBodyUnknownOperationAndSchemaKeepOriginalBytes() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory), intent = try memoryJournalIntent()
    _ = try await store.persist(intent)
    let file = directory.appendingPathComponent(LocalMemoryOperationStore.fileName), original = try Data(contentsOf: file)
    for change in ["hash", "operation", "version"] {
        var object = try #require(JSONSerialization.jsonObject(with: original) as? [String: Any])
        var records = try #require(object["records"] as? [[String: Any]])
        if change == "hash" { records[0]["payloadSHA256"] = String(repeating: "0", count: 64) }
        if change == "operation" { var encodedIntent = try #require(records[0]["intent"] as? [String: Any]); encodedIntent["operation"] = "arbitraryURL"; records[0]["intent"] = encodedIntent }
        object["records"] = records
        if change == "version" { object["schemaVersion"] = 99 }
        let malformed = try JSONSerialization.data(withJSONObject: object); try memoryJournalOverwrite(malformed, file: file)
        if change == "version" {
            #expect(throws: LocalMemoryOperationFailure.unsupportedVersion(99)) { try LocalMemoryOperationStore(directory: directory) }
        } else {
            #expect(throws: LocalMemoryOperationFailure.corruptFile) { try LocalMemoryOperationStore(directory: directory) }
        }
        #expect(try Data(contentsOf: file) == malformed)
    }
}

@Test func memoryJournalRecordPayloadAndFileLimitsLeaveKnownOutcomeIntact() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let original = try LocalMemoryOperationStore(directory: directory), intent = try memoryJournalIntent(operation: .deleteItem)
    _ = try await original.persist(intent)
    let pending = try await original.recordReceipt(memoryJournalReceipt(intent, cleanup: journalPending), for: intent, expectedRevision: 0)
    let file = directory.appendingPathComponent(LocalMemoryOperationStore.fileName), old = try Data(contentsOf: file)
    let limited = try LocalMemoryOperationStore(directory: directory, limits: .init(recordCount: 1, fileBytes: old.count + 1))
    await #expect(throws: LocalMemoryOperationFailure.recordLimit) { try await limited.persist(memoryJournalIntent("memory.another")) }
    await #expect(throws: LocalMemoryOperationFailure.fileLimit) { try await limited.prepareCleanupRetry(for: intent, expectedRevision: pending.revision) }
    #expect(try Data(contentsOf: file) == old)
    let tinyDir = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: tinyDir) }
    let tiny = try LocalMemoryOperationStore(directory: tinyDir, limits: .init(payloadBytes: 1))
    await #expect(throws: LocalMemoryOperationFailure.payloadLimit) { try await tiny.persist(intent) }
}

@Test func memoryJournalTwoActorsKeepDistinctRequestsAndTargets() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let first = try LocalMemoryOperationStore(directory: directory), second = try LocalMemoryOperationStore(directory: directory)
    try await withThrowingTaskGroup(of: Void.self) { group in
        for number in 0..<12 {
            let intent = try memoryJournalIntent("memory.\(number)", operation: .mute, target: "memory:item_\(number)")
            group.addTask { _ = try await (number.isMultiple(of: 2) ? first : second).persist(intent) }
        }
        try await group.waitForAll()
    }
    let intent = try memoryJournalIntent(), scope = try LocalAccountScope(server: intent.server, ownerId: intent.ownerId)
    let records = try await LocalMemoryOperationStore(directory: directory).operations(account: scope)
    #expect(records.count == 12 && Set(records.map(\.intent?.targetId)).count == 12)
}

@Test func memoryJournalDoesNotRewriteAdoptionOrConversationFiles() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let session = try memoryJournalSession(), scope = try LocalAccountScope(server: session.server, ownerId: session.account.ownerId)
    let cache = try LocalConversationStore(directory: directory)
    _ = try await cache.saveDraft(account: scope, conversationId: "conversation:conversation_A", text: "draft")
    let adoption = try LocalEndpointOperationStore(directory: directory)
    let adoptIntent = try SharedAdoptionIntent(session: session, conversationID: "conversation_A", requestID: "adopt_A", modelProfileID: "profile_A", expectedSyncSeq: 10)
    _ = try await adoption.persist(adoptIntent)
    let cacheFile = directory.appendingPathComponent(LocalConversationStore.fileName), adoptionFile = directory.appendingPathComponent(LocalEndpointOperationStore.fileName)
    let cacheBytes = try Data(contentsOf: cacheFile), adoptionBytes = try Data(contentsOf: adoptionFile)
    let journal = try LocalMemoryOperationStore(directory: directory)
    _ = try await journal.persist(memoryJournalIntent())
    let cacheAfter = try Data(contentsOf: cacheFile), adoptionAfter = try Data(contentsOf: adoptionFile)
    #expect(cacheAfter == cacheBytes && adoptionAfter == adoptionBytes)
}

@Test func memoryJournalPrivateFileAndSymlinkTargetProtection() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory)
    _ = try await store.persist(memoryJournalIntent())
    let file = directory.appendingPathComponent(LocalMemoryOperationStore.fileName)
    let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
    #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
    let target = directory.appendingPathComponent("owned-fixture.json"), bytes = Data("preserved".utf8)
    try memoryJournalOverwrite(bytes, file: target); try FileManager.default.removeItem(at: file)
    try FileManager.default.createSymbolicLink(at: file, withDestinationURL: target)
    #expect(throws: LocalMemoryOperationFailure.unsafeFile) { try LocalMemoryOperationStore(directory: directory) }
    #expect(try Data(contentsOf: target) == bytes)
}

@Test func memoryJournalDefiniteSubmissionRejectionReopensWithoutResetOrNewId() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory), intent = try memoryJournalIntent()
    _ = try await store.persist(intent)
    let rejected = try await store.markRejected(intent, expectedRevision: 0, errorCode: "INVALID_REQUEST")
    let reopened = try LocalMemoryOperationStore(directory: directory)
    let restored = try await reopened.persist(intent)
    #expect(restored.state == .rejected && restored.revision == rejected.revision)
    #expect(restored.intent?.requestId == intent.requestId && restored.intent?.payload == intent.payload)
    await #expect(throws: LocalMemoryOperationFailure.invalidTransition) { try await reopened.markUncertain(intent, expectedRevision: rejected.revision) }
}

private func registerJournalServiceProof(_ store: LocalMemoryOperationStore, _ intent: MemoryMutationIntent,
                                        state: MemoryMutationState = .applied, world: Int = 6) async throws -> LocalMemoryOperationRecord {
    _ = try await store.persist(intent)
    return try await store.recordReceipt(memoryJournalReceipt(intent, state: state, world: world), for: intent, expectedRevision: 0)
}

@Test func memoryJournalRedactionTombstoneRemovesUniqueBodyAndHashButPreservesIdentityProof() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory)
    let unique = "ERASE_CORRECTION_" + UUID().uuidString
    let correction = try memoryJournalIntent(correction: unique)
    let before = try await registerJournalServiceProof(store, correction)
    let deletion = try memoryJournalIntent("memory.delete_A", operation: .deleteItem, world: 6)
    let provedDelete = try await registerJournalServiceProof(store, deletion, world: 7)
    let result = try await store.redactCorrections(deletedBy: deletion, expectedRevision: provedDelete.revision)
    #expect(result.disposition == .complete && result.redactedRequestIds == [correction.requestId])
    #expect(result.currentJournalScopeComplete && result.proofs.count == 1)
    let record = try await store.operation(for: correction)
    let tombstone = try #require(record)
    #expect(tombstone.isRedacted && !tombstone.bodyAvailable && tombstone.intent == nil && tombstone.payloadSHA256 == nil)
    #expect(tombstone.identity.requestId == correction.requestId && tombstone.identity.targetId == correction.targetId)
    #expect(tombstone.receipt == before.receipt && tombstone.state == before.state)
    let file = directory.appendingPathComponent(LocalMemoryOperationStore.fileName)
    let bytes = try Data(contentsOf: file), text = String(decoding: bytes, as: UTF8.self)
    let oldHash = try #require(before.payloadSHA256)
    #expect(!text.contains(unique))
    #expect(!text.contains(oldHash))
    let encodedProof = try JSONEncoder().encode(result.proofs)
    #expect(!String(decoding: encodedProof, as: UTF8.self).contains(unique))
    #expect(try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as? NSNumber == NSNumber(value: 0o600))
}

@Test func memoryJournalRedactionReopenRejectsPersistMutatorsAndAnyReplacementBody() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory), correction = try memoryJournalIntent()
    _ = try await registerJournalServiceProof(store, correction)
    let deletion = try memoryJournalIntent("memory.delete_A", operation: .deleteItem, world: 6)
    let provedDelete = try await registerJournalServiceProof(store, deletion, world: 7)
    _ = try await store.redactCorrections(deletedBy: deletion, expectedRevision: provedDelete.revision)
    let reopened = try LocalMemoryOperationStore(directory: directory)
    let record = try await reopened.operation(for: correction)
    let tombstone = try #require(record)
    #expect(tombstone.redactionProof != nil && tombstone.intent == nil)
    await #expect(throws: LocalMemoryOperationFailure.redactedRequest) { try await reopened.persist(correction) }
    await #expect(throws: LocalMemoryOperationFailure.redactedRequest) { try await reopened.persist(memoryJournalIntent(correction: "replacement")) }
    await #expect(throws: LocalMemoryOperationFailure.redactedRequest) {
        try await reopened.recordReceipt(memoryJournalReceipt(correction), for: correction, expectedRevision: tombstone.revision)
    }
    await #expect(throws: LocalMemoryOperationFailure.redactedRequest) { try await reopened.markUncertain(correction, expectedRevision: tombstone.revision) }
}

@Test func memoryJournalRedactionIncludesServiceConflictAndRejectionTerminalProof() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory)
    let conflict = try memoryJournalIntent("memory.conflict", correction: "private conflict correction")
    let rejected = try memoryJournalIntent("memory.rejected", correction: "private rejected correction")
    _ = try await registerJournalServiceProof(store, conflict, state: .revisionConflict, world: 8)
    _ = try await registerJournalServiceProof(store, rejected, state: .rejected, world: 8)
    let deletion = try memoryJournalIntent("memory.delete_A", operation: .deleteItem, world: 8)
    let proof = try await registerJournalServiceProof(store, deletion, state: .noChange, world: 9)
    let result = try await store.redactCorrections(deletedBy: deletion, expectedRevision: proof.revision)
    #expect(Set(result.redactedRequestIds) == [conflict.requestId, rejected.requestId])
    #expect(try await store.operation(for: conflict)?.state == .revisionConflict)
    #expect(try await store.operation(for: rejected)?.state == .rejected)
    #expect(try await store.operation(for: conflict)?.isRedacted == true)
}

@Test func memoryJournalRedactionReportsQueuedUnknownAndHttpOnlyRejectionWithoutTouchingBytes() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory)
    let queued = try memoryJournalIntent("memory.queued", correction: "queued unique text")
    let unknown = try memoryJournalIntent("memory.unknown", correction: "unknown unique text")
    let localRejected = try memoryJournalIntent("memory.http_rejected", correction: "http-only unique text")
    for intent in [queued, unknown, localRejected] { _ = try await store.persist(intent) }
    _ = try await store.markUncertain(unknown, expectedRevision: 0)
    _ = try await store.markRejected(localRejected, expectedRevision: 0, errorCode: "INVALID_REQUEST")
    let deletion = try memoryJournalIntent("memory.delete_A", operation: .deleteItem, world: 6)
    let deleteProof = try await registerJournalServiceProof(store, deletion, world: 7)
    let file = directory.appendingPathComponent(LocalMemoryOperationStore.fileName), before = try Data(contentsOf: file)
    let result = try await store.redactCorrections(deletedBy: deletion, expectedRevision: deleteProof.revision)
    #expect(result.disposition == .pending && Set(result.pendingRequestIds) == [queued.requestId, unknown.requestId, localRejected.requestId])
    #expect(result.redactedRequestIds.isEmpty && result.currentJournalScopeComplete == false)
    #expect(try Data(contentsOf: file) == before)
    for intent in [queued, unknown, localRejected] { #expect(try await store.operation(for: intent)?.intent?.payload == intent.payload) }
}

@Test func memoryJournalRedactionScopeAndNewerWorldStayIntact() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory)
    let eligible = try memoryJournalIntent("memory.eligible", correction: "eligible text")
    _ = try await registerJournalServiceProof(store, eligible)
    let others = [try memoryJournalIntent("memory.owner_B", owner: "owner_B"),
                  try memoryJournalIntent("memory.host_B", host: "host_B"),
                  try memoryJournalIntent("memory.server_B", origin: "https://other.example"),
                  try memoryJournalIntent("memory.target_B", target: "memory:item_B"),
                  try memoryJournalIntent("memory.kind_B", kind: .event)]
    for intent in others { _ = try await registerJournalServiceProof(store, intent) }
    let newerResult = try memoryJournalIntent("memory.newer_receipt", world: 5)
    let newerExpected = try memoryJournalIntent("memory.newer_expected", world: 20)
    _ = try await registerJournalServiceProof(store, newerResult, state: .revisionConflict, world: 20)
    _ = try await registerJournalServiceProof(store, newerExpected, state: .rejected, world: 6)
    let deletion = try memoryJournalIntent("memory.delete_A", operation: .deleteItem, world: 6)
    let deleteProof = try await registerJournalServiceProof(store, deletion, world: 7)
    let result = try await store.redactCorrections(deletedBy: deletion, expectedRevision: deleteProof.revision)
    #expect(result.redactedRequestIds == [eligible.requestId])
    #expect(Set(result.retainedNewerRequestIds) == [newerResult.requestId, newerExpected.requestId])
    for intent in others + [newerResult, newerExpected] {
        #expect(try await store.operation(for: intent)?.intent?.payload == intent.payload)
    }
}

@Test func memoryJournalRedactionEvidenceAndUnprovedDeletionAreNonApplicable() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory), correction = try memoryJournalIntent()
    _ = try await registerJournalServiceProof(store, correction)
    let evidence = try memoryJournalIntent("memory.delete_evidence", operation: .deleteEvidence, kind: nil, target: correction.targetId)
    let evidenceProof = try await registerJournalServiceProof(store, evidence, world: 7)
    let file = directory.appendingPathComponent(LocalMemoryOperationStore.fileName), before = try Data(contentsOf: file)
    let notItem = try await store.redactCorrections(deletedBy: evidence, expectedRevision: evidenceProof.revision)
    #expect(notItem.disposition == .notApplicable && notItem.nonApplicability == .notItemDeletion)
    #expect(try Data(contentsOf: file) == before)
    let queuedDelete = try memoryJournalIntent("memory.delete_queued", operation: .deleteItem)
    _ = try await store.persist(queuedDelete)
    let notProved = try await store.redactCorrections(deletedBy: queuedDelete, expectedRevision: 0)
    #expect(notProved.disposition == .notApplicable && notProved.nonApplicability == .deletionNotProved)
    #expect(try await store.operation(for: correction)?.bodyAvailable == true)
}

@Test func memoryJournalRedactionSchemaOneReadsOriginalBytesThenMigratesAtomically() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory), correction = try memoryJournalIntent(correction: "migration private text")
    _ = try await registerJournalServiceProof(store, correction)
    let unknown = try memoryJournalIntent("memory.unknown", correction: "keep unknown bytes")
    _ = try await store.persist(unknown); _ = try await store.markUncertain(unknown, expectedRevision: 0)
    let deletion = try memoryJournalIntent("memory.delete_A", operation: .deleteItem, world: 6)
    let deleteProof = try await registerJournalServiceProof(store, deletion, world: 7)
    let file = directory.appendingPathComponent(LocalMemoryOperationStore.fileName)
    var object = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
    var records = try #require(object["records"] as? [[String: Any]])
    for index in records.indices { records[index].removeValue(forKey: "identity"); records[index].removeValue(forKey: "redactionProof") }
    object["records"] = records; object["schemaVersion"] = 1
    let oldFormat = try JSONSerialization.data(withJSONObject: object, options: .sortedKeys); try memoryJournalOverwrite(oldFormat, file: file)
    let reopened = try LocalMemoryOperationStore(directory: directory)
    #expect(try await reopened.operation(for: unknown)?.intent?.payload == unknown.payload)
    #expect(try Data(contentsOf: file) == oldFormat)
    let result = try await reopened.redactCorrections(deletedBy: deletion, expectedRevision: deleteProof.revision)
    #expect(result.redactedRequestIds == [correction.requestId] && result.pendingRequestIds == [unknown.requestId])
    let newFormat = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
    #expect(newFormat["schemaVersion"] as? Int == 2)
    let again = try LocalMemoryOperationStore(directory: directory)
    #expect(try await again.operation(for: correction)?.isRedacted == true)
    #expect(try await again.operation(for: unknown)?.intent?.payload == unknown.payload)
    #expect(try await again.operation(for: unknown)?.state == .uncertain)
}

@Test func memoryJournalRedactionCasAndIdempotentRecheckKeepTombstoneProof() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let first = try LocalMemoryOperationStore(directory: directory), second = try LocalMemoryOperationStore(directory: directory)
    let correction = try memoryJournalIntent()
    _ = try await registerJournalServiceProof(first, correction)
    let deletion = try memoryJournalIntent("memory.delete_A", operation: .deleteItem, world: 6)
    let deleteProof = try await registerJournalServiceProof(first, deletion, world: 7)
    let result = try await first.redactCorrections(deletedBy: deletion, expectedRevision: deleteProof.revision)
    await #expect(throws: LocalMemoryOperationFailure.staleRevision) { try await second.redactCorrections(deletedBy: deletion, expectedRevision: deleteProof.revision) }
    let latestRevision = try #require(result.deletionRecordRevision)
    let rechecked = try await second.redactCorrections(deletedBy: deletion, expectedRevision: latestRevision)
    #expect(rechecked.redactedRequestIds.isEmpty && rechecked.alreadyRedactedRequestIds == [correction.requestId])
    #expect(rechecked.proofs.count == 1 && rechecked.proofs[0].correction.requestId == correction.requestId)
}

@Test func memoryJournalRedactionConcurrentUnknownWriteDoesNotLoseOriginalIntention() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let first = try LocalMemoryOperationStore(directory: directory), second = try LocalMemoryOperationStore(directory: directory)
    let correction = try memoryJournalIntent(), unknown = try memoryJournalIntent("memory.concurrent_unknown", correction: "preserve concurrent")
    _ = try await registerJournalServiceProof(first, correction)
    let deletion = try memoryJournalIntent("memory.delete_A", operation: .deleteItem, world: 6)
    let deleteProof = try await registerJournalServiceProof(first, deletion, world: 7)
    async let redaction = first.redactCorrections(deletedBy: deletion, expectedRevision: deleteProof.revision)
    async let writing = second.persist(unknown)
    _ = try await (redaction, writing)
    let reopened = try LocalMemoryOperationStore(directory: directory)
    #expect(try await reopened.operation(for: correction)?.isRedacted == true)
    #expect(try await reopened.operation(for: unknown)?.intent?.payload == unknown.payload)
}

@Test func memoryJournalRedactionCorruptTombstoneNeverReinstatesBody() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory), correction = try memoryJournalIntent()
    _ = try await registerJournalServiceProof(store, correction)
    let deletion = try memoryJournalIntent("memory.delete_A", operation: .deleteItem, world: 6)
    let deleteProof = try await registerJournalServiceProof(store, deletion, world: 7)
    _ = try await store.redactCorrections(deletedBy: deletion, expectedRevision: deleteProof.revision)
    let file = directory.appendingPathComponent(LocalMemoryOperationStore.fileName)
    var object = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
    var records = try #require(object["records"] as? [[String: Any]])
    let index = try #require(records.firstIndex { ($0["identity"] as? [String: Any])?["requestId"] as? String == correction.requestId })
    records[index]["intent"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(correction))
    object["records"] = records
    let corrupt = try JSONSerialization.data(withJSONObject: object); try memoryJournalOverwrite(corrupt, file: file)
    #expect(throws: LocalMemoryOperationFailure.corruptFile) { try LocalMemoryOperationStore(directory: directory) }
    #expect(try Data(contentsOf: file) == corrupt)
}

@Test func memoryJournalRedactionFileLimitFailureIsAtomic() async throws {
    let directory = memoryJournalDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try LocalMemoryOperationStore(directory: directory), correction = try memoryJournalIntent(correction: "x")
    _ = try await registerJournalServiceProof(store, correction)
    let deletion = try memoryJournalIntent("memory.delete_A", operation: .deleteItem, world: 6)
    let deleteProof = try await registerJournalServiceProof(store, deletion, world: 7)
    let file = directory.appendingPathComponent(LocalMemoryOperationStore.fileName), before = try Data(contentsOf: file)
    let limited = try LocalMemoryOperationStore(directory: directory, limits: .init(fileBytes: before.count + 1))
    await #expect(throws: LocalMemoryOperationFailure.fileLimit) { try await limited.redactCorrections(deletedBy: deletion, expectedRevision: deleteProof.revision) }
    #expect(try Data(contentsOf: file) == before)
    #expect(try await store.operation(for: correction)?.intent?.payload == correction.payload)
}
