import Foundation
import Testing
import Security
import CryptoKit
import JOSESwift
@testable import WeftMateCore

private actor CloudTestTransport: HTTPTransport {
    var replies: [HTTPResponse]
    var requests: [URLRequest] = []
    var pauseAt: Int?
    var paused: CheckedContinuation<Void, Never>?
    init(_ replies: [HTTPResponse], pauseAt: Int? = nil) { self.replies = replies; self.pauseAt = pauseAt }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        requests.append(request)
        if requests.count == pauseAt { await withCheckedContinuation { paused = $0 } }
        guard !replies.isEmpty else { throw APIFailure.invalidResponse }
        return replies.removeFirst()
    }
    func waitPaused() async { while paused == nil { await Task.yield() } }
    func release() { paused?.resume(); paused = nil }
    func recorded() -> [URLRequest] { requests }
}
private func cloudReply(_ object: [String: Any], status: Int = 200, headers: [String: String] = [:]) throws -> HTTPResponse {
    .init(status: status, headers: headers, body: try JSONSerialization.data(withJSONObject: object))
}
private func cloudAuthReply(host: String = "host-one") throws -> HTTPResponse {
    try cloudReply(["account": ["ownerId": "owner-one", "username": "synthetic", "displayName": "Synthetic"],
        "device": ["id": "device-one", "name": "iPhone"], "csrfToken": String(repeating: "b", count: 43)],
        headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43) + "; HttpOnly; Secure"])
}

@Suite struct CloudAuthTests {
    @Test func callbackAndPKCE() throws {
        let configuration = CloudConfiguration(server: try ServerConfiguration(input: "https://cloud.example.com"))
        let flow = try CloudAuthorization(configuration: configuration, hostID: "host-one")
        let query = URLComponents(url: flow.url, resolvingAgainstBaseURL: false)!.queryItems!
        #expect(query.first { $0.name == "code_challenge" }?.value == cloudBase64(Data(SHA256.hash(data: Data(flow.verifier.utf8)))))
        #expect(query.first { $0.name == "code_challenge_method" }?.value == "S256")
        #expect(query.filter { $0.name == "resource" }.count == 2)
        #expect(query.allSatisfy { $0.name != "client_secret" })
        let callback = configuration.redirectURI + "?state=\(flow.state)&code=synthetic"
        #expect(try flow.code(from: URL(string: callback)!) == "synthetic")
        for bad in [callback + "&state=other", callback + "&code=other", callback + "&error=denied", callback + "#fragment",
                    "com.weftmate.apple:/other?state=\(flow.state)&code=synthetic", configuration.redirectURI + "?state=other&code=synthetic"] {
            #expect(throws: CloudLoginFailure.callback) { try flow.code(from: URL(string: bad)!) }
        }
    }
    @Test func persistedP256AndDPoP() throws {
        let store = MemoryStore()
        let key = try CloudDeviceKey(softwareStore: store)
        let restored = try CloudDeviceKey(softwareStore: store)
        #expect(key.publicJwk == restored.publicJwk)
        #expect(!key.secureEnclave); #expect(key.publicJwk["d"] == nil)
        let url = URL(string: "https://host.example.com/personal/v1/auth/cloud-session?ignored=yes")!
        let raw = try key.proof(url: url, accessToken: "synthetic-token", nonce: "one-use-nonce")
        let other = try key.proof(url: url, accessToken: "synthetic-token", nonce: "one-use-nonce")
        let jws = try JWS(compactSerialization: raw)
        let pub = try ECPublicKey(data: JSONSerialization.data(withJSONObject: key.publicJwk)).converted(to: SecKey.self)
        let payload = try jws.validate(using: Verifier(signatureAlgorithm: .ES256, key: pub)!).payload.data()
        let fields = try JSONSerialization.jsonObject(with: payload) as! [String: Any]
        #expect(jws.header.typ == "dpop+jwt"); #expect(fields["htm"] as? String == "POST")
        #expect(fields["htu"] as? String == "https://host.example.com/personal/v1/auth/cloud-session")
        #expect(fields["ath"] as? String == cloudBase64(Data(SHA256.hash(data: Data("synthetic-token".utf8)))))
        #expect(fields["nonce"] as? String == "one-use-nonce"); #expect(raw != other)
        #expect(try key.thumbprint == ECPublicKey(data: JSONSerialization.data(withJSONObject: key.publicJwk)).thumbprint())
        #expect(try HostPinStore.spkiFingerprint(pub).count == 43)
    }
    @Test func pinsNeverOverwriteAndPairingRequiresPublicKey() throws {
        let pins = HostPinStore(store: MemoryStore())
        let origin = "https://host.example.com"
        try pins.save(String(repeating: "a", count: 43), for: origin)
        #expect(throws: CloudLoginFailure.pinChanged) { try pins.save(String(repeating: "b", count: 43), for: origin) }
        let key = try CloudDeviceKey(softwareStore: MemoryStore())
        var fields: [String: Any] = ["hostId": "host-one", "challenge": String(repeating: "a", count: 43), "tlsSpki": String(repeating: "a", count: 43),
            "expiresIn": 120, "origin": "https://host.example.com", "publicJwk": key.publicJwk,
            "relay": ["state": "online", "baseUrl": origin]]
        #expect(try HostPairing.parse(JSONSerialization.data(withJSONObject: fields)).hostId == "host-one")
        fields["publicJwk"] = ["kty": "EC", "crv": "P-256", "d": "private"]
        #expect(throws: CloudLoginFailure.pairing) { try HostPairing.parse(JSONSerialization.data(withJSONObject: fields)) }
    }
    @Test func pendingCannotReadContentAndRetryHasFreshNonceAndProof() async throws {
        let transport = CloudTestTransport([
            try cloudReply(["nonce": "first"]), try cloudReply(["status": "pending_approval", "requestId": "request-one"], status: 202),
            try cloudReply(["nonce": "second"]), try cloudAuthReply(), try cloudReply(["ownerId": "owner-one", "hostId": "host-one"])
        ])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        let key = try CloudDeviceKey(softwareStore: MemoryStore())
        let server = try ServerConfiguration(input: "https://host.example.com")
        let first = try await client.exchangeCloudSession(server: server, hostID: "host-one", accessToken: "synthetic", deviceName: "iPhone", key: key)
        #expect(first == .pending(requestID: "request-one")); #expect(await client.currentSession() == nil)
        await #expect(throws: APIFailure.notAuthenticated) { try await client.conversations() }
        let second = try await client.exchangeCloudSession(server: server, hostID: "host-one", accessToken: "synthetic", deviceName: "iPhone", key: key)
        guard case .authenticated(let session) = second else { Issue.record("No host session"); return }
        #expect(session.hostId == "host-one")
        let requests = await transport.recorded()
        #expect(requests[1].value(forHTTPHeaderField: "Authorization") == nil)
        #expect(requests[1].value(forHTTPHeaderField: "Origin") == server.originString)
        #expect(requests[1].value(forHTTPHeaderField: "DPoP") != requests[3].value(forHTTPHeaderField: "DPoP"))
    }
    @Test func cancelledExchangeCannotInstallLateCookie() async throws {
        let store = MemoryStore()
        let transport = CloudTestTransport([try cloudReply(["nonce": "first"]), try cloudAuthReply()], pauseAt: 2)
        let client = PersonalClient(credentialStore: store, transport: transport)
        let key = try CloudDeviceKey(softwareStore: MemoryStore())
        let operation = Task {
            try await client.exchangeCloudSession(server: ServerConfiguration(input: "https://host.example.com"), hostID: "host-one",
                accessToken: "synthetic", deviceName: "iPhone", key: key)
        }
        await transport.waitPaused(); operation.cancel(); await transport.release()
        await #expect(throws: CancellationError.self) { try await operation.value }
        #expect(await client.currentSession() == nil); #expect(store.count == 0)
    }
    @Test func wrongHostCannotPersistSession() async throws {
        let store = MemoryStore()
        let transport = CloudTestTransport([try cloudReply(["nonce": "first"]), try cloudAuthReply(), try cloudReply(["ownerId": "owner-one", "hostId": "different-host"])])
        let client = PersonalClient(credentialStore: store, transport: transport)
        await #expect(throws: APIFailure.identityMismatch) {
            try await client.exchangeCloudSession(server: ServerConfiguration(input: "https://host.example.com"), hostID: "host-one",
                accessToken: "synthetic", deviceName: "Mac", key: CloudDeviceKey(softwareStore: MemoryStore()))
        }
        #expect(store.count == 0); #expect(await client.currentSession() == nil)
    }
    @Test func approvedDevicesUseCookieAndCSRF() async throws {
        let transport = CloudTestTransport([try cloudReply(["nonce": "first"]), try cloudAuthReply(), try cloudReply(["ownerId": "owner-one", "hostId": "host-one"]),
            try cloudReply(["devices": [["id": "request-other", "name": "Mac · test", "requestedAt": "2026-10-07T00:00:00Z", "fingerprint": "synthetic"]]]), try cloudReply(["decision": "deny"])])
        let client = PersonalClient(credentialStore: MemoryStore(), transport: transport)
        _ = try await client.exchangeCloudSession(server: ServerConfiguration(input: "https://host.example.com"), hostID: "host-one",
            accessToken: "synthetic", deviceName: "iPhone", key: CloudDeviceKey(softwareStore: MemoryStore()))
        let pending = try await client.pendingCloudDevices(); #expect(pending[0].platformLabel == "macOS")
        try await client.decideCloudDevice(id: "request-other", allow: false)
        let request = await transport.recorded().last!
        #expect(request.value(forHTTPHeaderField: "Cookie")?.hasPrefix("wm_personal_session=") == true)
        #expect(request.value(forHTTPHeaderField: "X-WeftMate-CSRF") == String(repeating: "b", count: 43))
        #expect(String(data: request.httpBody!, encoding: .utf8)!.contains("deny"))
    }
}
