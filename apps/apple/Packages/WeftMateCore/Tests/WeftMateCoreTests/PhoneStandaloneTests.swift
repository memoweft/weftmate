import Foundation
import Testing
@testable import WeftMateCore

struct PhoneStandaloneTests {
    @Test func encryptedHistoryAndAccountIsolation() throws {
        let dir=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:dir) }
        let keys=MemoryStore()
        let a=try PhoneChatStore(account:"issuer|account-a",directory:dir,credentials:keys)
        var state=PhoneChatState(); var thread=PhoneChatThread(); thread.messages=[.init(role:"user",text:"synthetic-private-message")]; state.threads=[thread]; state.selected=thread.id
        try a.save(state)
        #expect(try a.load().threads == state.threads)
        #expect(String(data:try Data(contentsOf:a.file),encoding:.utf8)?.contains("synthetic-private-message") != true)
        let b=try PhoneChatStore(account:"issuer|account-b",directory:dir,credentials:keys)
        #expect(try b.load().threads.isEmpty)
        let reopened=try PhoneChatStore(account:"issuer|account-a",directory:dir,credentials:keys)
        #expect(try reopened.load().threads == state.threads)
        let model=PhoneModelConfiguration(name:"synthetic",baseURL:"https://model.example.com/v1",model:"test",apiKey:"synthetic-key")
        try a.saveModels([model]); #expect(try b.loadModels().isEmpty); #expect(try reopened.loadModels() == [model])
        #expect(try Data(contentsOf:a.file).range(of:Data(model.apiKey.utf8)) == nil)
        var bytes=try Data(contentsOf:a.file); bytes[bytes.count-1] ^= 1; try bytes.write(to:a.file)
        #expect(throws:(any Error).self) { try reopened.load() }
    }
    @Test func transferFreezesBodiesAndRetiresDeletedGeneration() throws {
        var state=PhoneChatState(),thread=PhoneChatThread();thread.messages=[.init(role:"user",text:"synthetic preference"),.init(role:"assistant",text:"synthetic answer")];state.threads=[thread];state.selected=thread.id
        let initial=state.prepareMigration(host:"computer-a",generation:1)
        #expect(initial.count == 1);#expect(initial[0].memoryRefs.isEmpty);#expect(initial[0].dependencyComplete)
        state.threads[0].messages[1].text="regenerated reply"
        let retry=state.prepareMigration(host:"computer-a",generation:1)
        #expect(retry[0].id == initial[0].id);#expect(retry[0].messages == initial[0].messages)
        state.acknowledgeMigration(host:"computer-a",ids:Set(initial.map(\.id)))
        #expect(state.prepareMigration(host:"computer-a",generation:1).isEmpty)
        #expect(state.prepareMigration(host:"computer-a",generation:2).isEmpty)
        #expect(state.threads.isEmpty);#expect(state.selected == nil)
    }
    @Test func deletionGenerationKeepsUnsharedIndependentThreads() {
        var state=PhoneChatState(),shared=PhoneChatThread(),independent=PhoneChatThread()
        shared.messages=[.init(role:"user",text:"already shared")];independent.messages=[.init(role:"user",text:"never shared")]
        state.threads=[shared];_=state.prepareMigration(host:"computer-a",generation:1)
        state.threads.append(independent);state.selected=independent.id
        state.applyMigrationGeneration(host:"computer-a",generation:2)
        #expect(state.threads == [independent]);#expect(state.selected == independent.id)
        #expect(state.migrations?["computer-a"]?.turns.isEmpty == true)
    }
    @Test func streamParsesContentAndRejectsTools() throws {
        #expect(try PhoneStreamDelta.text("data: {\"choices\":[{\"delta\":{\"content\":\"你好🌿\"}}]}") == "你好🌿")
        #expect(try PhoneStreamDelta.text("data: [DONE]") == nil)
        #expect(try PhoneStreamDelta.text(":keepalive") == nil)
        #expect(throws:(any Error).self) { try PhoneStreamDelta.text("data: {\"choices\":[{\"delta\":{\"tool_calls\":[]}}]}") }
        #expect(throws:(any Error).self) { try PhoneStreamDelta.text("data: {\"error\":{\"code\":\"failed\"}}") }
    }
    @Test func requestAndDisplayPolicy() throws {
        var config=PhoneModelConfiguration(name:"synthetic",baseURL:"https://model.example.com/v1",model:"test",apiKey:"synthetic-key")
        let request=try config.request(messages:[["role":"user","content":"hello"]],stream:true)
        #expect(request.url?.absoluteString == "https://model.example.com/v1/chat/completions")
        #expect(request.value(forHTTPHeaderField:"Authorization") == "Bearer synthetic-key")
        config.baseURL="http://model.example.com/v1"
        #expect(throws:(any Error).self) { try config.request(messages:[],stream:true) }
        config.baseURL="http://127.0.0.1:9999/v1"
        #expect(throws:(any Error).self) { try config.request(messages:[],stream:true) }
        #expect(try config.request(messages:[],stream:true,allowLoopback:true).url?.host == "127.0.0.1")
        #expect(PhoneCurrencyText.money(0) == "¥0")
        #expect(PhoneCurrencyText.money(1.23456) == "¥1.23")
        #expect(PhoneHealthText.number(74.1) == "74")
        #expect(PhoneHealthText.number(56.6,metric:"restingHeartRateBpm") == "57")
        #expect(PhoneHealthText.number(47.6,metric:"hrvSdnnMs") == "48")
        #expect(PhoneHealthText.time("2026-10-11T23:05:00Z",zone:TimeZone(identifier:"Asia/Shanghai")!) == "7:05")
        #expect(PhoneHealthText.time("2026-10-11T23:05:00Z",zone:TimeZone(identifier:"America/Los_Angeles")!) == "16:05")
    }
}

@Test func nativeJSONIntegerConversionRejectsUnrepresentableValues() {
    #expect(JSONValue.number(.infinity).int == nil)
    #expect(JSONValue.number(-1).int == nil)
    #expect(JSONValue.number(1.5).int == nil)
    #expect(JSONValue.number(2_147_483_647).int == 2_147_483_647)
    #if arch(arm64_32)
    #expect(JSONValue.number(2_147_483_648).int == nil)
    #else
    #expect(JSONValue.number(2_147_483_648).int == 2_147_483_648)
    #endif
    #expect(JSONValue.number(9_007_199_254_740_992).int == nil)
}
