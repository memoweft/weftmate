import SwiftUI
import WeftMateCore

@MainActor final class ModelServiceSettingsModel: ObservableObject {
    @Published var services: [ModelService]=[]
    @Published var supported=true
    @Published var canManage=true
    @Published var busy=false
    @Published var notice: String?
    @Published var profiles: [WeftMateCore.UsageModel] = []
    @Published var backgroundID = ""
    @Published var mainName = "按对话选择"
    var localOnly: Bool { phone != nil }
    func chooseBackground(_ id: String) async {
        guard let app else { return }
        do { let reply = try await app.assistantClient.setBackgroundModel(id.isEmpty ? nil : id); backgroundID = reply.backgroundModelProfileId ?? "" }
        catch { notice = "后台模型没能保存，请重试。" }
    }
    private weak var app: AppleAppModel?
    private weak var phone: PhoneStandaloneModel?
    init(app: AppleAppModel?,phone: PhoneStandaloneModel? = nil) { self.app=app;self.phone=phone }
    var identity: String {
        if phone != nil { return phone?.serviceIdentity ?? "" }
        return app?.accountEpoch.uuidString ?? ""
    }
    func load(force: Bool = false) async {
        if let phone { services=phone.services; mainName = phone.selectedServiceModel?.name ?? "按对话选择"; return }
        do {
            _ = try await app?.readModelCatalogue(force:force)
            services=app?.modelServices ?? [];supported=app?.modelServicesSupported == true;canManage=app?.modelServicesCanManage == true
            #if os(iOS)
            backgroundID = app?.serviceModelSettings?.backgroundModelProfileId ?? ""
            mainName = services.flatMap(\.models).first { $0.matches(app?.serviceModelSettings?.defaultModelProfileId) }?.name ?? "按对话选择"
            profiles = try await app?.assistantClient.usageSettings().models ?? []
            #endif
        } catch { notice="模型服务暂时读不了，请重试。" }
    }
    func check(existing: ModelService?,base: String,key: String,type: String) async -> ModelCatalogResult? {
        guard !busy else { return nil };busy=true;let ticket=identity;defer { busy=false }
        if let phone {
            if key.isEmpty,let existing { await phone.refreshService(existing,force:true);services=phone.services;return services.first {$0.id == existing.id}?.catalog }
            let result=await phone.queryService(baseUrl:base,apiKey:key,interfaceType:type);return ticket == identity ? result : nil
        }
        do {
            let result=try await app?.assistantClient.checkModelService(baseUrl:key.isEmpty ? nil : base,apiKey:key.isEmpty ? nil : key,interfaceType:type,serviceId:existing?.id)
            return ticket == identity ? result : nil
        } catch { if ticket == identity { notice="暂时没能查询，稍后可重试或手填型号。" };return nil }
    }
    func save(existing: ModelService?,name: String,base: String,key: String,type: String,result: ModelCatalogResult?,manual: String,selected: String?,enabled: Set<String>) async -> Bool {
        guard !busy else { return false };busy=true;let ticket=identity;defer { busy=false }
        do {
            if let phone { try phone.saveService(existing:existing,name:name,baseUrl:base,apiKey:key,interfaceType:type,result:result,manual:manual,selected:selected,enabled:existing == nil ? nil : enabled);services=phone.services;return true }
            var value=ModelServiceWrite(name:name,baseUrl:base,apiKey:key.isEmpty ? nil : key,interfaceType:type,modelId:manual.isEmpty ? nil : manual,expectedRevision:existing?.revision)
            value.selectedModelId=selected
            if existing != nil { value.models=enabled.sorted().map { .init(modelId:$0,enabled:true) } + (existing?.models.filter {!enabled.contains($0.modelId)}.map { .init(modelId:$0.modelId,enabled:false) } ?? []) }
            _ = try await app?.assistantClient.writeModelService(value,id:existing?.id)
            guard ticket == identity else { return false };await load(force:true);return true
        } catch { if ticket == identity { notice="模型服务没能保存，请检查地址和密钥后重试。" };return false }
    }
    func remove(_ service: ModelService) async -> Bool {
        guard !busy else { return false }
        busy = true; defer { busy = false }
        let ticket=identity
        do {
            if let phone {
                phone.removeService(service); services = phone.services
                if services.contains(where: { $0.id == service.id }) { notice = phone.notice ?? "模型服务没能删除，请重试。"; return false }
                return true
            }
            try await app?.assistantClient.removeModelService(service);guard ticket == identity else { return false };await load(force:true);return true
        } catch { if ticket == identity { notice="模型服务没能删除，请重试。" };return false }
    }
}
struct ModelServicesSettingsView: View {
    @StateObject var store: ModelServiceSettingsModel
    @Environment(\.colorScheme) private var scheme
    @State private var editing: ModelService?
    @State private var editor=false
    @ViewBuilder var body: some View {
        #if os(iOS)
        phoneContent
        #else
        ScrollView {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p20) {
                Text("一个地址和密钥，就能选用这个服务的全部聊天模型。").foregroundStyle(Weave.muted)
                ForEach(store.services) { service in
                    VStack(alignment:.leading,spacing:AppleTokens.Space.p12) {
                        Text(service.name).font(AppleTokens.Fonts.headline)
                        Text(service.baseUrl).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        Text("\(service.models.count) 个模型 · \(service.models.filter(\.enabled).count) 个显示在菜单里")
                        Text(service.catalog.message).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        if let checked=service.catalog.checkedAt { Text(HealthInputMath.parseISO(checked)?.formatted(date:.abbreviated,time:.shortened) ?? "").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
                        Button("管理模型服务") { editing=service;editor=true }.buttonStyle(ServiceActionStyle()).disabled(!store.canManage).accessibilityIdentifier("modelServices.edit."+service.id)
                    }.padding(AppleTokens.Space.p16).background(ServiceControlPalette(dark:scheme == .dark).surface,in:RoundedRectangle(cornerRadius:AppleTokens.Radius.r16))
                }
                Button("添加模型服务…") { editing=nil;editor=true }.buttonStyle(ServiceActionStyle(primary:true)).disabled(!store.canManage).accessibilityIdentifier("modelServices.new")
                if let notice=store.notice { Text(notice).foregroundStyle(Weave.muted) }
            }.padding(AppleTokens.Space.p20)
        }.background(ServiceControlPalette(dark:scheme == .dark).canvas).navigationTitle("模型服务").task { await store.load() }
            .sheet(isPresented:$editor) { NavigationStack { ModelServiceEditor(store:store,existing:editing,onClose:{editor=false}) } }
        #endif
    }
    #if os(iOS)
    private var phoneContent: some View {
        Form {
            Section {
                ForEach(store.services) { service in
                    Button { editing = service; editor = true } label: {
                        PhoneSettingsLabel(title: service.name, subtitle: "\(service.models.count) 个模型 · " + service.catalog.message, icon: "model")
                    }.buttonStyle(.plain).disabled(!store.canManage).accessibilityIdentifier("modelServices.edit." + service.id)
                }
                Button { editing = nil; editor = true } label: { WeftLabel("添加模型服务", icon: "plus") }.disabled(!store.canManage).accessibilityIdentifier("modelServices.new")
            } header: { Text("模型服务") } footer: { Text("每段对话都能选自己的模型。一个地址和密钥可读取这个服务的聊天模型。") }
            Section("默认选择") {
                LabeledContent("主模型", value: store.mainName).accessibilityIdentifier("modelServices.mainModel")
                Text("每段对话在聊天里选择自己的模型，已有对话保留原选择。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                if !store.localOnly {
                    Picker("后台模型", selection: Binding(get: { store.backgroundID }, set: { id in Task { await store.chooseBackground(id) } })) {
                        Text("跟随主模型").tag("")
                        ForEach(store.services) { service in ForEach(service.models.filter(\.enabled)) { item in if let id = item.profileId { Text(item.name).tag(id) } } }
                    }.disabled(!store.canManage).accessibilityIdentifier("modelServices.backgroundModel")
                } else { Text("连上电脑后，由电脑负责记忆与后台整理。").foregroundStyle(Weave.muted) }
            }
            if let notice = store.notice { Section { InlineNotice(message: notice, isError: true); Button("重试") { Task { await store.load(force: true) } } } }
        }.scrollContentBackground(.hidden).background(Weave.grouped).navigationTitle("模型服务").task { await store.load() }
            .navigationDestination(isPresented: $editor) { ModelServiceEditor(store: store, existing: editing, onClose: { editor = false }) }
    }
    #endif

}
struct ModelServiceEditor: View {
    @ObservedObject var store: ModelServiceSettingsModel
    var existing: ModelService?
    var onClose: () -> Void = {}
    var embedded = false
    private var editorCanvas: Color {
        #if os(macOS)
        AppleTokens.Colors.controlCanvas
        #else
        Weave.canvas
        #endif
    }
    @State private var name="MiMo"
    @State private var base="https://api.xiaomimimo.com/v1"
    @State private var type="openai-compatible"
    @State private var key=""
    @State private var manual=""
    @State private var selected: String?
    @State private var result: ModelCatalogResult?
    @State private var enabled=Set<String>()
    @State private var removing=false
    @State private var query=""
    @State private var queryTask: Task<Void,Never>?
    @State private var initialized = false
    #if os(macOS)
    @State private var presets = false
    #endif
    private var queryTitle: String {
        #if os(iOS)
        "读取模型"
        #else
        "查询模型清单"
        #endif
    }
    private var editTitle: String {
        #if os(iOS)
        "编辑模型服务"
        #else
        "管理模型服务"
        #endif
    }
    private var items: [ServiceModel] {
        var items=existing?.models ?? []
        for item in result?.models ?? [] { if !items.contains(where: {$0.modelId == item.modelId}) { items.append(item) } };return items
    }
    private var valid: Bool { !name.isEmpty && !base.isEmpty && (existing != nil || !key.isEmpty) && (!items.isEmpty || !manual.isEmpty) && (existing?.baseUrl == base || !key.isEmpty) }
    @MainActor private func queryModels() async {
        let capturedBase=base,capturedKey=key,capturedType=type,identity=store.identity
        let found=await store.check(existing:existing,base:capturedBase,key:capturedKey,type:capturedType)
        guard capturedBase == base,capturedKey == key,capturedType == type,identity == store.identity,!Task.isCancelled else { return }
        result=found;if selected == nil { selected=ModelCatalog.recommendedModel(result?.models ?? []) };enabled.formUnion(result?.models?.map(\.modelId) ?? [])
    }
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:AppleTokens.Space.p16) {
                #if os(iOS)
                PhoneActionMenu {
                    ForEach(PhoneProviderPreset.values) { preset in ServiceMenuRow(title:preset.name) { name=preset.name;base=preset.baseURL;type="openai-compatible";key="";result=nil } }
                    ServiceMenuRow(title:"Claude") { name="Claude";base="https://api.anthropic.com/v1";type="anthropic";key="";result=nil }
                    ServiceMenuRow(title:"自定义") { name="自定义服务";base="";type="openai-compatible";result=nil }
                } label: { WeftLabel("选择预设或自定义", icon: "chevron").phoneMenuLabel() }.accessibilityIdentifier("modelServices.preset")
                #else
                Button("选择预设或自定义") { presets.toggle() }.buttonStyle(ServiceActionStyle()).accessibilityIdentifier("modelServices.preset")
                if presets {
                    ForEach(PhoneProviderPreset.values) { preset in ServiceMenuRow(title: preset.name) { name = preset.name; base = preset.baseURL; type = "openai-compatible"; key = ""; result = nil; presets = false } }
                    ServiceMenuRow(title: "Claude") { name = "Claude"; base = "https://api.anthropic.com/v1"; type = "anthropic"; key = ""; result = nil; presets = false }
                    ServiceMenuRow(title: "自定义") { name = "自定义服务"; base = ""; type = "openai-compatible"; result = nil; presets = false }
                }
                #endif
                #if os(iOS)
                Text("连接信息只留在自己的配置里。").font(AppleTokens.Fonts.callout).foregroundStyle(Weave.muted)
                Text("服务名称").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                #endif
                TextField("服务名称",text:$name).modelServiceField().accessibilityIdentifier("modelServices.name")
                #if os(iOS)
                Text("服务地址").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                #endif
                TextField("服务地址",text:$base).accountInput().modelServiceField().autocorrectionDisabled().accessibilityIdentifier("modelServices.address")
                #if os(iOS)
                Text("API 密钥").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                #endif
                SecureField(existing == nil ? "粘贴密钥" : "新密钥（留空保留原密钥）",text:$key).accountInput().modelServiceField().accessibilityIdentifier("modelServices.key")
                Text("密钥保存在钥匙串或电脑的加密存储中。查询清单不会发送聊天消息。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                Button(store.busy ? "正在查询…" : queryTitle) { Task { await queryModels() } }.buttonStyle(ServiceActionStyle()).disabled(store.busy || (key.isEmpty && (existing == nil || existing?.baseUrl != base)) || base.isEmpty).accessibilityIdentifier("modelServices.query")
                if let result { Text(result.message).font(AppleTokens.Fonts.callout).accessibilityIdentifier("modelServices.queryResult") }
                if !items.isEmpty {
                    Text("选择默认模型").font(AppleTokens.Fonts.headline)
                    TextField("搜索型号",text:$query).modelServiceField()
                    ForEach(items.filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) || $0.modelId.localizedCaseInsensitiveContains(query) }) { item in
                        VStack(spacing:AppleTokens.Space.p0) {
                            ServiceMenuRow(title:item.name,selected:selected == item.modelId) { selected=item.modelId }.accessibilityIdentifier("modelServices.default."+item.modelId)
                            #if os(iOS)
                            NavigationLink("单价与能力") { PhoneServiceModelProfile(item: item, profile: store.profiles.first { $0.id == item.profileId }) }.font(AppleTokens.Fonts.caption).accessibilityIdentifier("modelServices.profile." + item.modelId)
                            #endif
                            if existing != nil { ServiceSwitch(title:"在菜单里显示",enabled:Binding(get:{enabled.contains(item.modelId)},set:{value in if value { enabled.insert(item.modelId) } else { enabled.remove(item.modelId) }})) }
                        }
                    }
                }
                if result?.status != "available" || existing != nil {
                    TextField("手填一个型号",text:$manual).accountInput().modelServiceField().autocorrectionDisabled().accessibilityIdentifier("modelServices.manual")
                }
                Button(existing == nil ? "完成并使用" : "保存") { Task { if await store.save(existing:existing,name:name,base:base,key:key,type:type,result:result,manual:manual,selected:selected,enabled:enabled) { key="";onClose() } } }.buttonStyle(ServiceActionStyle(primary:true)).disabled(!valid || store.busy).accessibilityIdentifier("modelServices.save")
                if let notice=store.notice { Text(notice).foregroundStyle(Weave.muted) }
                if existing != nil {
                    Button("删除模型服务") { removing=true }.buttonStyle(ServiceActionStyle()).foregroundStyle(Weave.danger).accessibilityIdentifier("modelServices.delete")
                    #if os(iOS)
                        .phonePopover(isPresented: $removing) {
                            VStack(alignment: .leading, spacing: AppleTokens.Space.p16) {
                                Text("删除这个模型服务？已有对话保留。")
                                Button("删除", role: .destructive) { if let existing { Task { if await store.remove(existing) { key = ""; onClose() }; removing = false } } }
                                Button("取消") { removing = false }
                            }.padding(AppleTokens.Space.p20).frame(idealWidth: AppleTokens.Phone.menuWidth)
                        }
                    #endif
                }
            }.padding(AppleTokens.Space.p20)
        }.background(editorCanvas).navigationTitle(embedded ? "WeftMate" : existing == nil ? "添加模型服务" : editTitle)
            .toolbar { if !embedded { ToolbarItem(placement:.cancellationAction) { Button("关闭") { key="";onClose() }.foregroundStyle(Weave.secondary) } } }
            .onAppear { guard !initialized else { return }; initialized = true; if let existing { name=existing.name;base=existing.baseUrl;type=existing.interfaceType;selected=existing.selectedModelId;enabled=Set(existing.models.filter(\.enabled).map(\.modelId)) } }
            #if DEBUG
            .onAppear {
                let args=ProcessInfo.processInfo.arguments
                if existing == nil,args.contains("--ui-testing"),args.contains("--apple9-fixture"),let i=args.firstIndex(of:"--apple9-model-url"),args.indices.contains(i+1),let url=URL(string:args[i+1]),url.host == "127.0.0.1",url.scheme == "http" {
                    name="合成模型服务";base=url.absoluteString;key=UUID().uuidString
                }
            }
            #endif
            .onChange(of:base) { _,_ in result=nil }
            .onChange(of:key) { _,_ in
                result=nil;queryTask?.cancel()
                guard !key.isEmpty,!base.isEmpty else { return }
                queryTask=Task { do { try await Task.sleep(for:.milliseconds(700)) } catch { return };await queryModels() }
            }
            .onDisappear { queryTask?.cancel() }
            #if os(macOS)
            .confirmationDialog("删除这个模型服务？旧对话仍然保留。",isPresented:$removing,titleVisibility:.visible) { Button("删除",role:.destructive) { if let existing { Task { if await store.remove(existing) { onClose() } } } };Button("取消",role:.cancel) {} }
            #endif
    }
}
