import Foundation
import WeftMateCore

// Compiles the actual iPhone state model on macOS; UI, cloud and Keychain are absent.
final class PhoneCheckCredentials: CredentialStore, @unchecked Sendable {
    private let lock=NSLock()
    private var data: [String:Data]=[:]
    func load(key: String) -> Data? { lock.withLock { data[key] } }
    func save(_ value: Data,key: String) { lock.withLock { data[key]=value } }
    func delete(key: String) { lock.withLock { data[key]=nil } }
}
struct PhoneCheckSession { enum Verification { case verified };var verification: Verification = .verified;var hostId="synthetic-computer" }
@MainActor final class PhoneCheckCloud { var subject: String?="account-a";var authenticated=true }
@MainActor final class PhoneCheckOffline {
    var memoryItems: [OfflineMemory]=[]
    func authorizeMemory(control: (String) async throws -> OfflineAuthorization) async throws {}
    func erase() { enqueued=[];synced=[];memoryItems=[];ready=false }
    var generation: Int?=1
    var ready=true
    var hostOffline=false
    var synced=Set<String>()
    var enqueued: [OfflineTurn]=[]
    func enqueuePhoneTurns(_ values: [OfflineTurn],generation: Int) throws {
        guard generation == self.generation else { throw OfflineFailure.notReady }
        for value in values where !enqueued.contains(where: { $0.id == value.id }) { enqueued.append(value) }
    }
}
@MainActor final class AppleAppModel {
    var session: PhoneCheckSession?
    let cloudLogin=PhoneCheckCloud()
    let offline=PhoneCheckOffline()
    let healthStateDirectory: URL
    var phoneCredentialNamespace="synthetic-state-only"
    var phoneAccountIdentity: String { "https://cloud.example.com|"+(cloudLogin.subject ?? "device-local") }
    var controlGeneration=1
    init(directory: URL) { healthStateDirectory=directory.appendingPathComponent("Health") }
    func offlineAuthorization(_ host: String) async throws -> OfflineAuthorization {
        let json: [String:Any]=["authorized":true,"hostId":host,"accountId":cloudLogin.subject ?? "", "generation":controlGeneration]
        return try JSONDecoder().decode(OfflineAuthorization.self,from:JSONSerialization.data(withJSONObject:json))
    }
}
@main struct PhoneMemoryModelChecks {
    @MainActor static func main() async {
        do { try await run() } catch { print("FAIL: \(error)");exit(1) }
    }
    @MainActor static func run() async throws {
        let root=URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true)
        let process=Process(),output=Pipe()
        let fixture=URL(fileURLWithPath:#filePath).deletingLastPathComponent().appendingPathComponent("phone_memory_state_server.mjs")
        process.executableURL=URL(fileURLWithPath:"/usr/bin/env");process.arguments=["node",fixture.path];process.standardOutput=output
        try process.run();defer { if process.isRunning { process.terminate();process.waitUntilExit() } }
        var bytes=Data();while true { let byte=output.fileHandleForReading.readData(ofLength:1);if byte==Data([10]) { break };bytes.append(byte) }
        let ready=try JSONSerialization.jsonObject(with:bytes) as! [String:String]
        let origin=ready["origin"]!,keys=PhoneCheckCredentials(),app=AppleAppModel(directory:root)
        let model=PhoneStandaloneModel(testCredentials:keys,testLoopback:true)
        var checks=0
        func require(_ value: Bool,_ name: String) throws { guard value else { throw NSError(domain:"PhoneMemory:"+name,code:1) };checks+=1 }
        func wait(_ condition: () -> Bool, line: UInt = #line) async throws {
            for _ in 0..<200 { if condition() { return };try await Task.sleep(for:.milliseconds(10)) }
            throw NSError(domain:"PhoneMemoryWait-line-\(line)",code:1)
        }
        func report() async throws -> [String:Any] { let (data,_)=try await URLSession.shared.data(from:URL(string:origin+"/report")!);return try JSONSerialization.jsonObject(with:data) as! [String:Any] }
        func mode(_ value: String) async throws { var req=URLRequest(url:URL(string:origin+"/mode")!);req.httpMethod="POST";req.httpBody=Data(value.utf8);_ = try await URLSession.shared.data(for:req) }
        func chat(_ text: String) async throws { model.newThread();model.draft=text;model.send();try await wait({!model.busy}) }
        func pendingChat(_ text: String) async throws {
            model.setMemoryEnabled(false);try await chat(text);model.setMemoryEnabled(true)
        }
        func extract() async { await model.extractMemory(threadID:model.state.selected!) }
        model.activate(app:app)
        let config=PhoneModelConfiguration(name:"合成",baseURL:origin+"/v1",model:"synthetic",apiKey:"synthetic-state-key");try model.saveModel(config)
        try await chat("我喜欢清淡的食物");try require(model.memory.items.count == 1,"saved-before-reply-completes")
        let before=try await report()["extractions"] as! Int
        model.finishConversation();try await wait({model.memory.items.count == 1})
        try require(model.memory.items.count == 1,"leave-conversation-triggers")
        await extract();let after=try await report()["extractions"] as! Int
        try require(after == before,"no-new-content-zero-repeat")
        try await chat("我喜欢清淡的食物，现在改成辣的食物");await extract()
        try require(model.memory.items.count == 1 && model.memory.items[0].text.contains("改成辣"),"updates-existing-item")
        let id=model.memory.items[0].id;try model.saveMemory(id:id,text:"我喜欢辣的食物",pinned:true)
        try require(model.memory.items[0].pinned,"manual-edit-pin")
        model.forgetMemory(id);await extract();try require(model.memory.items.isEmpty,"forget-does-not-reappear")
        try model.saveMemory(text:"固定绘画偏好",pinned:true)
        try await chat("关于绘画");let contexts=try await report()["contexts"] as! [String]
        try require(contexts.last!.contains("记忆：固定绘画偏好") && contexts.last!.contains("没有相关记忆就直说不知道"),"same-system-message-memory-context")
        model.setMemoryEnabled(false);let offBefore=try await report()["extractions"] as! Int
        await extract();let offAfter=try await report()["extractions"] as! Int
        try require(offBefore == offAfter,"toggle-off-zero-extraction")
        model.setMemoryEnabled(true)
        try await mode("fail");let processed=model.memory.processed;try await chat("我在学日语");await extract()
        try require(model.memory.processed == processed && model.notice == nil && model.memoryNotice != nil,"failure-visible-no-watermark")
        try await mode("ok");await extract();try require(model.memory.items.contains { $0.text == "我在学日语" },"retry-succeeds")
        try await chat("坏输出");let badProcessed=model.memory.processed;await extract();try require(model.memory.processed == badProcessed,"malformed-output-retries")
        try await pendingChat("我正在学绘画");try await mode("slow")
        let pending=Task { await extract() };try await wait({model.extracting})
        app.cloudLogin.subject="account-b";model.activate(app:app);await pending.value
        try require(model.memory.items.isEmpty && model.state.threads.isEmpty,"late-result-cannot-cross-account")
        app.cloudLogin.subject="account-a";model.activate(app:app);try await mode("ok")
        try require(!model.memory.items.isEmpty,"reopen-original-account")
        try await mode("slow");try await pendingChat("我希望留下事实");let forgetting=Task { await extract() };try await wait({model.extracting});model.forgetMemory();await forgetting.value
        try require(model.memory.items.isEmpty,"forget-all-discards-inflight-result")
        try model.saveMemory(text:"交接时仍能用",pinned:true)
        app.session=PhoneCheckSession();app.offline.ready=false;await model.synchronize(app:app)
        try require(model.memory.computerHost == nil && model.memory.items.count == 1,"unready-computer-keeps-phone-memory")
        try await mode("slow");try await pendingChat("我正在做项目");let takeover=Task { await extract() };try await wait({model.extracting})
        app.offline.ready=true;await model.synchronize(app:app);await takeover.value
        try require(!model.extracting && model.memory.computerHost != nil && model.memory.items.count == 1,"stop-before-enqueue-keep-memory-until-receipt")
        let original=app.offline.enqueued;let encoder=JSONEncoder();encoder.outputFormatting=[.sortedKeys];await model.synchronize(app:app)
        try require(try encoder.encode(app.offline.enqueued) == encoder.encode(original),"interrupted-transfer-idempotent-retry")
        app.offline.synced=Set(original.prefix(1).map(\.id));await model.synchronize(app:app)
        try require(model.memory.items.count == 1 && !model.memory.handoffConfirmed,"partial-receipt-no-empty-window")
        app.offline.synced=Set(app.offline.enqueued.map(\.id));await model.synchronize(app:app)
        try require(model.memory.handoffConfirmed && model.memory.items.isEmpty && model.memory.processed.isEmpty && !model.state.threads.isEmpty,"all-receipts-delete-derived-only")
        let pcBefore=try await report()["extractions"] as! Int;await extract();let pcAfter=try await report()["extractions"] as! Int
        try require(pcBefore == pcAfter,"computer-owner-zero-extraction")
        app.offline.memoryItems=try JSONDecoder().decode([OfflineMemory].self,from:Data("[{\"id\":\"computer-memory\",\"kind\":\"cognition\",\"text\":\"电脑记住的绘画偏好\",\"sources\":[],\"currentState\":\"current\"}]".utf8))
        try await mode("ok");try await chat("绘画");let computerContexts=try await report()["contexts"] as! [String]
        try require(computerContexts.last!.contains("电脑记住的绘画偏好") && !computerContexts.last!.contains("交接时仍能用"),"after-takeover-only-computer-memory")
        try require(model.messages.last?.memoryRefs?.map(\.id) == ["computer-memory"] && model.messages.last?.dependencyComplete == true,"computer-context-dependencies-retained-for-true-forgetting")
        model.computerDirectoryChanged(hostIDs:[]);app.session=nil
        try require(model.usesPhoneMemory && model.memory.batch(model.state.threads[0]).isEmpty,"computer-removed-does-not-scan-old-chat")
        try await mode("ok");try await chat("我正在学钢琴");await extract()
        try require(model.memory.items.map(\.text) == ["我正在学钢琴"],"new-chat-only-after-computer-removal")
        // Ten labelled dialogues: mechanism expectations, not live model quality.
        let scenarios: [(String,Bool)]=[
            ("我住在杭州",true),("我喜欢清淡的茶",true),("我正在写毕业论文",true),
            ("我约定周末练琴",true),("我希望你避免大段英文",true),("今天天气不错",false),
            ("我密码是 synthetic-password",false),("我的身份证110101199001011234",false),
            ("助手猜我住北京",false),("请记住我的诊断为某疾病",true)
        ]
        for (text,expected) in scenarios {
            try await chat(text);await extract()
            try require(model.memory.items.contains { $0.text == text } == expected,"quality-fixture:"+text)
        }
        print("Synthetic labelled quality scenarios: 10/10 expected; no live MiMo invocation or secret search")
        func scanFiles() throws -> Int {
        var hits=0
        for case let file as URL in FileManager.default.enumerator(at:root,includingPropertiesForKeys:[.isRegularFileKey])! where file.pathExtension == "sealed" {
            let data=try Data(contentsOf:file);for text in ["交接时仍能用","我正在学钢琴","固定绘画偏好","synthetic-state-key"] { if data.range(of:Data(text.utf8)) != nil { hits+=1 } }
        }
        return hits
        }
        let hits=try scanFiles();try require(hits == 0,"encrypted-memory-plaintext-zero")
        app.cloudLogin.subject="idle-account";app.session=nil
        let idle=PhoneStandaloneModel(testCredentials:keys,testLoopback:true,idleDelay:.milliseconds(50));idle.activate(app:app);try idle.saveModel(config)
        idle.draft="我爱画画";idle.send();try await wait({!idle.busy});try await wait({idle.memory.items.count == 1})
        try require(idle.memory.items.first?.text == "我爱画画","idle-after-completion-triggers-once")
        idle.deactivate();try require(idle.memory.items.isEmpty && idle.models.isEmpty,"logout-clears-visible-account-memory")
        app.cloudLogin.subject="large-account";app.offline.enqueued=[];app.offline.synced=[]
        var large=PhoneChatState();large.memory = .init();large.memory?.items=[.init(text:"大量交接保留记忆")]
        for i in 0..<100 { var thread=PhoneChatThread();thread.messages=[.init(role:"user",text:"合成第\(i)轮")];large.threads.append(thread) }
        let largeStore=try PhoneChatStore(account:app.phoneAccountIdentity,directory:root.appendingPathComponent("PhoneChats"),credentials:keys);try largeStore.save(large)
        model.activate(app:app);app.session=PhoneCheckSession();await model.synchronize(app:app)
        try require(model.handoffCount == 100 && app.offline.enqueued.isEmpty,"large-transfer-waits-for-choice")
        model.handoffLater();await model.synchronize(app:app);try require(app.offline.enqueued.isEmpty,"later-keeps-originals-and-memory")
        model.handoffNow();try await wait({app.offline.enqueued.count == 100})
        try require(model.memory.items.count == 1,"now-enqueues-complete-large-history")
        model.clearLocalData();try require(model.state.threads.isEmpty && model.memory.items.isEmpty && model.models.isEmpty,"clear-local-data-includes-memory")
        app.offline.ready=true;app.cloudLogin.subject="long-account"
        var longState=PhoneChatState(),longThread=PhoneChatThread();longThread.messages=[.init(role:"user",text:String(repeating:"长",count:16385))]
        longState.threads=[longThread];longState.memory = .init();longState.memory?.items=[.init(text:"长对话仍有记忆")]
        let longStore=try PhoneChatStore(account:app.phoneAccountIdentity,directory:root.appendingPathComponent("PhoneChats"),credentials:keys);try longStore.save(longState)
        model.activate(app:app);let enqueuedBefore=app.offline.enqueued.count;await model.synchronize(app:app)
        try require(model.state.threads[0].messages[0].text.count == 16385 && model.memory.items.count == 1 && !model.memory.handoffConfirmed && app.offline.enqueued.count == enqueuedBefore,"old-long-history-never-clipped-or-falsely-confirmed")
        app.cloudLogin.subject="large-account"
        let reopened=PhoneStandaloneModel(testCredentials:keys,testLoopback:true);reopened.activate(app:app)
        try require(reopened.state.threads.isEmpty && reopened.memory.items.isEmpty,"clear-persists-with-key-deletion")
        print("PASS PhoneMemoryModelChecks: \(checks) assertions; synthetic HTTP/SSE only; plaintext hits \(hits); report \(try await report()["extractions"]!) extraction requests; cloud/Keychain/simulator/GUI: 0")
    }
}
