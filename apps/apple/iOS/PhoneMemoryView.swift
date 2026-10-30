import SwiftUI
import WeftMateCore

struct PhoneMemoryWorkspaceView: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject private var offline: OfflineChatModel
    @ObservedObject private var cloud: CloudLoginModel
    @State private var query=""
    @State private var kind=""
    @State private var selectedID: String?
    init(app: AppleAppModel) { self.app=app;offline=app.offline;cloud=app.cloudLogin }
    private var items: [OfflineMemory] {
        guard let host=cloud.requestedComputerID ?? app.session?.hostId ?? offline.memoryHostID,let subject=cloud.subject,cloud.authenticated,
              offline.memoryHostID == host,offline.memoryAccountID == subject else { return [] }
        return offline.memoryItems
    }
    private var filtered: [OfflineMemory] { items.filter { (kind.isEmpty || $0.kind == kind) && (query.isEmpty || $0.text.localizedCaseInsensitiveContains(query)) } }
    private var computerOnline: Bool { app.session?.verification == .verified && !offline.hostOffline }
    var body: some View {
        ScrollView {
            LazyVStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
                Text("看看它如何理解你。").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
                    Text("记忆由电脑整理，手机查看同步副本。").accessibilityIdentifier("phoneMemory.explanation")
                    Text("原话收到与记忆形成分开显示；纠正、停用和遗忘由电脑处理。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                }.padding(AppleTokens.Space.p16).background(Weave.soft,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r12))
                if !computerOnline,app.session != nil || offline.hostOffline || !items.isEmpty { Text("电脑现在不在线。这里只读上次同步的获准副本，连接电脑后才能修改。").font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted).accessibilityIdentifier("phoneMemory.offline") }
                if let notice=offline.notice { InlineNotice(message:notice).accessibilityIdentifier("phoneMemory.notice") }
                HStack { WeftIcon("search");TextField("搜索记忆",text:$query).textFieldStyle(.plain).accessibilityIdentifier("phoneMemory.search") }.padding(AppleTokens.Space.p12).background(Weave.soft,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r12))
                Picker("记忆类别",selection:$kind) {
                    Text("全部").tag("");Text("认知").tag("cognition");Text("人物与事物").tag("entity");Text("事件").tag("event");Text("关系").tag("relationship")
                }.pickerStyle(.menu).accessibilityIdentifier("phoneMemory.filter")
                if filtered.isEmpty {
                    Text(items.isEmpty ? "还没有可查看的电脑记忆副本。连接电脑并完成同步后，这里会显示电脑记住的内容。" : "没有找到匹配的记忆，试试其他关键词或类别。")
                        .foregroundStyle(Weave.muted).padding(.vertical,AppleTokens.Space.p20).accessibilityIdentifier("phoneMemory.empty")
                }
                VStack(spacing:0) {
                    ForEach(filtered) { item in
                        Button { selectedID=item.id } label: { PhoneFeatureRow(title:item.text,subtitle:memoryKindName(item.kind)+" · "+String(item.sources.count)+" 个来源") }.buttonStyle(.plain).accessibilityIdentifier("phoneMemory.text."+item.id)
                        Divider()
                    }
                }
                PhoneSectionHeading(title:"同步与清理")
                NavigationLink { MemoryWorkspaceView(appModel:app,phoneRouting:false).id(app.accountEpoch) } label: { PhoneFeatureRow(icon:"memory",title:"管理电脑记忆与清理回执",subtitle:computerOnline ? "查看来源、纠正、停用或确认遗忘范围" : "连接电脑后可用") }
                    .disabled(!computerOnline).accessibilityIdentifier("phoneMemory.manageComputer")
            }.padding(AppleTokens.Space.p20)
        }.navigationTitle("记忆").navigationBarTitleDisplayMode(.large).background(Weave.canvas)
            .navigationDestination(isPresented:Binding(get:{selectedID != nil},set:{if !$0 { selectedID=nil }})) {
                if let item=items.first(where:{ $0.id == selectedID }) { detail(item) }
                else { Text("这条记忆的副本已更新或撤回，请返回查看当前列表。").padding(AppleTokens.Space.p20) }
            }
            .onChange(of:app.accountEpoch) { _,_ in selectedID=nil;query="";kind="" }
            .onChange(of:cloud.subject) { _,_ in selectedID=nil;query="";kind="" }
    }
    private func detail(_ item: OfflineMemory) -> some View {
        ScrollView {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                Text(memoryKindName(item.kind)+" · 来自电脑记忆").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                Text(item.text).font(AppleTokens.Fonts.title3).textSelection(.enabled)
                PhoneSectionHeading(title:"为什么会这样理解")
                if item.sources.isEmpty { Text("这份副本没有可显示的来源；连接电脑后可读取获准来源。").foregroundStyle(Weave.muted) }
                ForEach(item.sources,id:\.id) { source in
                    PhoneFeatureRow(icon:"source",title:source.summary ?? "来自电脑上的原话",subtitle:"连接电脑后查看获准原文",chevron:false)
                    Divider()
                }
                if computerOnline {
                    NavigationLink { MemoryWorkspaceView(appModel:app,phoneRouting:false,phoneSelection:item).id(app.accountEpoch) } label: { Text("不准确，纠正它").frame(maxWidth:.infinity) }.buttonStyle(PrimaryActionStyle()).accessibilityIdentifier("phoneMemory.correct")
                    Text("也可以在电脑记忆详情中停用，或读取完整遗忘范围后忘掉它。").font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted)
                } else { Text("离线只读。电脑上线后，可以读取来源、纠正、停用和遗忘。").foregroundStyle(Weave.muted) }
            }.padding(AppleTokens.Space.p20)
        }.background(Weave.canvas).navigationTitle("记忆详情").accessibilityIdentifier("phoneMemory.detail")
    }
}
private func memoryKindName(_ value: String) -> String {
    ["cognition":"认知","entity":"人物与事物","relationship":"关系","event":"事件"][value] ?? "记忆"
}
