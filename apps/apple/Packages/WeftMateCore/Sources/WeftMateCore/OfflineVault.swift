import Foundation
import CryptoKit
import Security

/// All methods are synchronous and serialized by OfflineReplica's main actor.
/// Only ciphertext is written to files. RSA and local AES keys are ThisDeviceOnly Keychain items.
public final class OfflineVault {
    let identity: OfflineIdentity
    let store: any CredentialStore
    let file: URL
    let keyPrefix: String
    public init(identity: OfflineIdentity, directory: URL, store: any CredentialStore = KeychainCredentialStore()) throws {
        self.identity = identity; self.store = store
        let digest = SHA256.hash(data: Data(identity.scope.utf8)).map { String(format: "%02x", $0) }.joined()
        keyPrefix = "offline.v1." + digest
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var excluded = directory; var values = URLResourceValues(); values.isExcludedFromBackup = true
        try excluded.setResourceValues(values)
        file = directory.appendingPathComponent(digest + ".sealed")
        if let prior = try store.load(key: "offline.active"), prior != Data(keyPrefix.utf8) {
            try Self.clearActive(directory: directory, store: store)
        }
        try rememberScope()
    }
    private func rememberScope() throws { try store.save(Data(keyPrefix.utf8), key: "offline.active") }
    /// Also works before a replica has been loaded, e.g. logout immediately after app restore.
    public static func clearActive(directory: URL, store: any CredentialStore) throws {
        guard let bytes = try store.load(key: "offline.active"), let prefix = String(data: bytes, encoding: .utf8) else { return }
        let digest = String(prefix.dropFirst("offline.v1.".count))
        guard prefix.hasPrefix("offline.v1."), digest.count == 64, digest.allSatisfy({ $0.isHexDigit }) else { throw APIFailure.credentialStorage }
        var failure: (any Error)?
        for key in [prefix + ".aes", prefix + ".rsa"] { do { try store.delete(key: key) } catch { failure = error } }
        let file = directory.appendingPathComponent(digest + ".sealed")
        do { if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) } } catch { failure = error }
        if let failure { throw failure }
        try store.delete(key: "offline.active")
    }
    func privateKey() throws -> SecKey {
        try rememberScope()
        if let bytes = try store.load(key: keyPrefix + ".rsa") {
            guard let key = SecKeyCreateWithData(bytes as CFData,
                [kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeyClass: kSecAttrKeyClassPrivate,
                 kSecAttrKeySizeInBits: 2048] as CFDictionary, nil) else { throw OfflineFailure.invalid }
            return key
        }
        guard let key = SecKeyCreateRandomKey([kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeySizeInBits: 2048] as CFDictionary, nil),
              let bytes = SecKeyCopyExternalRepresentation(key, nil) else { throw APIFailure.credentialStorage }
        try store.save(bytes as Data, key: keyPrefix + ".rsa")
        return key
    }
    public func publicJwk() throws -> [String: String] {
        guard let key = SecKeyCopyPublicKey(try privateKey()), let external = SecKeyCopyExternalRepresentation(key, nil) else { throw OfflineFailure.invalid }
        // Security exports an RSA public key as PKCS#1 DER: SEQUENCE(INTEGER n, INTEGER e).
        let bytes = [UInt8](external as Data); var offset = 0
        func element(_ tag: UInt8) throws -> Data {
            guard offset + 2 <= bytes.count, bytes[offset] == tag else { throw OfflineFailure.invalid }
            offset += 1; var length = Int(bytes[offset]); offset += 1
            if length & 128 != 0 {
                let count = length & 127; length = 0
                guard count > 0, count <= 4, offset + count <= bytes.count else { throw OfflineFailure.invalid }
                for _ in 0..<count { length = length * 256 + Int(bytes[offset]); offset += 1 }
            }
            guard offset + length <= bytes.count else { throw OfflineFailure.invalid }
            if tag == 0x30 { return Data() }
            let result = Data(bytes[offset..<(offset + length)]); offset += length
            return result
        }
        _ = try element(0x30)
        let n = try element(2).drop(while: { $0 == 0 }), e = try element(2).drop(while: { $0 == 0 })
        guard n.count == 256, Data(e) == Data([1, 0, 1]) else { throw OfflineFailure.invalid }
        return ["kty": "RSA", "n": cloudBase64(Data(n)), "e": cloudBase64(Data(e))]
    }
    public func open(_ envelope: OfflineEnvelope, identity: OfflineIdentity) throws -> OfflineSnapshot {
        guard envelope.version == 1, envelope.algorithm == "RSA-OAEP-256+A256GCM", identity.scope == self.identity.scope else { throw OfflineFailure.identity }
        let aad = try Self.decode(envelope.aad)
        struct Header: Decodable { let version: Int; let ownerId, hostId, deviceId, keyId: String }
        let header = try JSONDecoder().decode(Header.self, from: aad), jwk = try publicJwk()
        // M3-A hashes this exact insertion order, rather than RFC 7638 canonical order.
        let keyJSON = "{\"kty\":\"RSA\",\"n\":\"\(jwk["n"]!)\",\"e\":\"AQAB\"}"
        let keyID = SHA256.hash(data: Data(keyJSON.utf8)).map { String(format: "%02x", $0) }.joined()
        guard header.version == 1, header.ownerId == identity.ownerId, header.hostId == identity.hostId,
              header.deviceId == identity.deviceId, header.keyId == keyID else { throw OfflineFailure.identity }
        guard let raw = SecKeyCreateDecryptedData(try privateKey(), .rsaEncryptionOAEPSHA256,
            try Self.decode(envelope.wrappedKey) as CFData, nil), (raw as Data).count == 32 else { throw OfflineFailure.invalid }
        var contentKey = raw as Data
        defer { contentKey.resetBytes(in: 0..<contentKey.count) }
        let encrypted = try Self.decode(envelope.ciphertext), nonce = try Self.decode(envelope.iv)
        guard nonce.count == 12, encrypted.count >= 16, encrypted.count <= 2 * 1024 * 1024 + 16 else { throw OfflineFailure.invalid }
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce), ciphertext: encrypted.dropLast(16), tag: encrypted.suffix(16))
        let plain = try AES.GCM.open(box, using: SymmetricKey(data: contentKey), authenticating: aad)
        return try JSONDecoder().decode(OfflineSnapshot.self, from: plain)
    }
    public func load() throws -> OfflineState {
        guard FileManager.default.fileExists(atPath: file.path) else { return OfflineState() }
        guard let key = try store.load(key: keyPrefix + ".aes") else {
            try FileManager.default.removeItem(at: file); return OfflineState()
        }
        let plain = try AES.GCM.open(AES.GCM.SealedBox(combined: Data(contentsOf: file)), using: SymmetricKey(data: key), authenticating: Data(identity.scope.utf8))
        return try JSONDecoder().decode(OfflineState.self, from: plain)
    }
    public func save(_ state: OfflineState) throws {
        try rememberScope()
        let key = SymmetricKey(size: .bits256)
        let sealed = try AES.GCM.seal(JSONEncoder().encode(state), using: key, authenticating: Data(identity.scope.utf8))
        // Fail-closed crash order: old ciphertext cannot be read after key replacement.
        try store.save(key.withUnsafeBytes { Data($0) }, key: keyPrefix + ".aes")
        try sealed.combined!.write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
    public func clear() throws {
        // Remove both keys even if deleting the file fails; never keep a recoverable old copy.
        var failure: (any Error)?
        for suffix in [".aes", ".rsa"] { do { try store.delete(key: keyPrefix + suffix) } catch { failure = error } }
        do { if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) } } catch { failure = error }
        if let failure { throw failure }
        if try store.load(key: "offline.active") == Data(keyPrefix.utf8) { try store.delete(key: "offline.active") }
    }
    static func decode(_ value: String) throws -> Data {
        let normalized = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        guard let result = Data(base64Encoded: normalized + String(repeating: "=", count: (4 - normalized.count % 4) % 4)) else { throw OfflineFailure.invalid }
        return result
    }
}
