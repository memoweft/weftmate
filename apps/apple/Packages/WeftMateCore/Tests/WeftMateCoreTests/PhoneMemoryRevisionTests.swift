import Foundation
import Testing
@testable import WeftMateCore

@Suite struct PhoneMemoryRevisionTests {
    private let blue="测试花名是蓝色纸鹤",green="测试花名是绿色纸鹤",language="长期学习日语"
    private func message(_ text: String, at seconds: Double) -> PhoneChatMessage {
        var value=PhoneChatMessage(role:"user",text:text)
        value.date=Date(timeIntervalSince1970:seconds)
        return value
    }
    private func change(_ source: PhoneChatMessage, _ text: String, id: String? = nil, evidence: String? = nil, sources: [String]? = nil) -> [String:Any] {
        ["id":id as Any? ?? NSNull(),"text":text,"sourceIDs":sources ?? [source.id],"evidence":evidence ?? source.text]
    }
    private func output(_ changes: [[String:Any]] = [], removals: [[String:Any]] = []) throws -> String {
        String(decoding:try JSONSerialization.data(withJSONObject:["upsert":changes,"invalidate":removals]),as:UTF8.self)
    }
    private func seeded() throws -> PhoneMemoryState {
        let source=message("请记住，我的测试花名是蓝色纸鹤。",at:1000)
        var state=PhoneMemoryState()
        try state.apply(output([change(source,blue)]),batch:[source],threadID:"seed",now:Date(timeIntervalSince1970:2000))
        return state
    }
    private func corrected(_ state: PhoneMemoryState) throws -> PhoneMemoryState {
        var state=state
        let source=message("不对，是绿色纸鹤。",at:1020)
        try state.apply(output([change(source,green,id:state.items[0].id)]),batch:[source],threadID:"correction",now:Date(timeIntervalSince1970:2020))
        return state
    }
    private func reopened(_ state: PhoneMemoryState) throws -> PhoneMemoryState {
        try JSONDecoder().decode(PhoneMemoryState.self,from:JSONEncoder().encode(state))
    }

    @Test func oldRetryCannotUndoCorrectionButItsIndependentFactIsKept() throws {
        var state=try seeded()
        let old=message("请记住，我的测试花名是蓝色纸鹤。我长期学习日语。",at:1010)
        state.recordFailure([old],now:Date(timeIntervalSince1970:2010))
        state=try reopened(corrected(state))
        var thread=PhoneChatThread();thread.messages=[old]
        let batch=state.batch(thread,now:Date(timeIntervalSince1970:2100))
        #expect(batch.map(\.id) == [old.id])
        try state.apply(output([
            change(old,blue,id:state.items[0].id,evidence:"我的测试花名是蓝色纸鹤"),
            change(old,language,evidence:"我长期学习日语")
        ]),batch:batch,threadID:thread.id,now:Date(timeIntervalSince1970:2100))
        #expect(Set(state.items.map(\.text)) == [green,language])
        #expect(state.processed.contains(old.id) && state.retry?[old.id] == nil)
    }

    @Test func oldRetryCannotRecreateForgottenRevisionWithANewID() throws {
        var state=try seeded()
        let old=message("请记住，我的测试花名是蓝色纸鹤。我长期学习日语。",at:1010)
        state.recordFailure([old],now:Date(timeIntervalSince1970:2010))
        state=try corrected(state)
        state.forget(state.items[0].id)
        state=try reopened(state)
        try state.apply(output([
            change(old,blue,evidence:"我的测试花名是蓝色纸鹤"),
            change(old,language,evidence:"我长期学习日语")
        ]),batch:[old],threadID:"old-retry",now:Date(timeIntervalSince1970:2100))
        #expect(state.items.map(\.text) == [language])
        #expect(!String(decoding:try JSONEncoder().encode(state),as:UTF8.self).contains("纸鹤"))
    }

    @Test func oldForgettingRequestCannotDeleteANewerCorrection() throws {
        var state=try seeded()
        let old=message("忘掉我的测试花名。",at:1010)
        state.recordFailure([old],now:Date(timeIntervalSince1970:2010))
        state=try reopened(corrected(state))
        let removal:[String:Any]=["id":state.items[0].id,"sourceIDs":[old.id],"evidence":old.text]
        try state.apply(output(removals:[removal]),batch:[old],threadID:"old-forget",now:Date(timeIntervalSince1970:2100))
        #expect(state.items.map(\.text) == [green])
    }

    @Test func anOldForgettingRequestCannotBorrowUnrelatedNewEvidence() throws {
        var state=try corrected(seeded())
        let old=message("忘掉我的测试花名。",at:1010),new=message("我长期学习日语。",at:1030)
        let removal:[String:Any]=["id":state.items[0].id,"sourceIDs":[old.id,new.id],"evidence":new.text]
        try state.apply(output([change(new,language)],removals:[removal]),batch:[old,new],threadID:"mixed-forget")
        #expect(Set(state.items.map(\.text)) == [green,language])
    }

    @Test func unrelatedNewSourceCannotLendItsDateToOldEvidence() throws {
        var state=try corrected(seeded())
        let old=message("我的测试花名是蓝色纸鹤。",at:1010),new=message("我长期学习日语。",at:1030)
        var staleChange=change(old,blue,id:state.items[0].id,sources:[old.id,new.id])
        staleChange["latestSourceDate"]=9999999999
        try state.apply(output([
            staleChange,
            change(new,language)
        ]),batch:[old,new],threadID:"mixed",now:Date(timeIntervalSince1970:2100))
        #expect(Set(state.items.map(\.text)) == [green,language])
    }

    @Test func newerExplicitSourceMayRestoreAnEarlierValue() throws {
        var state=try corrected(seeded())
        let source=message("现在改回蓝色纸鹤。",at:1030),id=state.items[0].id
        try state.apply(output([change(source,blue,id:id)]),batch:[source],threadID:"newer",now:Date(timeIntervalSince1970:2100))
        #expect(state.items.map(\.text) == [blue])
        #expect(state.items[0].id == id)
    }

    @Test func oldRetryCannotInsertAPriorValueAsANewItem() throws {
        var state=try corrected(seeded())
        let old=message("我的测试花名是蓝色纸鹤。",at:1010)
        try state.apply(output([change(old,blue)]),batch:[old],threadID:"old-new-id")
        #expect(state.items.map(\.text) == [green])
    }

    @Test func equalOriginalTimeDoesNotChooseBetweenDifferentRevisions() throws {
        var state=try seeded()
        let source=message("不对，是绿色纸鹤。",at:1000)
        try state.apply(output([change(source,green,id:state.items[0].id)]),batch:[source],threadID:"same-time")
        #expect(state.items.map(\.text) == [blue])
    }

    @Test func legacyStateWithoutSourceTimesStillReadsAndProtectsItsRevision() throws {
        var state=PhoneMemoryState()
        state.items=[.init(text:green,updatedAt:Date(timeIntervalSince1970:1020))]
        state=try reopened(state)
        #expect(state.items[0].latestSourceDate == nil && state.items[0].previousTextDigests == nil)
        let old=message("我的测试花名是蓝色纸鹤。",at:1010)
        try state.apply(output([change(old,blue,id:state.items[0].id)]),batch:[old],threadID:"legacy-old")
        #expect(state.items.map(\.text) == [green])
        let newer=message("现在改回蓝色纸鹤。",at:1030)
        try state.apply(output([change(newer,blue,id:state.items[0].id)]),batch:[newer],threadID:"legacy-new")
        #expect(state.items.map(\.text) == [blue])
    }

    @Test(arguments:["我希望你忘掉我的测试花名。","能不能忘掉我的测试花名？","可以请你删除我的测试花名吗？","Could you forget my test nickname?","I would like you to delete my test nickname.","我希望你忘掉“我的测试花名”这条记忆，但不要删除聊天原话。","Could you forget \"my test nickname\"?"])
    func naturalExplicitRequestsActuallyForget(_ text: String) throws {
        var state=try seeded()
        let source=message(text,at:1030)
        let removal:[String:Any]=["id":state.items[0].id,"sourceIDs":[source.id],"evidence":text]
        try state.apply(output(removals:[removal]),batch:[source],threadID:"forget",now:Date(timeIntervalSince1970:2100))
        #expect(state.items.isEmpty)
        #expect(state.processed.contains(source.id))
    }

    @Test(arguments:["不要忘记我的测试花名。","请不要删除我的测试花名。","我不希望你忘掉我的测试花名。","她说：忘掉我的测试花名。","请解释“忘掉我的测试花名”的意思。","“忘掉我的测试花名。”","我希望你记住“忘掉我的测试花名”这句话。","Don't forget my test nickname.","Please do not delete my test nickname.","She said 'forget my test nickname'.","今天天气不错。","我的测试花名是什么？","我之前让你忘掉的是什么？","你还记得我说过“忘掉我的测试花名”吗？","Could you tell me whether I asked you to forget my nickname?"])
    func negationQuotationAndUnrelatedSourcesCannotAuthorizeForgetting(_ text: String) throws {
        var state=try seeded()
        let source=message(text,at:1030)
        let removal:[String:Any]=["id":state.items[0].id,"sourceIDs":[source.id],"evidence":text]
        try state.apply(output(removals:[removal]),batch:[source],threadID:"unauthorized",now:Date(timeIntervalSince1970:2100))
        #expect(state.items.map(\.text) == [blue])
    }
}
