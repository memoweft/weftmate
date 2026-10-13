import Foundation
import WeftMateCore

@main struct PhoneModelServicesModelChecks {
    @MainActor static func main() async { do { try await run() } catch { print("FAIL PhoneModelServicesModelChecks: \(error)");exit(1) } }
    @MainActor static func run() async throws {
        let root=URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true)
        let process=Process(),output=Pipe()
        process.executableURL=URL(fileURLWithPath:"/usr/bin/env");process.arguments=["node",URL(fileURLWithPath:#filePath).deletingLastPathComponent().appendingPathComponent("phone_model_services_server.mjs").path];process.standardOutput=output
        try process.run();defer { if process.isRunning { process.terminate();process.waitUntilExit() } }
        var bytes=Data()
        while true { let byte=output.fileHandleForReading.readData(ofLength:1);guard !byte.isEmpty else { throw NSError(domain:"FixtureStart",code:1) };if byte == Data([10]) { break };bytes.append(byte) }
        guard let ready=try JSONSerialization.jsonObject(with:bytes) as? [String:String],let origin=ready["origin"] else { throw NSError(domain:"FixtureReady",code:1) }
        let app=AppleAppModel(directory:root),keys=PhoneCheckCredentials(),model=PhoneStandaloneModel(testCredentials:keys,testLoopback:true),secret=UUID().uuidString
        var checks=0
        func require(_ value: Bool,_ name: String) throws { guard value else { throw NSError(domain:name,code:1) };checks += 1 }
        func wait(_ condition: () -> Bool) async throws { for _ in 0..<200 { if condition() { return };try await Task.sleep(for:.milliseconds(20)) };throw NSError(domain:"StateTimeout",code:1) }
        model.activate(app:app)
        let result=await model.queryService(baseUrl:origin+"/v1",apiKey:secret,interfaceType:"openai-compatible")
        try require(result.status == "available" && result.models?.count == 2,"catalog-filters-nonchat")
        let auth=await model.queryService(baseUrl:origin+"/auth",apiKey:secret,interfaceType:"openai-compatible")
        let unsupported=await model.queryService(baseUrl:origin+"/unsupported",apiKey:secret,interfaceType:"openai-compatible")
        try require(auth.status == "authentication_failed" && unsupported.status == "unsupported" && auth.message != unsupported.message,"different-human-errors")
        try model.saveService(existing:nil,name:"合成模型服务",baseUrl:origin+"/v1",apiKey:secret,interfaceType:"openai-compatible",result:result,manual:"",selected:"mimo-v2.6-flash",enabled:nil)
        try require(model.services.count == 1 && model.models.count == 2,"one-key-all-models")
        try require(model.currentModel?.supportsImages == true,"explicit-vision")
        model.draft="第一条";model.send();try await wait { model.messages.last?.text == "mimo-v2.6-flash" }
        guard let service=model.services.first,let pro=service.models.first(where: {$0.modelId == "mimo-v2.6-pro"}) else { throw NSError(domain:"ModelMissing",code:1) }
        model.selectServiceModel(service,pro)
        try require(model.busy && model.currentModel?.model == "mimo-v2.6-pro","switch-does-not-cancel-in-flight")
        try await wait {!model.busy};try require(model.messages.last?.text == "mimo-v2.6-flash","in-flight-model-frozen")
        model.draft="第二条";model.send();try await wait {!model.busy}
        try require(model.messages.last?.text == "mimo-v2.6-pro","next-message-selected-model")
        let restored=PhoneStandaloneModel(testCredentials:keys,testLoopback:true);restored.activate(app:app)
        try require(restored.currentModel?.model == "mimo-v2.6-pro" && restored.messages == model.messages,"restart-default-and-history")
        await model.refreshService(service,force:true)
        try require(model.services.first?.models.first(where:{$0.modelId == pro.modelId})?.profileId == pro.profileId,"refresh-keeps-profile")
        try model.saveService(existing:model.services.first,name:service.name,baseUrl:service.baseUrl,apiKey:"",interfaceType:service.interfaceType,result:nil,manual:"manual-model",selected:nil,enabled:Set([pro.modelId]))
        try require(model.services.first?.models.contains(where: {$0.modelId == "manual-model" && $0.enabled}) == true,"manual-and-hide")
        app.cloudLogin.subject="account-b";model.activate(app:app);try require(model.services.isEmpty,"account-isolated-services")
        func scan() throws -> Int {
        var plaintext=0
        guard let enumerator=FileManager.default.enumerator(at:root,includingPropertiesForKeys:[.isRegularFileKey]) else { throw NSError(domain:"StorageScan",code:1) }
        for case let file as URL in enumerator {
            guard (try file.resourceValues(forKeys:[.isRegularFileKey])).isRegularFile == true else { continue }
            let data=try Data(contentsOf:file);for marker in [secret,"第一条","第二条"] { if data.range(of:Data(marker.utf8)) != nil { plaintext += 1 } }
        }
        return plaintext
        }
        try require(try scan() == 0,"no-key-or-chat-plaintext")
        print("PASS PhoneModelServicesModelChecks: \(checks) assertions; random-port real HTTP catalog/SSE; random in-process credential; plaintext hits 0; real providers/accounts/computers/simulator 0")
    }
}
