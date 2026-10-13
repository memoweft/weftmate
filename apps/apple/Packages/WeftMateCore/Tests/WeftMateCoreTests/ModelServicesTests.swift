import Testing
import Foundation
import WeftMateCore

private final class ServiceTestKeys: CredentialStore, @unchecked Sendable {
    var values:[String:Data]=[:]
    var failServices=false
    func load(key: String) throws -> Data? { values[key] }
    func save(_ data: Data,key: String) throws { if failServices && key.hasSuffix(".services") { throw APIFailure.credentialStorage };values[key]=data }
    func delete(key: String) throws { values[key]=nil }
}
@Suite struct ModelServicesTests {
    @Test func migrationMergesWithoutLosingAliasesAndBacksUpBeforeWrite() throws {
        let keys=ServiceTestKeys(),secret=UUID().uuidString
        let dir=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:dir) }
        let store=try PhoneChatStore(account:"synthetic-account",directory:dir,credentials:keys)
        let old=[PhoneModelConfiguration(id:"old-a",name:"MiMo",baseURL:"https://model.example.com/v1/",model:"mimo-v2.6-flash",apiKey:secret),PhoneModelConfiguration(id:"old-b",name:"MiMo",baseURL:"https://model.example.com/v1",model:"mimo-v2.6-pro",apiKey:secret),PhoneModelConfiguration(id:"old-c",name:"Duplicate",baseURL:"https://model.example.com/v1",model:"mimo-v2.6-flash",apiKey:secret),PhoneModelConfiguration(id:"old-d",name:"Other",baseURL:"https://model.example.com/v1",model:"other",apiKey:UUID().uuidString)]
        try store.saveModels(old);let before=keys.values.first {$0.key.hasSuffix(".models")}?.value
        let library=try store.loadLibrary()
        #expect(library.services.count == 2);#expect(library.services[0].service.models.count == 2)
        #expect(library.services[0].service.models[0].matches("old-c"));#expect(library.selectedProfileId == "old-a")
        let backupMatches=keys.values.first {$0.key.hasSuffix(".models.before")}?.value == before
        #expect(backupMatches)
        let idempotent=try store.loadLibrary().services == library.services
        #expect(idempotent)
        let legacyPreserved=try store.loadModels() == old
        #expect(legacyPreserved)
        let metadata=String(decoding:try JSONEncoder().encode(library.services[0].service),as:UTF8.self)
        let metadataSafe = !metadata.contains(secret)
        #expect(metadataSafe)
    }
    @Test func migrationFailureKeepsLegacyAndRetries() throws {
        let keys=ServiceTestKeys(),dir=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:dir) }
        let store=try PhoneChatStore(account:"synthetic-account",directory:dir,credentials:keys)
        let old=[PhoneModelConfiguration(name:"A",baseURL:"https://model.example.com/v1",model:"chat",apiKey:UUID().uuidString)]
        try store.saveModels(old);keys.failServices=true
        #expect(throws:APIFailure.credentialStorage) { try store.loadLibrary() }
        let legacyPreserved=try store.loadModels() == old
        #expect(legacyPreserved);#expect(keys.values.keys.contains {$0.hasSuffix(".models.before")})
        keys.failServices=false;#expect(try store.loadLibrary().services.count == 1)
        let serviceKey=try #require(keys.values.keys.first {$0.hasSuffix(".services")});keys.values[serviceKey]=Data("bad".utf8)
        #expect(try store.loadLibrary().services.count == 1)
    }
    @Test func menuPrioritizesCurrentRecentAndSearchesAll() {
        var items=(0..<45).map { ServiceModel(modelId:"chat-\($0)",profileId:"profile-\($0)") }
        items[20].lastUsedAt="2026-10-13T12:00:00Z";items[3].enabled=false
        let shown=ModelCatalog.menuModels(items,current:"profile-40",all:false,query:"")
        #expect(shown.count == 8);#expect(shown.contains {$0.modelId == "chat-40"});#expect(shown.contains {$0.modelId == "chat-20"});#expect(!shown.contains {$0.modelId == "chat-3"})
        #expect(ModelCatalog.menuModels(items,current:nil,all:true,query:"chat-44").map(\.modelId) == ["chat-44"])
        #expect(!ModelCatalog.chatModel("text-embedding-3"));#expect(ModelCatalog.chatModel("mimo-v2.6-pro"))
        #expect(ModelCatalog.displayName("mimo-v2.6-flash") == "MiMo v2.6 Flash")
        #expect(ModelCatalogResult(status:"authentication_failed").message != ModelCatalogResult(status:"unsupported").message)
    }
    @Test func recommendationMatchesModelOneAndPreservesEnabledPreference() {
        let models=[ServiceModel(modelId:"mimo-v2.6-pro"),ServiceModel(modelId:"mimo-v2.6-flash"),ServiceModel(modelId:"other-mini",enabled:false)]
        #expect(ModelCatalog.recommendedModel(models) == "mimo-v2.6-flash")
        #expect(ModelCatalog.recommendedModel(models,preferred:"mimo-v2.6-pro") == "mimo-v2.6-pro")
        #expect(ModelCatalog.recommendedModel(models,preferred:"other-mini") == "mimo-v2.6-flash")
    }
    @Test func onlyJSONBooleansDeclareCapabilities() throws {
        let value=try #require(JSONSerialization.jsonObject(with:Data("{\"yes\":true,\"no\":false,\"one\":1,\"zero\":0,\"text\":\"true\"}".utf8)) as? [String:Any])
        #expect(ModelCatalog.declaredBoolean(value["yes"]) == true)
        #expect(ModelCatalog.declaredBoolean(value["no"]) == false)
        #expect(ModelCatalog.declaredBoolean(value["one"]) == nil)
        #expect(ModelCatalog.declaredBoolean(value["zero"]) == nil)
        #expect(ModelCatalog.declaredBoolean(value["text"]) == nil)
    }
    @Test func nonChatFilteringAndEmptyDisplayNamesMatchModelOne() {
        for id in ["gpt-image-1","gpt-audio","omni-moderation","flux-1","stable-diffusion","whisper-1","text-embedding-3","rerank-v2","veo-3"] { #expect(!ModelCatalog.chatModel(id)) }
        #expect(ModelCatalog.chatModel("mimo-v2.6-pro"))
        #expect(ServiceModel(modelId:"mimo-v2.6-flash",name:" ").name == "MiMo v2.6 Flash")
    }
    @Test func optionalFieldsAndNextModelDecode() throws {
        let data=Data("{\"services\":[],\"canManage\":true}".utf8)
        let reply=try JSONDecoder().decode(ModelServicesReply.self,from:data)
        #expect(reply.models == nil);#expect(reply.modelSettings == nil)
        let session=try JSONDecoder().decode(SharedSessionRecord.self,from:Data("{\"sessionId\":\"session-synthetic\",\"title\":\"A\",\"running\":true,\"sendAvailable\":true,\"modelProfileId\":\"old\",\"selectedModelProfileId\":\"next\"}".utf8))
        #expect(session.modelProfileId == "old");#expect(session.selectedModelProfileId == "next")
    }
    @Test func anthropicMessagesImagesAndTextOnlyThinkingStream() throws {
        var config=PhoneModelConfiguration(name:"Claude",baseURL:"https://model.example.com/v1",model:"claude",apiKey:UUID().uuidString)
        config.interfaceType="anthropic";config.vision=true
        let deep=try JSONDecoder().decode(ServiceModel.DeepThinking.self,from:Data("{\"supported\":true,\"type\":\"adaptive\"}".utf8))
        config.deepThinking=deep;config.thinkingEnabled=true
        let request=try config.request(messages:[["role":"system","content":"instructions"],["role":"user","content":"hello"]],stream:false)
        #expect(request.url?.path == "/v1/messages");#expect(request.value(forHTTPHeaderField:"Authorization") == nil)
        let data=try #require(request.httpBody)
        let body=try #require(JSONSerialization.jsonObject(with:data) as? [String:Any])
        #expect(body["system"] as? String == "instructions");#expect((body["thinking"] as? [String:String])?["type"] == "adaptive")
        #expect(try config.streamText("data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"hidden\"}}") == nil)
        #expect(try config.streamText("data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}") == "hello")
        #expect(config.supportsImages == true)
    }
}
