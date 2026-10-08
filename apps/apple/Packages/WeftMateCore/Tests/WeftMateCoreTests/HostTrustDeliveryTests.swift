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
}
