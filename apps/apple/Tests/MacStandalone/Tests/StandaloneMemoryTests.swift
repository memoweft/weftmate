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
        @discardableResult func send(_ text: String, fresh: Bool = false) async throws -> String {
            if fresh { model.newThread() };model.draft=text;model.send()
            for _ in 0..<500 {
                if !model.busy { return model.messages.last?.text ?? "" }
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
        #expect(try await s.send("我的测试花名是什么？",fresh:true) == "我现在不知道，本机记忆里没有相关记录。")
        #expect(s.model.memory.items.isEmpty)
    }
    @Test func failedOrMalformedExtractionNeverClaimsItRemembered() async throws {
        for mode in ["fail","malformed"] {
            let s=try Scenario();defer { s.close() };try await s.mode(mode)
            let text=try await s.send("请记住，我的测试花名是蓝色纸鹤。")
            #expect(!text.contains("我记下了"))
            #expect(text.contains("没能") || text.contains("未能"))
            #expect(s.model.memory.items.isEmpty && s.model.memory.processed.isEmpty)
            try await s.mode("ok")
            #expect(try await s.send("我的测试花名是什么？",fresh:true) == "蓝色纸鹤")
        }
    }
    @Test func emptyPersonalRecallCannotInventOtherMemories() async throws {
        let s=try Scenario();defer { s.close() };try await s.mode("invent")
        #expect(try await s.send("我的测试花名是什么？",fresh:true) == "我现在不知道，本机记忆里没有相关记录。")
        #expect(s.model.memory.items.isEmpty)
    }
}
