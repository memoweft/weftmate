import Foundation
import Testing
import WeftMateCore
@testable import MacStandaloneProduct

@MainActor @Suite(.serialized) struct StandaloneMemoryTests {
    @MainActor private final class Scenario {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let process=Process(), keys=PhoneCheckCredentials()
        let app: AppleAppModel
        let model: PhoneStandaloneModel
        let origin: String
        init() throws {
            app=AppleAppModel(directory:root);app.cloudLogin.subject=nil;app.cloudLogin.authenticated=false
            model=PhoneStandaloneModel(testCredentials:keys,testLoopback:true)
            let pipe=Pipe()
            process.executableURL=URL(fileURLWithPath:"/usr/bin/env")
            process.arguments=["node",URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("memory-fixture.mjs").path]
            process.standardOutput=pipe;try process.run()
            var data=Data()
            while true {
                let byte=pipe.fileHandleForReading.readData(ofLength:1)
                guard !byte.isEmpty else { throw NSError(domain:"MemoryFixtureStart",code:1) }
                if byte == Data([10]) { break };data.append(byte)
            }
            origin=(try JSONSerialization.jsonObject(with:data) as! [String:String])["origin"]!
            model.activate(app:app)
            try model.saveModel(.init(name:"Synthetic",baseURL:origin+"/v1",model:"synthetic",apiKey:"synthetic-state-key"))
        }
        func close() {
            model.deactivate()
            if process.isRunning { process.terminate();process.waitUntilExit() }
            try? FileManager.default.removeItem(at:root)
        }
        func mode(_ value: String) async throws {
            var request=URLRequest(url:URL(string:origin+"/mode")!);request.httpMethod="POST";request.httpBody=Data(value.utf8)
            _ = try await URLSession.shared.data(for:request)
        }
        func report() async throws -> [String:Any] {
            let (data,_)=try await URLSession.shared.data(from:URL(string:origin+"/report")!)
            return try JSONSerialization.jsonObject(with:data) as! [String:Any]
        }
        @discardableResult func send(_ text: String, fresh: Bool = false) async throws -> String {
            if fresh { model.newThread() };model.draft=text;model.send()
            for _ in 0..<500 {
                if !model.busy && !model.memoryWorking { return model.messages.last?.text ?? "" }
                try await Task.sleep(for:.milliseconds(10))
            }
            throw NSError(domain:"MemoryReplyTimeout",code:1)
        }
    }
    @Test func rememberThenImmediateNewConversationAndReopen() async throws {
        let s=try Scenario();defer { s.close() }
        try await s.mode("slow")
        try await s.send("请记住，我的测试花名是蓝色纸鹤。")
        #expect(s.model.memory.items.map(\.text) == ["测试花名是蓝色纸鹤"])
        #expect(try await s.send("我的测试花名是什么？",fresh:true) == "蓝色纸鹤")
        s.model.deactivate();s.model.activate(app:s.app)
        #expect(try await s.send("我的测试花名是什么？",fresh:true) == "蓝色纸鹤")
        let store=try PhoneChatStore(account:s.app.phoneAccountIdentity,directory:s.root.appendingPathComponent("PhoneChats"),credentials:s.keys)
        #expect(try Data(contentsOf:store.file).range(of:Data("蓝色纸鹤".utf8)) == nil)
        #expect(s.app.offline.enqueued.isEmpty)
    }
    @Test func correctionUsesPreviousSubjectInAnotherConversation() async throws {
        let s=try Scenario();defer { s.close() }
        try await s.send("请记住，我的测试花名是蓝色纸鹤。")
        try await s.send("我的测试花名是什么？",fresh:true)
        try await s.send("不对，是绿色纸鹤。")
        #expect(s.model.memory.items.map(\.text) == ["测试花名是绿色纸鹤"])
        #expect(try await s.send("我的测试花名是什么？",fresh:true) == "绿色纸鹤")
    }
    @Test func failedOlderSourceCannotUndoCorrectionAndStillKeepsIndependentFact() async throws {
        let s=try Scenario();defer { s.close() }
        try await s.send("请记住，我的测试花名是蓝色纸鹤。")
        try await s.mode("fail")
        try await s.send("请记住，我的测试花名是蓝色纸鹤。我长期学习日语。",fresh:true)
        try await s.mode("ok")
        try await s.send("不对，是绿色纸鹤。",fresh:true)
        #expect(s.model.memory.items.map(\.text) == ["测试花名是绿色纸鹤"])
        s.model.deactivate();s.model.activate(app:s.app)
        s.model.retryMemory()
        for _ in 0..<500 { if !s.model.memoryWorking { break };try await Task.sleep(for:.milliseconds(10)) }
        #expect(Set(s.model.memory.items.map(\.text)) == ["测试花名是绿色纸鹤","长期学习日语"])
    }
    @Test func failedOlderSourceCannotRecreateForgottenRevisionAfterReopen() async throws {
        let s=try Scenario();defer { s.close() }
        try await s.send("请记住，我的测试花名是蓝色纸鹤。")
        try await s.mode("fail")
        try await s.send("请记住，我的测试花名是蓝色纸鹤。我长期学习日语。",fresh:true)
        try await s.mode("ok")
        try await s.send("不对，是绿色纸鹤。",fresh:true)
        let id=try #require(s.model.memory.items.first?.id)
        s.model.forgetMemory(id)
        s.model.deactivate();s.model.activate(app:s.app)
        s.model.retryMemory()
        for _ in 0..<500 { if !s.model.memoryWorking { break };try await Task.sleep(for:.milliseconds(10)) }
        #expect(s.model.memory.items.map(\.text) == ["长期学习日语"])
    }
    @Test func firstFailedSourceThenCorrectionAndForgetRetiresOnlyThatClause() async throws {
        let s=try Scenario();defer { s.close() }
        try await s.mode("fail")
        try await s.send("请记住，我的测试花名是蓝色纸鹤。我长期学习日语。")
        let original=try #require(s.model.messages.first { $0.role == "user" })
        try await s.mode("ok");try await s.send("不对，是绿色纸鹤。")
        #expect(s.model.memory.items.map(\.text) == ["测试花名是绿色纸鹤"])
        let report=try await s.report(),inputs=report["extractionInputs"] as! [[String:Any]]
        let background=inputs.last?["对话背景"] as! [[String:String]]
        #expect(background.contains { $0["id"] == original.id && $0["text"] == original.text })
        s.model.forgetMemory(try #require(s.model.memory.items.first?.id))
        s.model.deactivate();s.model.activate(app:s.app);s.model.retryMemory()
        for _ in 0..<500 { if !s.model.memoryWorking { break };try await Task.sleep(for:.milliseconds(10)) }
        #expect(s.model.memory.items.map(\.text) == ["长期学习日语"])
        #expect(s.model.state.threads.flatMap(\.messages).contains { $0.id == original.id && $0.text == original.text })
        let final=try await s.report()["extractionInputs"] as! [[String:Any]]
        let retried=final.last?["原话"] as! [[String:String]]
        #expect(retried.contains { $0["id"] == original.id && $0["text"]?.contains("日语") == true && $0["text"]?.contains("纸鹤") == false })
        #expect(!s.model.memory.replyHistory(s.model.state.threads.flatMap(\.messages)).contains { $0.text.contains("纸鹤") })
    }
    @Test func pinnedItemsCannotMakeAnOldFailedSourceBecomeANewFact() async throws {
        let s=try Scenario();defer { s.close() };try await s.mode("fail")
        try await s.send("请记住，我的测试花名是蓝色纸鹤。我长期学习日语。")
        try await s.mode("ok");try await s.send("不对，是绿色纸鹤。")
        for index in 0..<8 { try s.model.saveMemory(text:"固定项目\(index)",pinned:true) }
        var selection=s.model.memory
        #expect(!selection.select(query:"测试花名").contains { $0.text.contains("纸鹤") })
        s.model.retryMemory()
        for _ in 0..<500 { if !s.model.memoryWorking { break };try await Task.sleep(for:.milliseconds(10)) }
        #expect(s.model.memory.items.count == 10)
        #expect(s.model.memory.items.contains { $0.text == "测试花名是绿色纸鹤" })
        #expect(s.model.memory.items.contains { $0.text == "长期学习日语" })
        #expect(!s.model.memory.items.contains { $0.text.contains("蓝色") })
    }
    @Test func missingOrWrongSourceLinkStaysPendingAndDoesNotPretendSuccess() async throws {
        for mode in ["missing-link","wrong-link"] {
            let s=try Scenario();defer { s.close() };try await s.mode("fail")
            try await s.send("请记住，我的测试花名是蓝色纸鹤。我长期学习日语。")
            try await s.mode(mode);let reply=try await s.send("不对，是绿色纸鹤。我长期学习日语。")
            let source=try #require(s.model.messages.last { $0.role == "user" })
            #expect(s.model.memory.items.map(\.text) == ["长期学习日语"])
            #expect(!s.model.memory.processed.contains(source.id) && s.model.memory.retry?[source.id]?.needsSourceLink == true)
            #expect(reply.contains("还有部分记忆没能确认") && reply.contains("已在这台设备上记住：长期学习日语"))
        }
    }
    @Test func aNewExplicitMessageCanRememberTheSameFactAfterForgetting() async throws {
        let s=try Scenario();defer { s.close() }
        try await s.send("请记住，我的测试花名是蓝色纸鹤。")
        let original=try #require(s.model.messages.first { $0.role == "user" })
        s.model.forgetMemory(try #require(s.model.memory.items.first?.id))
        try await s.send("请记住，我的测试花名是蓝色纸鹤。")
        #expect(s.model.memory.items.map(\.text) == ["测试花名是蓝色纸鹤"])
        #expect(s.model.memory.projectedText(original) == "")
        #expect(s.model.memory.retiredSpans?.contains { $0.sourceID == original.id } == true)
    }
    @Test func keepingANicknameIsNotPermissionToForgetIt() async throws {
        let s=try Scenario();defer { s.close() }
        try await s.send("请记住，我的测试花名是蓝色纸鹤。")
        try await s.send("请把我的测试花名记好，别把它忘掉。")
        #expect(s.model.memory.items.map(\.text) == ["测试花名是蓝色纸鹤"])
        #expect(s.model.messages.last?.text.contains("已从这台设备的记忆里忘掉") == false)
    }
    @Test func failedOlderSourceCannotUndoAManualEdit() async throws {
        let s=try Scenario();defer { s.close() }
        try await s.send("请记住，我的测试花名是蓝色纸鹤。")
        try await s.mode("fail")
        try await s.send("请记住，我的测试花名是蓝色纸鹤。我长期学习日语。",fresh:true)
        try await s.mode("ok")
        try s.model.saveMemory(id:try #require(s.model.memory.items.first?.id),text:"测试花名是绿色纸鹤",pinned:false)
        s.model.retryMemory()
        for _ in 0..<500 { if !s.model.memoryWorking { break };try await Task.sleep(for:.milliseconds(10)) }
        #expect(Set(s.model.memory.items.map(\.text)) == ["测试花名是绿色纸鹤","长期学习日语"])
    }
    @Test func ordinaryBadItemIDRecoversWithTheCorrectRetryAndReceipt() async throws {
        let s=try Scenario();defer { s.close() };try await s.mode("unknown-item")
        try await s.send("我长期学习日语。")
        let source=try #require(s.model.messages.first { $0.role == "user" })
        #expect(s.model.memory.items.isEmpty && !s.model.memory.processed.contains(source.id))
        #expect(s.model.memoryNotice != nil)
        try await s.mode("ok");s.model.retryMemory()
        for _ in 0..<500 { if !s.model.memoryWorking { break };try await Task.sleep(for:.milliseconds(10)) }
        #expect(s.model.memory.items.map(\.text) == ["长期学习日语"])
        #expect(s.model.memory.processed.contains(source.id) && s.model.memory.retry?[source.id] == nil)
        #expect(s.model.memoryNotice == nil)
    }
    @Test func askingAboutAnEarlierDeleteRequestDoesNotDeleteButACurrentRequestDoes() async throws {
        let s=try Scenario();defer { s.close() }
        try await s.send("请记住，我的测试花名是蓝色纸鹤。")
        try await s.send("删除我的测试花名是我之前提过的要求吗？")
        #expect(s.model.memory.items.map(\.text) == ["测试花名是蓝色纸鹤"])
        #expect(s.model.messages.last?.text.contains("已从这台设备的记忆里忘掉") == false)
        try await s.send("能不能删除我之前记住的测试花名？")
        #expect(s.model.memory.items.isEmpty)
        #expect(s.model.messages.last?.text.contains("已从这台设备的记忆里忘掉") == true)
    }
    @Test func englishPastDeleteQuestionPreservesMemoryAndAPoliteCurrentRequestDeletes() async throws {
        let s=try Scenario();defer { s.close() }
        try await s.send("请记住，我的测试花名是蓝色纸鹤。")
        let question="Delete my nickname — was that what I asked earlier?"
        try await s.send(question)
        #expect(s.model.memory.items.map(\.text) == ["测试花名是蓝色纸鹤"])
        #expect(s.model.messages.last?.text.contains("已从这台设备的记忆里忘掉") == false)
        let inputs=try await s.report()["extractionInputs"] as! [[String:Any]]
        #expect((inputs.last?["原话"] as? [[String:String]])?.contains { $0["text"] == question } == true)
        s.model.deactivate();s.model.activate(app:s.app)
        #expect(s.model.memory.items.map(\.text) == ["测试花名是蓝色纸鹤"])
        try await s.send("Could you please delete my nickname from earlier?")
        #expect(s.model.memory.items.isEmpty)
        #expect(s.model.messages.last?.text.contains("已从这台设备的记忆里忘掉") == true)
    }
    @Test func naturalExplicitForgettingRemovesTheActualSavedItem() async throws {
        for request in ["我希望你忘掉我的测试花名。","能不能忘掉我的测试花名？"] {
            let s=try Scenario();defer { s.close() }
            try await s.send("请记住，我的测试花名是蓝色纸鹤。")
            try await s.send(request,fresh:true)
            #expect(s.model.memory.items.isEmpty)
            #expect(s.model.messages.last?.text.contains("已从这台设备的记忆里忘掉") == true)
        }
    }
    @Test func legacyDelayedFormationUsesTheRetainedOriginalSourceDates() async throws {
        let s=try Scenario();defer { s.close() };s.model.deactivate()
        var first=PhoneChatMessage(role:"user",text:"请记住，我的测试花名是蓝色纸鹤。")
        first.date=Date(timeIntervalSince1970:1000)
        var correction=PhoneChatMessage(role:"user",text:"不对，是绿色纸鹤。")
        correction.date=Date(timeIntervalSince1970:1020)
        var thread=PhoneChatThread();thread.messages=[first,correction]
        var old=PhoneChatState();old.threads=[thread];old.selected=thread.id;old.memory = .init()
        old.memory?.items=[.init(text:"测试花名是蓝色纸鹤",threadID:thread.id,sourceIDs:[first.id],updatedAt:Date(timeIntervalSince1970:2000))]
        old.memory?.processed=[first.id]
        let store=try PhoneChatStore(account:s.app.phoneAccountIdentity,directory:s.root.appendingPathComponent("PhoneChats"),credentials:s.keys)
        try store.save(old);s.model.activate(app:s.app);s.model.retryMemory()
        for _ in 0..<500 { if !s.model.memoryWorking { break };try await Task.sleep(for:.milliseconds(10)) }
        #expect(s.model.memory.items.map(\.text) == ["测试花名是绿色纸鹤"])
        #expect(s.model.memory.items.first?.latestSourceDate == correction.date)
    }
    @Test func forgetCannotReturnInNewConversationOrAfterReopen() async throws {
        let s=try Scenario();defer { s.close() }
        try await s.send("请记住，我的测试花名是蓝色纸鹤。")
        // Establish deletion behavior independently of the completion-timing regression.
        await s.model.extractMemory(threadID:s.model.state.selected!)
        #expect(s.model.memory.items.count == 1)
        try await s.send("忘掉我的测试花名。",fresh:true)
        #expect(s.model.memory.items.isEmpty)
        s.model.deactivate();s.model.activate(app:s.app)
        #expect(try await s.send("我的测试花名是什么？",fresh:true) == "没有相关记录")
        #expect(s.model.memory.items.isEmpty)
    }
    @Test func failedOrMalformedExtractionNeverClaimsItRemembered() async throws {
        for mode in ["fail","malformed"] {
            let s=try Scenario();defer { s.close() };try await s.mode(mode)
            let text=try await s.send("请记住，我的测试花名是蓝色纸鹤。")
            #expect(!text.contains("我记下了"))
            #expect(text.contains("没能") || text.contains("未能"))
            #expect(s.model.memory.items.isEmpty && s.model.memory.processed.isEmpty)
            let requests=try await s.report()["chatRequests"] as! [[[String:Any]]]
            let facts=requests[0][0]["content"] as! String
            #expect(requests.count == 1 && facts.contains("尚未确认") && facts.contains("不要声称"))
            try await s.mode("ok")
            s.model.retryMemory()
            for _ in 0..<200 { if !s.model.memoryWorking { break };try await Task.sleep(for:.milliseconds(10)) }
            #expect(try await s.send("我的测试花名是什么？",fresh:true) == "蓝色纸鹤")
        }
    }
    @Test func emptyPersonalRecallCannotInventOtherMemories() async throws {
        let s=try Scenario();defer { s.close() };try await s.mode("invent")
        #expect(try await s.send("我的测试花名是什么？",fresh:true) == "没有相关记录")
        #expect(s.model.memory.items.isEmpty)
        let requests=try await s.report()["chatRequests"] as! [[[String:Any]]]
        #expect(requests.count == 1)
        #expect((requests[0][0]["content"] as? String)?.contains("本机记忆里没有相关记录") == true)
    }
    @Test func correctionAndRememberWithTaskAlwaysReachChatModel() async throws {
        let s=try Scenario();defer { s.close() }
        #expect(try await s.send("不对，请重新计算 12×13") .contains("156"))
        let meal=try await s.send("记住我不吃辣，帮我安排一周食谱")
        #expect(meal.contains("周一") && meal.contains("周日"))
        #expect(s.model.memory.items.contains { $0.text == "用户不吃辣" })
        #expect((try await s.report()["chatRequests"] as? [Any])?.count == 2)
    }
    @Test func emptyOrDisabledMemoryStillSendsCodeAndImageToChatModel() async throws {
        let s=try Scenario();defer { s.close() }
        for enabled in [true,false] {
            s.model.setMemoryEnabled(enabled)
            #expect(try await s.send("我的代码报错是什么原因？代码：let count = missing",fresh:true).contains("missing 未定义"))
            s.model.newThread()
            s.model.addAttachment(.init(name:"synthetic.jpg",contentType:"image/jpeg",data:Data([0xff,0xd8,0xff,0xd9])))
            #expect(try await s.send("我的截图里是什么？").contains("合成色块"))
        }
        #expect((try await s.report()["chatRequests"] as? [Any])?.count == 4)
    }
    @Test func stalledOldExtractionDoesNotBlockChatAndFailedSourcesBackOff() async throws {
        let s=try Scenario();defer { s.close() }
        s.model.setMemoryEnabled(false)
        try await s.send("旧对话一",fresh:true);try await s.send("旧对话二",fresh:true)
        let oldID=s.model.messages[0].id
        s.model.setMemoryEnabled(true);try await s.mode("hold")
        s.model.newThread();s.model.draft="现在正常聊天";s.model.send()
        for _ in 0..<100 { if !s.model.busy { break };try await Task.sleep(for:.milliseconds(10)) }
        #expect(!s.model.busy)
        #expect((try await s.report()["chatRequests"] as? [Any])?.count == 3)
        try await s.mode("fail")
        for _ in 0..<200 { if !s.model.busy && !s.model.memoryWorking { break };try await Task.sleep(for:.milliseconds(10)) }
        let before=(try await s.report()["extractionSources"] as! [[String]]).filter { $0.contains(oldID) }.count
        #expect(before == 1)
        #expect(s.model.memory.retry?[oldID]?.after ?? .distantPast > Date())
        try await s.send("第二次正常聊天",fresh:true)
        for _ in 0..<50 { if !s.model.extracting { break };try await Task.sleep(for:.milliseconds(10)) }
        let after=(try await s.report()["extractionSources"] as! [[String]]).filter { $0.contains(oldID) }.count
        #expect(after == before)
    }
    @Test func queuedRepliesKeepTheirOwnMemoryResultsAndDoNotExtractFutureTurns() async throws {
        let s=try Scenario();defer { s.close() };try await s.mode("slow")
        for text in ["请记住，我的测试花名是蓝色纸鹤。","不对，是绿色纸鹤。","不对，请重新计算 12×13"] {
            s.model.draft=text;s.model.send()
        }
        for _ in 0..<500 { if !s.model.busy && !s.model.memoryWorking { break };try await Task.sleep(for:.milliseconds(10)) }
        let replies=s.model.messages.filter { $0.role == "assistant" }
        #expect(s.model.messages.count == 6 && replies.count == 3)
        #expect(replies.allSatisfy { $0.replyStatus == .complete })
        #expect(replies[0].text.contains("已在这台设备上记住：测试花名是蓝色纸鹤"))
        #expect(replies[1].text.contains("已在这台设备上记住：测试花名是绿色纸鹤"))
        #expect(replies[2].text.contains("156") && !replies[2].text.contains("已在这台设备上记住"))
        #expect(s.model.memory.items.map(\.text) == ["测试花名是绿色纸鹤"])
        let report=try await s.report()
        #expect((report["chatRequests"] as? [Any])?.count == 3)
        #expect((report["extractionBackgrounds"] as? [[Any]])?.first?.isEmpty == true)
    }
}
