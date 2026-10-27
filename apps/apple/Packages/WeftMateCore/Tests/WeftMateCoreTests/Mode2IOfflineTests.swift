import Foundation
import Testing
import Security
import CryptoKit
@testable import WeftMateCore

@MainActor @Test func mode2iOfflineWorkEncryptsOnlyAfterCapabilityAndExplicitChoice() throws {
    let keys=Mode2IKeys(),directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at:directory) }
    let identity=OfflineIdentity(ownerId:"owner",hostId:"host",deviceId:"cookie-device")
    let vault=try OfflineVault(identity:identity,directory:directory,store:keys)
    let publicJwk=try vault.publicJwk()
    let data: [String:Any] = ["generation":3,"reset":false,"items":[],"remove":[],"hashes":[:],"truncated":false,"recent":[],
        "control":["accountId":"cloud-account","hostId":"host","generation":3],"taskRecipient":publicJwk,
        "taskReferences":[["id":"work-session","title":"合成工作","projectId":"project-a"]]]
    let snapshot=try JSONDecoder().decode(OfflineSnapshot.self,from:JSONSerialization.data(withJSONObject:data))
    let reference=snapshot.taskReferences![0]
    var auth=try JSONDecoder().decode(OfflineAuthorization.self,from:Data("{\"accountId\":\"cloud-account\",\"hostId\":\"host\",\"generation\":3,\"authorized\":true}".utf8))
    #expect(throws: OfflineFailure.authorization) { try OfflineWorkTask.prepare(text:"合成机密交代",reference:reference,snapshot:snapshot,authorization:auth,deviceID:"physical-device") }
    auth.capabilities=["offlineTasks":.number(1)]
    let task=try OfflineWorkTask.prepare(text:"合成机密交代",reference:reference,snapshot:snapshot,authorization:auth,deviceID:"physical-device")
    let encoded=try JSONEncoder().encode(task)
    #expect(!String(decoding:encoded,as:UTF8.self).contains("合成机密交代"))
    let aad=try OfflineVault.decode(task.envelope.aad)
    let header=try JSONDecoder().decode(JSONValue.self,from:aad)
    #expect(header["purpose"]?.string == "offline-task" && header["deviceId"]?.string == "physical-device")
    #expect(header["accountId"]?.string == "cloud-account" && header["hostId"]?.string == "host")
    let privateKey=try #require(SecKeyCreateWithData(keys.rsaBytes()! as CFData,[kSecAttrKeyType:kSecAttrKeyTypeRSA,kSecAttrKeyClass:kSecAttrKeyClassPrivate,kSecAttrKeySizeInBits:2048] as CFDictionary,nil))
    let raw=try #require(SecKeyCreateDecryptedData(privateKey,.rsaEncryptionOAEPSHA256,try OfflineVault.decode(task.envelope.wrappedKey) as CFData,nil)) as Data
    let ciphertext=try OfflineVault.decode(task.envelope.ciphertext)
    let box=try AES.GCM.SealedBox(nonce:AES.GCM.Nonce(data:OfflineVault.decode(task.envelope.iv)),ciphertext:ciphertext.dropLast(16),tag:ciphertext.suffix(16))
    let plain=try AES.GCM.open(box,using:SymmetricKey(data:raw),authenticating:aad)
    let body=try JSONDecoder().decode(JSONValue.self,from:plain)
    #expect(body["text"]?.string == "合成机密交代" && body["sessionId"]?.string == "work-session" && body["projectId"]?.string == "project-a")
    let engine=try OfflineReplica(vault:vault)
    try engine.merge(snapshot);try engine.retainWorkTask(task)
    let restarted=try OfflineReplica(vault:vault)
    #expect(restarted.state.workTasks?.first?.id == task.id)
    #expect(restarted.state.workTasks?.first?.envelope.ciphertext == task.envelope.ciphertext)
    // Merely displaying the work tab creates no task; only retain after prepare writes one.
    #expect(snapshot.taskReferences?.count == 1 && engine.state.workTasks?.count == 1)
    var changed=auth;changed.capabilities=["offlineTasks":.number(2)]
    #expect(!changed.supportsTasks)
    #expect(throws: OfflineFailure.authorization) { try OfflineWorkTask.prepare(text:"合成交代",reference:reference,snapshot:snapshot,authorization:changed,deviceID:"physical-device") }
}

@MainActor @Test func mode2iFix1MemoryRemovalPreservesWorkCiphertextAcrossRestart() throws {
    let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString),keys=Mode2IKeys()
    defer { try? FileManager.default.removeItem(at:directory) }
    let vault=try OfflineVault(identity:.init(ownerId:"owner",hostId:"host",deviceId:"device"),directory:directory,store:keys)
    let before=try JSONDecoder().decode(OfflineSnapshot.self,from:Data("{\"generation\":3,\"reset\":false,\"items\":[{\"id\":\"memory-old\",\"kind\":\"cognition\",\"text\":\"合成记忆\",\"sources\":[],\"currentState\":\"current\"}],\"remove\":[],\"hashes\":{\"memory-old\":\"hash\"},\"truncated\":false,\"recent\":[],\"control\":{\"accountId\":\"owner\",\"hostId\":\"host\",\"generation\":3}}".utf8))
    let task=try JSONDecoder().decode(OfflineWorkTask.self,from:Data("{\"id\":\"unconfirmed-work\",\"hostId\":\"host\",\"generation\":3,\"state\":\"sending\",\"envelope\":{\"version\":1,\"algorithm\":\"RSA-OAEP-256+A256GCM\",\"aad\":\"synthetic-aad\",\"wrappedKey\":\"synthetic-key\",\"iv\":\"synthetic-iv\",\"ciphertext\":\"only-original-ciphertext\"}}".utf8))
    let engine=try OfflineReplica(vault:vault);try engine.merge(before);try engine.retainWorkTask(task)
    var wire=try JSONSerialization.jsonObject(with:JSONEncoder().encode(before)) as! [String:Any]
    wire["items"] = [];wire["remove"] = ["memory-old"];wire["hashes"] = [String:String]()
    let delta=try JSONDecoder().decode(OfflineSnapshot.self,from:JSONSerialization.data(withJSONObject:wire))
    try engine.merge(delta);try vault.save(engine.state)
    let restarted=try OfflineReplica(vault:vault)
    #expect(restarted.state.workTasks?.first?.id == task.id)
    #expect(restarted.state.workTasks?.first?.envelope.ciphertext == task.envelope.ciphertext)
    #expect(restarted.state.workTasks?.first?.state == "sending")
    #expect(restarted.state.snapshot?.items.isEmpty == true)
    #expect(restarted.state.pendingSubmission == nil && restarted.state.phoneTurnFragments == nil)
}
