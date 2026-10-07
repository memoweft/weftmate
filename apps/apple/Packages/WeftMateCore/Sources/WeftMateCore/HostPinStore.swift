import Foundation
import Security
import CryptoKit

public struct HostPinStore: Sendable {
    private let store: any CredentialStore
    public init(store: any CredentialStore = KeychainCredentialStore(service: "com.weftmate.apple.host-pins")) { self.store = store }
    public func pin(for origin: String) throws -> String? {
        guard let data = try store.load(key: origin) else { return nil }
        guard let pin = String(data: data, encoding: .utf8), pin.count == 43 else { throw APIFailure.credentialStorage }
        return pin
    }
    /// Pin comes only from an explicit QR/paste or authenticated direct-host pairing response.
    public func save(_ pin: String, for origin: String) throws {
        guard pin.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              try ServerConfiguration(input: origin).originString == origin else { throw APIFailure.invalidResponse }
        if let old = try self.pin(for: origin), old != pin { throw CloudLoginFailure.pinChanged }
        try store.save(Data(pin.utf8), key: origin)
    }
    public static func spkiFingerprint(_ key: SecKey) throws -> String {
        guard let attrs = SecKeyCopyAttributes(key) as? [String: Any],
              (attrs[kSecAttrKeyType as String] as? String) == (kSecAttrKeyTypeECSECPrimeRandom as String),
              let bytes = SecKeyCopyExternalRepresentation(key, nil) as Data?, bytes.count == 65 else {
            throw APIFailure.transport(.certificate)
        }
        // SubjectPublicKeyInfo: id-ecPublicKey + prime256v1 + X9.63 point (S2 content key is P-256).
        let prefix: [UInt8] = [0x30,0x59,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,
            0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x03,0x42,0x00]
        return cloudBase64(Data(SHA256.hash(data: Data(prefix) + bytes)))
    }
}
