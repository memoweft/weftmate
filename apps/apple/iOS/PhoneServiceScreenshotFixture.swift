#if DEBUG && targetEnvironment(simulator)
import SwiftUI
import WeftMateCore

/// Only synthetic, memory-only state; no cloud, computer, provider or Keychain access.
struct PhoneServiceScreenshotFixture: View {
    @ObservedObject var app: AppleAppModel
    @StateObject private var model=PhoneStandaloneModel(testCredentials:ServiceScreenshotKeys(),testLoopback:true)
    @State private var ready=false
    private func argument(_ flag: String) -> String? { let args=ProcessInfo.processInfo.arguments;guard let i=args.firstIndex(of:flag),args.indices.contains(i+1) else { return nil };return args[i+1] }
    private var scene: String { argument("--apple9-scene") ?? "one" }
    var body: some View {
        Group {
            if !ready { ProgressView("准备合成模型服务…") }
            else if scene == "settings" { NavigationStack { PhoneModelsView(model:model) } }
            else if scene == "add" || scene == "addQueried" { NavigationStack { PhoneModelEditor(model:model) } }
            else { PhoneWorkspace(model:app,phone:model) }
        }.preferredColorScheme(argument("--apple9-theme") == "dark" ? .dark : .light)
            .task {
                model.activate(app:app)
                var flash=ServiceModel(modelId:"mimo-v2.6-flash"),pro=ServiceModel(modelId:"mimo-v2.6-pro")
                flash.capabilities=try? JSONDecoder().decode(ServiceModel.Capabilities.self,from:Data("{\"vision\":true}".utf8))
                flash.deepThinking=try? JSONDecoder().decode(ServiceModel.DeepThinking.self,from:Data("{\"supported\":true}".utf8))
                pro.capabilities=try? JSONDecoder().decode(ServiceModel.Capabilities.self,from:Data("{\"vision\":false}".utf8))
                let result=ModelCatalogResult(status:"available",models:[flash,pro])
                do {
                    try model.saveService(existing:nil,name:"MiMo",baseUrl:"https://model.example.invalid/v1",apiKey:UUID().uuidString,interfaceType:"openai-compatible",result:result,manual:"",selected:flash.modelId,enabled:nil)
                    if scene == "two" {
                        let other=ModelCatalogResult(status:"available",models:[ServiceModel(modelId:"claude-synthetic",name:"Claude 合成模型")])
                        try model.saveService(existing:nil,name:"Claude",baseUrl:"https://claude.example.invalid/v1",apiKey:UUID().uuidString,interfaceType:"anthropic",result:other,manual:"",selected:"claude-synthetic",enabled:nil)
                        if let service=model.services.first,let item=service.models.first { model.selectServiceModel(service,item) }
                    }
                    if scene == "computers" || scene == "list" { try app.cloudLogin.seedComputerScreenshot() }
                    ready=true
                } catch { model.notice="合成场景准备失败。" }
            }
    }
}
private final class ServiceScreenshotKeys: CredentialStore, @unchecked Sendable {
    private let lock=NSLock();private var values:[String:Data]=[:]
    func load(key: String) -> Data? { lock.withLock {values[key]} }
    func save(_ value: Data,key: String) { lock.withLock {values[key]=value} }
    func delete(key: String) { lock.withLock {values[key]=nil} }
}
#endif
