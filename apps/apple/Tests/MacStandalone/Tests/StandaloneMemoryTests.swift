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
