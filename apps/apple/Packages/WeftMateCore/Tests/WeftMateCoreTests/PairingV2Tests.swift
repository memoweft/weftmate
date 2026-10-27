import Foundation
import Testing
import CryptoKit
import Security
import JOSESwift
@testable import WeftMateCore

private func pairingReply(_ fields: [String: Any], status: Int = 200, headers: [String: String] = [:]) throws -> HTTPResponse {
    .init(status: status, headers: headers, body: try JSONSerialization.data(withJSONObject: fields))
}

private struct PairingSetup: Sendable {
    let phone: CloudDeviceKey
    let installation: Data
    let pair: HostPairing
    let identity: CloudPairingIdentity
    let hostNonce = cloudBase64(Data(repeating: 4, count: 32))
    init() throws {
        phone = try CloudDeviceKey(softwareStore: MemoryStore())
        let signing = SecKeyCreateRandomKey([kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeySizeInBits: 256] as CFDictionary, nil)!
        installation = SecKeyCopyExternalRepresentation(signing, nil)! as Data
        let jwk = try ECPublicKey(publicKey: SecKeyCopyPublicKey(signing)!).parameters
        let fields: [String: Any] = ["version": 2, "issuer": "https://cloud.example.test/personal/v1/cloud/oidc", "sub": "synthetic-account",
            "hostId": "synthetic-host", "challenge": cloudBase64(Data(repeating: 3, count: 32)), "tlsSpki": cloudBase64(Data(repeating: 1, count: 32)),
            "publicJwk": jwk, "origin": "http://127.0.0.1:47777", "relay": ["state": "online", "baseUrl": "https://relay.example.test"],
            "expiresAt": Int64(Date().timeIntervalSince1970 * 1000) + 119_000, "expiresIn": 120, "hostCommitment": cloudBase64(Data(repeating: 0, count: 32))]
        let initial = try HostPairing.parse(JSONSerialization.data(withJSONObject: fields))
        var committed = fields
        committed["hostCommitment"] = try PairingV2.hostCommitment(initial.transcript(), nonce: hostNonce)
        pair = try HostPairing.parse(JSONSerialization.data(withJSONObject: committed))
        identity = CloudPairingIdentity(accessToken: "synthetic-token", issuer: pair.issuer, subject: pair.sub,
            hostID: pair.hostId, deviceID: "apple-" + phone.thumbprint, thumbprint: phone.thumbprint)
    }
}

private actor PairingTransport: HTTPTransport {
    let pair: HostPairing
    let identity: CloudPairingIdentity
    let installation: Data
    let hostNonce: String
    var requests: [URLRequest] = []
    var nonce = 0
    var confirmed = false
    var consumed = false
    var phoneNonce: String?
    var commitment: String?
    var corruptHost = false
    var corruptTrust = false
    var invalid = false
    init(_ setup: PairingSetup, corruptHost: Bool = false, corruptTrust: Bool = false) {
        pair = setup.pair; identity = setup.identity; installation = setup.installation; hostNonce = setup.hostNonce
        self.corruptHost = corruptHost; self.corruptTrust = corruptTrust
    }
    func confirm() { confirmed = true }
    func cancel() { invalid = true }
    func recorded() -> [URLRequest] { requests }
    func contribution() -> String? { phoneNonce }
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        requests.append(request)
        let fields = try request.httpBody.map { try JSONSerialization.jsonObject(with: $0) as! [String: String] } ?? [:]
        switch request.url!.path {
        case "/personal/v1/auth/cloud-nonce": nonce += 1; return try pairingReply(["nonce": "nonce-\(nonce)"])
        case "/personal/v1/cloud/pairings/join":
            commitment = fields["phoneCommitment"]
            #expect(fields["phoneNonce"] == nil)
            return try pairingReply(["state": "committed", "hostNonce": corruptHost ? cloudBase64(Data(repeating: 9, count: 32)) : hostNonce, "expiresAt": pair.expiresAt])
        case "/personal/v1/cloud/pairings/reveal":
            phoneNonce = fields["phoneNonce"]
            #expect(try PairingV2.phoneCommitment(challenge: pair.challenge, deviceID: identity.deviceID, thumbprint: identity.thumbprint, nonce: phoneNonce!) == commitment)
            return try pairingReply(["state": "comparing", "hostNonce": hostNonce, "expiresAt": pair.expiresAt, "verificationCode": "000000"])
        case "/personal/v1/cloud/pairings/redeem":
            if invalid || consumed { return try pairingReply(["error": ["code": "PAIRING_INVALID"]], status: 401) }
            guard confirmed else { return try pairingReply(["error": ["code": "PAIRING_CONFIRMATION_REQUIRED"]], status: 403) }
            consumed = true
            let issued = Date().timeIntervalSince1970.rounded(.down)
            let claims: [String: Any] = ["iss": pair.hostId, "aud": identity.thumbprint, "sub": pair.sub, "hostId": pair.hostId,
                "deviceId": identity.deviceID, "jkt": identity.thumbprint, "tlsSpki": corruptTrust ? cloudBase64(Data(repeating: 8, count: 32)) : pair.tlsSpki,
                "publicJwk": pair.publicJwk, "origin": pair.origin, "relay": ["state": "online", "baseUrl": pair.relay!.baseUrl!],
                "iat": issued, "exp": issued + 120, "jti": UUID().uuidString]
            var header = JWSHeader(algorithm: .ES256); header.typ = "wm-host-trust+jwt"
            let signing = SecKeyCreateWithData(installation as CFData, [kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeyClass: kSecAttrKeyClassPrivate] as CFDictionary, nil)!
            let token = try JWS(header: header, payload: Payload(JSONSerialization.data(withJSONObject: claims)), signer: Signer(signatureAlgorithm: .ES256, key: signing)!).compactSerializedString
            return try pairingReply(["account": ["ownerId": "synthetic-owner", "username": "synthetic", "displayName": "Synthetic"],
                "device": ["id": "synthetic-device", "name": "iPhone"], "csrfToken": String(repeating: "b", count: 43),
                "hostTrust": ["publicJwk": pair.publicJwk, "trustToken": token]],
                headers: ["set-cookie": "wm_personal_session=" + String(repeating: "a", count: 43) + "; HttpOnly; Secure"])
        case "/personal/v1/status": return try pairingReply(["ownerId": "synthetic-owner", "hostId": pair.hostId])
        default: throw APIFailure.invalidResponse
        }
    }
}

@Suite struct PairingV2Tests {
    @Test func exactComputerFixtureAndEveryTranscriptField() throws {
        let bytes = try Data(contentsOf: Bundle.module.url(forResource: "pairing-v2", withExtension: "json", subdirectory: "Fixtures")!)
        let fixture = try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
        let transcript = fixture["transcript"] as! [Any]
        let hostNonce = fixture["hostNonce"] as! String, phoneNonce = fixture["phoneNonce"] as! String
        let device = fixture["deviceId"] as! String, jkt = fixture["phoneJkt"] as! String
        #expect(try PairingV2.hostCommitment(transcript, nonce: hostNonce) == fixture["hostCommitment"] as? String)
        #expect(try PairingV2.phoneCommitment(challenge: transcript[6] as! String, deviceID: device, thumbprint: jkt, nonce: phoneNonce) == fixture["phoneCommitment"] as? String)
        #expect(try PairingV2.code(transcript, hostNonce: hostNonce, deviceID: device, thumbprint: jkt, phoneNonce: phoneNonce) == "309281")
        #expect(try PairingV2.code(transcript, hostNonce: hostNonce, deviceID: device, thumbprint: jkt,
            phoneNonce: "Dg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4") == "017533")
        for index in transcript.indices {
            var changed = transcript; changed[index] = "changed"
            #expect(try PairingV2.hostCommitment(changed, nonce: hostNonce) != fixture["hostCommitment"] as? String)
        }
        // Non-ASCII JSON and leading-zero decimal formatting must agree with JavaScript too.
        #expect(String(data: try JSONSerialization.data(withJSONObject: ["中文/😀"], options: [.withoutEscapingSlashes]), encoding: .utf8) == "[\"中文/😀\"]")
    }

    @Test func qrRejectsOldProtocolWrongAccountKeyOriginAndDeadline() throws {
        let setup = try PairingSetup(), pair = setup.pair
        #expect(try pair.publicKeyThumbprint() == ECPublicKey(data: JSONSerialization.data(withJSONObject: pair.publicJwk)).thumbprint())
        #expect(try pair.requestServer().originString == "https://relay.example.test")
        #expect(throws: CloudLoginFailure.pairing) { try pair.validate(issuer: "other", subject: pair.sub, hostID: pair.hostId) }
        #expect(throws: CloudLoginFailure.pairing) { try pair.validate(issuer: pair.issuer, subject: "other", hostID: pair.hostId) }
        #expect(throws: CloudLoginFailure.pairing) { try pair.validate(issuer: pair.issuer, subject: pair.sub, hostID: "other") }
        var fields = try JSONSerialization.jsonObject(with: JSONEncoder().encode(pair)) as! [String: Any]
        for (field, value) in [("version", 1 as Any), ("publicJwk", ["kty": "EC", "crv": "P-256", "x": "bad", "y": "bad"] as Any),
                               ("origin", "http://remote.example.test" as Any), ("relay", ["state": "online", "baseUrl": "http://127.0.0.1:47777"] as Any)] {
            var changed = fields; changed[field] = value
            #expect(throws: (any Error).self) { try HostPairing.parse(JSONSerialization.data(withJSONObject: changed)) }
        }
        fields["expiresAt"] = Int64(Date().timeIntervalSince1970 * 1000) - 1
        #expect(throws: PairingFailure.expired) { try HostPairing.parse(JSONSerialization.data(withJSONObject: fields)) }
        fields["expiresAt"] = Int64(Date().timeIntervalSince1970 * 1000) + 121_000
        #expect(throws: CloudLoginFailure.pairing) { try HostPairing.parse(JSONSerialization.data(withJSONObject: fields)) }
        let json = try JSONEncoder().encode(pair)
        #expect(try HostPairing.parse(Data(("wm1." + cloudBase64(json)).utf8)) == pair)
    }

    @Test func commitmentMismatchStopsBeforeRevealOrSession() async throws {
        let setup = try PairingSetup(), store = MemoryStore()
        let transport = PairingTransport(setup, corruptHost: true)
        let client = PersonalClient(credentialStore: store, transport: transport)
        await #expect(throws: PairingFailure.commitment) {
            try await client.beginCloudPairing(setup.pair, identity: setup.identity, deviceName: "Synthetic", key: setup.phone, hostPins: HostPinStore(store: MemoryStore()))
        }
        #expect(await transport.recorded().map { $0.url!.path } == ["/personal/v1/auth/cloud-nonce", "/personal/v1/cloud/pairings/join"])
        #expect(await client.currentSession() == nil && store.count == 0)
    }

    @Test func locallyComputedCodeWaitsForComputerThenRedeemsOnlyOnceWithFreshProofs() async throws {
        let setup = try PairingSetup(), store = MemoryStore(), pins = HostPinStore(store: MemoryStore())
        let transport = PairingTransport(setup), client = PersonalClient(credentialStore: store, transport: transport)
        let comparison = try await client.beginCloudPairing(setup.pair, identity: setup.identity, deviceName: "Synthetic", key: setup.phone, hostPins: pins)
        let nonce = await transport.contribution()!
        #expect(comparison.verificationCode == (try PairingV2.code(setup.pair.transcript(), hostNonce: setup.hostNonce,
            deviceID: setup.identity.deviceID, thumbprint: setup.identity.thumbprint, phoneNonce: nonce)))
        #expect(await client.currentSession() == nil && store.count == 0)
        #expect(try await client.redeemCloudPairing(comparison, identity: setup.identity, deviceName: "Synthetic", key: setup.phone, hostPins: pins) == nil)
        #expect(await client.currentSession() == nil && store.count == 0)
        await transport.confirm()
        let session = try await client.redeemCloudPairing(comparison, identity: setup.identity, deviceName: "Synthetic", key: setup.phone, hostPins: pins)
        #expect(session?.hostId == setup.pair.hostId)
        #expect(await client.currentSession() == session)
        let requests = await transport.recorded()
        let proofs = requests.filter { $0.value(forHTTPHeaderField: "DPoP") != nil }
        #expect(proofs.count == 4)
        #expect(Set(proofs.compactMap { $0.value(forHTTPHeaderField: "DPoP") }).count == 4)
        for (index, request) in proofs.enumerated() {
            let token = try JWS(compactSerialization: request.value(forHTTPHeaderField: "DPoP")!)
            let publicKey = try ECPublicKey(data: JSONSerialization.data(withJSONObject: setup.phone.publicJwk)).converted(to: SecKey.self)
            let payload = try token.validate(using: Verifier(signatureAlgorithm: .ES256, key: publicKey)!).payload.data()
            let claims = try JSONSerialization.jsonObject(with: payload) as! [String: Any]
            #expect(claims["nonce"] as? String == "nonce-\(index + 1)")
            #expect(claims["htu"] as? String == request.url!.absoluteString)
            #expect(claims["htm"] as? String == "POST")
            #expect(claims["ath"] as? String == cloudBase64(Data(SHA256.hash(data: Data(setup.identity.accessToken.utf8)))))
            #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
        }
        #expect(requests.allSatisfy { $0.url!.scheme == "https" && $0.url!.host == "relay.example.test" })
        await #expect(throws: PairingFailure.invalid) {
            try await client.redeemCloudPairing(comparison, identity: setup.identity, deviceName: "Synthetic", key: setup.phone, hostPins: pins)
        }
    }

    @Test func cancelledOrChangedTrustNeverInstallsContentSession() async throws {
        for cancelled in [true, false] {
            let setup = try PairingSetup(), store = MemoryStore(), pins = HostPinStore(store: MemoryStore())
            let transport = PairingTransport(setup, corruptTrust: !cancelled), client = PersonalClient(credentialStore: store, transport: transport)
            let comparison = try await client.beginCloudPairing(setup.pair, identity: setup.identity, deviceName: "Synthetic", key: setup.phone, hostPins: pins)
            if cancelled { await transport.cancel() } else { await transport.confirm() }
            await #expect(throws: (any Error).self) {
                try await client.redeemCloudPairing(comparison, identity: setup.identity, deviceName: "Synthetic", key: setup.phone, hostPins: pins)
            }
            #expect(await client.currentSession() == nil && store.count == 0)
        }
    }
}
