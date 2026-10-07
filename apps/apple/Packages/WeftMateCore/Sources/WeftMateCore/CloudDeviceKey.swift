import Foundation
import Security
import CryptoKit
import JOSESwift

func cloudBase64(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}

/// One installation key; Secure Enclave references and software keys never leave this device.
public final class CloudDeviceKey: @unchecked Sendable {
    private let key: SecKey
    public let publicJwk: [String: String]
    public let secureEnclave: Bool
    public init(namespace: String = "com.weftmate.apple.cloud", softwareStore: (any CredentialStore)? = nil) throws {
        let store = softwareStore ?? KeychainCredentialStore(service: namespace)
        let tag = Data((namespace + ".p256").utf8)
        let query: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, kSecReturnRef as String: true,
            kSecAttrSynchronizable as String: false]
        var result: CFTypeRef?
        let status = softwareStore == nil ? SecItemCopyMatching(query as CFDictionary, &result) : errSecItemNotFound
        let privateKey: SecKey
        if status == errSecSuccess, let result {
            privateKey = (result as! SecKey); secureEnclave = true
        } else {
            guard status == errSecItemNotFound else { throw APIFailure.credentialStorage }
            if let saved = try store.load(key: "p256.software") {
                let signing = try P256.Signing.PrivateKey(rawRepresentation: saved)
                guard let restored = SecKeyCreateWithData(signing.x963Representation as CFData,
                    [kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeyClass: kSecAttrKeyClassPrivate] as CFDictionary, nil)
                else { throw APIFailure.credentialStorage }
                privateKey = restored; secureEnclave = false
            } else {
                let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, .privateKeyUsage, nil)
                let attrs: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
                    kSecAttrKeySizeInBits as String: 256, kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
                    kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: true,
                        kSecAttrApplicationTag as String: tag, kSecAttrAccessControl as String: access as Any]]
                if softwareStore == nil, let enclave = SecKeyCreateRandomKey(attrs as CFDictionary, nil) {
                    privateKey = enclave; secureEnclave = true
                } else {
                    let signing = P256.Signing.PrivateKey()
                    try store.save(signing.rawRepresentation, key: "p256.software")
                    guard let created = SecKeyCreateWithData(signing.x963Representation as CFData,
                        [kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeyClass: kSecAttrKeyClassPrivate] as CFDictionary, nil)
                    else { throw APIFailure.credentialStorage }
                    privateKey = created; secureEnclave = false
                }
            }
        }
        key = privateKey
        guard let pub = SecKeyCopyPublicKey(privateKey), let bytes = SecKeyCopyExternalRepresentation(pub, nil) as Data?, bytes.count == 65 else {
            throw APIFailure.credentialStorage
        }
        publicJwk = ["kty": "EC", "crv": "P-256", "x": cloudBase64(bytes.subdata(in: 1..<33)), "y": cloudBase64(bytes.subdata(in: 33..<65))]
    }
    public var thumbprint: String {
        let bytes = try! JSONSerialization.data(withJSONObject: publicJwk, options: [.sortedKeys, .withoutEscapingSlashes])
        return cloudBase64(Data(SHA256.hash(data: bytes)))
    }
    public func proof(url: URL, method: String = "POST", accessToken: String? = nil, nonce: String? = nil, now: Date = Date()) throws -> String {
        let header = try JWSHeader(parameters: ["alg": "ES256", "typ": "dpop+jwt", "jwk": publicJwk])
        var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        parts.query = nil; parts.fragment = nil
        var payload: [String: Any] = ["jti": UUID().uuidString.lowercased(), "iat": Int(now.timeIntervalSince1970),
            "htm": method, "htu": parts.url!.absoluteString]
        if let accessToken { payload["ath"] = cloudBase64(Data(SHA256.hash(data: Data(accessToken.utf8)))) }
        if let nonce { payload["nonce"] = nonce }
        guard let signer = Signer(signatureAlgorithm: .ES256, key: key) else { throw APIFailure.credentialStorage }
        return try JWS(header: header, payload: Payload(JSONSerialization.data(withJSONObject: payload)), signer: signer).compactSerializedString
    }
}
