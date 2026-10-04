import Foundation
import Security
import CryptoKit

/// Synchronous atomic store operations prevent actor reentrancy during account changes.
public protocol CredentialStore: Sendable {
    func load(key: String) throws -> Data?
    func save(_ data: Data, key: String) throws
    func delete(key: String) throws
}

public struct KeychainCredentialStore: CredentialStore {
    private let service: String
    public init(service: String = "com.weftmate.apple.credentials") { self.service = service }
    private func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: key, kSecAttrSynchronizable as String: false]
    }
    public func load(key: String) throws -> Data? {
        var q = query(key); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw APIFailure.credentialStorage }
        return data
    }
    public func save(_ data: Data, key: String) throws {
        let q = query(key)
        let update = [kSecValueData as String: data]
        let status = SecItemUpdate(q as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var insert = q; insert[kSecValueData as String] = data
            // Never sync a phone credential/identity into a Watch or another computer.
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { throw APIFailure.credentialStorage }
        } else if status != errSecSuccess { throw APIFailure.credentialStorage }
    }
    public func delete(key: String) throws {
        let status = SecItemDelete(query(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw APIFailure.credentialStorage }
    }
}

public struct DeviceIdentity: Sendable, Equatable {
    public let identifier: String
    public let platform: ApplePlatform
    public var defaultName: String { "\(platform.deviceLabel) · \(identifier.prefix(8))" }
    public static func load(platform: ApplePlatform = .current,
                            store: any CredentialStore = KeychainCredentialStore()) throws -> DeviceIdentity {
        let key = "installation.\(platform.rawValue)"
        if let saved = try store.load(key: key), let raw = String(data: saved, encoding: .utf8), UUID(uuidString: raw) != nil {
            return .init(identifier: raw, platform: platform)
        }
        let id = UUID().uuidString.lowercased()
        try store.save(Data(id.utf8), key: key)
        return .init(identifier: id, platform: platform)
    }
}

func credentialKey(server: ServerConfiguration, platform: ApplePlatform) -> String {
    let hash = SHA256.hash(data: Data(server.originString.utf8)).map { String(format: "%02x", $0) }.joined()
    return "session.\(platform.rawValue).\(hash)"
}
