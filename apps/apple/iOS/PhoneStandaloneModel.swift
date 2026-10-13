import SwiftUI
import WeftMateCore

@MainActor final class PhoneStandaloneModel: ObservableObject {
    @Published private(set) var state=PhoneChatState()
    @Published private(set) var models: [PhoneModelConfiguration]=[]
    @Published private(set) var library=PhoneModelLibrary()
    @Published var modelID=""
    @Published var thinkingEnabled=false
    @Published private(set) var queryingServices=Set<String>()
    var serviceIdentity: String { account }
    var services: [ModelService] { library.services.map(\.service) }
    var selectedServiceModel: ServiceModel? { services.flatMap(\.models).first { $0.matches(modelID) } }
    var conversationUsesImages: Bool { (messages.flatMap { $0.attachments ?? [] }+attachments).contains(where: \.isImage) }
    @Published var draft="" { didSet {
        guard store != nil else { return }
        if state.pending == nil { state.pending = .init() };state.pending?.text=draft
        do { try persist() } catch { notice="草稿没能保存，请检查手机存储。" }
    } }
    var attachments: [PhoneAttachment] { state.pending?.attachments ?? [] }
    var attachmentReason: String? { currentModel == nil ? "先配置手机模型，再添加图片或文件。" : busy ? "等回复结束后再添加附件。" : nil }
    func addAttachment(_ value: PhoneAttachment) {
        guard attachmentReason == nil else { notice=attachmentReason;return }
        if value.isImage && currentModel?.supportsImages == false { notice="当前模型看不了图片";return }
        guard attachments.filter({$0.isImage == value.isImage}).count < (value.isImage ? PhoneAttachment.imageCount : PhoneAttachment.fileCount) else { notice=PhoneAttachmentFailure.tooMany.message;return }
        var next=state;if next.pending == nil { next.pending = .init() };next.pending?.attachments.append(value)
        do { try save(next);notice=nil } catch { notice="附件没能保存，请检查手机存储。" }
    }
    func removeAttachment(_ id: String) {
        var next=state;next.pending?.attachments.removeAll {$0.id == id}
        do { try save(next) } catch { notice="附件没能移除，请重试。" }
    }
    @Published private(set) var busy=false
    @Published private(set) var testing=false
    @Published var notice: String?
    private weak var app: AppleAppModel?
    private var store: PhoneChatStore?
    private var account=""
    private var epoch=UUID()
    private var task: Task<Void,Never>?
    #if DEBUG
    @Published private(set) var diagnostic="idle"
    private func diagnose(_ stage: String) { if allowLoopback { diagnostic=stage; NSLog("APPLE6_DIAGNOSTIC %@ %@",stage,String(describing:ObjectIdentifier(self))) } }
    #else
    private func diagnose(_ stage: String) {}
    #endif
    @Published private(set) var extracting=false
    @Published private(set) var handoffCount=0
    @Published private(set) var handoffBytes=0
    @Published private(set) var handoffDeferred=false
    private var memoryEpoch=UUID()
    private var memoryTask: Task<Void,Never>?
    private var idleTask: Task<Void,Never>?
    private var idleDelay: Duration = .seconds(20)
    private var handoffApproved=false
    private var transferring=false
    var memory: PhoneMemoryState { state.memory ?? .init() }
    var usesPhoneMemory: Bool { !memory.handoffConfirmed }
    private func cancelExtraction() {
        memoryEpoch=UUID();memoryTask?.cancel();memoryTask=nil;idleTask?.cancel();idleTask=nil;extracting=false
    }
    func setMemoryEnabled(_ enabled: Bool) {
        cancelExtraction();var next=state;next.memory=memory;next.memory?.enabled=enabled
        do { try save(next) } catch { notice="设置没能保存，请重试。" }
    }
    private func save(_ next: PhoneChatState) throws {
        guard let store else { throw APIFailure.credentialStorage };try store.save(next);state=next
    }
    func saveMemory(id: String? = nil, text: String, pinned: Bool) throws {
        let text=text.trimmingCharacters(in:.whitespacesAndNewlines)
        guard usesPhoneMemory,!text.isEmpty,text.count <= 400,PhoneMemoryRules.safe(text) else { throw OfflineFailure.invalid }
        cancelExtraction();var next=state;next.memory=memory
        if let id {
            guard let index=next.memory?.items.firstIndex(where: { $0.id == id }) else { throw OfflineFailure.invalid }
            let sources=next.memory!.items[index].sourceIDs
            next.memory?.suppressedSources.formUnion(sources)
            let oldDigest=PhoneMemoryRules.digest(next.memory!.items[index].text)
            next.memory?.suppressedText.insert(oldDigest)
            next.memory?.items[index].text=text;next.memory?.items[index].pinned=pinned;next.memory?.items[index].updatedAt=Date()
        } else {
            guard memory.items.count < 200 else { throw OfflineFailure.invalid }
            next.memory?.suppressedText.remove(PhoneMemoryRules.digest(text))
            next.memory?.items.append(.init(text:text,pinned:pinned))
        }
        try save(next);notice=nil
    }
    func forgetMemory(_ id: String? = nil) {
        cancelExtraction();var next=state;next.memory=memory
        if let id { next.memory?.forget(id) } else { next.memory?.forgetAll(threads:state.threads) }
        do { try save(next);notice=nil } catch { notice="没能忘掉，请重试。" }
    }
    func deactivate() {
        stop();store=nil;account="";state = .init();library = .init();models=[];modelID="";draft="";queryingServices=[];notice=nil;handoffCount=0;handoffBytes=0
    }
    func clearLocalData() {
        cancelExtraction();stop()
        do { guard let store else { return };try store.clear();self.store=nil;app?.offline.erase();state = .init();library = .init();models=[];modelID="";draft="";self.store=store;notice=nil;handoffCount=0;handoffBytes=0 }
        catch { notice="手机上的内容没能清除，请重试。" }
    }
    /// Called only after a successful authenticated account directory read, never on a network failure.
    func computerDirectoryChanged(hostIDs: Set<String>) {
        guard let host=memory.computerHost,!hostIDs.contains(host) else { return }
        cancelExtraction();state.memory?.computerRemoved();handoffApproved=false;handoffCount=0;handoffBytes=0
        try? persist()
    }
    func handoffNow() { handoffDeferred=false;handoffApproved=true; if let app { Task { await synchronize(app:app) } } }
    func handoffLater() { handoffDeferred=true;handoffApproved=false }
    func finishConversation(_ id: String? = nil) {
        guard !extracting else { return }
        let requested=id ?? state.selected
        let candidate=state.threads.first { $0.id == requested && !memory.batch($0).isEmpty } ?? state.threads.first { !memory.batch($0).isEmpty }
        guard let candidate else { return }
        idleTask?.cancel()
        memoryTask=Task { await extractMemory(threadID:candidate.id) }
    }
    private func scheduleExtraction(_ id: String) {
        idleTask?.cancel();idleTask=Task { [weak self] in
            do { try await Task.sleep(for: self?.idleDelay ?? .seconds(20)) } catch { return }
            self?.finishConversation(id)
        }
    }
    func extractMemory(threadID: String) async {
        guard !Task.isCancelled,!extracting,!busy,memory.enabled,memory.computerHost == nil,
              let config=currentModel, let thread=state.threads.first(where: { $0.id == threadID }) else { return }
        let batch=memory.batch(thread);guard !batch.isEmpty else { return }
        let ticket=memoryEpoch,identity=account
        extracting=true
        defer { if ticket == memoryEpoch { extracting=false;memoryTask=nil } }
        do {
            var selection=memory
            let related=selection.select(query:batch.map(\.text).joined(separator:"\n"))
            let input:[String:Any]=["原话":batch.map { ["id":$0.id,"text":$0.text] },"已有记忆":related.map { ["id":$0.id,"text":$0.text] }]
            let data=try JSONSerialization.data(withJSONObject:input)
            let request=try config.request(messages:[["role":"system","content":PhoneMemoryRules.extractionPrompt],["role":"user","content":String(decoding:data,as:UTF8.self)]],stream:false,allowLoopback:allowLoopback,maxTokens:1200)
            let (responseData,response)=try await network.data(for:request)
            guard ticket == memoryEpoch,identity == account,app?.phoneAccountIdentity == identity,memory.enabled,memory.computerHost == nil,!Task.isCancelled else { return }
            guard let http=response as? HTTPURLResponse,(200...299).contains(http.statusCode),
                  let content=try config.responseText(responseData) else { throw OfflineFailure.model }
            var next=state;next.memory=memory
            try next.memory?.apply(content,batch:batch,threadID:threadID)
            guard let store else { return };try store.save(next);state=next
        } catch { /* Rebuildable memory must never interrupt chat. No watermark on failure. */ }
    }
    private let network: URLSession
    private let credentialsOverride: (any CredentialStore)?
    private let loopbackOverride: Bool
    init() {
        network=URLSession(configuration:.ephemeral,delegate:PhoneModelRedirectPolicy(),delegateQueue:nil)
        credentialsOverride=nil;loopbackOverride=false
    }
    #if DEBUG
    func seedAttachmentScreenshot() {
        guard ProcessInfo.processInfo.arguments.contains("--ui-testing"),ProcessInfo.processInfo.arguments.contains("--apple8-fixture") else { return }
        var thread=PhoneChatThread(),message=PhoneChatMessage(role:"user",text:draft);message.attachments=attachments
        thread.messages=[message,.init(role:"assistant",text:"这是一张合成色块图。虚构周报里完成了三件任务，下一步是整理资料。")]
        state.threads=[thread];state.selected=thread.id;state.pending = .init();draft="";try? persist()
    }
    init(testCredentials: any CredentialStore, testLoopback: Bool, idleDelay: Duration = .seconds(20)) {
        self.idleDelay=idleDelay
        network=URLSession(configuration:.ephemeral,delegate:PhoneModelRedirectPolicy(),delegateQueue:nil)
        credentialsOverride=testCredentials;loopbackOverride=testLoopback
    }
    #endif
    var messages: [PhoneChatMessage] { state.threads.first { $0.id == state.selected }?.messages ?? [] }
    var currentModel: PhoneModelConfiguration? {
        guard var value=models.first(where: { $0.id == modelID }) ?? models.first else { return nil }
        if value.deepThinking?.supported == true { value.thinkingEnabled=thinkingEnabled };return value
    }
    private var allowLoopback: Bool {
        #if DEBUG
        loopbackOverride || (ProcessInfo.processInfo.arguments.contains("--ui-testing") && ProcessInfo.processInfo.arguments.contains("--apple6-fixture"))
        #else
        false
        #endif
    }
    func activate(app: AppleAppModel) {
        self.app=app
        let identity=app.phoneAccountIdentity
        guard account != identity || store == nil else { return }
        diagnose("activate");cancelExtraction();handoffCount=0;handoffBytes=0;handoffApproved=false;stop(); epoch=UUID(); account=identity; store=nil; state = .init(); library = .init(); models=[]; modelID=""; draft=""; notice=nil
        do {
            let next=try PhoneChatStore(account:identity,directory:app.healthStateDirectory.deletingLastPathComponent().appendingPathComponent("PhoneChats"),credentials:credentialsOverride ?? KeychainCredentialStore(service:app.phoneCredentialNamespace))
            state=try next.load();store=next
            do { library=try next.loadLibrary();models=library.services.flatMap(\.configurations);modelID=library.selectedProfileId ?? models.first?.id ?? "" }
            catch { models=try next.loadModels();library=(try? PhoneModelLibrary.migrate(models)) ?? .init();modelID=models.first?.id ?? "";notice="旧模型仍可使用，模型服务整理暂未完成，稍后再试。" }
            draft=state.pending?.text ?? ""
        } catch { notice="手机上的内容暂时打不开，请重试。" }
    }
    func synchronize(app: AppleAppModel) async {
        guard !transferring, !busy, app.session?.verification == .verified,
              let host=app.session?.hostId, let subject=app.cloudLogin.subject, app.cloudLogin.authenticated else { return }
        activate(app:app)
        transferring=true;let ticket=epoch
        defer { transferring=false }
        do {
            let control=try await app.offlineAuthorization(host)
            guard ticket == epoch, account == app.phoneAccountIdentity, !busy else { return }
            guard control.authorized,control.hostId == host,control.accountId == subject else { return }
            let generation=control.generation
            state.applyMigrationGeneration(host:host,generation:generation)
            state.acknowledgeMigration(host:host,ids:app.offline.synced)
            try persist()
            guard app.offline.ready,!app.offline.hostOffline,app.offline.generation == generation else { return }
            // Readiness is the authenticated M3-A snapshot + matching cloud authorization.
            if memory.computerHost != host { cancelExtraction();state.memory=memory;state.memory?.computerHost=host;state.memory?.handoffConfirmed=false;try persist() }
            let pending=state.prepareMigration(host:host,generation:generation);try persist()
            handoffCount=pending.count;handoffBytes=pending.reduce(0) { $0+$1.messages.reduce(0) { $0+$1.text.utf8.count } }
            if pending.isEmpty {
                state.memory?.confirmHandoff();try persist();handoffCount=0;handoffBytes=0
            } else if (pending.count >= 100 || handoffBytes >= 256*1024),!handoffApproved { return }
            if pending.contains(where: { $0.messages.contains { $0.text.utf16.count > 16384 } }) {
                notice="有一段对话比较长，电脑更新后会继续接过来。这里的对话和记住的事仍然保留。";return
            }
            if !pending.isEmpty { try app.offline.enqueuePhoneTurns(pending,generation:generation) }
        } catch { if ticket == epoch { notice="手机上的对话仍在这里，电脑准备好后会自动同步。" } }
    }
    private func authorizeTransferredHistory(ticket: UUID) async throws {
        guard let app else { return }
        if memory.handoffConfirmed {
            try await app.offline.authorizeMemory(control:app.offlineAuthorization)
            guard ticket == epoch,account == app.phoneAccountIdentity else { throw OfflineFailure.authorization }
        }
        guard let migrations=state.migrations,!migrations.isEmpty else { return }
        let subject=app.cloudLogin.subject
        for (host,migration) in migrations where migration.conversationIDs.contains(state.selected ?? "") {
            let control=try await app.offlineAuthorization(host)
            guard ticket == epoch,account == app.phoneAccountIdentity,control.authorized,control.accountId == subject,control.hostId == host else { throw OfflineFailure.authorization }
            if migration.generation != control.generation {
                state.applyMigrationGeneration(host:host,generation:control.generation);try persist();throw OfflineFailure.authorization
            }
        }
    }
    private func saveLibrary(_ next: PhoneModelLibrary) throws {
        guard let store else { throw APIFailure.credentialStorage };try store.saveLibrary(next)
        library=next;models=next.services.flatMap(\.configurations);modelID=next.selectedProfileId ?? models.first?.id ?? ""
    }
    func selectServiceModel(_ service: ModelService,_ model: ServiceModel) {
        guard model.enabled else { return }
        var next=library
        guard let i=next.services.firstIndex(where: {$0.service.id == service.id}),let m=next.services[i].service.models.firstIndex(where: {$0.modelId == model.modelId}) else { return }
        next.services[i].service.selectedModelId=model.modelId
        next.services[i].service.models[m].lastUsedAt=ISO8601DateFormatter().string(from:Date())
        next.selectedProfileId=model.profileId ?? service.id+":"+model.modelId
        do { try saveLibrary(next);thinkingEnabled=false } catch { notice="模型选择没能保存，请重试。" }
    }
    func queryService(baseUrl: String,apiKey: String,interfaceType: String) async -> ModelCatalogResult {
        let ticket=epoch,identity=account
        let result=await ModelCatalog.query(baseUrl:baseUrl,apiKey:apiKey,interfaceType:interfaceType,network:network,allowLoopback:allowLoopback)
        guard ticket == epoch,identity == account else { return .init(status:"failed") };return result
    }
    func refreshService(_ service: ModelService,force: Bool = false) async {
        guard !queryingServices.contains(service.id),(force || service.catalog.needsRefresh),let value=library.services.first(where: {$0.service.id == service.id}) else { return }
        let ticket=epoch,identity=account;queryingServices.insert(service.id)
        defer { if ticket == epoch { queryingServices.remove(service.id) } }
        let result=await queryService(baseUrl:value.service.baseUrl,apiKey:value.apiKey,interfaceType:value.service.interfaceType)
        guard ticket == epoch,identity == account,var updated=library.services.first(where: {$0.service.id == service.id}) else { return }
        updated.service.catalog=result
        if result.status == "available" {
            for var item in result.models ?? [] {
                if let old=updated.service.models.first(where: {$0.modelId == item.modelId}) { item.profileId=old.profileId;item.profileIds=old.profileIds;item.enabled=old.enabled;item.lastUsedAt=old.lastUsedAt }
                else { item.profileId=service.id+":"+item.modelId }
                if let i=updated.service.models.firstIndex(where: {$0.modelId == item.modelId}) { updated.service.models[i]=item } else { updated.service.models.append(item) }
            }
        }
        var next=library;next.services.removeAll {$0.service.id == service.id};next.services.append(updated)
        do { try saveLibrary(next) } catch { notice="模型清单没能保存，请重试。" }
    }
    func saveService(existing: ModelService?,name: String,baseUrl: String,apiKey: String,interfaceType: String,result: ModelCatalogResult?,manual: String,selected: String?,enabled: Set<String>?) throws {
        guard store != nil else { throw APIFailure.credentialStorage }
        let old=library.services.first {$0.service.id == existing?.id}
        let base=try ModelCatalog.normalizedURL(baseUrl,allowLoopback:allowLoopback).absoluteString
        guard old?.service.baseUrl == base || !apiKey.isEmpty else { throw OfflineFailure.model }
        let secret=apiKey.isEmpty ? old?.apiKey ?? "" : apiKey
        guard !secret.isEmpty else { throw OfflineFailure.model }
        var value=old ?? PhoneModelService(service:.init(name:name,baseUrl:base,interfaceType:interfaceType),apiKey:secret)
        value.apiKey=secret;value.service.name=name;value.service.baseUrl=base;value.service.interfaceType=interfaceType
        if let result { value.service.catalog=result }
        for var item in result?.models ?? [] {
            if let previous=value.service.models.first(where: {$0.modelId == item.modelId}) { item.profileId=previous.profileId;item.profileIds=previous.profileIds;item.enabled=previous.enabled }
            else { item.profileId=value.service.id+":"+item.modelId }
            if let i=value.service.models.firstIndex(where: {$0.modelId == item.modelId}) { value.service.models[i]=item } else { value.service.models.append(item) }
        }
        let manual=manual.trimmingCharacters(in:.whitespacesAndNewlines)
        if !manual.isEmpty,!value.service.models.contains(where: {$0.modelId == manual}) { var item=ServiceModel(modelId:manual,profileId:value.service.id+":"+manual);item.manual=true;value.service.models.append(item) }
        if let enabled { for i in value.service.models.indices { value.service.models[i].enabled=enabled.contains(value.service.models[i].modelId) } }
        guard !value.service.models.isEmpty else { throw OfflineFailure.model }
        let chosen=selected ?? (!manual.isEmpty ? manual : value.service.selectedModelId) ?? value.service.models.first?.modelId
        value.service.selectedModelId=chosen;value.service.revision += 1
        var next=library;next.services.removeAll {$0.service.id == value.service.id};next.services.append(value)
        if existing == nil,let item=value.service.models.first(where: {$0.modelId == chosen}) { next.selectedProfileId=item.profileId }
        try saveLibrary(next)
    }
    func removeService(_ service: ModelService) {
        do {
            var next=library;next.services.removeAll {$0.service.id == service.id}
            if !next.services.flatMap(\.configurations).contains(where: {$0.id == next.selectedProfileId}) { next.selectedProfileId=next.services.flatMap(\.configurations).first?.id }
            try saveLibrary(next)
        } catch { notice="模型服务没能删除，请重试。" }
    }
    func saveModel(_ value: PhoneModelConfiguration) throws {
        guard let store else { throw APIFailure.credentialStorage }
        var next=models; next.removeAll { $0.id == value.id }; next.append(value)
        try store.saveModels(next);try saveLibrary(PhoneModelLibrary.migrate(next));modelID=value.id
    }
    func removeModel(_ id: String) {
        if currentModel?.id == id { stop() }
        do { guard let store else { return }; let next=models.filter { $0.id != id }; try store.saveModels(next);try saveLibrary(PhoneModelLibrary.migrate(next));modelID=next.first?.id ?? "" }
        catch { notice="模型没能删除，请重试。" }
    }
    func test(_ value: PhoneModelConfiguration) async -> Bool {
        guard !testing else { return false }; diagnose("test-start"); testing=true; notice=nil; let ticket=epoch
        defer { if epoch == ticket { testing=false } }
        do {
            let r=try value.request(messages:[["role":"user","content":"请只回复：你好。"]],stream:false,allowLoopback:allowLoopback)
            diagnose("test-request");let (data,response)=try await network.data(for:r)
            guard ticket == epoch, !Task.isCancelled else { diagnose("test-stale");return false }
            guard let status=response as? HTTPURLResponse,(200...299).contains(status.statusCode),
                  let object=try JSONSerialization.jsonObject(with:data) as? [String:Any],let choices=object["choices"] as? [[String:Any]],
                  let message=choices.first?["message"] as? [String:Any],let content=message["content"] as? String,!content.isEmpty else { throw OfflineFailure.model }
            diagnose("test-success");notice="连接成功，可以保存并开始聊天。"; return true
        } catch { diagnose("test-failed");if ticket == epoch { notice="连接没成功，请核对地址、模型名称和密钥。" }; return false }
    }
    private func persist() throws { guard let store else { throw APIFailure.credentialStorage }; try store.save(state) }
    func newThread() { guard !busy else { return }; finishConversation(); let thread=PhoneChatThread(); state.threads.append(thread); state.selected=thread.id; do { try persist() } catch { notice="对话没能保存，请重试。" } }
    func select(_ id: String) { guard !busy else { return }; finishConversation(); state.selected=id; do { try persist() } catch { notice="对话没能保存，请重试。" } }
    func stop() { cancelExtraction();let wasBusy=busy; epoch=UUID(); task?.cancel(); task=nil; busy=false; testing=false; if wasBusy { notice="已停止，已收到的内容保留。" } }
    func send(regenerate: Bool = false) {
        guard !busy, let model=currentModel else { return }
        cancelExtraction()
        let originalState=state
        let text=draft.trimmingCharacters(in:.whitespacesAndNewlines)
        let pendingAttachments=attachments
        if !regenerate,pendingAttachments.contains(where: \.isImage),model.supportsImages == false { notice="当前模型看不了图片";return }
        guard regenerate || !text.isEmpty || !pendingAttachments.isEmpty else { return }
        guard regenerate || text.utf16.count <= 16384 else { notice="消息太长，请分几次发送。";return }
        if state.selected == nil { newThread() }
        guard let index=state.threads.firstIndex(where: { $0.id == state.selected }) else { return }
        if regenerate {
            if state.threads[index].messages.last?.role == "assistant" { state.threads[index].messages.removeLast() }
            guard state.threads[index].messages.last?.role == "user" else { return }
        } else {
            var message=PhoneChatMessage(role:"user",text:text);message.attachments=pendingAttachments
            state.threads[index].messages.append(message)
        }
        let threadID=state.threads[index].id, ticket=epoch
        let history=Array(state.threads[index].messages.suffix(20))
        let hasImages=history.contains { ($0.attachments ?? []).contains(where: \.isImage) }
        state.threads[index].messages.append(.init(role:"assistant",text:"")); let replyID=state.threads[index].messages.last!.id
        do { try persist() } catch { state=originalState;notice="对话未保存，请检查手机存储后重试。"; return }
        state.pending = .init();draft=""; busy=true; notice=nil
        task=Task {
            defer { if ticket == epoch { busy=false; task=nil;scheduleExtraction(threadID) } }
            do {
                try await authorizeTransferredHistory(ticket:ticket)
                try Task.checkCancellation();guard ticket == epoch else { return }
                state.memory=memory
                let selected=usesPhoneMemory ? state.memory!.select(query:text.isEmpty ? history.last?.text ?? "" : text) : []
                try persist()
                let computerItems=memory.handoffConfirmed ? OfflineReplica.recall(app?.offline.memoryItems ?? [],query:text) : []
                if let t=state.threads.firstIndex(where: { $0.id == threadID }),let m=state.threads[t].messages.firstIndex(where: { $0.id == replyID }) {
                    let refs=computerItems.map { OfflineMemoryRef(kind:$0.kind,id:$0.id) }
                    // Prior replies can carry memory dependencies even when recall did not select them again.
                    let inherited=state.threads[t].messages.suffix(21).flatMap { $0.memoryRefs ?? [] }
                    let all=Set(refs+inherited).sorted { $0.kind+$0.id < $1.kind+$1.id }
                    state.threads[t].messages[m].memoryRefs=Array(all.prefix(64))
                    state.threads[t].messages[m].dependencyComplete=all.count <= 64 && state.threads[t].messages.suffix(21).allSatisfy { $0.dependencyComplete != false }
                    try persist()
                }
                let context=usesPhoneMemory ? selected.map { ($0.text,Array($0.sourceIDs.sorted().prefix(3))) } : computerItems.map { ($0.text,$0.sources.map(\.id)) }
                let system=PhoneMemoryContext.prompt(context,computerOffline:app?.offline.hostOffline == true)
                let request=try model.attachmentRequest(messages:history,system:system,stream:true,allowLoopback:allowLoopback)
                let (bytes,response)=try await network.bytes(for:request)
                guard let http=response as? HTTPURLResponse else { throw OfflineFailure.model }
                if !(200...299).contains(http.statusCode) {
                    var reason=""
                    for try await line in bytes.lines { reason += line;if reason.utf8.count >= 8192 { break } }
                    if hasImages,PhoneAttachmentFailure.isVisionRejection(status:http.statusCode,body:reason) { throw PhoneAttachmentFailure.vision }
                    throw OfflineFailure.model
                }
                for try await line in bytes.lines {
                    try Task.checkCancellation(); guard ticket == epoch else { return }
                    if line.hasPrefix("data:"),line.dropFirst(5).trimmingCharacters(in:.whitespaces) == "[DONE]" { break }
                    if hasImages,line.contains("\"error\""),PhoneAttachmentFailure.isVisionRejection(status:400,body:line) { throw PhoneAttachmentFailure.vision }
                    if let delta=try model.streamText(line),let t=state.threads.firstIndex(where: { $0.id == threadID }),let m=state.threads[t].messages.firstIndex(where: { $0.id == replyID }) {
                        state.threads[t].messages[m].text += delta; try persist()
                    }
                }
                try await authorizeTransferredHistory(ticket:ticket)
                if ticket == epoch, messages.last?.text.isEmpty == true { throw OfflineFailure.model }
            } catch {
                guard ticket == epoch else { return }
                if !regenerate, !pendingAttachments.isEmpty,
                   let t=state.threads.firstIndex(where: {$0.id == threadID}),
                   state.threads[t].messages.last?.id == replyID, state.threads[t].messages.last?.text.isEmpty == true {
                    state.threads[t].messages.removeLast();state.threads[t].messages.removeLast()
                    state.pending = .init();state.pending?.attachments=pendingAttachments;draft=[text,draft].filter {!$0.isEmpty}.joined(separator:"\n")
                    try? persist()
                }
                notice=(error as? PhoneAttachmentFailure)?.message ?? (Task.isCancelled ? "已停止，已收到的内容保留。" : "回复中断，已收到的内容保留，可以重新生成。")
            }
        }
    }
}

private final class PhoneModelRedirectPolicy: NSObject, URLSessionTaskDelegate, Sendable {
    nonisolated func urlSession(_ session: URLSession,task: URLSessionTask,willPerformHTTPRedirection response: HTTPURLResponse,newRequest request: URLRequest,completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}
