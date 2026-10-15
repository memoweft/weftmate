import Foundation
import Testing
@testable import WeftMateCore

@Suite struct PhoneMemoryTests {
    func patch(_ message: PhoneChatMessage, text: String, id: String? = nil, evidence: String? = nil) throws -> String {
        String(decoding:try JSONSerialization.data(withJSONObject:["upsert":[["id":id as Any? ?? NSNull(),"text":text,"sourceIDs":[message.id],"evidence":evidence ?? message.text]],"invalidate":[]]),as:UTF8.self)
    }
    @Test func watermarkCRUDAndSuppression() throws {
        var memory=PhoneMemoryState(),thread=PhoneChatThread()
        let first=PhoneChatMessage(role:"user",text:"我喜欢清淡的食物")
        thread.messages=[first,.init(role:"assistant",text:"我猜你住在北京")]
        #expect(memory.batch(thread) == [first])
        var longThread=PhoneChatThread();longThread.messages=[.init(role:"user",text:String(repeating:"长",count:16384)+"末尾事实"),first]
        #expect(memory.batch(longThread).count == 1)
        #expect(memory.batch(longThread)[0].text.hasSuffix("末尾事实"))
        try memory.apply(patch(first,text:first.text),batch:[first],threadID:thread.id)
        #expect(memory.items.count == 1);#expect(memory.batch(thread).isEmpty)
        let correction=PhoneChatMessage(role:"user",text:"我现在更喜欢辣的食物")
        let id=memory.items[0].id
        try memory.apply(patch(correction,text:correction.text,id:id),batch:[correction],threadID:thread.id)
        #expect(memory.items[0].text == correction.text);#expect(memory.items[0].sourceIDs == [first.id,correction.id])
        memory.forget(id)
        #expect(memory.items.isEmpty);#expect(!memory.suppressedText.contains(correction.text))
        try memory.apply(patch(correction,text:correction.text),batch:[correction],threadID:thread.id)
        #expect(memory.items.isEmpty)
        let repeatMessage=PhoneChatMessage(role:"user",text:correction.text)
        try memory.apply(patch(repeatMessage,text:correction.text),batch:[repeatMessage],threadID:thread.id)
        #expect(memory.items.isEmpty)
        let fresh=PhoneChatMessage(role:"user",text:"我正在学绘画")
        try memory.apply(patch(fresh,text:fresh.text),batch:[fresh],threadID:thread.id)
        let forgetting=PhoneChatMessage(role:"user",text:"忘掉我正在学绘画这件事")
        let removal=String(decoding:try JSONSerialization.data(withJSONObject:["upsert":[],"invalidate":[["id":memory.items[0].id,"sourceIDs":[forgetting.id],"evidence":forgetting.text]]]),as:UTF8.self)
        try memory.apply(removal,batch:[forgetting],threadID:thread.id)
        #expect(memory.items.isEmpty)
    }
    @Test func parseFailureKeepsWatermarkAndRejectsUnsupportedSources() throws {
        let message=PhoneChatMessage(role:"user",text:"我在学日语")
        var memory=PhoneMemoryState()
        for bad in ["解释不是JSON","{}","{\"upsert\":{},\"invalidate\":[]}","{\"upsert\":null}"] {
            #expect(throws:(any Error).self) { try memory.apply(bad,batch:[message],threadID:"t") }
            #expect(memory.processed.isEmpty)
        }
        try memory.apply("```json\n"+patch(message,text:message.text)+"\n```",batch:[message],threadID:"t")
        #expect(memory.items.count == 1)
        let empty=try PhoneMemoryPatch.parse("{\"upsert\":[]}")
        #expect(empty.upsert.isEmpty && empty.invalidate.isEmpty)
        let unsupported=PhoneChatMessage(role:"user",text:"假造原话")
        try memory.apply(patch(unsupported,text:"住在北京"),batch:[message],threadID:"t")
        try memory.apply(patch(message,text:"住在北京",evidence:"助手猜住北京"),batch:[message],threadID:"t")
        #expect(memory.items.count == 1)
    }
    @Test func sensitiveFilterBeforePersistence() throws {
        for text in ["密码是 abc123","密钥 sk-synthetic","我的身份证110101199001011234","Bearer abc","api key synthetic","诊断为某疾病"] { #expect(!PhoneMemoryRules.safe(text)) }
        #expect(PhoneMemoryRules.safe("请记住我的诊断为某疾病"))
        #expect(!PhoneMemoryRules.safe("请记住我的密码abc"))
        var memory=PhoneMemoryState()
        let input=PhoneChatMessage(role:"user",text:"密码是 abc123")
        try memory.apply(patch(input,text:"abc123"),batch:[input],threadID:"t")
        #expect(memory.items.isEmpty);#expect(memory.processed.contains(input.id))
    }
    @Test func selectionAndStorageLimits() throws {
        var memory=PhoneMemoryState()
        for i in 0..<12 { memory.items.append(.init(text:String(repeating:"长",count:390)+"\(i)",updatedAt:Date(timeIntervalSince1970:Double(i)))) }
        memory.items.append(.init(text:"绘画偏好",pinned:true))
        memory.items.append(.init(text:"喜欢日语",updatedAt:Date(timeIntervalSince1970:0)))
        let chosen=memory.select(query:"日语")
        #expect(chosen.first?.text == "绘画偏好");#expect(chosen[1].text == "喜欢日语")
        #expect(chosen.count <= 8);#expect(chosen.reduce(0) { $0+$1.text.count } <= 2000)
        #expect(memory.items.filter { $0.lastUsed != nil }.count == chosen.count)
        memory.items=(0..<200).map { .init(text:"事\($0)") }
        let input=PhoneChatMessage(role:"user",text:"新事实")
        try memory.apply(patch(input,text:input.text),batch:[input],threadID:"t")
        #expect(memory.items.count == 200)
    }
    @Test func handoffRemovalDoesNotReprocessOldConversations() {
        var memory=PhoneMemoryState(),thread=PhoneChatThread()
        thread.messages=[.init(role:"user",text:"旧对话")]
        memory.items=[.init(text:"旧记忆")];memory.computerHost="computer"
        #expect(!memory.handoffConfirmed);#expect(memory.items.count == 1)
        memory.confirmHandoff();#expect(memory.items.isEmpty);#expect(memory.processed.isEmpty)
        memory.computerRemoved();#expect(memory.batch(thread).isEmpty)
        thread.messages.append(.init(role:"user",text:"移除电脑后的新内容"))
        #expect(memory.batch(thread).count == 1)
        memory.forgetAll(threads:[thread]);#expect(memory.batch(thread).isEmpty)
    }
    @Test func migrationKeepsComputerContextReferences() {
        var state=PhoneChatState(),thread=PhoneChatThread()
        var reply=PhoneChatMessage(role:"assistant",text:"电脑记忆辅助的回复")
        reply.memoryRefs=[.init(kind:"cognition",id:"computer-memory")];reply.dependencyComplete=false
        thread.messages=[.init(role:"user",text:"继续聊"),reply];state.threads=[thread]
        let turns=state.prepareMigration(host:"host",generation:1)
        #expect(turns[0].memoryRefs == reply.memoryRefs);#expect(!turns[0].dependencyComplete)
        #expect(turns[0].messages[1].text == reply.text)
    }
    @Test func encryptedMemoryAndAccountScope() throws {
        let dir=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:dir) }
        let keys=PhoneMemoryTestKeys(),a=try PhoneChatStore(account:"a",directory:dir,credentials:keys),b=try PhoneChatStore(account:"b",directory:dir,credentials:keys)
        var state=PhoneChatState();state.memory = .init();state.memory?.items=[.init(text:"encrypted-unique-memory")]
        try a.save(state)
        #expect(try Data(contentsOf:a.file).range(of:Data("encrypted-unique-memory".utf8)) == nil)
        #expect(try a.load().memory?.items.first?.text == "encrypted-unique-memory")
        #expect(try b.load().memory == nil)
        #expect(try dir.resourceValues(forKeys:[.isExcludedFromBackupKey]).isExcludedFromBackup == true)
    }
    @Test func standaloneRememberCorrectForgetAcrossSealedReloads() throws {
        let dir=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:dir) }
        let store=try PhoneChatStore(account:"synthetic-local",directory:dir,credentials:PhoneMemoryTestKeys())
        var state=PhoneChatState();state.memory = .init()
        func turn(_ text: String, output: (PhoneChatMessage,PhoneMemoryState) throws -> String) throws -> PhoneMemoryReceipt {
            var thread=PhoneChatThread();let user=PhoneChatMessage(role:"user",text:text);thread.messages=[user]
            let before=state.memory!
            try state.memory?.apply(output(user,before),batch:before.batch(thread),threadID:thread.id)
            state.threads.append(thread);try store.save(state);state=try store.load()
            return PhoneMemoryReceipt(before:before,after:state.memory!)
        }
        let remembered=try turn("请记住，我的测试花名是蓝色纸鹤。") { user,_ in try patch(user,text:"测试花名是蓝色纸鹤") }
        #expect(remembered.confirmation(for:"请记住")?.contains("蓝色纸鹤") == true)
        var memory=state.memory!
        #expect(PhoneMemoryContext.prompt(memory.select(query:"我的测试花名是什么").map { ($0.text,Array($0.sourceIDs)) },computerOffline:false).contains("蓝色纸鹤"))
        let corrected=try turn("不对，是绿色纸鹤。") { user,old in try patch(user,text:"测试花名是绿色纸鹤",id:old.items[0].id) }
        #expect(corrected.saved == ["测试花名是绿色纸鹤"])
        memory=state.memory!
        #expect(memory.select(query:"测试花名").map(\.text) == ["测试花名是绿色纸鹤"])
        let forgotten=try turn("忘掉我的测试花名。") { user,old in
            String(decoding:try JSONSerialization.data(withJSONObject:["upsert":[],"invalidate":[["id":old.items[0].id,"sourceIDs":[user.id],"evidence":user.text]]]),as:UTF8.self)
        }
        #expect(forgotten.removed == 1)
        memory=state.memory!;#expect(memory.select(query:"测试花名").isEmpty)
        #expect(memory.batch(state.threads[0]).isEmpty)
    }
    @Test func extractionRequestCarriesCorrectionContextAndDisablesMimoReasoning() throws {
        var memory=PhoneMemoryState();memory.items=[.init(text:"测试花名是蓝色纸鹤")]
        var thread=PhoneChatThread();thread.messages=[.init(role:"user",text:"我的测试花名是什么？"),.init(role:"assistant",text:"蓝色纸鹤"),.init(role:"user",text:"不对，是绿色纸鹤。")]
        let request=try PhoneMemoryExtraction.request(model:.init(name:"MiMo",baseURL:"https://api.xiaomimimo.com/v1",model:"mimo-v2.6-flash",apiKey:"synthetic-only"),memory:memory,thread:thread,batch:[thread.messages[2]])
        let body=try #require(JSONSerialization.jsonObject(with:request.httpBody!) as? [String:Any])
        #expect((body["thinking"] as? [String:String])?["type"] == "disabled")
        let messages=try #require(body["messages"] as? [[String:String]])
        let input=try #require(JSONSerialization.jsonObject(with:Data(messages[1]["content"]!.utf8)) as? [String:Any])
        #expect((input["原话"] as? [[String:String]])?.map { $0["id"] } == [thread.messages[2].id])
        #expect((input["对话背景"] as? [[String:String]])?.map { $0["text"] } == ["我的测试花名是什么？"])
        #expect((input["已有记忆"] as? [[String:String]])?.first?["id"] == memory.items[0].id)
    }
    @Test func incompleteExtractionHasNoReceiptAndCanBeRetried() throws {
        let config=PhoneModelConfiguration(name:"Synthetic",baseURL:"https://model.example.com/v1",model:"synthetic",apiKey:"synthetic-only")
        for body in [
            "{\"choices\":[{\"finish_reason\":\"length\",\"message\":{\"content\":\"{\\\"upsert\\\":[],\\\"invalidate\\\":[]}\"}}]}",
            "{\"choices\":[{\"message\":{\"content\":\"\"}}]}",
            "{\"choices\":[{\"message\":{\"content\":\"{broken\"}}]}"
        ] { #expect(throws:(any Error).self) { try PhoneMemoryExtraction.content(Data(body.utf8),model:config) } }
        let failed=PhoneMemoryReceipt()
        #expect(failed.saved.isEmpty && !failed.succeeded)
        #expect(failed.confirmation(for:"请记住花名")?.contains("没能保存") == true)
        let user=PhoneChatMessage(role:"user",text:"我的测试花名是蓝色纸鹤"),memory=PhoneMemoryState()
        var thread=PhoneChatThread();thread.messages=[user]
        #expect(memory.batch(thread) == [user])
        #expect(PhoneMemoryReceipt(before:memory,after:memory).confirmation(for:"记住")?.contains("没有新增或改动") == true)
    }
    @Test func forgottenFactsAreExcludedFromPromptHistoryAndLocalIDsNeverBecomeComputerReferences() throws {
        let source=PhoneChatMessage(role:"user",text:"测试花名是蓝色纸鹤")
        var memory=PhoneMemoryState();try memory.apply(patch(source,text:source.text),batch:[source],threadID:"t")
        let id=memory.items[0].id
        var reply=PhoneChatMessage(role:"assistant",text:"蓝色纸鹤");reply.phoneMemoryIDs=[id]
        let question=PhoneChatMessage(role:"user",text:"测试花名是什么？")
        let history=[source,question,reply]
        #expect(memory.replyHistory(history) == history)
        memory.forget(id)
        #expect(memory.replyHistory(history) == [question])
        var thread=PhoneChatThread();thread.messages=[source,reply]
        var state=PhoneChatState();state.threads=[thread]
        #expect(state.prepareMigration(host:"synthetic-computer",generation:1).first?.memoryRefs.isEmpty == true)
    }
    @Test func mimoMayOmitEmptyMutationArrays() throws {
        let user=PhoneChatMessage(role:"user",text:"请记住，测试花名是蓝色纸鹤")
        var memory=PhoneMemoryState()
        let full=try JSONSerialization.jsonObject(with:Data(patch(user,text:"测试花名是蓝色纸鹤").utf8)) as! [String:Any]
        let upsertOnly=String(decoding:try JSONSerialization.data(withJSONObject:["upsert":full["upsert"]!]),as:UTF8.self)
        try memory.apply(upsertOnly,batch:[user],threadID:"new-conversation")
        #expect(memory.items.map(\.text) == ["测试花名是蓝色纸鹤"])
        let forget=PhoneChatMessage(role:"user",text:"忘掉我的测试花名")
        let removeOnly=String(decoding:try JSONSerialization.data(withJSONObject:["invalidate":[["id":memory.items[0].id,"sourceIDs":[forget.id],"evidence":forget.text]]]),as:UTF8.self)
        try memory.apply(removeOnly,batch:[forget],threadID:"another-conversation")
        #expect(memory.items.isEmpty && memory.processed.contains(forget.id))
    }
    @Test func recallQuestionCannotAuthorizeModelToDeleteOrRewriteMemory() throws {
        let first=PhoneChatMessage(role:"user",text:"请记住，测试花名是蓝色纸鹤")
        var memory=PhoneMemoryState();try memory.apply(patch(first,text:"测试花名是蓝色纸鹤"),batch:[first],threadID:"t")
        let question=PhoneChatMessage(role:"user",text:"我的测试花名是什么？"),id=memory.items[0].id
        let hallucinatedDelete=String(decoding:try JSONSerialization.data(withJSONObject:["invalidate":[["id":id,"sourceIDs":[question.id],"evidence":question.text]]]),as:UTF8.self)
        try memory.apply(hallucinatedDelete,batch:[question],threadID:"another")
        #expect(memory.items.map(\.text) == ["测试花名是蓝色纸鹤"])
        try memory.apply(patch(question,text:"测试花名是橙色纸鹤",id:id),batch:[question],threadID:"another")
        #expect(memory.items.map(\.text) == ["测试花名是蓝色纸鹤"])
    }
    @Test func mimoEmptyNewIDIsNotAnUpdateToAnUnknownItem() throws {
        let user=PhoneChatMessage(role:"user",text:"请记住，测试花名是蓝色纸鹤")
        var memory=PhoneMemoryState()
        try memory.apply(patch(user,text:"测试花名是蓝色纸鹤",id:""),batch:[user],threadID:"t")
        #expect(memory.items.map(\.text) == ["测试花名是蓝色纸鹤"])
        let correction=PhoneChatMessage(role:"user",text:"不对，是绿色纸鹤")
        try memory.apply(patch(correction,text:"测试花名是绿色纸鹤",id:"unknown-item"),batch:[correction],threadID:"t")
        #expect(memory.items.map(\.text) == ["测试花名是蓝色纸鹤"])
    }
    @Test func emptyPersonalRecallIsHonestWithoutBlockingGeneralKnowledge() {
        #expect(PhoneMemoryContext.emptyRecallReply(query:"我的饮食偏好是什么？",hasMemory:false) == "我现在不知道，本机记忆里没有相关记录。")
        #expect(PhoneMemoryContext.emptyRecallReply(query:"我的饮食偏好是什么？",hasMemory:true) == nil)
        #expect(PhoneMemoryContext.emptyRecallReply(query:"量子纠缠是什么？",hasMemory:false) == nil)
        #expect(PhoneMemoryContext.emptyRecallReply(query:"请记住我喜欢清淡食物",hasMemory:false) == nil)
    }
}

private final class PhoneMemoryTestKeys: CredentialStore, @unchecked Sendable {
    private let lock=NSLock()
    private var values: [String:Data]=[:]
    func load(key: String) -> Data? { lock.withLock { values[key] } }
    func save(_ data: Data,key: String) { lock.withLock { values[key]=data } }
    func delete(key: String) { lock.withLock { values[key]=nil } }
}
