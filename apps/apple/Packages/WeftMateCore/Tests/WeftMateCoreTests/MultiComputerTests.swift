import Testing
import Foundation
@testable import WeftMateCore

@Suite struct MultiComputerTests {
    func directory(_ multi: Bool = true) throws -> CloudDirectory {
        let hosts:[[String:Any]]=[["id":"a","hostId":"a","name":"电脑","displayName":"电脑","type":"computer","online":true,"isCurrent":true],["id":"b","hostId":"b","name":"电脑","displayName":"电脑 (2)","type":"computer","online":false,"isCurrent":false]]
        var json:[String:Any]=["hosts":hosts,"devices":[]];if multi {json["capabilities"]=["multiHost":1]}
        return try JSONDecoder().decode(CloudDirectory.self,from:JSONSerialization.data(withJSONObject:json))
    }
    @Test func capabilityDefaultAndSourceNeverSilentlyMoves() throws {
        #expect(try directory(false).capabilities == nil)
        let value=try directory();#expect(value.capabilities?["multiHost"] == 1);#expect(value.hosts[1].computerName == "电脑 (2)")
        #expect(ComputerSelection.target(hosts:value.hosts,lastUsed:"b") == "a")
        #expect(ComputerSelection.target(hosts:value.hosts,lastUsed:"a",source:"b") == "b")
        let both=try JSONDecoder().decode(CloudDirectory.self,from:JSONSerialization.data(withJSONObject:["devices":[],"hosts":[["id":"a","name":"A","type":"computer","online":true,"isCurrent":false],["id":"b","name":"B","type":"computer","online":true,"isCurrent":false]]]))
        #expect(ComputerSelection.target(hosts:both.hosts,lastUsed:"b") == "b")
    }
    @Test func mergedRowsNamespaceSameConversationIDByComputer() {
        let chat=ConversationSummary(id:"same",title:"chat",conversationId:nil,sessionId:"session",running:false,sendAvailable:true,originalModelLabel:nil)
        #expect(ComputerConversation(hostId:"a",name:"A",online:true,conversation:chat).id != ComputerConversation(hostId:"b",name:"B",online:true,conversation:chat).id)
    }
    @Test func phoneHandoffNeverRetargetsFrozenConversation() throws {
        var state=PhoneChatState(),thread=PhoneChatThread();thread.messages=[PhoneChatMessage(role:"user",text:"synthetic turn")];state.threads=[thread]
        let a=state.prepareMigration(host:"a",generation:1)
        #expect(a.count == 1);#expect(state.prepareMigration(host:"b",generation:1).isEmpty)
        let encoder=JSONEncoder();encoder.outputFormatting = .sortedKeys
        #expect(try encoder.encode(state.prepareMigration(host:"a",generation:1)) == encoder.encode(a))
    }
    @Test func multipleVaultsSurviveRestartAndRemoveOnlyTarget() throws {
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString),keys=MemoryStore()
        defer {try? FileManager.default.removeItem(at:directory)}
        let a=OfflineIdentity(ownerId:"owner-a",hostId:"host-a",deviceId:"device-a"),b=OfflineIdentity(ownerId:"owner-b",hostId:"host-b",deviceId:"device-b")
        let first=try OfflineVault(identity:a,directory:directory,store:keys,multipleHosts:true)
        var stateA=OfflineState();stateA.synced=["turn-a"];try first.save(stateA)
        let second=try OfflineVault(identity:b,directory:directory,store:keys,multipleHosts:true)
        var stateB=OfflineState();stateB.synced=["turn-b"];try second.save(stateB)
        let reopenedA=try OfflineVault(identity:a,directory:directory,store:keys,multipleHosts:true)
        #expect(try reopenedA.load().synced == ["turn-a"]);#expect(try second.load().synced == ["turn-b"])
        try OfflineVault.clearComputer(hostID:"host-b",directory:directory,store:keys)
        #expect(try reopenedA.load().synced == ["turn-a"]);#expect(try second.load().synced.isEmpty)
        try OfflineVault.clearActive(directory:directory,store:keys)
        #expect(try reopenedA.load().synced.isEmpty)
    }
}
