import Foundation
import Testing
@testable import WeftMateCore

private actor OfflineTransport: HTTPTransport {
    var requests: [URLRequest] = []
    var paused: CheckedContinuation<Void, Never>?
    let pause: Bool
    let reply: String
    init(pause: Bool = false, reply: String = "你喜欢茉莉花茶，不加糖。") { self.pause = pause; self.reply = reply }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        requests.append(request)
        if pause { await withCheckedContinuation { paused = $0 } }
        return HTTPResponse(status: 200, body: try JSONSerialization.data(withJSONObject: ["choices": [["message": ["content": reply]]]]))
    }
    func waitPaused() async { while paused == nil { await Task.yield() } }
    func release() { paused?.resume(); paused = nil }
}
@Suite @MainActor struct OfflineTests {
    let identity = OfflineIdentity(ownerId: "owner-test", hostId: "host-test", deviceId: "device-test")
    func status(_ generation: Int = 1, account: String = "account-test") -> OfflineAuthorization {
        .init(hostId: "host-test", accountId: account, generation: generation, authorized: true)
    }
    func snapshot(generation: Int = 1, reset: Bool = false, empty: Bool = false) throws -> OfflineSnapshot {
        let json: [String: Any] = ["generation": generation, "reset": reset,
            "items": empty ? [] : [["id": "tea", "kind": "cognition", "text": "用户喝茶喜欢茉莉花茶，不加糖。", "currentState": "current", "sources": [["id": "source-tea", "summary": NSNull()]]],
                ["id": "travel", "kind": "event", "text": "用户去青海旅行。", "currentState": "current", "sources": []]],
            "remove": empty ? ["tea", "travel"] : [], "hashes": empty ? [:] : ["tea": String(repeating: "a", count: 64), "travel": String(repeating: "b", count: 64)],
            "truncated": false, "recent": [], "model": ["profileId": "mimo", "name": "Synthetic", "baseUrl": "https://model.example.com/v1", "modelId": "mimo", "apiKey": "a14-synthetic-model-key"],
            "control": ["hostId": "host-test", "accountId": "account-test", "generation": generation]]
        return try JSONDecoder().decode(OfflineSnapshot.self, from: JSONSerialization.data(withJSONObject: json))
    }
    private func fixture(transport: OfflineTransport = OfflineTransport()) throws -> (OfflineVault, OfflineReplica, URL, MemoryStore) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("a14-" + UUID().uuidString)
        let store = MemoryStore(), vault = try OfflineVault(identity: identity, directory: dir, store: store)
        return (vault, try OfflineReplica(vault: vault, transport: transport), dir, store)
    }
    #if os(macOS)
    func seal(_ snapshot: OfflineSnapshot, vault: OfflineVault, identity: OfflineIdentity? = nil) throws -> OfflineEnvelope {
        let process = Process(), input = Pipe(), output = Pipe()
        let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Tests/a14_vector.mjs")
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env"); process.arguments = ["node", source.path]
        process.standardInput = input; process.standardOutput = output
        let payload = try JSONSerialization.jsonObject(with: JSONEncoder().encode(snapshot))
        let id = identity ?? self.identity
        let data = try JSONSerialization.data(withJSONObject: ["payload": payload, "jwk": vault.publicJwk(), "identity": ["ownerId": id.ownerId, "hostId": id.hostId, "deviceId": id.deviceId]])
        try process.run(); try input.fileHandleForWriting.write(contentsOf: data); try input.fileHandleForWriting.close()
        let result = output.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
        #expect(process.terminationStatus == 0)
        return try JSONDecoder().decode(OfflineEnvelope.self, from: result)
    }
    @Test func windowsEnvelopeOriginalAADTagTamperAndIdentity() throws {
        let (vault, _, dir, _) = try fixture(); defer { try? FileManager.default.removeItem(at: dir) }
        let envelope = try seal(snapshot(), vault: vault)
        #expect(try vault.open(envelope, identity: identity).items.count == 2)
        let wrong = OfflineIdentity(ownerId: "other", hostId: "host-test", deviceId: "device-test")
        #expect(throws: (any Error).self) { try vault.open(envelope, identity: wrong) }
        var bytes = try OfflineVault.decode(envelope.ciphertext); bytes[bytes.count - 1] ^= 1
        let tampered = OfflineEnvelope(version: 1, algorithm: envelope.algorithm, aad: envelope.aad, wrappedKey: envelope.wrappedKey, iv: envelope.iv, ciphertext: cloudBase64(bytes))
        #expect(throws: (any Error).self) { try vault.open(tampered, identity: identity) }
        try vault.clear()
        #expect(throws: (any Error).self) { try vault.open(envelope, identity: identity) }
    }
    @Test func receiptLossRetriesIdenticalTurnAndCookieRenewalKeepsKey() async throws {
        let (vault, engine, dir, store) = try fixture(); defer { try? FileManager.default.removeItem(at: dir) }
        try engine.merge(snapshot()); try await engine.send("喝茶喜欢什么？", conversationID: "chat", control: { _ in status() })
        let before = try JSONEncoder().encode(engine.state.turns[0]), id = engine.state.turns[0].id
        let renewed = OfflineIdentity(ownerId: identity.ownerId, hostId: identity.hostId, deviceId: "renewed-cookie")
        let renewedVault = try OfflineVault(identity: renewed, directory: dir, store: store)
        #expect(try vault.publicJwk() == renewedVault.publicJwk())
        let envelope = try seal(snapshot(), vault: vault, identity: renewed)
        var requests: [String] = []
        do {
            try await engine.sync(identity: renewed, fetch: { _ in envelope }, submit: { body in
                requests.append(body.turns[0].id); throw APIFailure.transport(.timeout)
            }, control: { _ in status() })
            Issue.record("Expected lost receipt")
        } catch {}
        #expect(engine.state.synced.isEmpty)
        try await engine.sync(identity: renewed, fetch: { _ in envelope }, submit: { body in
            requests.append(body.turns[0].id)
            #expect(body.turns[0].messages == engine.state.turns[0].messages)
            return .init(generation: 1, receipts: [.init(id: id, state: "synced")])
        }, control: { _ in status() })
        #expect(requests == [id, id]); #expect(engine.state.synced == [id])
        let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys
        #expect(try encoder.encode(JSONDecoder().decode(OfflineTurn.self, from: before)) == encoder.encode(engine.state.turns[0]))
        var submitted = false
        try await engine.sync(identity: renewed, fetch: { _ in envelope }, submit: { _ in submitted = true; return .init(generation: 1, receipts: []) }, control: { _ in status() })
        #expect(!submitted)
    }
    #endif
    @Test func encryptedStorageDeletionAndKeyRotation() async throws {
        let (vault, engine, dir, store) = try fixture(); defer { try? FileManager.default.removeItem(at: dir) }
        try engine.merge(snapshot()); try await engine.send("喝茶喜欢什么？", conversationID: "chat", control: { _ in status() })
        let old = try Data(contentsOf: vault.file), key = store.load(key: vault.keyPrefix + ".aes")
        #expect(!old.contains(Data("茉莉花茶".utf8))); #expect(!old.contains(Data("a14-synthetic-model-key".utf8)))
        #expect(try vault.load().turns.count == 1)
        try vault.save(engine.state); #expect(key != store.load(key: vault.keyPrefix + ".aes"))
        try old.write(to: vault.file)
        #expect(throws: (any Error).self) { try vault.load() }
        try engine.clear(); #expect(store.count == 0); #expect(!FileManager.default.fileExists(atPath: vault.file.path)); #expect(engine.state.turns.isEmpty)
    }
    @Test func accountChangeAfterProcessRestartDeletesPreviousScope() throws {
        let (vault, engine, dir, store) = try fixture(); defer { try? FileManager.default.removeItem(at: dir) }
        try engine.merge(snapshot()); try vault.save(engine.state); let publicKey = try vault.publicJwk()
        let next = OfflineIdentity(ownerId: "other-owner", hostId: identity.hostId, deviceId: identity.deviceId)
        let replacement = try OfflineVault(identity: next, directory: dir, store: store)
        #expect(!FileManager.default.fileExists(atPath: vault.file.path))
        #expect(store.load(key: vault.keyPrefix + ".aes") == nil); #expect(store.load(key: vault.keyPrefix + ".rsa") == nil)
        #expect(try replacement.publicJwk() != publicKey)
        try OfflineVault.clearActive(directory: dir, store: store); #expect(store.count == 0)
    }
    @Test func deltaRemoveAndResetEraseInheritedHistory() async throws {
        let (_, engine, dir, _) = try fixture(); defer { try? FileManager.default.removeItem(at: dir) }
        try engine.merge(snapshot()); try await engine.send("喝茶喜欢什么？", conversationID: "chat", control: { _ in status() })
        var delta = try snapshot(); delta.items = []
        try engine.merge(delta); #expect(engine.state.snapshot?.items.count == 2); #expect(engine.state.turns.count == 1)
        try engine.merge(snapshot(empty: true)); #expect(engine.state.turns.isEmpty); #expect(engine.state.snapshot?.items.isEmpty == true)
        try engine.merge(snapshot(generation: 2, reset: true)); #expect(engine.state.turns.isEmpty); #expect(engine.state.snapshot?.generation == 2)
    }
    @Test func wrongCloudAccountAndGenerationDeleteEverything() async throws {
        for mismatch in [status(account: "other"), status(2)] {
            let (vault, engine, dir, store) = try fixture(); defer { try? FileManager.default.removeItem(at: dir) }
            try engine.merge(snapshot()); try vault.save(engine.state)
            do { try await engine.check(control: { _ in mismatch }); Issue.record("Expected rejection") } catch {}
            #expect(engine.state.snapshot == nil); #expect(store.count == 0)
        }
    }
    @Test(arguments: [APIFailure.server(status: 403, code: "FORBIDDEN"), APIFailure.server(status: 400, code: "invalid_grant")])
    func controlUnavailableSendsNothingAndRevocationClears(revocation: APIFailure) async throws {
        let transport = OfflineTransport(), (vault, engine, dir, store) = try fixture(transport: transport)
        defer { try? FileManager.default.removeItem(at: dir) }
        try engine.merge(snapshot()); try vault.save(engine.state)
        do { try await engine.send("喝茶？", conversationID: "chat", control: { _ in throw APIFailure.transport(.unavailable) }); Issue.record("Expected rejection") } catch {}
        #expect(await transport.requests.isEmpty); #expect(engine.state.snapshot != nil)
        do { try await engine.check(control: { _ in throw revocation }); Issue.record("Expected rejection") } catch {}
        #expect(engine.state.snapshot == nil); #expect(store.count == 0)
    }
    @Test func modelResponseAfterRemoteRevocationIsDiscarded() async throws {
        let transport = OfflineTransport(pause: true), (_, engine, dir, store) = try fixture(transport: transport)
        defer { try? FileManager.default.removeItem(at: dir) }
        try engine.merge(snapshot()); var generation = 1
        let request = Task { try await engine.send("喝茶？", conversationID: "chat", control: { _ in status(generation) }) }
        await transport.waitPaused(); generation = 2; await transport.release()
        do { try await request.value; Issue.record("Expected rejection") } catch {}
        #expect(engine.state.turns.isEmpty); #expect(store.count == 0)
    }
    @Test func logoutDuringModelRequestCannotResurrect() async throws {
        let transport = OfflineTransport(pause: true), (_, engine, dir, store) = try fixture(transport: transport)
        defer { try? FileManager.default.removeItem(at: dir) }
        try engine.merge(snapshot())
        let request = Task { try await engine.send("喝茶？", conversationID: "chat", control: { _ in status() }) }
        await transport.waitPaused(); try engine.clear(); await transport.release()
        do { try await request.value; Issue.record("Expected rejection") } catch {}
        #expect(engine.state.turns.isEmpty); #expect(store.count == 0)
    }
    @Test func longUnicodeReplyFitsHostTurnContract() async throws {
        let transport = OfflineTransport(reply: String(repeating: "👩‍👩‍👧‍👧", count: 2000))
        let (_, engine, dir, _) = try fixture(transport: transport); defer { try? FileManager.default.removeItem(at: dir) }
        try engine.merge(snapshot()); try await engine.send("你好", conversationID: "chat", control: { _ in status() })
        #expect(engine.state.turns[0].messages.count == 2)
        #expect(engine.state.turns[0].messages[1].text.utf16.count <= 16384)
    }
    @Test func relatedRecallBoundedContextAndDependencies() async throws {
        let transport = OfflineTransport(), (_, engine, dir, _) = try fixture(transport: transport)
        defer { try? FileManager.default.removeItem(at: dir) }
        try engine.merge(snapshot()); try await engine.send("我喝茶喜欢什么？", conversationID: "chat", control: { _ in status() })
        try await engine.send("还有什么？", conversationID: "chat", control: { _ in status() })
        let request = await transport.requests[0], body = String(decoding: request.httpBody!, as: UTF8.self)
        #expect(body.contains("茉莉花茶")); #expect(!body.contains("青海")); #expect(!body.contains("tools"))
        #expect(engine.state.turns[1].memoryRefs == [.init(kind: "cognition", id: "tea")]); #expect(engine.state.turns[1].dependencyComplete)
        #expect(engine.state.turns[0].timestamp > 1_700_000_000_000)
    }
}
