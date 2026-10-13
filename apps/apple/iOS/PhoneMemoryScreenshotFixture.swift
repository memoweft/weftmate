#if DEBUG && targetEnvironment(simulator)
import SwiftUI
import WeftMateCore

/// Two explicit Debug flags only. Uses synthetic account state and in-memory keys; no transport is started.
struct PhoneMemoryScreenshotFixture: View {
    @ObservedObject var app: AppleAppModel
    @StateObject private var model=PhoneStandaloneModel(testCredentials:PhoneMemoryScreenshotKeys(),testLoopback:false)
    @State private var ready=false
    private var scene: String { argument("--apple7-scene") ?? "entries" }
    private var dark: Bool { argument("--apple7-theme") == "dark" }
    private func argument(_ flag: String) -> String? {
        let args=ProcessInfo.processInfo.arguments;guard let i=args.firstIndex(of:flag),args.indices.contains(i+1) else { return nil };return args[i+1]
    }
    var body: some View {
        Group {
            if ready {
                if scene == "edit" { PhoneMemoryEditor(model:model,item:model.memory.items.first) }
                else { NavigationStack { if scene == "settings" { PhoneModelsView(model:model) } else { PhoneMemoryListView(model:model) } } }
            } else { ProgressView("准备合成内容…") }
        }.preferredColorScheme(dark ? .dark : .light)
            .task {
                model.activate(app:app);model.clearLocalData()
                if scene != "empty" {
                    try? model.saveMemory(text:"我喜欢清淡的食物，不喜欢太甜的饮料。",pinned:true)
                    try? model.saveMemory(text:"我正在学日语，希望回答时带上读音。",pinned:false)
                    try? model.saveMemory(text:"周末会练习钢琴，提醒建议尽量简短。",pinned:false)
                }
                if scene == "settings" { try? model.saveModel(.init(name:"合成手机模型",baseURL:"https://model.example.invalid/v1",model:"synthetic",apiKey:"synthetic-only")) }
                ready=true
            }
    }
}
private final class PhoneMemoryScreenshotKeys: CredentialStore, @unchecked Sendable {
    private let lock=NSLock()
    private var values: [String:Data]=[:]
    func load(key: String) -> Data? { lock.withLock { values[key] } }
    func save(_ value: Data,key: String) { lock.withLock { values[key]=value } }
    func delete(key: String) { lock.withLock { values[key]=nil } }
}
#endif
