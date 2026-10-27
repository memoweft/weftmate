import Foundation
import Testing
import Security
import JOSESwift
@testable import WeftMateCore

@Suite struct HostTrustDeliveryTests {
    @Test func trustedPhysicalAnchorBindsRecipientIdentityAndLifetime() throws {
        let key = SecKeyCreateRandomKey([kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeySizeInBits: 256] as CFDictionary, nil)!
        let jwk = try ECPublicKey(publicKey: SecKeyCopyPublicKey(key)!).parameters
        let now = Date()
        let body: [String: Any] = ["iss": "host-one", "aud": "recipient-key", "sub": "subject-one", "hostId": "host-one",
            "deviceId": "phone-one", "jkt": "recipient-key", "tlsSpki": String(repeating: "A", count: 43), "publicJwk": jwk,
            "origin": "https://host.example.com", "iat": now.timeIntervalSince1970, "exp": now.timeIntervalSince1970 + 120, "jti": UUID().uuidString]
        var header = JWSHeader(algorithm: .ES256); header.typ = "wm-host-trust+jwt"
        let token = try JWS(header: header, payload: Payload(JSONSerialization.data(withJSONObject: body)), signer: Signer(signatureAlgorithm: .ES256, key: key)!).compactSerializedString
        let pin = try HostTrustDelivery.verify(token: token, trustedPublicJwk: jwk, hostID: "host-one", subject: "subject-one", deviceID: "phone-one", thumbprint: "recipient-key", now: now)
        #expect(pin.origin == "https://host.example.com")
        let foreign = try CloudDeviceKey(softwareStore: MemoryStore()).publicJwk
        #expect(throws: CloudLoginFailure.pairing) { try HostTrustDelivery.verify(token: token, trustedPublicJwk: foreign, hostID: "host-one", subject: "subject-one", deviceID: "phone-one", thumbprint: "recipient-key", now: now) }
        #expect(throws: CloudLoginFailure.pairing) { try HostTrustDelivery.verify(token: token, trustedPublicJwk: jwk, hostID: "host-one", subject: "other-subject", deviceID: "phone-one", thumbprint: "recipient-key", now: now) }
        #expect(throws: CloudLoginFailure.pairing) { try HostTrustDelivery.verify(token: token, trustedPublicJwk: jwk, hostID: "host-one", subject: "subject-one", deviceID: "other-device", thumbprint: "recipient-key", now: now) }
        #expect(throws: CloudLoginFailure.pairing) { try HostTrustDelivery.verify(token: token, trustedPublicJwk: jwk, hostID: "host-one", subject: "subject-one", deviceID: "phone-one", thumbprint: "other-key", now: now) }
        #expect(throws: CloudLoginFailure.pairing) { try HostTrustDelivery.verify(token: token, trustedPublicJwk: jwk, hostID: "host-one", subject: "subject-one", deviceID: "phone-one", thumbprint: "recipient-key", now: now.addingTimeInterval(121)) }
        #expect(throws: CloudLoginFailure.pairing) { try HostTrustDelivery.verify(token: token + "invalid", trustedPublicJwk: jwk, hostID: "host-one", subject: "subject-one", deviceID: "phone-one", thumbprint: "recipient-key", now: now) }
    }
    @Test func signedLoopbackOriginUsesHTTPSRelayWithoutRequiringOriginHTTPS() throws {
        let key = SecKeyCreateRandomKey([kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeySizeInBits: 256] as CFDictionary, nil)!
        let jwk = try ECPublicKey(publicKey: SecKeyCopyPublicKey(key)!).parameters
        let now = Date(), origin = "http://127.0.0.1:17653", relay = "https://host-one.hosts.weftmate.com"
        func token(relay: String) throws -> String {
            let body: [String: Any] = ["iss": "host-one", "aud": "recipient-key", "sub": "subject-one", "hostId": "host-one",
                "deviceId": "phone-one", "jkt": "recipient-key", "tlsSpki": String(repeating: "A", count: 43), "publicJwk": jwk,
                "origin": origin, "relay": ["state": "online", "baseUrl": relay],
                "iat": now.timeIntervalSince1970, "exp": now.timeIntervalSince1970 + 120, "jti": UUID().uuidString]
            var header = JWSHeader(algorithm: .ES256); header.typ = "wm-host-trust+jwt"
            return try JWS(header: header, payload: Payload(JSONSerialization.data(withJSONObject: body)), signer: Signer(signatureAlgorithm: .ES256, key: key)!).compactSerializedString
        }
        let pin = try HostTrustDelivery.verify(token: token(relay: relay), trustedPublicJwk: jwk, hostID: "host-one", subject: "subject-one", deviceID: "phone-one", thumbprint: "recipient-key", now: now)
        #expect(pin.origin == origin && pin.relay?.baseUrl == relay)
        #expect(throws: CloudLoginFailure.pairing) {
            try HostTrustDelivery.verify(token: token(relay: "http://127.0.0.1:17654"), trustedPublicJwk: jwk, hostID: "host-one", subject: "subject-one", deviceID: "phone-one", thumbprint: "recipient-key", now: now, allowLoopbackHTTP: true)
        }
    }
    @Test func pairingPreservesLoopbackOriginAndRejectsHTTPRelay() throws {
        let key = try CloudDeviceKey(softwareStore: MemoryStore())
        let origin = "http://127.0.0.1:17653", relay = "https://host-one.hosts.weftmate.com"
        var fields: [String: Any] = ["hostId": "host-one", "challenge": String(repeating: "a", count: 43),
            "expiresIn": 120, "tlsSpki": String(repeating: "A", count: 43), "publicJwk": key.publicJwk,
            "origin": origin, "relay": ["state": "online", "baseUrl": relay]]
        let json = try JSONSerialization.data(withJSONObject: fields)
        for input in [json, Data(("wm1." + cloudBase64(json)).utf8), Data((relay + "/personal/v1/ui/#pair=" + cloudBase64(json)).utf8)] {
            let pair = try HostPairing.parse(input)
            #expect(pair.origin == origin && pair.relay?.baseUrl == relay)
        }
        fields["relay"] = ["state": "online", "baseUrl": "http://127.0.0.1:17654"]
        #expect(throws: (any Error).self) { try HostPairing.parse(JSONSerialization.data(withJSONObject: fields), allowLoopbackHTTP: true) }
    }

}
