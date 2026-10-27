import Foundation
import CryptoKit
import Testing
@testable import WeftMateCore

@Suite struct PhoneWindowTests {
    @Test func upgradesSealedLegacyContainerWithoutLosingOriginalsOrReceipts() throws {
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:directory) }
        let keys=WindowTestKeys(),account="synthetic-window-account"
        let store=try PhoneChatStore(account:account,directory:directory,credentials:keys)
        var state=PhoneChatState(),thread=PhoneChatThread()
        var original=PhoneChatMessage(role:"user",text:"要保留的原话")
        original.date=Date(timeIntervalSince1970:123456)
        thread.messages=[original,.init(role:"assistant",text:"原回复")]
        state.threads=[thread];state.selected=thread.id;state.pending = .init();state.pending?.text="未发草稿"
        let offered=state.prepareMigration(host:"computer-a",generation:7)
        state.acknowledgeMigration(host:"computer-a",ids:Set(offered.map(\.id)))
        try store.save(state)
        let model=PhoneModelConfiguration(name:"原模型",baseURL:"https://model.example.invalid/v1",model:"synthetic",apiKey:"synthetic-key")
        try store.saveModels([model]);let library=try store.loadLibrary()
        var legacy=try JSONSerialization.jsonObject(with:JSONEncoder().encode(state)) as! [String:Any]
        legacy["memory"]=["enabled":false,"items":[["text":"必须丢弃的旧轻量正文"]],"processed":[original.id],
                          "computerHost":"computer-a","handoffConfirmed":true,
                          "suppressedSources":["forgotten-source"],"suppressedText":[digest("忘过的原话")]]
        let key=try #require(keys.values.first { $0.key.hasSuffix(".aes") }?.value)
        let sealed=try AES.GCM.seal(JSONSerialization.data(withJSONObject:legacy),using:SymmetricKey(data:key),authenticating:Data(account.utf8))
        try #require(sealed.combined).write(to:store.file,options:.atomic)

        let upgraded=try store.load()
        #expect(upgraded.threads == state.threads)
        #expect(upgraded.selected == thread.id && upgraded.pending?.text == "未发草稿")
        #expect(upgraded.migrations?["computer-a"]?.accepted == Set(offered.map(\.id)))
        #expect(try store.loadModels() == [model]);#expect(try store.loadLibrary().selectedProfileId == library.selectedProfileId)
        #expect(upgraded.transcriptSync?.hostID == "computer-a")
        #expect(upgraded.transcriptSync?.excludedSourceIDs == ["forgotten-source"])
        #expect(upgraded.transcriptSync?.excludedTextDigests == [digest("忘过的原话")])
        let after=try Data(contentsOf:store.file)
        let clear=try AES.GCM.open(AES.GCM.SealedBox(combined:after),using:SymmetricKey(data:key),authenticating:Data(account.utf8))
        #expect(!String(decoding:clear,as:UTF8.self).contains("必须丢弃的旧轻量正文"))
        #expect((try JSONSerialization.jsonObject(with:clear) as! [String:Any])["memory"] == nil)
        _ = try store.load();#expect(try Data(contentsOf:store.file) == after)
        let other=try PhoneChatStore(account:"other-account",directory:directory,credentials:keys)
        #expect(try other.load().threads.isEmpty)
    }

    @Test func legacyForgetBlocksOriginalAndFrozenUnacceptedTurnsAcrossComputers() throws {
        var state=PhoneChatState(),thread=PhoneChatThread()
        var forgotten=PhoneChatMessage(role:"user",text:"已经忘掉的原话")
        forgotten.id="forgotten-source"
        let repeated=PhoneChatMessage(role:"user",text:"以前重复的原话")
        let retained=PhoneChatMessage(role:"user",text:"仍可交的原话")
        thread.messages=[forgotten,repeated,retained];state.threads=[thread]
        _ = state.prepareMigration(host:"computer-a",generation:1)
        var json=try JSONSerialization.jsonObject(with:JSONEncoder().encode(state)) as! [String:Any]
        json["memory"]=["items":[["text":"轻量正文不得上交"]],"suppressedSources":[forgotten.id],"suppressedText":[digest(repeated.text)]]
        let upgraded=try PhoneTranscriptStorage.upgrade(JSONSerialization.data(withJSONObject:json))
        var restored=try JSONDecoder().decode(PhoneChatState.self,from:upgraded)
        let pending=restored.prepareMigration(host:"computer-a",generation:1)
        #expect(pending.map(\.id) == [retained.id])
        #expect(restored.threads[0].messages == thread.messages)
        restored.transcriptSync?.hostID=nil
        #expect(restored.prepareMigration(host:"computer-b",generation:1).isEmpty)
        // A new ID with the old text must also stay excluded, even on another computer.
        var another=PhoneChatThread();another.messages=[.init(role:"user",text:repeated.text),.init(role:"user",text:"新话")]
        restored.threads.append(another)
        #expect(restored.prepareMigration(host:"computer-b",generation:1).map(\.messages).flatMap { $0 }.map(\.text) == ["新话"])
    }

    @Test func computerContextKeepsDependenciesDuringTranscriptTransfer() {
        var state=PhoneChatState(),thread=PhoneChatThread()
        var reply=PhoneChatMessage(role:"assistant",text:"电脑副本辅助的回复")
        reply.memoryRefs=[.init(kind:"cognition",id:"computer-memory")];reply.dependencyComplete=false
        thread.messages=[.init(role:"user",text:"继续聊"),reply];state.threads=[thread]
        let turns=state.prepareMigration(host:"host",generation:1)
        #expect(turns[0].memoryRefs == reply.memoryRefs && !turns[0].dependencyComplete)
        #expect(turns[0].messages[1].text == reply.text)
    }
    @Test @MainActor func excludesLegacyForgottenOutboxBeforeFirstNetworkSync() throws {
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:directory) }
        let identity=OfflineIdentity(ownerId:"synthetic-owner",hostId:"synthetic-host",deviceId:"synthetic-device")
        let vault=try OfflineVault(identity:identity,directory:directory,store:WindowTestKeys())
        var old=OfflineState()
        old.turns=["forgotten","accepted","retained"].map {
            .init(id:$0,conversationId:"synthetic-conversation",timestamp:123,messages:[.init(role:"user",text:$0)],memoryRefs:[],dependencyComplete:true)
        }
        old.synced=["accepted"];try vault.save(old)
        let engine=try OfflineReplica(vault:vault)
        var exclusions=PhoneTranscriptSync();exclusions.excludedSourceIDs=["forgotten","accepted"]
        try engine.excludeUnsubmittedPhoneTurns(exclusions)
        #expect(engine.state.turns.map(\.id) == ["accepted","retained"])
        #expect(engine.state.synced == ["accepted"])
        #expect(try vault.load().turns.map(\.id) == ["accepted","retained"])
    }
    private func digest(_ text: String) -> String {
        SHA256.hash(data:Data(text.lowercased().filter { !$0.isWhitespace }.utf8)).map { String(format:"%02x",$0) }.joined()
    }
}
private final class WindowTestKeys: CredentialStore, @unchecked Sendable {
    var values: [String:Data]=[:]
    func load(key: String) -> Data? { values[key] }
    func save(_ value: Data,key: String) { values[key]=value }
    func delete(key: String) { values[key]=nil }
}
