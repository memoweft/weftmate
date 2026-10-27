import SwiftUI
import WeftMateCore

struct PhoneMemoryWorkspaceView: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject private var offline: OfflineChatModel
    @ObservedObject private var cloud: CloudLoginModel
    init(app: AppleAppModel) { self.app=app;offline=app.offline;cloud=app.cloudLogin }
    private var items: [OfflineMemory] {
        guard let host=app.session?.hostId,let subject=cloud.subject,cloud.authenticated,
              offline.memoryHostID == host,offline.memoryAccountID == subject else { return [] }
        return offline.memoryItems
    }
    private var computerOnline: Bool { app.session?.verification == .verified && !offline.hostOffline }
    var body: some View {
        ScrollView {
            LazyVStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                Text("电脑上的记忆").font(AppleTokens.Fonts.title2.bold())
                Text("记忆由电脑整理、纠正和遗忘。iPhone 保存原话，聊天时只读当前账号从这台电脑同步来的获准副本。")
                    .foregroundStyle(Weave.muted).accessibilityIdentifier("phoneMemory.explanation")
                if offline.hostOffline {
                    Text("电脑现在不在线。这里显示上次同步的获准副本，电脑上线后会更新。")
                        .accessibilityIdentifier("phoneMemory.offline")
                }
                if let notice=offline.notice { InlineNotice(message:notice).accessibilityIdentifier("phoneMemory.notice") }
                if items.isEmpty {
                    Text("还没有可查看的电脑记忆副本。连接电脑并完成同步后，这里会显示电脑记住的内容。")
                        .foregroundStyle(Weave.muted).accessibilityIdentifier("phoneMemory.empty")
                }
                ForEach(items) { item in
                    VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
                        Text(item.text).textSelection(.enabled).accessibilityIdentifier("phoneMemory.text."+item.id)
                        if !item.sources.isEmpty {
                            Text(item.sources.compactMap(\.summary).isEmpty ? "来自电脑上的原话" : "来源："+item.sources.compactMap(\.summary).joined(separator:"、"))
                                .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        }
                    }.phoneCard()
                }
                if computerOnline {
                    NavigationLink("修改或忘掉电脑记忆") { MemoryWorkspaceView(appModel:app,phoneRouting:false) }
                        .buttonStyle(OutlineActionStyle()).accessibilityIdentifier("phoneMemory.manageComputer")
                }
            }.padding(AppleTokens.Space.p20)
        }.navigationTitle("记忆").background(Weave.canvas)
    }
}
