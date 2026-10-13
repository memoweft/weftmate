import SwiftUI
import WeftMateCore

struct PhoneStandaloneChat: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var model: PhoneStandaloneModel
    @ObservedObject private var cloud: CloudLoginModel
    @Binding var tab: PhoneTab
    init(app: AppleAppModel, model: PhoneStandaloneModel, tab: Binding<PhoneTab> = .constant(.chat)) { self.app=app; self.model=model; cloud=app.cloudLogin; _tab=tab }
    @State private var modelsOpen=false
    @State private var sidebar=false
    @FocusState private var focused: Bool
    var body: some View {
        NavigationStack {
            VStack(spacing:AppleTokens.Space.p0) {
                if model.messages.isEmpty {
                    ScrollView {
                        VStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                            Text("从这里开始聊").font(AppleTokens.Fonts.title2.bold())
                            Text("手机自己就能聊天，电脑可以以后再添加。")
                            if model.models.isEmpty { PhoneModelEditor(model:model) }
                            else { Text("模型已经准备好，发一句话试试。") }
                        }.padding(AppleTokens.Space.p20)
                    }
                } else {
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                                ForEach(model.messages) { message in
                                    VStack(alignment:message.role == "user" ? .trailing : .leading,spacing:AppleTokens.Space.p8) {
                                        Text(message.text.isEmpty ? (model.busy ? "正在回复…" : "还没有收到回复，可以重新生成。") : message.text).textSelection(.enabled).frame(maxWidth:.infinity,alignment:message.role == "user" ? .trailing : .leading)
                                        if message.role == "assistant" {
                                            HStack {
                                                if !message.text.isEmpty { Button { UIPasteboard.general.string=message.text } label: { WeftIcon("copy") }.phoneIcon().accessibilityLabel("复制回复").accessibilityIdentifier("phoneChat.copy") }
                                                if message.id == model.messages.last?.id { Button { model.send(regenerate:true) } label: { WeftIcon("sync") }.phoneIcon().disabled(model.busy).accessibilityLabel("重新生成").accessibilityIdentifier("phoneChat.regenerate") }
                                            }
                                        }
                                    }.id(message.id)
                                }
                            }.padding(AppleTokens.Space.p20)
                        }.onChange(of:model.messages.last?.text) { _,_ in if let id=model.messages.last?.id { proxy.scrollTo(id,anchor:.bottom) } }
                    }
                }
                if let notice=model.notice, !model.models.isEmpty || !model.messages.isEmpty { Text(notice).font(AppleTokens.Fonts.footnote).foregroundStyle(Weave.muted).padding(.horizontal,AppleTokens.Space.p16) }
                if !model.models.isEmpty {
                    VStack(alignment:.leading,spacing:AppleTokens.Space.p8) {
                        Text("手机上可以聊天和记住你说过的事；操作电脑，连上电脑后可用。")
                            .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        HStack(spacing:AppleTokens.Space.p8) {
                            TextField("聊一聊…",text:$model.draft,axis:.vertical).lineLimit(1...5).focused($focused).accessibilityIdentifier("phoneChat.draft")
                            Button { focused=false; model.busy ? model.stop() : model.send() } label: { WeftIcon(model.busy ? "stop" : "send") }.phoneIcon(primary:true).disabled(!model.busy && model.draft.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty).accessibilityLabel(model.busy ? "停止回复" : "发送").accessibilityIdentifier("phoneChat.send")
                        }
                        if focused {
                            HStack(spacing:AppleTokens.Space.p8) {
                                Menu {
                                    Picker("模型",selection:$model.modelID) { ForEach(model.models) { value in Text(value.name+" · "+value.model).tag(value.id) } }
                                    Button("配置模型") { focused=false; modelsOpen=true }
                                } label: { WeftIcon("model").phoneMenuLabel(circle:true,onCard:true) }.phoneIcon().accessibilityLabel("模型选择，"+(model.currentModel?.model ?? "尚未配置")).accessibilityIdentifier("phoneChat.model")
                                Menu { Text("手机聊天没有电脑操作，无需审批。"); Text("连上电脑后可选择操作模式。") } label: { PhoneOperationModeIcon().phoneMenuLabel(circle:true,onCard:true) }.phoneIcon().accessibilityLabel("操作模式，手机聊天").accessibilityIdentifier("phoneChat.mode")
                                Spacer()
                                Button { focused=false } label: { WeftIcon("chevron") }.phoneIcon().accessibilityLabel("收起键盘")
                            }
                        }
                    }.padding(AppleTokens.Space.p12).background(Weave.soft,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r24)).padding(AppleTokens.Space.p12)
                }
            }.background(Weave.canvas).allowsHitTesting(!sidebar).opacity(sidebar ? 0 : 1).navigationTitle("WeftMate").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement:.topBarLeading) { Button { focused=false; sidebar=true } label: { WeftIcon("sidebar") }.phoneIcon().accessibilityLabel("对话列表").accessibilityIdentifier("phoneChat.sidebar") }
                    ToolbarItem(placement:.topBarTrailing) { PhoneAccountMenu(model:app) }
                }
                .navigationDestination(isPresented:$modelsOpen) { PhoneModelsView(model:model) }
                .overlay(alignment:.leading) { if sidebar { PhoneLocalDrawer(app:app,model:model,tab:$tab,close:{sidebar=false}) } }
        }.task(id:"\(cloud.cloudAddress)|\(cloud.subject ?? "device-local")") { model.activate(app:app) }
    }
}
struct PhoneLocalDrawer: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var model: PhoneStandaloneModel
    @Binding var tab: PhoneTab
    var close: () -> Void
    @State private var search=""
    var body: some View {
        ZStack(alignment:.leading) {
            Color.black.opacity(0.65).ignoresSafeArea().onTapGesture(perform:close).accessibilityLabel("关闭侧栏")
            VStack(spacing:AppleTokens.Space.p12) {
                HStack { Text("WeftMate").font(AppleTokens.Fonts.headline); Spacer(); PhoneAccountMenu(model:app); Button(action:close) { WeftIcon("deny") }.phoneIcon().accessibilityLabel("关闭侧栏") }.padding(AppleTokens.Space.p16)
                ScrollView {
                    VStack(alignment:.leading,spacing:AppleTokens.Space.p4) {
                        ForEach(PhoneTab.allCases) { item in
                            Button { tab=item; close() } label: { HStack(spacing:AppleTokens.Space.p12) { WeftIcon(item.icon); Text(item.title); Spacer(minLength:0) }.frame(maxWidth:.infinity,minHeight:44,alignment:.leading).padding(.horizontal,AppleTokens.Space.p12).background(tab == item ? Weave.accentSoft : .clear,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r12)) }.buttonStyle(.plain)
                        }
                        Text("手机上的对话").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted).padding(.horizontal,AppleTokens.Space.p12)
                        ForEach(model.state.threads.filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) }) { thread in
                            Button { model.select(thread.id); close() } label: { HStack(spacing:AppleTokens.Space.p12) { WeftIcon("chat"); Text(thread.title).lineLimit(2); Spacer(minLength:0) }.frame(maxWidth:.infinity,minHeight:44,alignment:.leading).padding(.horizontal,AppleTokens.Space.p12).background(thread.id == model.state.selected ? Weave.accentSoft : .clear,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r12)) }.buttonStyle(.plain)
                        }
                    }.padding(.horizontal,AppleTokens.Space.p12)
                }
                HStack(spacing:AppleTokens.Space.p8) {
                    HStack { WeftIcon("search"); TextField("搜索对话",text:$search).textFieldStyle(.plain) }.padding(.horizontal,AppleTokens.Space.p12).frame(minHeight:44).background(Weave.surface,in:Capsule())
                    Button { model.newThread(); close() } label: { WeftIcon("plus") }.phoneIcon().accessibilityLabel("新建对话").accessibilityIdentifier("phoneChat.new")
                }.padding(AppleTokens.Space.p12)
            }.frame(maxWidth:320).background(Weave.soft)
        }.gesture(DragGesture().onEnded { value in if value.translation.width < -50 { close() } })
    }
}
struct PhoneModelsView: View {
    @ObservedObject var model: PhoneStandaloneModel
    @State private var clearing=false
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                Text("手机上的模型").font(AppleTokens.Fonts.title2.bold())
                Toggle("在手机上记住我说过的事",isOn:Binding(get:{model.memory.enabled},set:{model.setMemoryEnabled($0)})).accessibilityIdentifier("phoneMemory.enabled")
                Text("每段对话会多用一次小的模型请求。连上电脑后，由电脑负责记忆。")
                    .font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                Text("密钥保存在这台 iPhone 的钥匙串里。聊天内容会发送给你选择的模型提供方。")
                ForEach(model.models) { value in
                    VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                        Text(value.name+" · "+value.model).font(AppleTokens.Fonts.headline)
                        Text(value.baseURL).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        DisclosureGroup("修改模型") { PhoneModelEditor(model:model,existing:value) }
                        Button("删除模型",role:.destructive) { model.removeModel(value.id) }.accessibilityIdentifier("phoneModel.delete")
                    }.phoneCard()
                }
                PhoneModelEditor(model:model)
                Button("清除手机上的模型、对话与记忆",role:.destructive) { clearing=true }.accessibilityIdentifier("phoneModel.clearLocalData")
            }.padding(AppleTokens.Space.p20)
        }.navigationTitle("模型").background(Weave.canvas)
            .confirmationDialog("清除这台手机当前账号的模型、对话与记忆？电脑上的内容不受影响。",isPresented:$clearing,titleVisibility:.visible) {
                Button("清除本机内容",role:.destructive) { model.clearLocalData() };Button("取消",role:.cancel) {}
            }
    }
}
struct PhoneModelEditor: View {
    @ObservedObject var model: PhoneStandaloneModel
    var existing: PhoneModelConfiguration?
    @State private var preset="mimo"
    @State private var name="MiMo"
    @State private var address="https://api.xiaomimimo.com/v1"
    @State private var modelName="mimo-v2.6-flash"
    @State private var key=""
    @State private var tested: PhoneModelConfiguration?
    @State private var saved=false
    @State private var newID=UUID().uuidString
    @FocusState private var focused: Bool
    private var value: PhoneModelConfiguration { .init(id:existing?.id ?? newID,name:name,baseURL:address.trimmingCharacters(in:.whitespacesAndNewlines),model:modelName.trimmingCharacters(in:.whitespacesAndNewlines),apiKey:key) }
    private var selected: PhoneProviderPreset { PhoneProviderPreset.values.first { $0.id == preset } ?? PhoneProviderPreset.values[0] }
    var body: some View {
        VStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
            Picker("模型提供方",selection:$preset) { ForEach(PhoneProviderPreset.values) { Text($0.name).tag($0.id) } }.accessibilityIdentifier("phoneModel.provider")
            Text(selected.help).font(AppleTokens.Fonts.callout)
            Link("如何获取密钥",destination:URL(string:selected.url)!)
            SecureField("粘贴密钥",text:$key).accountInput().weaveField().focused($focused).accessibilityIdentifier("phoneModel.key")
            DisclosureGroup("调整地址与模型") {
                TextField("显示名称",text:$name).weaveField().focused($focused)
                TextField("服务地址",text:$address).accountInput().weaveField().focused($focused).accessibilityIdentifier("phoneModel.address")
                TextField("模型名称",text:$modelName).accountInput().weaveField().focused($focused).accessibilityIdentifier("phoneModel.name")
            }
            Text("测试会发送一条短消息，使用模型额度。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
            Button(model.testing ? "正在测试…" : "测试连接") { focused=false; let candidate=value; Task { if await model.test(candidate),candidate == value { tested=candidate } } }.disabled(model.testing || key.isEmpty || modelName.isEmpty).buttonStyle(OutlineActionStyle()).accessibilityIdentifier("phoneModel.test").accessibilityValue("密钥字符 \(key.count)，模型字符 \(modelName.count)，正在测试 \(model.testing)")
            Button("保存并使用这个模型") { do { try model.saveModel(value); key=""; tested=nil; saved=true; model.notice="模型已保存在手机上。" } catch { model.notice="模型没能保存，请重试。" } }.disabled(tested != value).buttonStyle(PrimaryActionStyle()).accessibilityIdentifier("phoneModel.save")
            if let notice=model.notice { Text(notice).font(AppleTokens.Fonts.footnote).accessibilityIdentifier("phoneModel.notice") }
            if saved { Text("已保存").accessibilityIdentifier("phoneModel.saved") }
        }.onAppear { if let existing { name=existing.name; address=existing.baseURL; modelName=existing.model; key=existing.apiKey } }
            .onChange(of:preset) { _,_ in name=selected.name; address=selected.baseURL; modelName=selected.model; key=""; tested=nil }
            .toolbar { ToolbarItemGroup(placement:.keyboard) { Spacer(); Button("完成") { focused=false } } }
            #if DEBUG
            .onAppear { let args=ProcessInfo.processInfo.arguments; if args.contains("--ui-testing"),args.contains("--apple6-fixture"),let i=args.firstIndex(of:"--apple6-model-url"),args.indices.contains(i+1) { address=args[i+1]; modelName="synthetic-stream"; name="合成模型" } }
            #endif
    }
}
struct PhoneComputerEmptyPage: View {
    @ObservedObject var app: AppleAppModel
    var title: String
    var explanation: String
    @State private var devices=false
    var body: some View {
        VStack(spacing:AppleTokens.Space.p20) { EmptyState(symbol:PhoneTab.allCases.first(where: { $0.title == title })?.icon ?? "desktop",title:title,message:explanation+"连上电脑后可用。"); Button("怎么连上电脑") { devices=true }.buttonStyle(OutlineActionStyle()).padding(AppleTokens.Space.p20) }
            .navigationTitle(title).background(Weave.canvas).toolbar { PhoneAccountMenu(model:app) }
            .sheet(isPresented:$devices) { SettingsView(model:app,route:.init(categoryID:"devices"),onClose:{devices=false}) }
    }
}

struct PhoneAccountSettingsContent: View {
    @ObservedObject var cloud: CloudLoginModel
    var body: some View {
        if cloud.authenticated { AccountSettingsView(cloud:cloud) }
        else { AuthView(model:cloud) }
    }
}
