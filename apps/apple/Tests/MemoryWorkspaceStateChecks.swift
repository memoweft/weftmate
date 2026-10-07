import Darwin
import Foundation
import WeftMateCore

private struct Failed: Error { let message: String }
private func pass(_ text: String) { print(text); fflush(nil) }
private func check(_ value: Bool, _ message: String) throws { if !value { throw Failed(message: message) } }
private final class Credentials: CredentialStore, @unchecked Sendable {
    private let lock = NSLock(); private var values: [String: Data] = [:]
    func load(key: String) -> Data? { lock.withLock { values[key] } }
    func save(_ value: Data, key: String) { lock.withLock { values[key] = value } }
    func delete(key: String) { lock.withLock { values[key] = nil } }
}
private actor MemoryHTTP: HTTPTransport {
    var revision = 4
    var text = "Synthetic original"
    var deleted = false
    var muted = false
    var receipts: [String: Data] = [:]
    var requests: [URLRequest] = []
    var pauseSuffix: String?
    var paused: CheckedContinuation<Void, Never>?
    var loseReply = false
    var discardReply = false
    var conflict = false
    var pagination = false
    var cleanupPending = true
    var offline = false
    func configure(lose: Bool = false, discard: Bool = false, conflict: Bool = false, pagination: Bool = false) {
        loseReply = lose; discardReply = discard; self.conflict = conflict; self.pagination = pagination
    }
    func pause(_ suffix: String) { pauseSuffix = suffix }
    func isPaused() -> Bool { paused != nil }
    func release() { paused?.resume(); paused = nil }
    func advance() { revision += 1 }
    func allRequests() -> [URLRequest] { requests }
    func mutationRequests() -> [URLRequest] { requests.filter { $0.url!.path.contains("/memory/") && $0.httpMethod != "GET" } }
    func seed(_ receipt: MemoryMutationReceipt) throws { receipts[receipt.requestId] = try JSONEncoder().encode(receipt) }
    func item(_ id: String = "memory.1", kind: String = "cognition") -> [String: Any] {
        ["id": id, "kind": kind, "text": id == "memory.1" ? text : "Synthetic other", "truncated": false,
         "currentState": "current", "createdAt": "2026-10-05T00:00:00Z", "updatedAt": "2026-10-05T00:00:00Z",
         "lifecycle": muted && id == "memory.1" ? ["mutedAt": "2026-10-05T00:00:01Z"] : [:], "sourceCount": 1]
    }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        requests.append(request)
        let path = request.url!.path
        if let suffix = pauseSuffix, (path.hasSuffix(suffix) || (suffix == "__any_lookup__" && path.contains("/memory/commands/by-request/"))) {
            pauseSuffix = nil; await withCheckedContinuation { paused = $0 }
        }
        var object: [String: Any] = [:]; var status = 200
        let auth: [String: Any] = ["account": ["ownerId": "ownerA", "username": "test", "displayName": "Synthetic"],
            "device": ["id": "device-Mac", "name": "Fixture"], "csrfToken": String(repeating: "b", count: 43)]
        switch path {
        case "/personal/v1/auth/login", "/personal/v1/auth/me": object = auth
        case "/personal/v1/status": object = ["ownerId": "ownerA", "hostId": "host-test"]
        case "/personal/v1/memory/status":
            if offline { throw APIFailure.transport(.unavailable) }
            object = ["state": "ready", "worldRevision": revision,
                "capabilities": ["list": true, "source": true, "inject": false, "correct": true, "mute": true, "deleteEvidence": true, "deleteWorldItem": true]]
        case "/personal/v1/memory/items":
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
            let kind = query.first { $0.name == "kind" }!.value!
            let search = query.first { $0.name == "query" }!.value!.precomposedStringWithCompatibilityMapping.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let after = query.contains { $0.name == "after" }
            var token: Any = NSNull()
            let more = pagination && !after && !deleted
            if more {
                let bytes = try JSONSerialization.data(withJSONObject: ["ownerId": "ownerA", "kind": kind, "query": search, "worldRevision": revision, "offset": 1], options: [.sortedKeys])
                token = bytes.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
            }
            object = ["items": deleted ? [] : pagination ? [item(after ? "memory.2" : "memory.1", kind: kind)] : [item(kind: kind), item("memory.2", kind: kind)],
                "worldRevision": revision, "nextCursor": token, "hasMore": more, "searchScope": "account_snapshot"]
        case let route where route.contains("/memory/commands/by-request/"):
            if route.hasSuffix("/retry-cleanup") {
                let id = route.split(separator: "/").dropLast().last.map(String.init)!
                var receipt = try JSONSerialization.jsonObject(with: receipts[id]!) as! [String: Any]
                receipt["storageCleanup"] = ["state": "complete", "detailCode": "current_wal_truncated"]
                receipts[id] = try JSONSerialization.data(withJSONObject: receipt)
                object = ["receipt": receipt]
            } else {
                let id = String(route.split(separator: "/").last!)
                if let bytes = receipts[id] { object = ["receipt": try JSONSerialization.jsonObject(with: bytes)] }
                else { status = 404; object = ["error": ["code": "NOT_FOUND"]] }
            }
        case let route where route.hasSuffix("/sources"):
            object = ["worldRevision": revision, "sources": [["evidenceId": "evidence.1", "relation": "supports", "currentnessState": "current",
                "permissions": ["allowLocalRead": false, "allowCloudRead": true, "allowInference": true], "contentAvailable": true,
                "summary": "WITHHELD-SYNTHETIC-SUMMARY", "rawContent": "WITHHELD-SYNTHETIC-BODY", "rawContentTruncated": false, "recordedAt": "2026-10-05T00:00:00Z"]]]
        case let route where route.contains("/memory/items/") || route.contains("/memory/evidence/"):
            if request.httpMethod == "GET" {
                let id = String(route.split(separator: "/").last!)
                object = ["item": item(id), "worldRevision": revision,
                    "availableActions": ["correct": ["available": true], "mute": ["available": !muted], "delete": ["available": true]]]
            } else {
                let payload = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
                let id = payload["requestId"] as! String
                let deletion = request.httpMethod == "DELETE"
                if !conflict {
                    revision += 1
                    if route.hasSuffix("/correct") { text = payload["text"] as! String }
                    if route.hasSuffix("/mute") { muted = true }
                    if deletion && route.contains("/items/") { deleted = true }
                }
                var receipt: [String: Any] = ["commandId": "command-" + id, "requestId": id, "worldRevision": revision,
                    "state": conflict ? "revision_conflict" : "applied"]
                if conflict { status = 409 }
                if deletion && !conflict { receipt["storageCleanup"] = ["state": cleanupPending ? "pending" : "complete", "detailCode": cleanupPending ? "wal_reader_busy" : "current_wal_truncated"] }
                receipts[id] = try JSONSerialization.data(withJSONObject: receipt)
                if loseReply {
                    loseReply = false
                    if discardReply { receipts[id] = nil }
                    throw APIFailure.transport(.timeout)
                }
                object = ["receipt": receipt]
            }
        default: throw Failed(message: "Unexpected synthetic Memory route")
        }
        let headers = path == "/personal/v1/auth/login" ? ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43)] : [:]
        return .init(status: status, headers: headers, body: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]))
    }
}
@MainActor private final class Scope {
    var epoch = UUID(); var session: AccountSession?
}
private func receipt(_ intent: MemoryMutationIntent, revision: Int, cleanup: Bool = false) throws -> MemoryMutationReceipt {
    var object: [String: Any] = ["commandId": "command-" + intent.requestId, "requestId": intent.requestId, "state": "applied", "worldRevision": revision]
    if cleanup { object["storageCleanup"] = ["state": "pending", "detailCode": "wal_reader_busy"] }
    return try JSONDecoder().decode(MemoryMutationReceipt.self, from: JSONSerialization.data(withJSONObject: object))
}
@main private struct MemoryWorkspaceChecks {
    @MainActor static func main() async throws {
        let base = URL(fileURLWithPath: CommandLine.arguments[1])
        func setup(_ name: String, http: MemoryHTTP = MemoryHTTP()) async throws -> (MemoryHTTP, PersonalClient, Scope, LocalMemoryOperationStore, MemoryWorkspaceModel) {
            let client = PersonalClient(credentialStore: Credentials(), transport: http)
            let scope = Scope()
            scope.session = try await client.login(server: ServerConfiguration(input: "https://unit.weftmate.example:8443"), username: "test", password: "synthetic-only", deviceName: "Mac")
            let journal = try LocalMemoryOperationStore(directory: base.appendingPathComponent(name))
            let model = MemoryWorkspaceModel(client: client, journal: journal, accountEpoch: scope.epoch,
                currentEpoch: { scope.epoch }, currentSession: { scope.session })
            await model.reload()
            return (http, client, scope, journal, model)
        }
        func paused(_ http: MemoryHTTP) async throws {
            for _ in 0..<10_000 { if await http.isPaused() { return }; await Task.yield() }
            throw Failed(message: "Controlled request did not pause")
        }
        func action(_ model: MemoryWorkspaceModel, _ kind: MemoryMutationKind) throws -> MemoryActionContext {
            guard let value = model.actionContext(kind) else { throw Failed(message: "Missing enabled action context") }; return value
        }

        let (readHTTP, _, _, _, read) = try await setup("read")
        try check(read.items.count == 2 && read.status?.status.state == .ready, "Initial status/list missing")
        try check(await readHTTP.allRequests().filter { $0.url!.path.hasSuffix("/sources") }.isEmpty, "Automatically read source bodies")
        await read.open(read.items[0]); await read.loadSources()
        try check(read.sources?.sources[0].rawContent == nil && read.sources?.sources[0].summary == nil && read.sources?.sources[0].localContentWithheld == true, "Source local-read boundary missing")
        read.closeSources(); try check(read.sources == nil, "Collapsed sources retained visible body")
        pass("PASS bounded read, explicit sources and local permission getters")

        let pageHTTP = MemoryHTTP(); await pageHTTP.configure(pagination: true)
        let (_, _, _, _, page) = try await setup("pagination", http: pageHTTP)
        await page.loadMore(); try check(page.items.count == 2 && !page.hasMore, "Explicit second page missing")
        page.query = " new query "; await page.reload(); await pageHTTP.advance(); await page.loadMore()
        try check(page.items.count == 1 && page.hasMore && page.error == nil, "Revision change mixed stale and new pages")
        pass("PASS explicit pagination and revision change rebuild only one current page")

        let (closeHTTP, _, _, _, close) = try await setup("close")
        await closeHTTP.pause("/memory/items"); let lateList = Task { await close.reload() }
        try await paused(closeHTTP); close.invalidate(); await closeHTTP.release(); await lateList.value
        try check(!close.validScope && close.items.isEmpty && close.status == nil && close.error == nil, "Closed workspace published late read/catch")
        pass("PASS actual list worker cancellation and inactive late-response guard")

        let (lateHTTP, _, scope, _, late) = try await setup("late-owner")
        await lateHTTP.pause("/memory.1"); let lateDetail = Task { await late.open(late.items[0]) }
        try await paused(lateHTTP); scope.epoch = UUID(); late.invalidate(); await lateHTTP.release(); await lateDetail.value
        try check(late.detail == nil && late.sources == nil && late.items.isEmpty, "Prior owner detail published into new epoch")
        let (sourceHTTP, _, _, _, source) = try await setup("late-source")
        await source.open(source.items[0]); await sourceHTTP.pause("/sources"); let lateSource = Task { await source.loadSources() }
        try await paused(sourceHTTP); source.closeDetail(); await sourceHTTP.release(); await lateSource.value
        try check(source.sources == nil && source.detail == nil && source.detailError == nil, "Closed detail source published late")
        pass("PASS owner-late detail and closed-source callback isolation")

        for ownerFlip in [false, true] {
            let (http, _, scope, journal, model) = try await setup(ownerFlip ? "cancel-owner" : "cancel-close")
            await model.open(model.items[0]); let context = try action(model, .mute)
            // Dynamic request IDs are generated only after the immutable action is captured.
            await http.pauseNextLookup()
            let pending = Task { await model.mutate(context) }
            try await paused(http)
            if ownerFlip { scope.epoch = UUID(); model.invalidate() } else { model.closeDetail() }
            await http.release(); await pending.value
            try check(await http.mutationRequests().isEmpty, "Cancelled lookup proceeded to mutation POST")
            let account = try LocalAccountScope(server: context.session.server, ownerId: context.session.account.ownerId)
            let records = try await journal.operations(account: account)
            try check(records.count == 1 && records[0].receipt == nil && records[0].intent != nil, "Cancelled durable operation was lost or marked applied")
        }
        pass("PASS paused lookup close/owner flip cancels actual SDK task before POST")

        let (targetHTTP, _, _, targetJournal, target) = try await setup("target")
        await target.open(target.items[0]); let oldToken = target.editorToken
        target.setCorrection("Captured correction", token: oldToken)
        let oldDelete = try action(target, .deleteItem); let oldCorrect = try action(target, .correct)
        await target.open(target.items[1]); target.setCorrection("Late editor A", token: oldToken)
        await target.mutate(oldDelete); await target.mutate(oldCorrect)
        let account = try LocalAccountScope(server: oldDelete.session.server, ownerId: oldDelete.session.account.ownerId)
        let staleRecords = try await targetJournal.operations(account: account)
        try check(await targetHTTP.mutationRequests().isEmpty && staleRecords.isEmpty && target.correctionText.isEmpty && target.detail?.item.id == "memory.2", "A old action or editor retargeted B")
        await target.open(target.items[0]); target.setCorrection("Click-time text", token: target.editorToken)
        let captured = try action(target, .correct); target.setCorrection("Later typing", token: target.editorToken)
        await target.mutate(captured)
        let submitted = await targetHTTP.mutationRequests().first!
        let body = try JSONSerialization.jsonObject(with: submitted.httpBody!) as! [String: Any]
        try check(body["text"] as? String == "Click-time text" && target.items[0].text == "Click-time text" && target.detail == nil && target.correctionText.isEmpty, "Correction capture or refreshed visible text incorrect")
        await target.open(target.items[0]); await target.mutate(try action(target, .mute))
        try check(target.items[0].lifecycle.mutedAt != nil && target.detail == nil, "Mute result left old list state")
        pass("PASS stale action/editor target guard, click-time correction and success list refresh")

        let lostHTTP = MemoryHTTP(); await lostHTTP.configure(lose: true, discard: true)
        let (_, client, lostScope, journal, lost) = try await setup("lost", http: lostHTTP)
        await lost.open(lost.items[0]); await lost.mutate(try action(lost, .mute))
        let original = lost.visibleOperations.first!.record
        try check(original.state == .uncertain, "Lost reply claimed success")
        let reopened = MemoryWorkspaceModel(client: client, journal: journal, accountEpoch: lostScope.epoch,
            currentEpoch: { lostScope.epoch }, currentSession: { lostScope.session })
        await reopened.reload(); await reopened.reconcile(original.requestId)
        try check(await lostHTTP.mutationRequests().count == 1 && reopened.operations[original.requestId]?.lookupNotFound == true, "Restart lookup automatically replayed mutation")
        await reopened.reconcile(original.requestId, allowSubmission: true)
        let attempts = await lostHTTP.mutationRequests()
        try check(attempts.count == 2 && attempts[0].httpBody == attempts[1].httpBody && reopened.operations[original.requestId]?.record.state == .applied, "Explicit continuation changed body/ID or failed")
        pass("PASS unknown reopen lookup-only and explicit same-byte continuation")

        let conflictHTTP = MemoryHTTP(); await conflictHTTP.configure(conflict: true)
        let (_, _, _, _, conflict) = try await setup("conflict", http: conflictHTTP)
        await conflict.open(conflict.items[0]); await conflict.mutate(try action(conflict, .correct))
        // Blank corrections are rejected locally; now submit a meaningful captured correction.
        if conflict.visibleOperations.isEmpty {
            await conflict.open(conflict.items[0]); conflict.setCorrection("Synthetic revision correction", token: conflict.editorToken)
            await conflict.mutate(try action(conflict, .correct))
        }
        let conflictPosts = await conflictHTTP.mutationRequests()
        try check(conflict.visibleOperations.first?.record.state == .revisionConflict && conflictPosts.count == 1, "Conflict was retried or mislabeled transport failure")
        pass("PASS revision conflict preserves one original operation and reloads")

        let (deleteHTTP, deleteClient, deleteScope, deleteJournal, deletion) = try await setup("delete")
        let session = deleteScope.session!
        let old = try MemoryMutationIntent(session: session, operation: .correct, itemKind: .cognition, targetID: "memory.1", requestID: "old-correction", expectedWorldRevision: 2, correction: "OLD-CORRECTION-MARKER")
        let oldRecord = try await deleteJournal.persist(old); let oldReceipt = try receipt(old, revision: 3)
        _ = try await deleteJournal.recordReceipt(oldReceipt, for: old, expectedRevision: oldRecord.revision); try await deleteHTTP.seed(oldReceipt)
        _ = try await deleteClient.reconcileMemoryMutation(old)
        let unknown = try MemoryMutationIntent(session: session, operation: .correct, itemKind: .cognition, targetID: "memory.1", requestID: "unknown-correction", expectedWorldRevision: 2, correction: "UNKNOWN-MARKER")
        _ = try await deleteJournal.persist(unknown)
        let newer = try MemoryMutationIntent(session: session, operation: .correct, itemKind: .cognition, targetID: "memory.1", requestID: "newer-correction", expectedWorldRevision: 8, correction: "NEWER-MARKER")
        let newerRecord = try await deleteJournal.persist(newer)
        _ = try await deleteJournal.recordReceipt(receipt(newer, revision: 9), for: newer, expectedRevision: newerRecord.revision)
        await deletion.reload(); await deletion.open(deletion.items[0]); await deletion.loadSources()
        // Pending prior correction blocks a new action until explicitly resolved. The known delete is recovered by its own original ID.
        let delete = try MemoryMutationIntent(session: session, operation: .deleteItem, itemKind: .cognition, targetID: "memory.1", requestID: "delete-original", expectedWorldRevision: 4)
        _ = try await deleteJournal.persist(delete); let deleteReceipt = try receipt(delete, revision: 5, cleanup: true); try await deleteHTTP.seed(deleteReceipt)
        await deleteHTTP.markDeleted(); await deletion.reload(); await deletion.reconcile(delete.requestId)
        let records = try await deleteJournal.operations(account: account)
        let tomb = records.first { $0.requestId == old.requestId }!
        try check(tomb.isRedacted && tomb.intent == nil && records.first { $0.requestId == unknown.requestId }?.bodyAvailable == true && records.first { $0.requestId == newer.requestId }?.bodyAvailable == true, "Delete redaction erased unknown/newer or retained proved text")
        try check(deletion.items.allSatisfy { $0.id != "memory.1" } && deletion.detail == nil && deletion.sources == nil && deletion.correctionText.isEmpty && deletion.notice?.contains("后续版本记录保留") == true && deletion.notice?.contains("尚未确认") == true && deletion.notice?.contains("服务端存储清理待完成") == true, "Delete visible/cache or precise cleanup scope incorrect")
        do { _ = try await deleteClient.reconcileMemoryMutation(old, allowSubmission: true); throw Failed(message: "RAM tomb replay allowed") }
        catch APIFailure.server(409, "MEMORY_LOCAL_REQUEST_REDACTED") { }
        await deletion.retryCleanup(delete.requestId)
        let mutations = await deleteHTTP.mutationRequests()
        try check(mutations.count == 1 && mutations[0].url!.path.hasSuffix("/retry-cleanup") && mutations[0].httpBody == Data("{}".utf8) && deletion.operations[delete.requestId]?.record.serverStorageCleanupConfirmedComplete == true, "Cleanup retry re-deleted item or lacked real proof")
        pass("PASS delete clears visible copies, proved journal/RAM tomb, retains unknown/newer and separate cleanup")

        let (cancelCleanupHTTP, _, cancelCleanupScope, cancelCleanupJournal, cancelCleanup) = try await setup("cleanup-cancel")
        let cleanupIntent = try MemoryMutationIntent(session: cancelCleanupScope.session!, operation: .deleteItem, itemKind: .cognition,
            targetID: "memory.1", requestID: "cleanup-paused", expectedWorldRevision: 4)
        let cleanupRecord = try await cancelCleanupJournal.persist(cleanupIntent)
        let pendingReceipt = try receipt(cleanupIntent, revision: 5, cleanup: true)
        _ = try await cancelCleanupJournal.recordReceipt(pendingReceipt, for: cleanupIntent, expectedRevision: cleanupRecord.revision)
        try await cancelCleanupHTTP.seed(pendingReceipt); await cancelCleanup.reload()
        await cancelCleanupHTTP.pause("/" + cleanupIntent.requestId)
        let pendingCleanup = Task { await cancelCleanup.retryCleanup(cleanupIntent.requestId) }; try await paused(cancelCleanupHTTP)
        cancelCleanup.invalidate(); await cancelCleanupHTTP.release(); await pendingCleanup.value
        let persistedCleanup = try await cancelCleanupJournal.operation(for: cleanupIntent)
        try check(await cancelCleanupHTTP.mutationRequests().isEmpty && persistedCleanup?.cleanupRetry?.state == .uncertain,
            "Cancelled cleanup lookup sent retry or lost uncertain marker")
        pass("PASS actual cleanup worker cancellation prevents retry POST and preserves unknown marker")

        let (offlineHTTP, _, _, offlineJournal, offlineModel) = try await setup("offline")
        await offlineModel.open(offlineModel.items[0])
        let offlineIntent = try MemoryMutationIntent(session: (try action(offlineModel, .mute)).session, operation: .mute, itemKind: .cognition,
            targetID: "memory.1", requestID: "offline-pending", expectedWorldRevision: 4)
        _ = try await offlineJournal.persist(offlineIntent); await offlineHTTP.goOffline(); await offlineModel.reload()
        try check(offlineModel.operations[offlineIntent.requestId]?.record.state == .queued && offlineModel.error != nil,
            "Offline service hid durable pending operation")
        let (_, _, corruptScope, corruptJournal, corrupt) = try await setup("corrupt")
        _ = try await corruptJournal.persist(MemoryMutationIntent(session: corruptScope.session!, operation: .mute, itemKind: .cognition, targetID: "memory.1", requestID: "corrupt-local-record", expectedWorldRevision: 4))
        let journalFile = base.appendingPathComponent("corrupt").appendingPathComponent(LocalMemoryOperationStore.fileName)
        try Data("invalid synthetic journal".utf8).write(to: journalFile)
        await corrupt.reload()
        try check(corrupt.items.count == 2 && !corrupt.canMutate && corrupt.notice != nil, "Corrupt local journal blocked read-only service list")
        pass("PASS offline pending visibility and corrupted journal read-only fallback")

        let (deferredHTTP, deferredClient, deferredScope, deferredJournal, deferred) = try await setup("deferred")
        let deferredSession = deferredScope.session!
        let correction = try MemoryMutationIntent(session: deferredSession, operation: .correct, itemKind: .cognition, targetID: "memory.1", requestID: "deferred-correct", expectedWorldRevision: 2, correction: "DEFERRED-MARKER")
        let correctionReceipt = try receipt(correction, revision: 3)
        let correctionRecord = try await deferredJournal.persist(correction)
        _ = try await deferredJournal.recordReceipt(correctionReceipt, for: correction, expectedRevision: correctionRecord.revision)
        try await deferredHTTP.seed(correctionReceipt); await deferredHTTP.pause("/" + correction.requestId)
        let inflight = Task { try await deferredClient.reconcileMemoryMutation(correction) }; try await paused(deferredHTTP)
        let deleteForProof = try MemoryMutationIntent(session: deferredSession, operation: .deleteItem, itemKind: .cognition, targetID: "memory.1", requestID: "deferred-delete", expectedWorldRevision: 4)
        let deleteRecord = try await deferredJournal.persist(deleteForProof)
        let savedDelete = try await deferredJournal.recordReceipt(receipt(deleteForProof, revision: 5), for: deleteForProof, expectedRevision: deleteRecord.revision)
        _ = try await deferredJournal.redactCorrections(deletedBy: deleteForProof, expectedRevision: savedDelete.revision)
        await deferred.reload()
        try check(deferred.notice?.contains("进行中的操作") == true, "Hydrated proof ignored deferred RAM state")
        await deferredHTTP.release(); _ = try await inflight.value
        pass("PASS hydrated no-body proof distinguishes in-flight RAM deferral")
    }
}
extension MemoryHTTP {
    func pauseNextLookup() { pauseSuffix = "__any_lookup__" }
    func markDeleted() { deleted = true; revision = 5 }
    func goOffline() { offline = true }
}
