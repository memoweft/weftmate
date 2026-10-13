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
        let removal=String(decoding:try JSONSerialization.data(withJSONObject:["upsert":[],"invalidate":[["id":memory.items[0].id,"sourceIDs":[repeatMessage.id],"evidence":repeatMessage.text]]]),as:UTF8.self)
        try memory.apply(removal,batch:[repeatMessage],threadID:thread.id)
        #expect(memory.items.isEmpty)
    }
    @Test func parseFailureKeepsWatermarkAndRejectsUnsupportedSources() throws {
        let message=PhoneChatMessage(role:"user",text:"我在学日语")
        var memory=PhoneMemoryState()
        for bad in ["解释不是JSON","{\"upsert\":[]}","{\"upsert\":{},\"invalidate\":[]}"] {
            #expect(throws:(any Error).self) { try memory.apply(bad,batch:[message],threadID:"t") }
            #expect(memory.processed.isEmpty)
        }
        try memory.apply("```json\n"+patch(message,text:message.text)+"\n```",batch:[message],threadID:"t")
        #expect(memory.items.count == 1)
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
}

private final class PhoneMemoryTestKeys: CredentialStore, @unchecked Sendable {
    private let lock=NSLock()
    private var values: [String:Data]=[:]
    func load(key: String) -> Data? { lock.withLock { values[key] } }
    func save(_ data: Data,key: String) { lock.withLock { values[key]=data } }
    func delete(key: String) { lock.withLock { values[key]=nil } }
}
