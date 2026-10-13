#if DEBUG && os(iOS) && targetEnvironment(simulator)
import SwiftUI
import WeftMateCore

struct Apple5AddendumFixture: View {
    @StateObject private var app=AppleAppModel()
    @ObservedObject var health: DailyHealthModel
    @State private var ready=false
    @State private var scene="normal"
    @State private var pdf: URL?
    @State private var images: [URL]=[]
    @State private var preview=false
    @State private var error: String?
    var body: some View {
        VStack(spacing:AppleTokens.Space.p0) {
            if ready {
                Menu("合成场景") {
                    ForEach(["normal","narrow","large","attachments","pdf"],id:\.self) { value in Button(value) { select(value) }.accessibilityIdentifier("apple5add."+value) }
                }.accessibilityIdentifier("apple5add.scenarios").accessibilityValue("原文件 \(images.count)，输入区附件 \(app.mainChat.attachments.count)")
                if scene == "narrow" || scene == "large" {
                    Text(scene == "narrow" ? "320 点导航组件" : "大字体导航组件").font(AppleTokens.Fonts.headline)
                    Spacer()
                    PhoneBottomTabs(selection:.constant(.chat)).frame(width:320).dynamicTypeSize(scene == "large" ? .accessibility3 : .large)
                } else { PhoneWorkspace(model:app) }
            } else { Text(app.authError ?? error ?? "正在连接合成账号…") }
        }.environmentObject(health).preferredColorScheme(ProcessInfo.processInfo.arguments.contains("dark") ? .dark : .light)
            .fullScreenCover(isPresented:$preview) { ConversationAttachmentPreview(file:pdf,name:"合成计划.pdf",contentType:"application/pdf",loading:false,error:nil,close:{preview=false}) }
            .task {
                let environment=ProcessInfo.processInfo.environment
                await app.authenticate(username:environment["WEFTMATE_APPLE5_USERNAME"] ?? "",password:environment["WEFTMATE_APPLE5_PASSWORD"] ?? "",displayName:"合成账号",register:false)
                guard app.session != nil else { return }; await app.mainChat.configure(); await app.mainChat.read(replace:true); await app.refresh()
                do { images=try Apple5MediaFixture.make(); pdf=images.last; ready=true } catch { self.error="合成文件没能准备好。" }
            }
    }
    private func select(_ value: String) {
        if value == "pdf" { app.phonePreviewRequest=UUID(); dismissPhonePreviewKeyboard(); preview=true; return }
        scene=value
        if value == "attachments" { app.mainChat.addFiles(images) }
    }
}
@MainActor private enum Apple5MediaFixture {
    static func make() throws -> [URL] {
        let folder=FileManager.default.temporaryDirectory.appendingPathComponent("apple5-media-"+UUID().uuidString)
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        let image=UIGraphicsImageRenderer(size:CGSize(width:160,height:100)).image { context in
            UIColor.systemTeal.setFill();context.fill(CGRect(x:0,y:0,width:160,height:100))
            NSString(string:"合成图片").draw(at:CGPoint(x:20,y:36),withAttributes:[.font:UIFont.systemFont(ofSize:18),.foregroundColor:UIColor.white])
        }
        let photo=folder.appendingPathComponent("合成照片.png");try image.pngData()!.write(to:photo)
        let pdf=folder.appendingPathComponent("合成计划.pdf")
        let renderer=UIGraphicsPDFRenderer(bounds:CGRect(x:0,y:0,width:320,height:420))
        try renderer.writePDF(to:pdf) { context in context.beginPage(); NSString(string:"合成周末计划\n\n留一点时间散步，读几页书。\n这份文件只用于隔离界面测试。").draw(in:CGRect(x:24,y:36,width:272,height:300),withAttributes:[.font:UIFont.systemFont(ofSize:20),.foregroundColor:UIColor.black]) }
        return [photo,pdf]
    }
}
#endif
