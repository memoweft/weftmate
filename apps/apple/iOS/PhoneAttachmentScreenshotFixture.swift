#if DEBUG && targetEnvironment(simulator)
import SwiftUI
import WeftMateCore

struct PhoneAttachmentScreenshotFixture: View {
    @ObservedObject var app: AppleAppModel
    @StateObject private var model=PhoneStandaloneModel(testCredentials:PhoneAttachmentScreenshotKeys(),testLoopback:false)
    @State private var ready=false
    private func argument(_ flag: String) -> String? { let args=ProcessInfo.processInfo.arguments;guard let i=args.firstIndex(of:flag),args.indices.contains(i+1) else { return nil };return args[i+1] }
    var body: some View {
        Group { if ready { PhoneWorkspace(model:app,phone:model) } else { ProgressView("准备合成附件…") } }
            .preferredColorScheme(argument("--apple8-theme") == "dark" ? .dark : .light)
            .task {
                model.activate(app:app);model.clearLocalData()
                let scene=argument("--apple8-scene") ?? "draft"
                try? model.saveModel(.init(name:"合成手机模型",baseURL:scene == "text" ? "https://dashscope.aliyuncs.com/compatible-mode/v1" : "https://model.example.invalid/v1",model:scene == "text" ? "qwen-plus" : "synthetic",apiKey:"synthetic-only"))
                if scene != "menu" && scene != "text" {
                    let png=UIGraphicsImageRenderer(size:CGSize(width:320,height:220)).pngData { context in
                        UIColor.systemTeal.setFill();context.fill(CGRect(x:0,y:0,width:320,height:220))
                        UIColor.systemYellow.setFill();context.fill(CGRect(x:80,y:50,width:120,height:120))
                    }
                    if let image=try? PhoneAttachmentInput.image(png,name:"合成色块.png"),let file=try? PhoneAttachmentInput.file(Data("虚构周报\n完成三件任务，下一步整理资料。".utf8),name:"虚构周报.md",remainingText:32000) {
                        model.addAttachment(image);model.addAttachment(file);model.draft="这张图是什么？帮我总结文件。"
                        if scene == "sent" { model.seedAttachmentScreenshot() }
                    }
                }
                ready=true
            }
    }
}
private final class PhoneAttachmentScreenshotKeys: CredentialStore, @unchecked Sendable {
    private let lock=NSLock();private var values: [String:Data]=[:]
    func load(key: String) -> Data? { lock.withLock {values[key]} }
    func save(_ value: Data,key: String) { lock.withLock {values[key]=value} }
    func delete(key: String) { lock.withLock {values[key]=nil} }
}
#endif
