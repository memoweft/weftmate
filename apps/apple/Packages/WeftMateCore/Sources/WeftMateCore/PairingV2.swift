import Foundation
import CryptoKit
import Security

/// The ordered transcript is rebuilt from independently checked QR/account/key fields.
public struct PairingV2Attempt: Sendable {
    public let pairing: HostPairing
    public let deviceID: String
    public let phoneJKT: String
    public let phoneNonce: String
    public let phoneCommitment: String
    private let transcript: Data
    public init(pairing:HostPairing,issuer:String,subject:String,hostID:String,deviceID:String,phoneJKT:String,now:Date=Date(),nonce:Data?=nil) throws {
        guard pairing.version == 2,pairing.issuer == issuer,pairing.sub == subject,pairing.hostId == hostID,
              let expires=pairing.expiresAt,expires > Int64(now.timeIntervalSince1970*1000),
              expires <= Int64(now.timeIntervalSince1970*1000)+120_000,
              Self.nonce(pairing.challenge),Self.nonce(pairing.tlsSpki),let commitment=pairing.hostCommitment,Self.nonce(commitment),
              !deviceID.isEmpty,Self.nonce(phoneJKT) else { throw CloudLoginFailure.pairing }
        let members=["crv","kty","x","y"]
        if let base=pairing.relay?.baseUrl {_ = try ServerConfiguration(input:base)}
        guard pairing.publicJwk["kty"] == "EC",pairing.publicJwk["crv"] == "P-256",pairing.publicJwk["d"] == nil,
              members.allSatisfy({pairing.publicJwk[$0] != nil}) else { throw CloudLoginFailure.pairing }
        let publicKey=Dictionary(uniqueKeysWithValues:members.map { ($0,pairing.publicJwk[$0]!) })
        let hostJKT=Self.hash(try JSONSerialization.data(withJSONObject:publicKey,options:[.sortedKeys,.withoutEscapingSlashes]))
        let fields:[Any]=[2,issuer,subject,hostID,pairing.tlsSpki,hostJKT,pairing.challenge,expires,pairing.origin,pairing.relay?.baseUrl ?? ""]
        self.transcript=try Self.json(fields)
        var bytes=nonce ?? Data(count:32)
        if nonce == nil {
            let result=bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault,32,$0.baseAddress!) }
            guard result == errSecSuccess else { throw CloudLoginFailure.pairing }
        }
        guard bytes.count == 32 else { throw CloudLoginFailure.pairing }
        self.pairing=pairing;self.deviceID=deviceID;self.phoneJKT=phoneJKT;self.phoneNonce=Self.base64(bytes)
        self.phoneCommitment=try Self.commitPhone(challenge:pairing.challenge,deviceID:deviceID,jkt:phoneJKT,nonce:self.phoneNonce)
    }
    public func verifyHost(nonce:String,expiresAt:Int64,now:Date=Date()) throws -> String {
        guard Self.nonce(nonce),expiresAt == pairing.expiresAt,expiresAt > Int64(now.timeIntervalSince1970*1000),
              try Self.commitHost(transcript:transcript,nonce:nonce) == pairing.hostCommitment else { throw CloudLoginFailure.pairing }
        return try Self.code(transcript:transcript,hostNonce:nonce,deviceID:deviceID,jkt:phoneJKT,phoneNonce:phoneNonce)
    }
    static func json(_ fields:[Any]) throws -> Data { try JSONSerialization.data(withJSONObject:fields,options:[.withoutEscapingSlashes]) }
    static func base64(_ bytes:Data) -> String { bytes.base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"") }
    static func hash(_ bytes:Data) -> String { base64(Data(SHA256.hash(data:bytes))) }
    static func nonce(_ text:String) -> Bool { text.range(of:"^[A-Za-z0-9_-]{43}$",options:.regularExpression) != nil }
    static func fields(_ data:Data) throws -> [Any] { guard let fields=try JSONSerialization.jsonObject(with:data) as? [Any] else { throw CloudLoginFailure.pairing };return fields }
    static func commitHost(transcript:Data,nonce:String) throws -> String { hash(try json(["wm-pair-host-v2"] + fields(transcript) + [nonce])) }
    static func commitPhone(challenge:String,deviceID:String,jkt:String,nonce:String) throws -> String { hash(try json(["wm-pair-phone-v2",challenge,deviceID,jkt,nonce])) }
    static func code(transcript:Data,hostNonce:String,deviceID:String,jkt:String,phoneNonce:String) throws -> String {
        let bytes=Array(SHA256.hash(data:try json(["wm-pair-sas-v2"] + fields(transcript) + [hostNonce,deviceID,jkt,phoneNonce])))
        let number=bytes.prefix(4).reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        return String(format:"%06u",number % 1_000_000)
    }
}
