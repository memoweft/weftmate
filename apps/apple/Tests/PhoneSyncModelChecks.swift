import Foundation
import WeftMateCore

@main struct PhoneSyncModelChecks {
    @MainActor static func main() async {
        do { try await run() } catch { print("FAIL PhoneSyncModelChecks: \(error)");exit(1) }
    }
    @MainActor static func run() async throws {
        let root=URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true),keys=PhoneSyncKeys(),app=AppleAppModel(directory:URL(fileURLWithPath:CommandLine.arguments[1]))
        let process=Process(),pipe=Pipe()
        let source=URL(fileURLWithPath:#filePath).deletingLastPathComponent().appendingPathComponent("phone_sync_server.mjs")
        process.executableURL=URL(fileURLWithPath:"/usr/bin/env");process.arguments=["node",source.path];process.standardOutput=pipe
        try process.run();defer { if process.isRunning { process.terminate();process.waitUntilExit() } }
        var data=Data()
        while true { let byte=pipe.fileHandleForReading.readData(ofLength:1);guard !byte.isEmpty else { throw OfflineFailure.invalid };if byte == Data([10]) { break };data.append(byte) }
        let origin=(try JSONSerialization.jsonObject(with:data) as! [String:String])["origin"]!
        func configure(_ body: [String:Any]) async throws {
            var request=URLRequest(url:URL(string:origin+"/configure")!);request.httpMethod="POST";request.httpBody=try JSONSerialization.data(withJSONObject:body)
            _ = try await URLSession.shared.data(for:request)
        }
        func report() async throws -> [String:Any] {
            let (data,_)=try await URLSession.shared.data(from:URL(string:origin+"/report")!);return try JSONSerialization.jsonObject(with:data) as! [String:Any]
        }
        var checks=0
        func require(_ condition: Bool,_ name: String) throws { guard condition else { throw NSError(domain:name,code:1) };checks+=1 }
        let client=PersonalClient(credentialStore:keys)
        let session=try await client.login(server:ServerConfiguration(input:origin,allowLoopbackHTTP:true),username:"synthetic",password:"synthetic-password",deviceName:"PhoneSyncState")
        let identity=OfflineIdentity(ownerId:session.account.ownerId,hostId:session.hostId,deviceId:session.device.id)
        let binding=OfflineBinding(issuer:"https://cloud.example.invalid",subject:"account-test",identity:identity)
        let restored=try JSONDecoder().decode(OfflineBinding.self,from:JSONEncoder().encode(binding))
        try require(restored.matches(issuer:binding.issuer,subject:"account-test",hostID:identity.hostId),"binding-restores-same-account-host")
        try require(!restored.matches(issuer:binding.issuer,subject:"other-account",hostID:nil),"binding-rejects-other-account")
        try require(!restored.matches(issuer:"https://another-cloud.example.invalid",subject:"account-test",hostID:nil),"binding-rejects-other-issuer")
        try require(!restored.matches(issuer:binding.issuer,subject:"account-test",hostID:"other-host"),"binding-rejects-other-host")
        try await configure(["memory":true,"ready":false])
        let directory=root.appendingPathComponent("Offline")
        app.session=session
        await app.offline.poll(session:session,client:client,directory:directory,store:keys,allowLoopback:true,phoneFirst:true,control:app.offlineAuthorization)
        try require(app.offline.ready && !app.offline.memoryAuthorityReady,"copy-and-upload-readiness-independent")
        let phone=PhoneStandaloneModel(testCredentials:keys,testLoopback:true)
        phone.activate(app:app)
        try phone.saveModel(.init(name:"手机模型",baseURL:origin+"/v1",model:"phone-configured",apiKey:"synthetic-state-key"))
        phone.draft="茉莉花茶";phone.send()
        for _ in 0..<1000 { if !phone.busy { break };try await Task.sleep(for:.milliseconds(10)) }
        await phone.synchronize(app:app)
        try require(phone.messages.last?.replyStatus == .complete && app.offline.turns.isEmpty,"ready-false-keeps-originals-and-phone-chat-works")
        try await configure(["ready":true])
        await app.offline.poll(session:session,client:client,directory:directory,store:keys,allowLoopback:true,phoneFirst:true,control:app.offlineAuthorization)
        await phone.synchronize(app:app)
        try require(app.offline.pending == 1,"ready-true-enqueues-original")
        await app.offline.poll(session:session,client:client,directory:directory,store:keys,allowLoopback:true,phoneFirst:true,control:app.offlineAuthorization)
        await phone.synchronize(app:app)
        try require(app.offline.pending == 0 && app.offline.notice == "电脑已收到" && !phone.state.threads.isEmpty,"receipt-means-received-originals-retained")

        app.session=nil;app.offline=OfflineChatModel()
        await app.offline.restore(identity:restored.identity,directory:directory,store:keys,multipleComputers:false,control:app.offlineAuthorization)
        try require(app.session == nil && app.offline.ready && app.offline.hostOffline && phone.computerMemory.map(\.id) == ["tea"],"restart-without-session-restores-authorized-copy")
        phone.newThread();phone.draft="茉莉花茶";phone.send()
        for _ in 0..<1000 { if !phone.busy { break };try await Task.sleep(for:.milliseconds(10)) }
        let requests=try await report()["chats"] as! [[String:Any]]
        let context=(requests.last?["messages"] as! [[String:Any]])[0]["content"] as! String
        try require(phone.messages.last?.replyStatus == .complete && context.contains("电脑记住我喜欢茉莉花茶") && context.contains("电脑离线"),"sessionless-chat-uses-copy-and-own-model")
        try require(requests.allSatisfy { $0["model"] as? String == "phone-configured" },"phone-model-independent-of-null-host-model")
        app.authorizationAvailable=false
        await app.offline.restore(identity:identity,directory:directory,store:keys,multipleComputers:false,control:app.offlineAuthorization)
        try require(!app.offline.ready && phone.computerMemory.isEmpty,"cloud-unavailable-never-unlocks-copy")
        app.authorizationAvailable=true;app.cloudLogin.subject="other-account"
        await app.offline.restore(identity:identity,directory:directory,store:keys,multipleComputers:false,control:app.offlineAuthorization)
        phone.activate(app:app)
        try require(!app.offline.ready && phone.state.threads.isEmpty && phone.computerMemory.isEmpty,"account-switch-isolates-copy-and-originals")
        print("PASS PhoneSyncModelChecks: \(checks) assertions; real OfflineChatModel + PhoneStandaloneModel, encrypted restart, real HTTP and configured-model SSE")
    }
}
