import Foundation
import CryptoKit

public enum PairingFailure: Error, LocalizedError, Sendable, Equatable {
    case expired, invalid, commitment, conflict
    public var errorDescription: String? {
        switch self {
        case .expired: "配对码已过期，请在电脑上重新生成，然后重新扫码。"
        case .invalid: "这次配对已取消、失效或已用过，请重新扫码。"
        case .commitment: "两边的配对信息不一致，已停止连接。请重新扫码。"
        case .conflict: "这次配对已被另一台设备使用，请在电脑上重新生成，然后重新扫码。"
        }
    }
}

/// Values come from the cloud client's signature-verified host token, never the QR.
public struct CloudPairingIdentity: Sendable {
    public let accessToken: String
    public let issuer: String
    public let subject: String
    public let hostID: String
    public let deviceID: String
    public let thumbprint: String
}

/// Created only after the host commitment was checked and both contributions were revealed.
public struct PairingComparison: Sendable {
    public let pairing: HostPairing
    public let server: ServerConfiguration
    public let verificationCode: String
    let deviceID: String
    let thumbprint: String
}

enum PairingV2 {
    static func isNonce(_ value: String) -> Bool {
        guard value.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              let data = Data(base64Encoded: value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + "=") else { return false }
        return data.count == 32 && cloudBase64(data) == value
    }
    // JSONSerialization matches JSON.stringify: compact arrays, literal Unicode and unescaped '/'.
    static func hash(_ array: [Any]) throws -> Data {
        Data(SHA256.hash(data: try JSONSerialization.data(withJSONObject: array, options: [.withoutEscapingSlashes])))
    }
    static func hostCommitment(_ transcript: [Any], nonce: String) throws -> String {
        cloudBase64(try hash(["wm-pair-host-v2"] + transcript + [nonce]))
    }
    static func phoneCommitment(challenge: String, deviceID: String, thumbprint: String, nonce: String) throws -> String {
        cloudBase64(try hash(["wm-pair-phone-v2", challenge, deviceID, thumbprint, nonce]))
    }
    static func code(_ transcript: [Any], hostNonce: String, deviceID: String, thumbprint: String, phoneNonce: String) throws -> String {
        let digest = try hash(["wm-pair-sas-v2"] + transcript + [hostNonce, deviceID, thumbprint, phoneNonce])
        let number = digest.prefix(4).reduce(UInt32(0)) { ($0 << 8) | UInt32($1) } % 1_000_000
        return String(format: "%06u", number)
    }
}

extension HostPairing {
    public func checkExpiry(now: Date = Date()) throws {
        let remaining = Double(expiresAt) - now.timeIntervalSince1970 * 1000
        guard remaining > 0 else { throw PairingFailure.expired }
        guard remaining <= 120_000 else { throw CloudLoginFailure.pairing }
    }
    public func validate(issuer: String, subject: String, hostID: String, now: Date = Date()) throws {
        guard self.issuer == issuer, sub == subject, hostId == hostID else { throw CloudLoginFailure.pairing }
        try checkExpiry(now: now)
    }
    public func requestServer(allowLoopbackHTTP: Bool = false) throws -> ServerConfiguration {
        // HTTP loopback in origin describes the computer. Only explicit synthetic tests may send HTTP.
        if let base = relay?.baseUrl {
            let server = try ServerConfiguration(input: base, allowLoopbackHTTP: allowLoopbackHTTP)
            guard server.originString == base else { throw CloudLoginFailure.pairing }
            return server
        }
        return try ServerConfiguration(input: origin, allowLoopbackHTTP: allowLoopbackHTTP)
    }
    func publicKeyThumbprint() throws -> String {
        guard let x = publicJwk["x"], let y = publicJwk["y"], PairingV2.isNonce(x), PairingV2.isNonce(y),
              let point = Data(base64Encoded: (x + "=").replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")),
              let other = Data(base64Encoded: (y + "=").replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")) else { throw CloudLoginFailure.pairing }
        _ = try P256.Signing.PublicKey(x963Representation: Data([4]) + point + other)
        let jwk = ["crv": "P-256", "kty": "EC", "x": x, "y": y]
        return cloudBase64(Data(SHA256.hash(data: try JSONSerialization.data(withJSONObject: jwk, options: [.sortedKeys, .withoutEscapingSlashes]))))
    }
    func transcript() throws -> [Any] {
        [2, issuer, sub, hostId, tlsSpki, try publicKeyThumbprint(), challenge, expiresAt, origin, relay?.baseUrl ?? ""]
    }
}
