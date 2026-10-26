import Foundation
import CryptoKit
import Testing
@testable import WeftMateCore

#if os(macOS)
/// Captures Swift's actual PersonalClient bytes and sends them through the desktop route.
@Suite(.serialized) @MainActor struct PhoneTurnFragmentTests {
    private func fixture() async throws -> PhoneSyncFixture {
        let f=try await PhoneSyncFixture(sourceName:"phone_turn_fragment_server.mjs")
        do { try await f.sync();return f } catch { f.close();throw error }
    }
    private func enqueue(_ f: PhoneSyncFixture,user: String,reply: String = "完整回复") throws -> [OfflineTurn] {
        var long=PhoneChatThread(),next=PhoneChatThread()
        var message=PhoneChatMessage(role:"user",text:user)
        message.date=Date(timeIntervalSince1970:1_700_000_000)
        var response=PhoneChatMessage(role:"assistant",text:reply)
        response.memoryRefs=[.init(kind:"cognition",id:"original-memory")];response.dependencyComplete=false
        long.messages=[message,response]
        next.messages=[.init(role:"user",text:"下一轮继续上交")]
        f.phone.threads=[long,next]
        let turns=f.phone.prepareMigration(host:f.identity.hostId,generation:1)
        try f.engine.enqueuePhoneTurns(turns,generation:1,handover:f.phone.migrations?[f.identity.hostId]?.handover)
        return turns
    }
    @Test(arguments:[16384,16385]) func utf16BoundaryAndNextTurn(units: Int) async throws {
        let f=try await fixture();defer { f.close() }
        let turns=try enqueue(f,user:String(repeating:"中",count:units))
        try await f.sync()
        let requests=try await f.submissions()
        #expect(requests.contains { $0["turnFragments"] != nil } == (units > 16384))
        #expect(f.engine.state.synced == Set(turns.map(\.id)))
        #expect(f.phone.threads[0].messages[0].text == turns[0].messages[0].text)
        let accepted=try await f.report()["accepted"] as! [[String:Any]]
        #expect(accepted.count == 2)
        #expect(accepted[0]["timestamp"] as? Int64 == turns[0].timestamp)
        let handovers=requests.map { $0["handover"] as! [String:Any] }
        #expect(Set(handovers.map { $0["id"] as! String }).count == 1)
        #expect(handovers.allSatisfy { $0["totalTurns"] as? Int == 2 })
        #expect(handovers.last?["complete"] as? Bool == true)
        #expect(handovers.dropLast().allSatisfy { $0["complete"] as? Bool == false })
    }
    @Test func unicodeBytesLongAssistantAndDesktopDigest() async throws {
        let f=try await fixture();defer { f.close() }
        let reply=String(repeating:"中😀👩‍👩‍👧‍👧\"\\\n/",count:14000)
        let turns=try enqueue(f,user:"短问题",reply:reply)
        try await f.sync()
        let requests=try await f.submissions()
        let parts=requests.compactMap { ($0["turnFragments"] as? [[String:Any]])?.first }
        #expect(parts.count > 2)
        var raw=Data()
        for (index,part) in parts.enumerated() {
            let bytes=try #require(Data(base64Encoded:part["data"] as! String))
            #expect(bytes.count <= 96000)
            #expect(part["index"] as? Int == index)
            raw.append(bytes)
        }
        #expect(parts.dropLast().contains { String(data:Data(base64Encoded:$0["data"] as! String)!,encoding:.utf8) == nil })
        #expect(try JSONDecoder().decode(OfflineTurn.self,from:raw) == turns[0])
        let digest=SHA256.hash(data:raw).map { String(format:"%02x",$0) }.joined()
        #expect(parts.allSatisfy { $0["sha256"] as? String == digest && $0["encoding"] as? String == "json-utf8-base64" })
        let report=try await f.report(),assemblies=report["assemblies"] as! [[String:Any]]
        #expect(assemblies.first?["sha256"] as? String == digest)
        #expect(assemblies.first?["timestamp"] as? Int64 == turns[0].timestamp)
        #expect((report["accepted"] as! [Any]).count == 2)
        #expect((report["history"] as! [Any]).count == 2)
        #expect(f.engine.state.turns[0].messages[1].text == reply)
        for raw in report["raw"] as! [String] { #expect(Data(base64Encoded:raw)!.count <= 256*1024) }
    }
    @Test func oversizedWholeTurnStaysWithinEveryRequestBudget() async throws {
        let f=try await fixture();defer { f.close() }
        let turns=try enqueue(f,user:String(repeating:"\"\\\n茶😀/",count:50000),reply:String(repeating:"超大回复",count:60000))
        #expect(try OfflineSubmission(generation:1,turns:[turns[0]]).encoded().count > 256*1024)
        try await f.sync()
        #expect(f.engine.state.synced == Set(turns.map(\.id)))
        for raw in try await f.report()["raw"] as! [String] { #expect(Data(base64Encoded:raw)!.count <= 256*1024) }
    }
    @Test func fragmentedMigrationKeepsAttachmentOriginalsOnPhone() async throws {
        let f=try await fixture();defer { f.close() }
        let source=Data("synthetic-attachment-original-never-uploaded".utf8)
        let attachment=PhoneAttachment(name:"合成资料.txt",contentType:"text/plain",data:source,text:String(repeating:"原附件正文",count:20000))
        var message=PhoneChatMessage(role:"user",text:String(repeating:"中😀",count:20000))
        message.attachments=[attachment]
        var thread=PhoneChatThread();thread.messages=[message];f.phone.threads=[thread]
        let turns=f.phone.prepareMigration(host:f.identity.hostId,generation:1)
        try f.engine.enqueuePhoneTurns(turns,generation:1,handover:f.phone.migrations?[f.identity.hostId]?.handover)
        try await f.sync()
        let report=try await f.report(),accepted=report["accepted"] as! [[String:Any]]
        let text=(accepted[0]["messages"] as! [[String:Any]])[0]["text"] as! String
        #expect(text == message.text+"\n"+attachment.placeholder)
        #expect(!text.contains("synthetic-attachment-original-never-uploaded") && !text.contains("原附件正文"))
        #expect(f.phone.threads[0].messages[0].attachments?[0].data == source)
        #expect((report["history"] as! [Any]).count == 1)
    }
    @Test(arguments:[false,true]) func finalFragmentCompletesTheOriginal51TurnCohort(loseFinal: Bool) async throws {
        let f=try await fixture();defer { f.close() }
        var turns=(0..<50).map { OfflineTurn(id:"short-\($0)",conversationId:"cohort-chat",timestamp:1_700_000_000_000+Int64($0),messages:[.init(role:"user",text:"合成短话")],memoryRefs:[],dependencyComplete:true) }
        turns.append(.init(id:"last-long",conversationId:"cohort-chat",timestamp:1_700_000_000_050,messages:[.init(role:"user",text:String(repeating:"中😀",count:70000))],memoryRefs:[],dependencyComplete:true))
        let handover=OfflineHandover(id:"cohort-51",totalTurns:51,conversationCount:1,bytes:try JSONEncoder().encode(turns).count)
        try f.engine.enqueuePhoneTurns(turns,generation:1,handover:handover)
        if loseFinal {
            try await f.configure(["loseFinal":true])
            await #expect(throws:(any Error).self) { try await f.sync() }
            f.engine=try OfflineReplica(vault:f.vault,phoneFirst:true)
            try await f.sync();try await f.sync()
        } else { try await f.sync() }
        let requests=try await f.submissions(),handovers=requests.map { $0["handover"] as! [String:Any] }
        #expect((requests[0]["turns"] as! [Any]).count == 50)
        #expect(handovers.allSatisfy { $0["id"] as? String == handover.id && $0["totalTurns"] as? Int == 51 && $0["bytes"] as? Int == handover.bytes })
        let firstCompletion=try #require(handovers.firstIndex { $0["complete"] as? Bool == true })
        #expect(handovers.prefix(firstCompletion).allSatisfy { $0["complete"] as? Bool == false })
        let finalPiece=(requests[firstCompletion]["turnFragments"] as! [[String:Any]])[0]
        #expect(finalPiece["index"] as? Int == (finalPiece["count"] as! Int)-1)
        if !loseFinal { #expect(firstCompletion == handovers.count-1) }
        #expect(f.engine.state.synced == Set(turns.map(\.id)))
        #expect(f.engine.state.phoneHandovers?.isEmpty == true)
    }
    @Test func partialReceiptAndRestartPreserveExactFrozenBytes() async throws {
        let f=try await fixture();defer { f.close() }
        let turns=try enqueue(f,user:String(repeating:"中😀",count:90000))
        try await f.configure(["pauseAt":1]);try await f.sync()
        #expect(f.engine.state.synced.isEmpty)
        let before=try await f.report()["raw"] as! [String]
        f.phone.threads[0].messages[0].text="本机后来修改"
        _ = f.phone.prepareMigration(host:f.identity.hostId,generation:1)
        f.engine=try OfflineReplica(vault:f.vault,phoneFirst:true)
        try await f.configure(["pauseAt":NSNull()]);try await f.sync()
        let after=try await f.report()["raw"] as! [String]
        #expect(before.last == after[before.count])
        #expect(f.engine.state.turns[0] == turns[0])
        #expect(f.engine.state.synced == Set(turns.map(\.id)))
        #expect(try Data(contentsOf:f.vault.file).range(of:Data("下一轮继续上交".utf8)) == nil)
        #expect(f.engine.state.phoneTurnFragments?.isEmpty == true)
    }
    @Test func lostFinalReceiptReplaysAndReceivesExactlyOneTurn() async throws {
        let f=try await fixture();defer { f.close() }
        let turns=try enqueue(f,user:String(repeating:"中😀",count:70000))
        try await f.configure(["loseFinal":true])
        await #expect(throws:(any Error).self) { try await f.sync() }
        #expect(f.engine.state.synced.isEmpty)
        let frozen=try f.engine.state.pendingSubmission!.encoded()
        f.engine=try OfflineReplica(vault:f.vault,phoneFirst:true)
        try await f.sync() // final fragment is reaccepted, but cannot reconstruct deleted server fragments
        #expect(f.engine.state.synced.isEmpty)
        try await f.sync() // replay from the beginning after that fragment-only acknowledgement
        let report=try await f.report(),raw=report["raw"] as! [String]
        #expect(raw.filter { Data(base64Encoded:$0) == frozen }.count >= 2)
        #expect((report["accepted"] as! [Any]).count == 2)
        #expect((report["history"] as! [Any]).count == 2)
        #expect(f.engine.state.synced == Set(turns.map(\.id)))
    }
    @Test(arguments:["foreignFragment","wrongIndex","wrongDigest","prematureTurn","wrongGeneration"])
    func mismatchedReceiptNeverAdvances(fault: String) async throws {
        let f=try await fixture();defer { f.close() }
        _ = try enqueue(f,user:String(repeating:"中😀",count:70000))
        try await f.configure([fault:true])
        await #expect(throws:(any Error).self) { try await f.sync() }
        #expect(f.engine.state.synced.isEmpty)
        #expect(f.engine.state.phoneTurnFragments?.values.allSatisfy { $0.nextIndex == 0 } != false)
    }
    @Test func generationChangeDiscardsProgress() async throws {
        let f=try await fixture();defer { f.close() }
        _ = try enqueue(f,user:String(repeating:"中😀",count:70000))
        try await f.configure(["pauseAt":1]);try await f.sync()
        #expect(f.engine.state.phoneTurnFragments?.values.first?.nextIndex == 1)
        try await f.configure(["generation":2]);
        await #expect(throws:(any Error).self) { try await f.sync() }
        #expect(f.engine.state.phoneTurnFragments == nil && f.engine.state.turns.isEmpty)
    }
    @Test func lateAccountSwitchCannotRestoreProgress() async throws {
        let f=try await fixture();defer { f.close() }
        _ = try enqueue(f,user:String(repeating:"中😀",count:70000))
        var replacement: OfflineReplica?
        await #expect(throws:(any Error).self) {
            try await f.engine.sync(identity:f.identity,fetch:{ try await f.client.syncOffline($0) },submit:{ request in
                let receipt=try await f.client.submitOffline(request)
                try f.engine.clear()
                let vault=try OfflineVault(identity:.init(ownerId:"other-owner",hostId:"host-test",deviceId:"other-phone"),directory:f.directory,store:f.keys)
                replacement=try OfflineReplica(vault:vault,phoneFirst:true)
                return receipt
            },control:{ _ in .init(hostId:"host-test",accountId:"account-test",generation:1,authorized:true) })
        }
        #expect(f.engine.state.snapshot == nil && f.engine.state.phoneTurnFragments == nil)
        #expect(replacement?.state.snapshot == nil && replacement?.state.turns.isEmpty == true)
    }
}
#endif
