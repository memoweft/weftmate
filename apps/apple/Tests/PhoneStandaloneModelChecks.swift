import Foundation
import WeftMateCore

@main struct PhoneStandaloneModelChecks {
    @MainActor static func main() async {
        do { try await run() } catch { print("FAIL: \(error)");exit(1) }
    }
    @MainActor static func run() async throws {
        let root=URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true)
        let process=Process(),output=Pipe()
        let fixture=URL(fileURLWithPath:#filePath).deletingLastPathComponent().appendingPathComponent("phone_standalone_state_server.mjs")
        process.executableURL=URL(fileURLWithPath:"/usr/bin/env");process.arguments=["node",fixture.path];process.standardOutput=output
        try process.run();defer { if process.isRunning { process.terminate();process.waitUntilExit() } }
        var bytes=Data()
        while true { let byte=output.fileHandleForReading.readData(ofLength:1);guard !byte.isEmpty else { throw NSError(domain:"LocalModelStart",code:1) };if byte==Data([10]) { break };bytes.append(byte) }
        let ready=try JSONSerialization.jsonObject(with:bytes) as! [String:String]
        let origin=ready["origin"]!,keys=PhoneCheckCredentials(),app=AppleAppModel(directory:root)
        let model=PhoneStandaloneModel(testCredentials:keys,testLoopback:true)
        var checks=0
        func require(_ value: Bool,_ name: String) throws { guard value else { throw NSError(domain:"PhoneStandalone:"+name,code:1) };checks+=1 }
        func wait(_ condition: () -> Bool,_ name: String) async throws {
            for _ in 0..<1000 { if condition() { return };try await Task.sleep(for:.milliseconds(20)) }
            throw NSError(domain:"PhoneStandaloneWait:"+name,code:1)
        }
        model.activate(app:app)
        try require(model.models.isEmpty && model.state.threads.isEmpty,"empty-account-needs-no-computer")
        let config=PhoneModelConfiguration(name:"合成手机模型",baseURL:origin+"/v1",model:"synthetic-stream",apiKey:"synthetic-state-key")
        try require(await model.test(config),"real-loopback-connection-test")
        try model.saveModel(config)
        try require(model.currentModel == config,"saved-phone-model")
        model.draft="手机独立问题";model.send()
        try await wait({model.messages.last?.text == "第一片"},"first-stream-delta-before-completion")
        try require(model.busy,"stream-is-in-progress")
        try await wait({!model.busy},"stream-completed")
        try require(model.messages.map(\.role)==["user","assistant"],"user-assistant-order")
        try require(model.messages.last?.text == "第一片、第二片，手机独立回复完成。","complete-stream-text")
        model.draft="慢回复队列一";model.send()
        try await wait({model.busy},"queue-first-started")
        model.draft="队列二";model.send()
        model.draft="队列三";model.send()
        try require(model.messages.filter { $0.role == "user" }.suffix(3).map(\.text) == ["慢回复队列一","队列二","队列三"],"three-sends-are-retained-while-busy")
        try await wait({!model.busy},"queue-drained")
        try require(model.messages.suffix(6).map(\.role) == ["user","assistant","user","assistant","user","assistant"],"three-replies-in-order")
        try require(model.messages.suffix(6).filter { $0.role == "assistant" }.allSatisfy { !$0.text.isEmpty },"three-replies-have-body")
        model.newThread()
        model.draft="手机独立问题";model.send();try await wait({!model.busy},"fresh-before-reopen")
        let timeoutApp=AppleAppModel(directory:root.appendingPathComponent("timeout"))
        let timeoutModel=PhoneStandaloneModel(testCredentials:keys,testLoopback:true,replyTimeout:0.4)
        timeoutModel.activate(app:timeoutApp);try timeoutModel.saveModel(config)
        timeoutModel.draft="超时后重试";timeoutModel.send()
        timeoutModel.draft="超时之后的下一条";timeoutModel.send()
        try await wait({!timeoutModel.busy},"timeout-unblocks-composer")
        try require(timeoutModel.messages[1].replyStatus == .failed && timeoutModel.notice == "这次没回复，可以重试。","timeout-is-recoverable")
        try require(timeoutModel.messages.count == 4 && timeoutModel.messages[3].replyStatus == .complete,"timeout-does-not-block-next-queued-question")
        timeoutModel.retryReply(timeoutModel.messages[1].id);try await wait({!timeoutModel.busy},"timeout-retry-completes")
        try require(timeoutModel.messages.count == 4 && timeoutModel.messages[1].replyStatus == .complete && timeoutModel.messages[3].replyStatus == .complete && timeoutModel.messages[0].text == "超时后重试","retry-keeps-question-and-replaces-failure-in-place")
        let selected=model.state.selected
        let restored=PhoneStandaloneModel(testCredentials:keys,testLoopback:true);restored.activate(app:app)
        try require(restored.state.selected == selected && restored.messages == model.messages,"process-model-reopen-preserves-chat")
        try require(restored.models == [config],"reopen-preserves-keychain-model")
        model.send(regenerate:true);try await wait({!model.busy},"regenerate-completed")
        try require(model.messages.count == 2 && model.messages.last?.text == restored.messages.last?.text,"regenerate-replaces-latest-answer")
        model.draft="慢回复";model.send();try await wait({(model.messages.last?.text.count ?? 0)>0},"slow-stream-start")
        model.stop();let stopped=model.messages
        try await Task.sleep(for:.milliseconds(500))
        try require(!model.busy && model.messages == stopped,"stop-discards-late-deltas")
        try require(model.notice == "已停止，已收到的内容保留。","stop-has-honest-status")
        model.draft="慢回复换账号";model.send();try await wait({(model.messages.last?.text.count ?? 0)>0},"account-switch-in-flight")
        app.cloudLogin.subject="account-b";model.activate(app:app)
        try await Task.sleep(for:.milliseconds(500))
        try require(model.messages.isEmpty && model.models.isEmpty && !model.busy,"new-account-is-isolated-from-late-reply")
        app.cloudLogin.subject="account-a";model.activate(app:app)
        try require(!model.messages.isEmpty && model.models == [config],"return-to-original-account-retains-content")
        let changed=PhoneModelConfiguration(id:config.id,name:"修改后的手机模型",baseURL:config.baseURL,model:config.model,apiKey:config.apiKey)
        try model.saveModel(changed);try require(model.models.count == 1 && model.currentModel?.name == changed.name,"model-update")
        app.session=PhoneCheckSession();app.offline.ready=false;await model.synchronize(app:app)
        try require(app.offline.enqueued.isEmpty && model.state.migrations == nil,"computer-not-ready-keeps-independent-chat-unoffered")
        app.offline.ready=true;await model.synchronize(app:app)
        try require(!app.offline.enqueued.isEmpty,"first-computer-enqueues-phone-turns")
        try require(app.offline.enqueued.allSatisfy { $0.memoryRefs.isEmpty && $0.dependencyComplete },"only-phone-source-messages-are-enqueued")
        app.offline.synced=Set(app.offline.enqueued.map(\.id));await model.synchronize(app:app)
        try require(model.state.migrations?["synthetic-computer"]?.accepted == app.offline.synced,"receipts-confirm-synced-turns")
        app.controlGeneration=2;app.offline.generation=2;await model.synchronize(app:app)
        try require(model.state.threads.isEmpty,"new-delete-generation-clears-offered-history")
        model.removeModel(config.id);try require(model.models.isEmpty,"model-delete")
        let deleted=PhoneStandaloneModel(testCredentials:keys,testLoopback:true);deleted.activate(app:app)
        try require(deleted.models.isEmpty,"model-delete-persists")
        func scanFiles() throws -> (Int,Int) {
            var hits=0,files=0
            for case let file as URL in FileManager.default.enumerator(at:root,includingPropertiesForKeys:[.isRegularFileKey])! {
                guard (try file.resourceValues(forKeys:[.isRegularFileKey])).isRegularFile == true else { continue };let data=try Data(contentsOf:file);files+=1
                for marker in ["手机独立问题","synthetic-state-key","第一片","慢回复"] { if data.range(of:Data(marker.utf8)) != nil { hits+=1 } }
            }
            return (hits,files)
        }
        let (hits,files)=try scanFiles()
        try require(hits == 0,"no-plaintext-chat-or-model-key-on-disk")
        let (report,_) = try await URLSession.shared.data(from:URL(string:origin+"/report")!)
        let traffic=try JSONSerialization.jsonObject(with:report) as! [String:Int]
        try require((traffic["streams"] ?? 0)>=4,"real-sse-http-requests-observed")
        print("PASS PhoneStandaloneModelChecks: \(checks) assertions; HTTP \(traffic["requests"] ?? 0); SSE \(traffic["streams"] ?? 0); encrypted files \(files); plaintext/key hits \(hits); cloud/Keychain/simulator/GUI: 0")
    }
}
