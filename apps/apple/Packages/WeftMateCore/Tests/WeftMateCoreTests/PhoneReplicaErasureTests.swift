import Foundation
import Testing
@testable import WeftMateCore

@Suite @MainActor struct PhoneReplicaErasureTests {
    @Test func generationKeepsOriginalDatesDraftAndIndependentReminderWithoutReoffering() throws {
        var state=PhoneChatState(),thread=PhoneChatThread()
        var original=PhoneChatMessage(role:"user",text:"合成原话：我喜欢茉莉花茶")
        original.date=Date(timeIntervalSince1970:123456)
        var derived=PhoneChatMessage(role:"assistant",text:"必须清除的派生回复")
        derived.memoryRefs=[.init(kind:"cognition",id:"tea")];derived.dependencyComplete=true
        thread.messages=[original,derived];state.threads=[thread];state.selected=thread.id
        state.pending = .init();state.pending?.text="未发草稿"
        state.reminders=[.init(text:"独立提醒",fireAt:Date(timeIntervalSince1970:999999),sessionID:thread.id)]
        let offered=state.prepareMigration(host:"computer-a",generation:1)
        state.acknowledgeMigration(host:"computer-a",generation:1,ids:Set(offered.map(\.id)))
        state.applyMigrationGeneration(host:"computer-a",generation:2)
        #expect(state.threads.first?.messages == [original])
        #expect(state.selected == thread.id && state.pending?.text == "未发草稿")
        #expect(state.reminders?.count == 1)
        #expect(state.migrations?["computer-a"]?.accepted == [original.id])
        #expect(state.migrations?["computer-a"]?.turns.isEmpty == true)
        #expect(state.prepareMigration(host:"computer-a",generation:2).isEmpty)
        #expect(state.prepareMigration(host:"computer-b",generation:1).isEmpty)
        let bytes=try JSONEncoder().encode(state)
        #expect(!String(decoding:bytes,as:UTF8.self).contains(derived.text))
        var reopened=try JSONDecoder().decode(PhoneChatState.self,from:bytes)
        #expect(reopened.prepareMigration(host:"computer-b",generation:1).isEmpty)
    }

    @Test func removeClearsOnlyDependentAndUnknownRepliesIncludingFrozenBodies() {
        var state=PhoneChatState(),thread=PhoneChatThread()
        var erased=PhoneChatMessage(role:"assistant",text:"茶的派生回复")
        erased.memoryRefs=[.init(kind:"cognition",id:"tea")];erased.dependencyComplete=true
        var independent=PhoneChatMessage(role:"assistant",text:"独立普通回复")
        independent.memoryRefs=[];independent.dependencyComplete=true
        let unknown=PhoneChatMessage(role:"assistant",text:"旧版依赖不完整的回复")
        thread.messages=[.init(role:"user",text:"茶"),erased,.init(role:"user",text:"天气"),independent,.init(role:"user",text:"旧问题"),unknown]
        state.threads=[thread];state.selected=thread.id
        _=state.prepareMigration(host:"computer-a",generation:1)
        state.invalidateComputerMemory(host:"computer-a",removedIDs:["tea"],reset:false)
        #expect(state.threads[0].messages.filter { $0.role == "user" }.count == 3)
        #expect(state.threads[0].messages.filter { $0.role == "assistant" } == [independent])
        #expect(state.migrations?["computer-a"]?.turns.isEmpty == true)
        #expect(state.migrations?["computer-a"]?.handover == nil)
        #expect(state.prepareMigration(host:"computer-a",generation:1).isEmpty)
        let reply=state.enqueueReply(text:"新问题")!
        #expect(state.replyHistory(reply).map(\.text) == ["新问题"])
        #expect(state.prepareMigration(host:"computer-b",generation:1).isEmpty)
    }

    @Test func resetErasesFrozenFragmentsAndKeepsIDOnlyBarrierInEncryptedReplica() throws {
        let dir=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:dir) }
        let identity=OfflineIdentity(ownerId:"synthetic-owner",hostId:"computer-a",deviceId:"phone")
        let vault=try OfflineVault(identity:identity,directory:dir,store:MemoryStore())
        let turn=OfflineTurn(id:"long-original",conversationId:"thread",timestamp:123,
            messages:[.init(role:"user",text:String(repeating:"合成原话",count:18000)),.init(role:"assistant",text:"失效正文")],memoryRefs:[.init(kind:"cognition",id:"tea")],dependencyComplete:true)
        var old=OfflineState();old.snapshot=try snapshot(1);old.turns=[turn];old.synced=["received-original"]
        old.phoneTurnFragments=[turn.id:try .init(turn:turn,generation:1)]
        old.pendingSubmission = .init(generation:1,turns:[],turnFragments:[old.phoneTurnFragments![turn.id]!.fragment])
        try vault.save(old)
        let engine=try OfflineReplica(vault:vault,phoneFirst:true)
        try engine.merge(snapshot(2,reset:true))
        #expect(engine.state.turns.isEmpty && engine.state.pendingSubmission == nil && engine.state.phoneTurnFragments == nil)
        #expect(engine.state.synced == ["received-original"])
        try engine.enqueuePhoneTurns([turn],generation:2)
        #expect(engine.state.turns.isEmpty)
        let reopened=try OfflineReplica(vault:vault,phoneFirst:true)
        #expect(reopened.state.erasure?.reset == true)
        #expect(reopened.state.retiredPhoneTurnIDs?.contains(turn.id) == true)
        #expect(!String(decoding:try JSONEncoder().encode(reopened.state),as:UTF8.self).contains("失效正文"))
    }

    @Test func removeCancelsLateModelCompletionWithoutRecreatingAnAssistant() async throws {
        let dir=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:dir) }
        let vault=try OfflineVault(identity:.init(ownerId:"synthetic-owner",hostId:"computer-a",deviceId:"phone"),directory:dir,store:MemoryStore())
        let transport=ErasureDelayedTransport(),engine=try OfflineReplica(vault:vault,transport:transport,phoneFirst:true)
        try engine.merge(snapshot(1))
        let work=Task { try await engine.send("茶",conversationID:"thread",control:{ _ in .init(hostId:"computer-a",accountId:"synthetic-account",generation:1,authorized:true) }) }
        await transport.waitForRequest()
        try engine.merge(snapshot(1,removed:["tea"]))
        await transport.release()
        await #expect(throws:(any Error).self) { try await work.value }
        #expect(engine.state.turns.isEmpty && engine.state.pendingSubmission == nil)
        #expect(try vault.load().turns.isEmpty)
    }

    @Test func acknowledgedResetCannotEraseLaterIndependentMemoryRepliesAgain() throws {
        let dir=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:dir) }
        let vault=try OfflineVault(identity:.init(ownerId:"synthetic-owner",hostId:"computer-a",deviceId:"phone"),directory:dir,store:MemoryStore())
        let engine=try OfflineReplica(vault:vault,phoneFirst:true)
        try engine.merge(snapshot(1));try engine.merge(snapshot(2,reset:true))
        try engine.acknowledgeErasure(engine.state.erasure!.id)
        #expect(try vault.load().erasure == nil)
        try engine.merge(snapshot(2));try engine.merge(snapshot(2,removed:["tea"]))
        #expect(engine.state.erasure?.reset == false && engine.state.erasure?.removedIDs == ["tea"])
    }

    private func snapshot(_ generation: Int,reset: Bool = false,removed: [String] = []) throws -> OfflineSnapshot {
        let hasTea=removed.isEmpty && !reset
        return try JSONDecoder().decode(OfflineSnapshot.self,from:JSONSerialization.data(withJSONObject:[
            "generation":generation,"reset":reset,"remove":removed,
            "items":hasTea ? [["id":"tea","kind":"cognition","text":"合成茶偏好","sources":[],"currentState":"current"]] : [],
            "hashes":hasTea ? ["tea":String(repeating:"a",count:64)] : [:],"truncated":false,"recent":[],
            "model":["profileId":"test","name":"synthetic","baseUrl":"https://model.example.invalid/v1","modelId":"test","apiKey":"synthetic-key"],
            "control":["hostId":"computer-a","accountId":"synthetic-account","generation":generation]]))
    }
}
private actor ErasureDelayedTransport: HTTPTransport {
    private var continuation: CheckedContinuation<Void,Never>?
    func send(_ request: URLRequest) async throws -> HTTPResponse {
        await withCheckedContinuation { continuation=$0 }
        return .init(status:200,body:Data(#"{"choices":[{"message":{"content":"迟到派生正文"}}]}"#.utf8))
    }
    func waitForRequest() async { while continuation == nil { await Task.yield() } }
    func release() { continuation?.resume();continuation=nil }
}
