import Foundation
import CryptoKit
import Security

public struct OfflineTaskReference: Codable, Sendable, Identifiable {
    public let id, title: String
    public let projectId: String?
}
public struct OfflineTaskReceipt: Codable, Sendable {
    public let id, hostId, state: String
}
public struct OfflineWorkTask: Codable, Sendable, Identifiable {
    public let id, hostId: String
    public let generation: Int
    public let envelope: OfflineEnvelope
    public var state: String
    public static func prepare(text: String, reference: OfflineTaskReference, snapshot: OfflineSnapshot,
                               authorization: OfflineAuthorization, deviceID: String, now: Date = Date()) throws -> Self {
        guard authorization.supportsTasks, authorization.authorized, authorization.hostId == snapshot.control.hostId,
              authorization.accountId == snapshot.control.accountId, authorization.generation == snapshot.generation,
              snapshot.taskReferences?.contains(where: { $0.id == reference.id && $0.projectId == reference.projectId }) == true,
              let projectID=reference.projectId, let recipient=snapshot.taskRecipient else { throw OfflineFailure.authorization }
        let normalized=text.trimmingCharacters(in:.whitespacesAndNewlines)
        guard !normalized.isEmpty,normalized.utf16.count <= 8192,SharedValidation.id(deviceID) else { throw OfflineFailure.invalid }
        let id=UUID().uuidString.lowercased()
        let body: JSONValue = .object(["text":.string(normalized),"sessionId":.string(reference.id),"projectId":.string(projectID),"createdAt":.number(now.timeIntervalSince1970*1000)])
        let aad: [String: JSONValue] = ["version":.number(1),"purpose":.string("offline-task"),"accountId":.string(authorization.accountId),
            "hostId":.string(authorization.hostId),"deviceId":.string(deviceID),"generation":.number(Double(snapshot.generation)),"id":.string(id)]
        return .init(id:id,hostId:authorization.hostId,generation:snapshot.generation,
                     envelope:try seal(body,recipient:recipient,header:aad),state:"sending")
    }
    private static func seal(_ body: JSONValue, recipient: [String: String], header: [String: JSONValue]) throws -> OfflineEnvelope {
        guard recipient["kty"] == "RSA",recipient["e"] == "AQAB",let modulus=recipient["n"],
              let bytes=Data(base64Encoded:modulus.replacingOccurrences(of:"-",with:"+").replacingOccurrences(of:"_",with:"/") + String(repeating:"=",count:(4-modulus.count%4)%4)),
              bytes.count == 256 else { throw OfflineFailure.invalid }
        func der(_ tag: UInt8,_ body: Data) -> Data {
            let count=body.count
            let length: [UInt8] = count<128 ? [UInt8(count)] : count<256 ? [0x81,UInt8(count)] : [0x82,UInt8(count>>8),UInt8(count&255)]
            return Data([tag]+length)+body
        }
        let n=bytes.first! >= 128 ? Data([0])+bytes : bytes
        let publicDER=der(0x30,der(0x02,n)+der(0x02,Data([1,0,1])))
        guard let key=SecKeyCreateWithData(publicDER as CFData,[kSecAttrKeyType:kSecAttrKeyTypeRSA,kSecAttrKeyClass:kSecAttrKeyClassPublic,kSecAttrKeySizeInBits:2048] as CFDictionary,nil) else { throw OfflineFailure.invalid }
        let keyJSON="{\"kty\":\"RSA\",\"n\":\""+modulus+"\",\"e\":\"AQAB\"}"
        var fields=header;fields["keyId"] = .string(SHA256.hash(data:Data(keyJSON.utf8)).map { String(format:"%02x",$0) }.joined())
        let encoder=JSONEncoder();encoder.outputFormatting=[.sortedKeys,.withoutEscapingSlashes]
        let aad=try encoder.encode(fields)
        var raw=Data(count:32)
        let random=raw.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault,32,$0.baseAddress!) }
        guard random == errSecSuccess else { throw APIFailure.credentialStorage }
        defer { raw.resetBytes(in:0..<raw.count) }
        guard let wrapped=SecKeyCreateEncryptedData(key,.rsaEncryptionOAEPSHA256,raw as CFData,nil) else { throw OfflineFailure.invalid }
        let sealed=try AES.GCM.seal(encoder.encode(body),using:SymmetricKey(data:raw),authenticating:aad)
        return try JSONDecoder().decode(OfflineEnvelope.self,from:encoder.encode([
            "version":JSONValue.number(1),"algorithm":.string("RSA-OAEP-256+A256GCM"),"aad":.string(cloudBase64(aad)),
            "wrappedKey":.string(cloudBase64(wrapped as Data)),"iv":.string(cloudBase64(Data(sealed.nonce))),
            "ciphertext":.string(cloudBase64(sealed.ciphertext+sealed.tag))]))
    }
}
