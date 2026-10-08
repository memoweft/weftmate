import Foundation
import Security
import CryptoKit
import JOSESwift

/// The caller obtains the anchor through an existing pinned channel or a physically scanned QR.
/// This verifier never takes an anchor from the token header or cloud directory.
public enum HostTrustDelivery {
    public static func verify(token: String, trustedPublicJwk: [String: String], hostID: String,
                              subject: String, deviceID: String, thumbprint: String, now: Date = Date()) throws -> HostTrustPin {
        do {
            let jws = try JWS(compactSerialization: token)
            guard jws.header.algorithm == .ES256, jws.header.typ == "wm-host-trust+jwt",
                  jws.header.jku == nil, jws.header.x5u == nil, jws.header.crit == nil,
                  trustedPublicJwk["kty"] == "EC", trustedPublicJwk["crv"] == "P-256", trustedPublicJwk["d"] == nil else { throw CloudLoginFailure.pairing }
            let publicKey = try ECPublicKey(data: JSONSerialization.data(withJSONObject: trustedPublicJwk)).converted(to: SecKey.self)
            guard let verifier = Verifier(signatureAlgorithm: .ES256, key: publicKey) else { throw CloudLoginFailure.pairing }
            let payload = try JSONDecoder().decode(HostTrustPin.self, from: jws.validate(using: verifier).payload.data())
            guard payload.iss == hostID, payload.hostId == hostID, payload.sub == subject,
                  payload.aud == thumbprint, payload.jkt == thumbprint, payload.deviceId == deviceID,
                  payload.exp > now.timeIntervalSince1970, payload.iat <= now.timeIntervalSince1970 + 30,
                  payload.exp > payload.iat, payload.exp - payload.iat <= 120, !payload.jti.isEmpty,
                  payload.tlsSpki.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { throw CloudLoginFailure.pairing }
            let members = ["kty", "crv", "x", "y"]
            guard members.allSatisfy({ payload.publicJwk[$0] == trustedPublicJwk[$0] }) else { throw CloudLoginFailure.pairing }
            _ = try ServerConfiguration(input: payload.origin)
            if let base = payload.relay?.baseUrl { _ = try ServerConfiguration(input: base) }
            return payload
        } catch { throw CloudLoginFailure.pairing }
    }
}
public struct HostTrustPin: Decodable, Sendable {
    public let iss: String; public let aud: String; public let sub: String
    public let hostId: String; public let deviceId: String; public let jkt: String
    public let tlsSpki: String; public let publicJwk: [String: String]
    public let origin: String; public let relay: HostPairing.Relay?
    public let iat: Double; public let exp: Double; public let jti: String
}
