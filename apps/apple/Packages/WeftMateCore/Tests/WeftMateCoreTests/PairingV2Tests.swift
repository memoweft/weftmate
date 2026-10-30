import Foundation
import CryptoKit
import Testing
@testable import WeftMateCore

@Suite struct PairingV2Tests {
    @Test func sharedEncodingVector() throws {
        var directory=URL(fileURLWithPath:#filePath).deletingLastPathComponent()
        var file:URL?
        for _ in 0..<8 {
            let candidate=directory.appendingPathComponent("tests/fixtures/pairing-v2.json")
            if FileManager.default.fileExists(atPath:candidate.path) { file=candidate;break }
            directory.deleteLastPathComponent()
        }
        let fileURL=try #require(file)
        let object=try JSONSerialization.jsonObject(with:Data(contentsOf:fileURL))
        let vector=try #require(object as? [String:Any])
        let vectorFields=try #require(vector["transcript"] as? [Any])
        let transcript=try PairingV2Attempt.json(vectorFields)
        let host=try #require(vector["hostNonce"] as? String),phone=try #require(vector["phoneNonce"] as? String)
        let device=try #require(vector["deviceId"] as? String),jkt=try #require(vector["phoneJkt"] as? String)
        #expect(try PairingV2Attempt.commitHost(transcript:transcript,nonce:host) == vector["hostCommitment"] as? String)
        let fields=try PairingV2Attempt.fields(transcript)
        let challenge=try #require(fields[6] as? String)
        #expect(try PairingV2Attempt.commitPhone(challenge:challenge,deviceID:device,jkt:jkt,nonce:phone) == vector["phoneCommitment"] as? String)
        #expect(try PairingV2Attempt.code(transcript:transcript,hostNonce:host,deviceID:device,jkt:jkt,phoneNonce:phone) == "309281")
    }
    private func pair(now:Date,issuer:String="https://cloud.example.test/personal/v1/cloud/oidc",subject:String="owner") throws -> (HostPairing,String) {
        let bytes=P256.Signing.PrivateKey().publicKey.x963Representation
        let jwk=["crv":"P-256","kty":"EC","x":PairingV2Attempt.base64(bytes.subdata(in:1..<33)),"y":PairingV2Attempt.base64(bytes.subdata(in:33..<65))]
        let jkt=PairingV2Attempt.hash(try JSONSerialization.data(withJSONObject:jwk,options:[.sortedKeys,.withoutEscapingSlashes]))
        let challenge=PairingV2Attempt.base64(Data(repeating:3,count:32)),hostNonce=PairingV2Attempt.base64(Data(repeating:4,count:32))
        let expiry=Int64(now.timeIntervalSince1970*1000)+120_000,spki=PairingV2Attempt.base64(Data(repeating:1,count:32))
        let fields:[Any]=[2,issuer,subject,"host",spki,jkt,challenge,expiry,"http://127.0.0.1:3311",""]
        return (HostPairing(challenge:challenge,expiresIn:120,hostId:"host",tlsSpki:spki,publicJwk:jwk,origin:"http://127.0.0.1:3311",relay:nil,version:2,issuer:issuer,sub:subject,expiresAt:expiry,hostCommitment:try PairingV2Attempt.commitHost(transcript:PairingV2Attempt.json(fields),nonce:hostNonce)),hostNonce)
    }
    @Test func contributionAndHostCommitmentAreBoundToIdentityAndAbsoluteExpiry() throws {
        let now=Date(timeIntervalSince1970:1_800_000_000),jkt=PairingV2Attempt.base64(Data(repeating:6,count:32))
        let (pair,host)=try pair(now:now)
        let attempt=try PairingV2Attempt(pairing:pair,issuer:pair.issuer!,subject:"owner",hostID:"host",deviceID:"phone",phoneJKT:jkt,now:now)
        let code=try attempt.verifyHost(nonce:host,expiresAt:pair.expiresAt!,now:now)
        #expect(code.count == 6 && code.allSatisfy(\.isNumber))
        #expect(throws:CloudLoginFailure.pairing) { try attempt.verifyHost(nonce:PairingV2Attempt.base64(Data(repeating:8,count:32)),expiresAt:pair.expiresAt!,now:now) }
        #expect(throws:CloudLoginFailure.pairing) { try attempt.verifyHost(nonce:host,expiresAt:pair.expiresAt!,now:now.addingTimeInterval(120)) }
        #expect(throws:CloudLoginFailure.pairing) { try PairingV2Attempt(pairing:pair,issuer:pair.issuer!,subject:"other",hostID:"host",deviceID:"phone",phoneJKT:jkt,now:now) }
        #expect(throws:CloudLoginFailure.pairing) { try PairingV2Attempt(pairing:pair,issuer:"https://other.invalid",subject:"owner",hostID:"host",deviceID:"phone",phoneJKT:jkt,now:now) }
        let second=try PairingV2Attempt(pairing:pair,issuer:pair.issuer!,subject:"owner",hostID:"host",deviceID:"phone",phoneJKT:jkt,now:now)
        #expect(second.phoneCommitment != attempt.phoneCommitment)
    }
    @Test func badHostCommitmentStopsBeforePhoneReveal() async throws {
        let now=Date(),(pair,_)=try pair(now:now)
        let key=try CloudDeviceKey(namespace:"pairing-order-"+UUID().uuidString)
        let attempt=try PairingV2Attempt(pairing:pair,issuer:pair.issuer!,subject:"owner",hostID:"host",deviceID:"apple-"+key.thumbprint,phoneJKT:key.thumbprint,now:now)
        let http=PairingOrderHTTP(expiry:pair.expiresAt!)
        let client=PersonalClient(transport:http)
        await #expect(throws:CloudLoginFailure.pairing) {
            try await client.preparePairingV2(server:ServerConfiguration(input:"https://host.example.test"),accessToken:"synthetic-token",deviceName:"synthetic",key:key,attempt:attempt)
        }
        let paths=await http.paths
        #expect(paths == ["/personal/v1/auth/cloud-nonce","/personal/v1/cloud/pairings/join"])
    }
}

private actor PairingOrderHTTP:HTTPTransport {
    let expiry:Int64
    var paths:[String]=[]
    init(expiry:Int64) {self.expiry=expiry}
    func send(_ request:URLRequest) throws -> HTTPResponse {
        let path=request.url!.path;paths.append(path)
        let body:[String:Any]=path.hasSuffix("cloud-nonce") ? ["nonce":PairingV2Attempt.base64(Data(repeating:7,count:32))] : ["state":"committed","hostNonce":PairingV2Attempt.base64(Data(repeating:9,count:32)),"expiresAt":expiry]
        return HTTPResponse(status:200,body:try JSONSerialization.data(withJSONObject:body))
    }
}
