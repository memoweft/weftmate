import Foundation
import WeftMateCore

@main struct PhoneWindowModelChecks {
    @MainActor static func main() async {
        do { try await run() } catch { print("FAIL: \(error)");exit(1) }
    }
    @MainActor static func run() async throws {
        let root=URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true)
        let process=Process(),output=Pipe()
        let fixture=URL(fileURLWithPath:#filePath).deletingLastPathComponent().appendingPathComponent("phone_window_state_server.mjs")
        process.executableURL=URL(fileURLWithPath:"/usr/bin/env");process.arguments=["node",fixture.path];process.standardOutput=output
        try process.run();defer { if process.isRunning { process.terminate();process.waitUntilExit() } }
        var bytes=Data()
        while true { let byte=output.fileHandleForReading.readData(ofLength:1);guard !byte.isEmpty else { throw NSError(domain:"WindowServerStart",code:1) };if byte == Data([10]) { break };bytes.append(byte) }
        let ready=try JSONSerialization.jsonObject(with:bytes) as! [String:String]
        let origin=ready["origin"]!,keys=PhoneCheckCredentials(),app=AppleAppModel(directory:root)
        let model=PhoneStandaloneModel(testCredentials:keys,testLoopback:true)
        let config=PhoneModelConfiguration(name:"合成模型",baseURL:origin+"/v1",model:"synthetic",apiKey:"synthetic-state-key")
        var checks=0
        func require(_ value: Bool,_ name: String) throws { guard value else { throw NSError(domain:"PhoneWindow:"+name,code:1) };checks+=1 }
        func wait(_ condition: () -> Bool) async throws {
            for _ in 0..<1000 { if condition() { return };try await Task.sleep(for:.milliseconds(10)) }
            throw NSError(domain:"PhoneWindowWait",code:1)
        }
        func report() async throws -> [String:Any] {
            let (data,_)=try await URLSession.shared.data(from:URL(string:origin+"/report")!)
            return try JSONSerialization.jsonObject(with:data) as! [String:Any]
        }
        func chat(_ text: String) async throws { model.draft=text;model.send();try await wait({!model.busy}) }
        model.activate(app:app);try model.saveModel(config)
        try await chat("没有连过电脑也能聊天")
        try require(model.messages.last?.replyStatus == .complete,"configured-model-needs-no-computer")
        let first=model.state.selected!
        model.newThread();model.select(first)
        // Cross the former 20-second idle deadline. Page/lifecycle callbacks have been removed;
        // reactivation and conversation selection must also cause no extra model traffic.
        try await Task.sleep(for:.seconds(21))
        model.deactivate();model.activate(app:app)
        let initial=try await report()
        try require(initial["requests"] as? Int == 1 && initial["streams"] as? Int == 1 && initial["nonStreaming"] as? Int == 0,"idle-navigation-reactivation-zero-extraction-requests")
        try require(model.showsLocalConversation(connected:false,openedSessionID:nil),"no-connection-routes-local")
        try require(model.showsLocalConversation(connected:true,openedSessionID:first),"local-reminder-route-ignores-transfer-state")
        try require(!model.showsLocalConversation(connected:true,openedSessionID:"computer-conversation"),"explicit-computer-conversation-routes-remote")
        try require(!model.showsLocalConversation(connected:true,openedSessionID:nil),"connected-start-and-task-entry-route-remote")

        app.session=PhoneCheckSession()
        let computerItems=try JSONDecoder().decode([OfflineMemory].self,from:Data("[{\"id\":\"computer-memory\",\"kind\":\"cognition\",\"text\":\"电脑记住的绘画偏好\",\"sources\":[],\"currentState\":\"current\"}]".utf8))
        app.offline.memoryItems=computerItems
        await model.synchronize(app:app)
        let original=app.offline.enqueued
        try require(!original.isEmpty && app.offline.synced.isEmpty,"original-transcript-has-no-receipts-yet")
        try await chat("绘画")
        let duringTransfer=try await report()
        try require((duringTransfer["contexts"] as! [String]).last!.contains("电脑记住的绘画偏好"),"authorized-copy-used-before-transcript-delivery-completes")
        try require(app.offline.authorizations > 0,"copy-rechecks-cloud-authorization")
        try require(model.messages.last?.memoryRefs?.map(\.id) == ["computer-memory"],"computer-memory-dependencies-are-recorded")
        app.offline.synced=Set(original.prefix(1).map(\.id));await model.synchronize(app:app)
        try require(!model.computerMemory.isEmpty,"partial-receipts-do-not-disable-copy")
        app.offline.hostOffline=true
        try await chat("离线绘画")
        let offlineReport=try await report()
        try require((offlineReport["contexts"] as! [String]).last!.contains("电脑离线") && model.messages.last?.replyStatus == .complete,"unreachable-computer-uses-authorized-copy")
        app.session=PhoneCheckSession(hostId:"another-computer")
        try require(model.computerMemory.isEmpty,"other-computer-cannot-read-current-replica")
        app.session=PhoneCheckSession();app.cloudLogin.subject="account-b";model.activate(app:app)
        try require(model.computerMemory.isEmpty && model.state.threads.isEmpty,"account-switch-cannot-read-old-copy-or-local-memory")
        app.cloudLogin.subject="account-a";model.activate(app:app)
        model.computerDirectoryChanged(hostIDs:[]);app.session=nil
        try require(model.computerMemory.isEmpty && !model.state.threads.isEmpty,"removal-keeps-originals-without-phone-memory-fallback")
        model.newThread();try await chat("移除电脑后普通聊天")
        let afterRemoval=try await report()
        try require(!(afterRemoval["contexts"] as! [String]).last!.contains("电脑记住的绘画偏好"),"removed-computer-memory-never-enters-request")

        app.cloudLogin.subject="large-account";app.session=PhoneCheckSession();app.offline.ready=true;app.offline.hostOffline=false;app.offline.enqueued=[];app.offline.synced=[];app.offline.memoryAccountID="large-account"
        app.offline.memoryItems=computerItems
        var large=PhoneChatState()
        for i in 0..<100 { var thread=PhoneChatThread();thread.messages=[.init(role:"user",text:"合成第\(i)轮")];large.threads.append(thread) }
        let store=try PhoneChatStore(account:app.phoneAccountIdentity,directory:root.appendingPathComponent("PhoneChats"),credentials:keys)
        try store.save(large);model.activate(app:app);await model.synchronize(app:app)
        try require(model.handoffCount == 100 && app.offline.enqueued.isEmpty,"large-original-transfer-asks-before-enqueue")
        model.handoffLater();await model.synchronize(app:app)
        try require(model.handoffDeferred && !model.computerMemory.isEmpty,"deferred-transfer-still-allows-computer-copy")
        model.handoffNow();try await wait({app.offline.enqueued.count == 100})
        let encoder=JSONEncoder();encoder.outputFormatting=[.sortedKeys]
        let frozen=try encoder.encode(app.offline.enqueued);await model.synchronize(app:app)
        try require(try encoder.encode(app.offline.enqueued) == frozen,"transcript-retry-preserves-frozen-body")
        app.offline.synced=Set(app.offline.enqueued.map(\.id));await model.synchronize(app:app)
        try require(model.handoffCount == 0 && model.state.threads.count == 100,"all-receipts-retain-originals-and-clear-transfer-banner")
        app.controlGeneration=2
        model.newThread();try await chat("绘画")
        try require(model.messages.last?.replyStatus != .complete && model.computerMemory.isEmpty,"revoked-generation-cannot-reach-model-with-old-copy")
        let final=try await report()
        try require(final["requests"] as? Int == 4 && final["streams"] as? Int == 4 && final["nonStreaming"] as? Int == 0,"only-four-explicit-chats-zero-extraction")
        model.clearLocalData();try require(model.state.threads.isEmpty && model.models.isEmpty,"clear-removes-local-originals-and-models")
        print("PASS PhoneWindowModelChecks: \(checks) assertions; 4 explicit chat requests; 0 extraction requests; idle >20s; no cloud/Keychain/simulator")
    }
}
