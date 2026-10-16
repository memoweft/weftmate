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

    @Test func firstFailureHasAValidatedSourceLinkAndKeepsItsIndependentFact() throws {
        let old=message("请记住，我的测试花名是蓝色纸鹤。我长期学习日语。",at:1000)
        let newer=message("不对，是绿色纸鹤。",at:1020)
        var state=PhoneMemoryState(),correction=change(newer,green)
        state.recordFailure([old],now:Date(timeIntervalSince1970:1001))
        correction["replacesSource"]=["id":old.id,"quote":"我的测试花名是蓝色纸鹤"]
        let result=try state.apply(output([correction]),batch:[newer],threadID:"same",knownSources:[old,newer],referenceSources:[old])
        #expect(result.pendingSourceIDs.isEmpty && state.items.map(\.text) == [green])
        #expect(state.items[0].sourceIDs == [newer.id])
        state.forget(state.items[0].id,at:Date(timeIntervalSince1970:1040),sources:[old,newer])
        state=try reopened(state)
        #expect(state.projectedText(old)?.contains("纸鹤") == false)
        #expect(state.projectedText(old)?.contains("我长期学习日语") == true)
        var retry=old;retry.text=try #require(state.projectedText(old))
        try state.apply(output([change(retry,language,evidence:"我长期学习日语")]),batch:[retry],threadID:"same",knownSources:[old,newer])
        #expect(state.items.map(\.text) == [language])
        #expect(state.projectedText(old)?.contains("纸鹤") == false)
        #expect(state.projectedText(old)?.contains("日语") == true)
        #expect(!String(decoding:try JSONEncoder().encode(state),as:UTF8.self).contains("纸鹤"))
    }
    @Test(arguments:["missing","wrong-id","wrong-quote","repeated","broad","not-visible","future"])
    func invalidSourceLinksStayPending(_ variant: String) throws {
        let text=variant == "repeated" ? "我的测试花名是蓝色纸鹤。我的测试花名是蓝色纸鹤。我长期学习日语。" : "我的测试花名是蓝色纸鹤。我长期学习日语。"
        let old=message(text,at:variant == "future" ? 1040 : 1000)
        let newer=message("不对，是绿色纸鹤。我长期学习日语。",at:1020)
        var state=PhoneMemoryState(),correction=change(newer,green,evidence:"是绿色纸鹤")
        if variant != "missing" {
            correction["replacesSource"]=["id":variant == "wrong-id" ? "other-account-source" : old.id,
                "quote":variant == "wrong-quote" ? "不存在的原话" : variant == "broad" ? old.text : "我的测试花名是蓝色纸鹤"]
        }
        let result=try state.apply(output([correction,change(newer,language,evidence:"我长期学习日语")]),batch:[newer],threadID:"same",knownSources:[old,newer],referenceSources:variant == "not-visible" ? [] : [old])
        #expect(result.pendingSourceIDs == [newer.id])
        #expect(state.items.map(\.text) == [language])
        #expect(!state.processed.contains(newer.id) && state.retry?[newer.id]?.needsSourceLink == true)
        try state.apply(output(),batch:[newer],threadID:"same",knownSources:[old,newer],referenceSources:[old])
        #expect(!state.processed.contains(newer.id))
        let receipt=PhoneMemoryReceipt(before:.init(),after:state,pending:true)
        #expect(receipt.note?.contains("还有部分记忆没能确认") == true)
    }
    @Test(arguments:["不要纠正成绿色纸鹤。","“不对，是绿色纸鹤。”","我之前说过“不对，是绿色纸鹤”吗？"])
    func aReferenceAloneCannotAuthorizeCorrection(_ text: String) throws {
        let old=message("我的测试花名是蓝色纸鹤。",at:1000),source=message(text,at:1020)
        var state=PhoneMemoryState(),proposal=change(source,green)
        proposal["replacesSource"]=["id":old.id,"quote":"我的测试花名是蓝色纸鹤"]
        let result=try state.apply(output([proposal]),batch:[source],threadID:"same",referenceSources:[old])
        #expect(state.items.isEmpty && state.retiredSpans == nil)
        #expect(result.pendingSourceIDs == [source.id])
    }
    @Test func ambiguousExistingOwnersCannotBeCombinedByOneReference() throws {
        let old=message("我的测试花名是蓝色纸鹤。",at:1000),source=message("不对，是绿色纸鹤。",at:1020)
        var state=PhoneMemoryState(),proposal=change(source,green)
        state.items=[.init(text:blue,sourceIDs:[old.id]),.init(text:blue,sourceIDs:[old.id])]
        proposal["replacesSource"]=["id":old.id,"quote":"我的测试花名是蓝色纸鹤"]
        let result=try state.apply(output([proposal]),batch:[source],threadID:"same",referenceSources:[old])
        #expect(state.items.count == 2 && state.items.allSatisfy { $0.text == blue })
        #expect(result.pendingSourceIDs == [source.id] && state.retiredSpans == nil)
    }
    @Test func retiredSourceCannotLaunderBlueThroughJapaneseEvidence() throws {
        let old=message("我的测试花名是蓝色纸鹤。我长期学习日语。",at:1000),newer=message("不对，是绿色纸鹤。",at:1020)
        var state=PhoneMemoryState(),correction=change(newer,green)
        correction["replacesSource"]=["id":old.id,"quote":"我的测试花名是蓝色纸鹤"]
        try state.apply(output([correction]),batch:[newer],threadID:"same",knownSources:[old],referenceSources:[old])
        var retry=old;retry.text=try #require(state.projectedText(old))
        try state.apply(output([change(retry,blue,evidence:"我长期学习日语"),change(retry,language,evidence:"我长期学习日语")]),batch:[retry],threadID:"same",knownSources:[old,newer])
        #expect(Set(state.items.map(\.text)) == [green,language])
        #expect(!state.processed.contains(old.id))
    }
    @Test func forgettingDoesNotPermanentlyBlockANewExplicitRemember() throws {
        let old=message("请记住，我的测试花名是蓝色纸鹤。",at:1000),fresh=message("请记住，我的测试花名是蓝色纸鹤。",at:1050)
        var state=PhoneMemoryState()
        try state.apply(output([change(old,blue)]),batch:[old],threadID:"same")
        state.forget(state.items[0].id,at:Date(timeIntervalSince1970:1040),sources:[old])
        try state.apply(output([change(old,blue)]),batch:[old],threadID:"same",knownSources:[old])
        #expect(state.items.isEmpty)
        try state.apply(output([change(fresh,blue)]),batch:[fresh],threadID:"same",knownSources:[old,fresh])
        #expect(state.items.map(\.text) == [blue])
        #expect(state.projectedText(old) == "")
    }
    @Test func legacyDigestBoundaryUsesOldSourceIdentityAndAllowsNewRemember() throws {
        let old=message("请记住，我的测试花名是蓝色纸鹤。",at:1000),fresh=message("请记住，我的测试花名是蓝色纸鹤。",at:1050)
        var state=PhoneMemoryState();state.suppressedText=[PhoneMemoryRules.digest(blue)]
        state.prepareLegacySuppression(sourceIDs:[old.id]);state=try reopened(state)
        try state.apply(output([change(old,blue)]),batch:[old],threadID:"same")
        #expect(state.items.isEmpty)
        state.prepareLegacySuppression(sourceIDs:[old.id,fresh.id])
        try state.apply(output([change(fresh,blue)]),batch:[fresh],threadID:"same")
        #expect(state.items.map(\.text) == [blue])
        #expect(state.suppressedTextBefore == nil)
    }
    @Test func legacyMissingOriginalCannotInventARevisionTimeOrClaimCompletion() throws {
        let source=message("不对，是绿色纸鹤。",at:1020)
        var state=PhoneMemoryState();state.items=[.init(text:blue,sourceIDs:["missing-original"],updatedAt:Date(timeIntervalSince1970:2000))]
        let id=state.items[0].id
        let result=try state.apply(output([change(source,green,id:id)]),batch:[source],threadID:"same")
        #expect(result.pendingSourceIDs == [source.id] && !state.processed.contains(source.id))
        #expect(state.items[0].text == blue && state.items[0].latestSourceDate == nil)
        try state.apply(output(),batch:[source],threadID:"same")
        #expect(!state.processed.contains(source.id))
    }
    @Test func legacyMissingOriginalDoesNotBlockANewExplicitMessage() throws {
        let pending=message("不对，是绿色纸鹤。",at:1020),fresh=message("请记住，我的测试花名是绿色纸鹤。",at:1050)
        var state=PhoneMemoryState();state.items=[.init(text:blue,sourceIDs:["missing-original"],updatedAt:Date(timeIntervalSince1970:2000))]
        state.prepareLegacySuppression(sourceIDs:[pending.id]);state=try reopened(state)
        let id=state.items[0].id
        try state.apply(output([change(pending,green,id:id)]),batch:[pending],threadID:"same")
        #expect(!state.processed.contains(pending.id) && state.items[0].text == blue)
        let result=try state.apply(output([change(fresh,green,id:id)]),batch:[fresh],threadID:"same")
        #expect(result.pendingSourceIDs.isEmpty && state.items[0].text == green)
        #expect(state.items[0].latestSourceDate == fresh.date)
    }
    @Test func reverseModelOrderCannotRollBackTwoCorrectionsInOneBatch() throws {
        let old=message("我的测试花名是蓝色纸鹤。",at:1000),middle=message("不对，是绿色纸鹤。",at:1020),newer=message("不对，是橙色纸鹤。",at:1030)
        var state=PhoneMemoryState(),greenChange=change(middle,green),orangeChange=change(newer,"测试花名是橙色纸鹤")
        let link=["id":old.id,"quote":"我的测试花名是蓝色纸鹤"]
        greenChange["replacesSource"]=link;orangeChange["replacesSource"]=link
        try state.apply(output([orangeChange,greenChange]),batch:[middle,newer],threadID:"same",referenceSources:[old])
        #expect(state.items.map(\.text) == ["测试花名是橙色纸鹤"])
        #expect(state.items.first?.latestSourceDate == newer.date)
        #expect(state.projectedText(middle) == "")
        let id=state.items[0].id
        // Known IDs are also checked again at mutation time, after the first plan.
        let later=message("现在改回蓝色纸鹤。",at:1050),earlier=message("现在改为绿色纸鹤。",at:1040)
        try state.apply(output([change(later,blue,id:id),change(earlier,green,id:id)]),batch:[earlier,later],threadID:"same")
        #expect(state.items.map(\.text) == [blue] && state.items.first?.latestSourceDate == later.date)
    }
    @Test func repeatedOlderSameValueCannotLowerTheRevisionBoundary() throws {
        var state=try corrected(seeded())
        let older=message("我的测试花名是绿色纸鹤。",at:1010),stale=message("我的测试花名是蓝色纸鹤。",at:1015)
        let id=state.items[0].id
        try state.apply(output([change(older,green,id:id)]),batch:[older],threadID:"same")
        #expect(state.items[0].latestSourceDate == Date(timeIntervalSince1970:1020))
        try state.apply(output([change(stale,blue,id:id)]),batch:[stale],threadID:"same")
        #expect(state.items.map(\.text) == [green])
    }
    @Test func englishDecimalsRemainWithinACompleteSentence() throws {
        let old=message("Remember, my height is 1.75 m. I study Japanese.",at:1000),newer=message("Actually, my height is 1.76 m.",at:1020)
        for quote in ["my height is 1.75 m.","my height is 1."] {
            var state=PhoneMemoryState(),proposal=change(newer,"my height is 1.76 m")
            proposal["replacesSource"]=["id":old.id,"quote":quote]
            let result=try state.apply(output([proposal]),batch:[newer],threadID:"same",referenceSources:[old])
            if quote == "my height is 1.75 m." {
                #expect(result.pendingSourceIDs.isEmpty && state.items.map(\.text) == ["my height is 1.76 m"])
                #expect(state.projectedText(old)?.contains("I study Japanese.") == true)
            } else { #expect(result.pendingSourceIDs == [newer.id] && state.items.isEmpty) }
        }
    }
    @Test func projectedAwaySourcesDoNotConsumeTheEightMessageBudget() throws {
        var state=PhoneMemoryState(),retired: [PhoneChatMessage]=[]
        for index in 0..<8 {
            let old=message("我的旧编号为\(index)。",at:Double(1000+index)),newer=message("不对，是新编号\(index)。",at:Double(2000+index))
            retired.append(old);state.recordFailure([old],now:Date(timeIntervalSince1970:1100))
            var proposal=change(newer,"我的新编号为\(index)")
            proposal["replacesSource"]=["id":old.id,"quote":"我的旧编号为\(index)"]
            try state.apply(output([proposal]),batch:[newer],threadID:"same",referenceSources:[old])
        }
        let fresh=(0..<10).map { message("我正在学习独立项目\($0)。",at:Double(3000+$0)) }
        var thread=PhoneChatThread();thread.messages=retired+fresh
        let batch=state.batch(thread,now:Date(timeIntervalSince1970:5000))
        #expect(batch.count == 8 && batch.map(\.id) == Array(fresh.prefix(8)).map(\.id))
        #expect(thread.messages.map(\.text) == (retired+fresh).map(\.text))
    }
    @Test func sourceCoordinatesAreDerivedFromTheExactUTF16Original() throws {
        let old=message("😀我的测试花名是蓝色纸鹤。我长期学习日语。",at:1000),newer=message("不对，是绿色纸鹤。",at:1020)
        var state=PhoneMemoryState(),correction=change(newer,green)
        correction["replacesSource"]=["id":old.id,"quote":"😀我的测试花名是蓝色纸鹤"]
        try state.apply(output([correction]),batch:[newer],threadID:"same",referenceSources:[old])
        let span=try #require(state.retiredSpans?.first)
        #expect(span.startUTF16 == 0 && span.lengthUTF16 == "😀我的测试花名是蓝色纸鹤".utf16.count)
        #expect(state.projectedText(old) == "。我长期学习日语。")
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
        #expect(state.projectedText(old)?.contains("纸鹤") == false)
        #expect(state.projectedText(old)?.contains("日语") == true)
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

    @Test(arguments:["我希望你忘掉我的测试花名。","能不能忘掉我的测试花名？","可以请你删除我的测试花名吗？","Could you forget my test nickname?","I would like you to delete my test nickname.","我希望你忘掉“我的测试花名”这条记忆，但不要删除聊天原话。","Could you forget \"my test nickname\"?","能不能删除我之前记住的测试花名？"])
    func naturalExplicitRequestsActuallyForget(_ text: String) throws {
        var state=try seeded()
        let source=message(text,at:1030)
        let removal:[String:Any]=["id":state.items[0].id,"sourceIDs":[source.id],"evidence":text]
        try state.apply(output(removals:[removal]),batch:[source],threadID:"forget",now:Date(timeIntervalSince1970:2100))
        #expect(state.items.isEmpty)
        #expect(state.processed.contains(source.id))
    }

    @Test(arguments:["不要忘记我的测试花名。","请不要删除我的测试花名。","我不希望你忘掉我的测试花名。","她说：忘掉我的测试花名。","请解释“忘掉我的测试花名”的意思。","“忘掉我的测试花名。”","我希望你记住“忘掉我的测试花名”这句话。","Don't forget my test nickname.","Please do not delete my test nickname.","She said 'forget my test nickname'.","今天天气不错。","我的测试花名是什么？","我之前让你忘掉的是什么？","你还记得我说过“忘掉我的测试花名”吗？","Could you tell me whether I asked you to forget my nickname?","请把我的测试花名记好，别把它忘掉。"])
    func negationQuotationAndUnrelatedSourcesCannotAuthorizeForgetting(_ text: String) throws {
        var state=try seeded()
        let source=message(text,at:1030)
        let removal:[String:Any]=["id":state.items[0].id,"sourceIDs":[source.id],"evidence":text]
        try state.apply(output(removals:[removal]),batch:[source],threadID:"unauthorized",now:Date(timeIntervalSince1970:2100))
        #expect(state.items.map(\.text) == [blue])
    }
}

import Foundation
import Testing
@testable import WeftMateCore

@Suite struct IndependentD9Probes {
  func message(_ text:String,_ seconds:Double)->PhoneChatMessage { var m=PhoneChatMessage(role:"user",text:text);m.date=Date(timeIntervalSince1970:seconds);return m }
  func change(_ m:PhoneChatMessage,_ text:String,id:String?=nil,link:[String:String]?=nil)->[String:Any] { var c:[String:Any] = ["id":id as Any? ?? NSNull(),"text":text,"sourceIDs":[m.id],"evidence":m.text];if let link { c["replacesSource"]=link };return c }
  func patch(_ changes:[[String:Any]]=[],_ removals:[[String:Any]]=[])->String { String(decoding:try! JSONSerialization.data(withJSONObject:["upsert":changes,"invalidate":removals]),as:UTF8.self) }
  @Test func ordinaryUnknownIDCanRecoverOnAValidRetry() throws {
    let m=message("我长期学习日语。",1000);var state=PhoneMemoryState()
    let bad=try state.apply(patch([change(m,"长期学习日语",id:"unknown-id")]),batch:[m],threadID:"t",now:Date(timeIntervalSince1970:2000))
    #expect(bad.pendingSourceIDs == [m.id])
    let good=try state.apply(patch([change(m,"长期学习日语")]),batch:[m],threadID:"t",now:Date(timeIntervalSince1970:2100))
    #expect(state.items.map(\.text) == ["长期学习日语"])
    #expect(good.pendingSourceIDs.isEmpty)
    #expect(state.processed.contains(m.id) && state.retry?[m.id] == nil)
  }
  @Test func eightFullyRetiredSourcesDoNotBlockTheNextPendingMessage() throws {
    var state=PhoneMemoryState(),old:[PhoneChatMessage]=[]
    for i in 0..<8 {
      let m=message("我的旧编号为\(i)。",Double(1000+i)),n=message("不对，是新编号\(i)。",Double(2000+i));old.append(m)
      state.recordFailure([m],now:Date(timeIntervalSince1970:1100))
      let result=try state.apply(patch([change(n,"我的新编号为\(i)",link:["id":m.id,"quote":"我的旧编号为\(i)"])]),batch:[n],threadID:"t",knownSources:[m,n],referenceSources:[m])
      #expect(result.pendingSourceIDs.isEmpty)
      #expect(state.projectedText(m) == "")
    }
    let fresh=message("我长期学习日语。",3000);var thread=PhoneChatThread();thread.messages=old+[fresh]
    #expect(state.batch(thread,now:Date(timeIntervalSince1970:5000)).contains { $0.id == fresh.id })
  }
  @Test func historicalDeletionQuestionCannotAuthorizeDeletion() throws {
    let first=message("请记住，我的测试花名是蓝色纸鹤。",1000),question=message("删除我的测试花名是我之前提过的要求吗？",2000)
    var state=PhoneMemoryState();try state.apply(patch([change(first,"测试花名是蓝色纸鹤")]),batch:[first],threadID:"t")
    let removal:[String:Any] = ["id":state.items[0].id,"sourceIDs":[question.id],"evidence":question.text]
    try state.apply(patch([], [removal]),batch:[question],threadID:"t",knownSources:[first,question])
    #expect(state.items.map(\.text) == ["测试花名是蓝色纸鹤"])
  }
  @Test func englishSentenceQuoteKeepsTheIndependentSentence() throws {
    let old=message("Remember, my nickname is Blue. I study Japanese.",1000),newer=message("Actually, my nickname is Green.",2000)
    var state=PhoneMemoryState()
    let result=try state.apply(patch([change(newer,"my nickname is Green",link:["id":old.id,"quote":"my nickname is Blue."])]),batch:[newer],threadID:"t",knownSources:[old,newer],referenceSources:[old])
    #expect(result.pendingSourceIDs.isEmpty)
    #expect(state.items.map(\.text) == ["my nickname is Green"])
    #expect(state.projectedText(old)?.contains("I study Japanese.") == true)
  }
  @Test func englishTwoSentenceQuoteCannotRetireAnIndependentFact() throws {
    let old=message("Remember, my nickname is Blue. I study Japanese.",1000),newer=message("Actually, my nickname is Green.",2000)
    var state=PhoneMemoryState()
    let result=try state.apply(patch([change(newer,"my nickname is Green",link:["id":old.id,"quote":"my nickname is Blue. I study Japanese."])]),batch:[newer],threadID:"t",knownSources:[old,newer],referenceSources:[old])
    #expect(result.pendingSourceIDs == [newer.id])
    #expect(state.projectedText(old)?.contains("I study Japanese.") == true)
  }
}
