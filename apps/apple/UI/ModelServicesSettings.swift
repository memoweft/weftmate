import SwiftUI
import WeftMateCore

@MainActor final class ModelServiceSettingsModel: ObservableObject {
    @Published var services: [ModelService]=[]
    @Published var supported=true
    @Published var canManage=true
    @Published var busy=false
    @Published var notice: String?
    private weak var app: AppleAppModel?
    #if os(iOS)
    private weak var phone: PhoneStandaloneModel?
    init(app: AppleAppModel?,phone: PhoneStandaloneModel? = nil) { self.app=app;self.phone=phone }
    #else
    init(app: AppleAppModel?) { self.app=app }
    #endif
    var identity: String {
        #if os(iOS)
        if phone != nil { return phone?.serviceIdentity ?? "" }
        #endif
        return app?.accountEpoch.uuidString ?? ""
    }
    func load(force: Bool = false) async {
        #if os(iOS)
        if let phone { services=phone.services;return }
        #endif
        do {
            _ = try await app?.readModelCatalogue(force:force)
            services=app?.modelServices ?? [];supported=app?.modelServicesSupported == true;canManage=app?.modelServicesCanManage == true
        } catch { notice="模型服务暂时读不了，请重试。" }
    }
    func check(existing: ModelService?,base: String,key: String,type: String) async -> ModelCatalogResult? {
        guard !busy else { return nil };busy=true;let ticket=identity;defer { busy=false }
        #if os(iOS)
        if let phone {
            if key.isEmpty,let existing { await phone.refreshService(existing,force:true);services=phone.services;return services.first {$0.id == existing.id}?.catalog }
            let result=await phone.queryService(baseUrl:base,apiKey:key,interfaceType:type);return ticket == identity ? result : nil
        }
        #endif
        do {
            let result=try await app?.assistantClient.checkModelService(baseUrl:key.isEmpty ? nil : base,apiKey:key.isEmpty ? nil : key,interfaceType:type,serviceId:existing?.id)
            return ticket == identity ? result : nil
        } catch { if ticket == identity { notice="暂时没能查询，稍后可重试或手填型号。" };return nil }
    }
    func save(existing: ModelService?,name: String,base: String,key: String,type: String,result: ModelCatalogResult?,manual: String,selected: String?,enabled: Set<String>) async -> Bool {
        guard !busy else { return false };busy=true;let ticket=identity;defer { busy=false }
        do {
            #if os(iOS)
            if let phone { try phone.saveService(existing:existing,name:name,baseUrl:base,apiKey:key,interfaceType:type,result:result,manual:manual,selected:selected,enabled:existing == nil ? nil : enabled);services=phone.services;return true }
            #endif
            var value=ModelServiceWrite(name:name,baseUrl:base,apiKey:key.isEmpty ? nil : key,interfaceType:type,modelId:manual.isEmpty ? nil : manual,expectedRevision:existing?.revision)
            value.selectedModelId=selected
            if existing != nil { value.models=enabled.sorted().map { .init(modelId:$0,enabled:true) } + (existing?.models.filter {!enabled.contains($0.modelId)}.map { .init(modelId:$0.modelId,enabled:false) } ?? []) }
            _ = try await app?.assistantClient.writeModelService(value,id:existing?.id)
            guard ticket == identity else { return false };await load(force:true);return true
        } catch { if ticket == identity { notice="模型服务没能保存，请检查地址和密钥后重试。" };return false }
    }
    func remove(_ service: ModelService) async {
        let ticket=identity
        do {
            #if os(iOS)
            if let phone { phone.removeService(service);services=phone.services;return }
            #endif
            try await app?.assistantClient.removeModelService(service);guard ticket == identity else { return };await load(force:true)
        } catch { if ticket == identity { notice="模型服务没能删除，请重试。" } }
    }
}
struct ModelServicesSettingsView: View {
    @StateObject var store: ModelServiceSettingsModel
    @State private var editing: ModelService?
    @State private var editor=false
    @State private var removing: ModelService?
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:20) {
                Text("模型服务").font(AppleTokens.Fonts.title2.bold())
                Text("一个地址和密钥，就能选用这个服务的全部聊天模型。").foregroundStyle(Weave.muted)
                ForEach(store.services) { service in
                    VStack(alignment:.leading,spacing:12) {
                        Text(service.name).font(AppleTokens.Fonts.headline)
                        Text(service.baseUrl).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        Text("\(service.models.count) 个模型 · \(service.models.filter(\.enabled).count) 个显示在菜单里")
                        Text(service.catalog.message).font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                        if let checked=service.catalog.checkedAt { Text(HealthInputMath.parseISO(checked)?.formatted(date:.abbreviated,time:.shortened) ?? "").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted) }
                        Button("管理模型服务") { editing=service;editor=true }.buttonStyle(ServiceActionStyle()).accessibilityIdentifier("modelServices.edit."+service.id)
                    }.padding(16).background(Weave.surface,in:RoundedRectangle(cornerRadius:16))
                }
                Button("添加模型服务…") { editing=nil;editor=true }.buttonStyle(ServiceActionStyle(primary:true)).disabled(!store.canManage).accessibilityIdentifier("modelServices.new")
                if let notice=store.notice { Text(notice).foregroundStyle(Weave.muted) }
            }.padding(20)
        }.background(Weave.canvas).navigationTitle("模型服务").task { await store.load() }
            .sheet(isPresented:$editor) { NavigationStack { ModelServiceEditor(store:store,existing:editing,onClose:{editor=false}) } }
    }
}
struct ModelServiceEditor: View {
    @ObservedObject var store: ModelServiceSettingsModel
    var existing: ModelService?
    var onClose: () -> Void = {}
    @State private var name="MiMo"
    @State private var base="https://api.xiaomimimo.com/v1"
    @State private var type="openai-compatible"
    @State private var key=""
    @State private var manual=""
    @State private var selected: String?
    @State private var result: ModelCatalogResult?
    @State private var enabled=Set<String>()
    @State private var presets=false
    @State private var removing=false
    @State private var query=""
    @State private var queryTask: Task<Void,Never>?
    private var items: [ServiceModel] {
        var items=existing?.models ?? []
        for item in result?.models ?? [] { if !items.contains(where: {$0.modelId == item.modelId}) { items.append(item) } };return items
    }
    private var valid: Bool { !name.isEmpty && !base.isEmpty && (existing != nil || !key.isEmpty) && (!items.isEmpty || !manual.isEmpty) && (existing?.baseUrl == base || !key.isEmpty) }
    @MainActor private func queryModels() async {
        let capturedBase=base,capturedKey=key,capturedType=type,identity=store.identity
        let found=await store.check(existing:existing,base:capturedBase,key:capturedKey,type:capturedType)
        guard capturedBase == base,capturedKey == key,capturedType == type,identity == store.identity,!Task.isCancelled else { return }
        result=found;if selected == nil { selected=result?.models?.first?.modelId };enabled.formUnion(result?.models?.map(\.modelId) ?? [])
    }
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:16) {
                Button("选择预设或自定义") { presets.toggle() }.buttonStyle(ServiceActionStyle()).accessibilityIdentifier("modelServices.preset")
                if presets {
                    #if os(iOS)
                    ForEach(PhoneProviderPreset.values) { preset in ServiceMenuRow(title:preset.name) { name=preset.name;base=preset.baseURL;type="openai-compatible";key="";result=nil;presets=false } }
                    #endif
                    ServiceMenuRow(title:"Claude") { name="Claude";base="https://api.anthropic.com/v1";type="anthropic";key="";result=nil;presets=false }
                    ServiceMenuRow(title:"自定义") { name="自定义服务";base="";type="openai-compatible";result=nil;presets=false }
                }
                TextField("服务名称",text:$name).weaveField().accessibilityIdentifier("modelServices.name")
                TextField("服务地址",text:$base).weaveField().autocorrectionDisabled().accessibilityIdentifier("modelServices.address")
                SecureField(existing == nil ? "粘贴密钥" : "新密钥（留空保留原密钥）",text:$key).weaveField().accessibilityIdentifier("modelServices.key")
                Text("密钥保存在钥匙串或电脑的加密存储中。查询清单不会发送聊天消息。").font(AppleTokens.Fonts.caption).foregroundStyle(Weave.muted)
                Button(store.busy ? "正在查询…" : "查询模型清单") { Task { await queryModels() } }.buttonStyle(ServiceActionStyle()).disabled(store.busy || (key.isEmpty && (existing == nil || existing?.baseUrl != base)) || base.isEmpty).accessibilityIdentifier("modelServices.query")
                if let result { Text(result.message).font(AppleTokens.Fonts.callout).accessibilityIdentifier("modelServices.queryResult") }
                if !items.isEmpty {
                    Text("选择默认模型").font(AppleTokens.Fonts.headline)
                    TextField("搜索型号",text:$query).weaveField()
                    ForEach(items.filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) || $0.modelId.localizedCaseInsensitiveContains(query) }) { item in
                        VStack(spacing:0) {
                            ServiceMenuRow(title:item.name,selected:selected == item.modelId) { selected=item.modelId }.accessibilityIdentifier("modelServices.default."+item.modelId)
                            if existing != nil { ServiceSwitch(title:"在菜单里显示",enabled:Binding(get:{enabled.contains(item.modelId)},set:{value in if value { enabled.insert(item.modelId) } else { enabled.remove(item.modelId) }})) }
                        }
                    }
                }
                if result?.status != "available" || existing != nil {
                    TextField("手填一个型号",text:$manual).weaveField().autocorrectionDisabled().accessibilityIdentifier("modelServices.manual")
                }
                Button(existing == nil ? "完成并使用" : "保存") { Task { if await store.save(existing:existing,name:name,base:base,key:key,type:type,result:result,manual:manual,selected:selected,enabled:enabled) { key="";onClose() } } }.buttonStyle(ServiceActionStyle(primary:true)).disabled(!valid || store.busy).accessibilityIdentifier("modelServices.save")
                if let notice=store.notice { Text(notice).foregroundStyle(Weave.muted) }
                if existing != nil { Button("删除模型服务") { removing=true }.buttonStyle(ServiceActionStyle()).foregroundStyle(Weave.danger).accessibilityIdentifier("modelServices.delete") }
            }.padding(20)
        }.background(Weave.canvas).navigationTitle(existing == nil ? "添加模型服务" : "管理模型服务")
            .toolbar { ToolbarItem(placement:.cancellationAction) { Button("关闭") { key="";onClose() }.foregroundStyle(Weave.secondary) } }
            .onAppear { if let existing { name=existing.name;base=existing.baseUrl;type=existing.interfaceType;selected=existing.selectedModelId;enabled=Set(existing.models.filter(\.enabled).map(\.modelId)) } }
            .onChange(of:base) { _,_ in result=nil }
            .onChange(of:key) { _,_ in
                result=nil;queryTask?.cancel()
                guard !key.isEmpty,!base.isEmpty else { return }
                queryTask=Task { do { try await Task.sleep(for:.milliseconds(700)) } catch { return };await queryModels() }
            }
            .onDisappear { queryTask?.cancel();key="" }
            .confirmationDialog("删除这个模型服务？旧对话仍然保留。",isPresented:$removing,titleVisibility:.visible) { Button("删除",role:.destructive) { if let existing { Task { await store.remove(existing);onClose() } } };Button("取消",role:.cancel) {} }
    }
}
