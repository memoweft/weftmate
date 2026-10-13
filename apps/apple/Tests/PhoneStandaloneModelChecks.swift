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
@main struct PhoneStandaloneModelChecks {
    @MainActor static func main() async throws {
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
            for _ in 0..<200 { if condition() { return };try await Task.sleep(for:.milliseconds(20)) }
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
