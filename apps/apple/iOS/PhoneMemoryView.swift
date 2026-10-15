import SwiftUI
import WeftMateCore

struct PhoneMemoryWorkspaceView: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var model: PhoneStandaloneModel
    @ObservedObject private var offline: OfflineChatModel
    init(app: AppleAppModel) { self.app=app;model=app.phoneChat;offline=app.offline }
    var body: some View {
        Group {
            if model.usesPhoneMemory { PhoneMemoryListView(model:model) }
            else if offline.hostOffline || app.session == nil {
                ScrollView {
                    VStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                        Text("电脑上的记忆").font(AppleTokens.Fonts.title2.bold())
                        Text("电脑现在不在线。这里是上次记住的内容，只能查看；电脑上线后可以修改。")
                        if offline.memoryItems.isEmpty { Text("还没有可查看的内容。电脑上线后会自动更新。") }
                        ForEach(offline.memoryItems) { item in Text(item.text).frame(maxWidth:.infinity,alignment:.leading).phoneCard() }
                    }.padding(AppleTokens.Space.p20)
                }.navigationTitle("记忆").background(Weave.canvas)
            } else { MemoryWorkspaceView(appModel:app,phoneRouting:false) }
        }.task(id:app.phoneAccountIdentity) { model.activate(app:app) }
    }
}
struct PhoneMemoryListView: View {
    @ObservedObject var model: PhoneStandaloneModel
    @State private var editor: Editor?
    @State private var forgetAll=false
    private struct Editor: Identifiable { var id=UUID();var item: PhoneMemoryItem? }
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                Text("这些是手机自己记的。连上电脑后，记忆会交给电脑整理得更完整。")
                    .foregroundStyle(Weave.muted).accessibilityIdentifier("phoneMemory.explanation")
                if model.memory.computerHost != nil {
                    Text("电脑正在接过你的对话。完成前，这里的内容仍然可以用。")
                    if model.handoffCount >= 100 || model.handoffBytes >= 256*1024 {
                        Text("约 \(model.handoffCount) 轮对话、\(ByteCountFormatter.string(fromByteCount:Int64(model.handoffBytes),countStyle:.file))，交给电脑后会在那里整理。")
                        HStack { Button("现在交") { model.handoffNow() }.buttonStyle(PrimaryActionStyle());Button("稍后") { model.handoffLater() }.buttonStyle(OutlineActionStyle()) }
                    }
                }
                if let notice=model.notice { InlineNotice(message:notice,isError:true) }
                if let notice=model.memoryNotice { InlineNotice(message:notice,isError:true) }
                HStack {
                    Button("加一条") { editor=Editor() }.buttonStyle(OutlineActionStyle()).accessibilityIdentifier("phoneMemory.add")
                    Spacer()
                    Button("全部忘掉",role:.destructive) { forgetAll=true }.disabled(model.memory.items.isEmpty).accessibilityIdentifier("phoneMemory.forgetAll")
                }
                if model.memory.items.isEmpty {
                    Text("还没有记住的事。聊聊你的习惯和正在做的事，也可以自己加一条。")
                        .foregroundStyle(Weave.muted).accessibilityIdentifier("phoneMemory.empty")
                }
                ForEach(model.memory.items.sorted { $0.updatedAt > $1.updatedAt }) { item in
                    VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                        Text(item.text).textSelection(.enabled).accessibilityIdentifier("phoneMemory.text.\(item.id)")
                        HStack {
                            if item.pinned { WeftIcon("pin").accessibilityLabel("已置顶") }
                            Text(item.updatedAt,format:.dateTime.month().day()).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                            Spacer()
                            Button("修改") { editor=Editor(item:item) }.accessibilityIdentifier("phoneMemory.edit.\(item.id)")
                            Button("忘掉",role:.destructive) { model.forgetMemory(item.id) }.accessibilityIdentifier("phoneMemory.forget.\(item.id)")
                        }
                        if let threadID=item.threadID,let thread=model.state.threads.first(where: { $0.id == threadID }) {
                            Text("来自对话："+String(thread.title.prefix(60))).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        } else { Text("自己添加").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
                    }.phoneCard()
                }
            }.padding(AppleTokens.Space.p20)
        }.background(Weave.canvas).navigationTitle("记忆")
            .sheet(item:$editor) { value in PhoneMemoryEditor(model:model,item:value.item) }
            .confirmationDialog("把手机记住的事全部忘掉？对话仍会保留。",isPresented:$forgetAll,titleVisibility:.visible) {
                Button("全部忘掉",role:.destructive) { model.forgetMemory() };Button("取消",role:.cancel) {}
            }
    }
}
struct PhoneMemoryEditor: View {
    @ObservedObject var model: PhoneStandaloneModel
    var item: PhoneMemoryItem?
    @Environment(\.dismiss) private var dismiss
    @State private var text=""
    @State private var pinned=false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                TextField("想让它记住什么？",text:$text,axis:.vertical).lineLimit(4...10).accessibilityIdentifier("phoneMemory.editorText")
                Toggle("置顶，聊天时优先用",isOn:$pinned).accessibilityIdentifier("phoneMemory.pinned")
                Text("最多 400 字。请不要填写密码、密钥或证件号码。")
                if let error { Text(error).foregroundStyle(Weave.danger) }
            }.navigationTitle(item == nil ? "加一条记忆" : "修改记忆")
                .toolbar {
                    ToolbarItem(placement:.cancellationAction) { Button("取消") { dismiss() } }
                    ToolbarItem(placement:.confirmationAction) {
                        Button("保存") {
                            do { try model.saveMemory(id:item?.id,text:text,pinned:pinned);dismiss() }
                            catch { self.error="没能保存，请检查内容和手机存储后重试。" }
                        }.disabled(text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || text.count > 400).accessibilityIdentifier("phoneMemory.save")
                    }
                }
        }.onAppear { text=item?.text ?? "";pinned=item?.pinned ?? false }
    }
}

/// Large transfers ask before the first enqueue, wherever the user currently is.
struct PhoneMemoryHandoffBanner: View {
    @ObservedObject var model: PhoneStandaloneModel
    var body: some View {
        if model.memory.computerHost != nil,!model.memory.handoffConfirmed,!model.handoffDeferred,(model.handoffCount >= 100 || model.handoffBytes >= 256*1024) {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
                Text("约 \(model.handoffCount) 轮对话、\(ByteCountFormatter.string(fromByteCount:Int64(model.handoffBytes),countStyle:.file))，可以交给电脑整理记忆。")
                HStack { Button("现在交") { model.handoffNow() };Button("稍后") { model.handoffLater() } }
            }.font(AppleTokens.Fonts.callout).padding(AppleTokens.Space.p12).background(Weave.soft)
        }
    }
}
