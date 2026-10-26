import Foundation
import WeftMateCore

/// The unchanged phone and replica controllers, real desktop HTTP routes and encrypted stores.
/// Cloud authorization and Core formation are synthetic; the real Core loop belongs to APPLE-5.
@main struct PhoneReplicaErasureChecks {
    @MainActor static func main() async {
        do { try await run() } catch { print("FAIL PhoneReplicaErasureChecks: \(error)");exit(1) }
    }
    @MainActor static func run() async throws {
        let root=URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true),keys=PhoneSyncKeys()
        let app=AppleAppModel(directory:root),process=Process(),output=Pipe()
        let source=URL(fileURLWithPath:#filePath).deletingLastPathComponent().appendingPathComponent("phone_turn_fragment_server.mjs")
        process.executableURL=URL(fileURLWithPath:"/usr/bin/env");process.arguments=["node",source.path];process.standardOutput=output
        try process.run();defer { if process.isRunning { process.terminate();process.waitUntilExit() } }
        var bytes=Data()
        while true { let byte=output.fileHandleForReading.readData(ofLength:1);guard !byte.isEmpty else { throw OfflineFailure.invalid };if byte == Data([10]) { break };bytes.append(byte) }
        let origin=(try JSONSerialization.jsonObject(with:bytes) as! [String:String])["origin"]!
        var assertions=0
        func require(_ condition: Bool,_ name: String) throws { guard condition else { throw NSError(domain:name,code:1) };assertions+=1 }
        func wait(_ condition: () -> Bool) async throws {
            for _ in 0..<1000 { if condition() { return };try await Task.sleep(for:.milliseconds(10)) }
            throw NSError(domain:"ErasureWait",code:1)
        }
        func post(_ path: String,_ body: [String:Any] = [:]) async throws {
            var request=URLRequest(url:URL(string:origin+path)!);request.httpMethod="POST";request.httpBody=try JSONSerialization.data(withJSONObject:body)
            let (_,response)=try await URLSession.shared.data(for:request)
            try require((response as? HTTPURLResponse)?.statusCode == 200,"fixture-configuration")
        }
        func report() async throws -> [String:Any] {
            let (data,_)=try await URLSession.shared.data(from:URL(string:origin+"/report")!)
            return try JSONSerialization.jsonObject(with:data) as! [String:Any]
        }
        let client=PersonalClient(credentialStore:keys)
        let session=try await client.login(server:ServerConfiguration(input:origin,allowLoopbackHTTP:true),username:"synthetic",password:"synthetic-password",deviceName:"ErasurePhone")
        app.session=session
        let identity=OfflineIdentity(ownerId:session.account.ownerId,hostId:session.hostId,deviceId:session.device.id)
        let directory=root.appendingPathComponent("Offline")
        let config=PhoneModelConfiguration(name:"合成手机模型",baseURL:origin+"/v1",model:"phone-configured",apiKey:"synthetic-state-key")
        var phone=PhoneStandaloneModel(testCredentials:keys,testLoopback:true)
        phone.activate(app:app);try phone.saveModel(config)
        func poll() async {
            await app.offline.poll(session:session,client:client,directory:directory,store:keys,allowLoopback:true,phoneFirst:true,control:app.offlineAuthorization)
            await phone.synchronize(app:app)
        }
        func chat(_ text: String) async throws { phone.draft=text;phone.send();try await wait({ !phone.busy }) }
        func storedReplica() throws -> OfflineState { try OfflineVault(identity:identity,directory:directory,store:keys).load() }

        try await post("/configure",["memory":true,"reply":"合成记忆派生回复：茉莉花茶"]);await poll()
        try await chat("茉莉花茶")
        let original=phone.messages.first!,threadID=phone.state.selected!
        try require(phone.messages.last?.memoryRefs?.map(\.id) == ["tea"],"real-request-records-memory-dependency")
        await poll();await poll()
        try require(app.offline.synced.contains(original.id),"computer-receipt-recorded")
        try phone.saveReminder(text:"独立提醒",date:Date().addingTimeInterval(3600))
        phone.draft="未发草稿";try await Task.sleep(for:.milliseconds(400))
        let before=try await report()["turns"] as! [[String:Any]]
        try await post("/configure",["generation":2,"memory":false,"reply":"合成新回复"]);app.generation=2;await poll();await poll()
        try require(phone.state.selected == threadID && phone.messages == [original],"generation-keeps-exact-original-date-and-selection")
        try require(phone.draft == "未发草稿" && phone.reminders.count == 1,"generation-keeps-draft-and-independent-reminder")
        try require((try await report()["turns"] as! [Any]).count == before.count,"generation-zero-old-round-resubmission")
        let localStore=try PhoneChatStore(account:app.phoneAccountIdentity,directory:root.appendingPathComponent("PhoneChats"),credentials:keys)
        let decoded=String(decoding:try JSONEncoder().encode(localStore.load()),as:UTF8.self)
        try require(!decoded.contains("合成记忆派生回复") && decoded.contains(original.text),"decrypted-test-container-retains-only-original")
        phone=PhoneStandaloneModel(testCredentials:keys,testLoopback:true);phone.activate(app:app)
        app.offline=OfflineChatModel();await poll();await poll()
        try require((try await report()["turns"] as! [Any]).count == before.count,"restart-zero-old-round-resubmission")
        try await chat("继续普通聊天")
        let requests=try await report()["chats"] as! [[String:Any]]
        let requestBody=String(decoding:try JSONSerialization.data(withJSONObject:requests.last!),as:UTF8.self)
        try require(!requestBody.contains("茉莉花茶") && phone.messages.last?.replyStatus == .complete,"retired-original-viewable-but-not-automatic-model-context")

        // Freeze a long reply in a partially delivered fragment, then erase at the same generation.
        try await post("/configure",["memory":true,"reply":String(repeating:"待删派生正文",count:12000),"pauseAt":0]);await poll()
        phone.newThread();try await chat("茉莉花茶");await poll();await poll()
        try require(try storedReplica().pendingSubmission?.turnFragments?.isEmpty == false,"partial-fragment-is-persisted")
        let fragmentOriginal=phone.messages.first!
        try await post("/configure",["memory":false,"reply":"普通回复"]);await poll()
        try require(phone.messages == [fragmentOriginal],"remove-keeps-user-and-erases-derived-assistant")
        let afterRemove=try storedReplica()
        try require(afterRemove.pendingSubmission == nil && afterRemove.phoneTurnFragments == nil && afterRemove.turns.isEmpty,"remove-erases-frozen-payload-and-fragments")
        let removedCount=(try await report()["turns"] as! [Any]).count
        await poll();try require((try await report()["turns"] as! [Any]).count == removedCount,"remove-zero-fragment-retry")

        // No cloud check means no old replica, but ordinary configured-model chat still works.
        app.authorizationAvailable=false
        await app.offline.restore(identity:identity,directory:directory,store:keys,multipleComputers:false,control:app.offlineAuthorization)
        try await chat("暂时断网仍普通聊天")
        try require(phone.computerMemory.isEmpty && phone.messages.last?.replyStatus == .complete,"cloud-timeout-keeps-ordinary-chat")
        app.authorizationAvailable=true

        // Deletion during SSE discards both previously published fragments and the late tail.
        try await post("/configure",["memory":true,"pauseModel":true]);await poll()
        phone.newThread();phone.draft="茉莉花茶";phone.send()
        try await wait({ phone.messages.last?.text.contains("合成中途派生片段") == true })
        try await post("/configure",["generation":3,"memory":false]);app.generation=3;await poll()
        try await post("/release");try await wait({ !phone.busy })
        try require(phone.messages.count == 1 && phone.messages.first?.role == "user","deletion-during-stream-discards-published-and-late-response")
        try require(!String(decoding:try JSONEncoder().encode(localStore.load()),as:UTF8.self).contains("合成中途派生片段"),"late-reply-absent-from-decrypted-container")

        // A -> B -> A uses separate sealed transcripts and never resumes a paid request.
        try await post("/configure",["pauseModel":true]);phone.draft="换号进行中";phone.send()
        try await wait({ phone.messages.last?.text.contains("合成中途派生片段") == true })
        app.cloudLogin.subject="account-b";app.offline.suspend();phone.activate(app:app)
        try require(phone.messages.isEmpty && phone.models.isEmpty,"account-b-cannot-see-account-a")
        app.cloudLogin.subject="account-test";phone.activate(app:app)
        let returned=phone.messages
        try await post("/release");try await Task.sleep(for:.milliseconds(200))
        try require(phone.messages == returned && !phone.busy,"account-a-return-does-not-revive-late-response")

        // Only a confirmed directory result triggers computer removal.
        await poll();phone.newThread();phone.draft="移除电脑进行中";phone.send()
        try await wait({ phone.messages.last?.text.contains("合成中途派生片段") == true })
        phone.computerDirectoryChanged(hostIDs:[]);app.session=nil
        try await post("/release");try await wait({ !phone.busy })
        try require(phone.computerMemory.isEmpty && phone.messages.count == 1,"confirmed-removal-cancels-response-and-keeps-original")
        try await post("/configure",["pauseModel":false]);phone.newThread();try await chat("移除后普通聊天")
        try require(phone.messages.last?.replyStatus == .complete,"removed-computer-does-not-block-own-model")
        try require(phone.state.migrations?[identity.hostId]?.turns.isEmpty == true,"removal-retires-frozen-originals")
        print("PASS PhoneReplicaErasureChecks: \(assertions) assertions; real controllers + desktop routes + SSE + decrypted synthetic stores; Core formation/device acceptance pending APPLE-5")
    }
}
