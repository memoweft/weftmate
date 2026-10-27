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
        guard store != nil, draft != oldValue else { return }
        draftTask?.cancel()
        draftTask=Task { [weak self] in
            do { try await Task.sleep(for:.milliseconds(300)) } catch { return }
            do { try self?.persist() } catch { self?.notice="草稿没能保存，请检查本机存储。" }
        }
    } }
    private var draftTask: Task<Void,Never>?
    private var queuedModels: [String:PhoneModelConfiguration]=[:]
    private var replyTimeout: TimeInterval=120
    var attachments: [PhoneAttachment] { state.pending?.attachments ?? [] }
    var attachmentReason: String? { currentModel == nil ? "先配置模型，再添加图片或文件。" : busy ? "等回复结束后再添加附件。" : nil }
    func addAttachment(_ value: PhoneAttachment) {
        guard attachmentReason == nil else { notice=attachmentReason;return }
        if value.isImage && currentModel?.supportsImages == false { notice="当前模型看不了图片";return }
        guard attachments.filter({$0.isImage == value.isImage}).count < (value.isImage ? PhoneAttachment.imageCount : PhoneAttachment.fileCount) else { notice=PhoneAttachmentFailure.tooMany.message;return }
        var next=state;if next.pending == nil { next.pending = .init() };next.pending?.attachments.append(value);next.pending?.text=draft
        do { try save(next);notice=nil } catch { notice="附件没能保存，请检查本机存储。" }
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
    @Published private(set) var handoffCount=0
    @Published private(set) var handoffBytes=0
    @Published private(set) var handoffDeferred=false
    private var handoffApproved=false
    private var transferring=false
    var handoffHost: String? { state.transcriptSync?.hostID }
    func permitsComputerReplica(_ host: String) -> Bool { state.transcriptSync?.removedHostIDs?.contains(host) != true }
    private var hasComputerReplica: Bool {
        guard let app,account == app.phoneAccountIdentity,let host=app.session?.hostId ?? app.offline.memoryHostID,
              let subject=app.cloudLogin.subject,app.cloudLogin.authenticated else { return false }
        return permitsComputerReplica(host) && app.offline.memoryHostID == host && app.offline.memoryAccountID == subject
    }
    var computerMemory: [OfflineMemory] {
        guard hasComputerReplica else { return [] }
        return app?.offline.memoryItems ?? []
    }
    func containsConversation(_ id: String?) -> Bool { state.threads.contains { $0.id == id } }
    func showsLocalConversation(connected: Bool, openedSessionID: String?) -> Bool {
        !connected || containsConversation(openedSessionID)
    }
    private func save(_ next: PhoneChatState) throws {
        guard let store else { throw APIFailure.credentialStorage };try store.save(next);state=next
    }
    func deactivate() {
        stop();store=nil;account="";state = .init();library = .init();models=[];modelID="";draft="";queryingServices=[];notice=nil;handoffCount=0;handoffBytes=0
    }
    func clearLocalData() {
        stop()
        do { guard let store else { return };try store.clear();self.store=nil;app?.offline.erase();state = .init();library = .init();models=[];modelID="";draft="";self.store=store;state.cancelReminder(.account);try persist();notice=nil;handoffCount=0;handoffBytes=0 }
        catch { notice="本机内容没能清除，请重试。" }
    }
    /// Called only after a successful authenticated account directory read, never on a network failure.
    func computerDirectoryChanged(hostIDs: Set<String>) {
        if let removed=state.transcriptSync?.removedHostIDs,!removed.isDisjoint(with:hostIDs) {
            state.transcriptSync?.removedHostIDs=removed.subtracting(hostIDs);try? persist()
        }
        let known=Set((state.computerReminders ?? [:]).keys).union((state.reminderReads ?? [:]).keys).union((state.migrations ?? [:]).keys).union([handoffHost,app?.offline.replicaHostID].compactMap { $0 })
        for host in known where !hostIDs.contains(host) { computerRemoved(host);app?.removeComputerReplica(host) }
    }
    func computerRemoved(_ host: String) {
        guard state.transcriptSync?.removedHostIDs?.contains(host) != true else { return }
        state.invalidateComputerMemory(host:host,removedIDs:[],reset:true)
        state.transcriptSync?.removedHostIDs=(state.transcriptSync?.removedHostIDs ?? []).union([host])
        if handoffHost == host { state.transcriptSync?.hostID=nil }
        stop();handoffApproved=false;handoffCount=0;handoffBytes=0
        do { try persist() } catch { notice="电脑副本清理暂未保存，请重试。" }
    }
    /// Apply durable replica erasures even while a streamed answer is in progress.
    func refreshComputerMemory() throws {
        guard let app else { return }
        guard account == app.phoneAccountIdentity else { activate(app:app);throw OfflineFailure.authorization }
        guard let erasure=app.offline.memoryErasure else { return }
        do {
            if state.applyReplicaErasure(erasure) { stop();try persist() }
            try app.offline.acknowledgeMemoryErasure(erasure.id)
        } catch { state.replicaErasures?[erasure.hostID]=nil;throw error }
    }
    func handoffNow() { handoffDeferred=false;handoffApproved=true; if let app { Task { await synchronize(app:app) } } }
    func handoffLater() { handoffDeferred=true;handoffApproved=false }
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
    init(testCredentials: any CredentialStore, testLoopback: Bool, replyTimeout: TimeInterval = 120) {
        self.replyTimeout=replyTimeout
        network=URLSession(configuration:.ephemeral,delegate:PhoneModelRedirectPolicy(),delegateQueue:nil)
        credentialsOverride=testCredentials;loopbackOverride=testLoopback
    }
    #endif
    var messages: [PhoneChatMessage] { state.threads.first { $0.id == state.selected }?.messages ?? [] }
    /// Only an unstarted slot can be withdrawn. Persist the edit before publishing it.
    func withdrawQueued(_ id: String, edit: Bool) {
        var next=state
        guard let user=next.withdrawQueuedReply(id) else { return }
        if edit {
            guard draft.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty, attachments.isEmpty else {
                notice="先发送或清空当前草稿，再修改排队消息。"; return
            }
            if next.pending == nil { next.pending = .init() }
            next.pending?.text=user.text; next.pending?.attachments=user.attachments ?? []
        }
        do {
            try save(next); queuedModels.removeValue(forKey:id)
            if edit { draft=user.text }
        } catch { notice="排队消息没有改动，请重试。" }
    }
    var currentModel: PhoneModelConfiguration? {
        guard var value=models.first(where: { $0.id == modelID }) ?? models.first else { return nil }
        if value.deepThinking?.supported == true { value.thinkingEnabled=thinkingEnabled };return value
    }
    private var allowLoopback: Bool {
        #if DEBUG
        loopbackOverride || (ProcessInfo.processInfo.arguments.contains("--ui-testing") &&
            (ProcessInfo.processInfo.arguments.contains("--apple6-fixture") ||
             (Bundle.main.bundleIdentifier == AppleStorageProfile.windowBundleID && ProcessInfo.processInfo.arguments.contains("--phone-window-chat-fixture"))))
        #else
        false
        #endif
    }
    func activate(app: AppleAppModel) {
        self.app=app
        let identity=app.phoneAccountIdentity
        guard account != identity || store == nil else { return }
        diagnose("activate");handoffCount=0;handoffBytes=0;handoffApproved=false;handoffDeferred=false;stop(); epoch=UUID(); account=identity; store=nil; state = .init(); library = .init(); models=[]; modelID=""; draft=""; notice=nil
        do {
            let next=try PhoneChatStore(account:identity,directory:app.healthStateDirectory.deletingLastPathComponent().appendingPathComponent("PhoneChats"),credentials:credentialsOverride ?? KeychainCredentialStore(service:app.phoneCredentialNamespace))
            state=try next.load();store=next;state.interruptReplies()
            do { library=try next.loadLibrary();models=library.services.flatMap(\.configurations);modelID=library.threadSelections?[state.selected ?? ""] ?? library.selectedProfileId ?? models.first?.id ?? "" }
            catch { models=try next.loadModels();library=(try? PhoneModelLibrary.migrate(models)) ?? .init();modelID=models.first?.id ?? "";notice="旧模型仍可使用，模型服务整理暂未完成，稍后再试。" }
            draft=state.pending?.text ?? "";draftTask?.cancel();draftTask=nil;try persist()
        } catch { notice="本机内容暂时打不开，请重试。" }
    }
    func synchronize(app: AppleAppModel) async {
        activate(app:app)
        do { try refreshComputerMemory() } catch { notice="电脑副本清理暂未保存，请重试。";return }
        guard !transferring, !busy, app.session?.verification == .verified,
              let host=app.session?.hostId,permitsComputerReplica(host), let subject=app.cloudLogin.subject, app.cloudLogin.authenticated else { return }
        transferring=true;let ticket=epoch
        defer { transferring=false }
        do {
            let control=try await app.offlineAuthorization(host)
            guard ticket == epoch, account == app.phoneAccountIdentity, !busy else { return }
            guard control.authorized,control.hostId == host,control.accountId == subject else { return }
            let generation=control.generation
            state.applyMigrationGeneration(host:host,generation:generation)
            if app.offline.memoryHostID == host,app.offline.memoryAccountID == subject {
                state.acknowledgeMigration(host:host,generation:app.offline.generation ?? -1,ids:app.offline.synced)
            }
            try persist()
            guard app.offline.memoryHostID == host,app.offline.memoryAccountID == subject,
                  !app.offline.hostOffline,app.offline.generation == generation,app.offline.memoryAuthorityReady else { return }
            // Readiness is the authenticated M3-A snapshot + matching cloud authorization.
            if handoffHost != host { if state.transcriptSync == nil { state.transcriptSync = .init() };state.transcriptSync?.hostID=host;try persist() }
            let pending=state.prepareMigration(host:host,generation:generation);try persist()
            handoffCount=pending.count;handoffBytes=state.migrations?[host]?.handover?.bytes ?? 0
            if pending.isEmpty {
                handoffCount=0;handoffBytes=0;handoffApproved=false;handoffDeferred=false
            } else if (pending.count >= 100 || handoffBytes >= 256*1024),!handoffApproved { return }
            if !pending.isEmpty,let migration=state.migrations?[host] {
                let ids=Set(migration.handoverTurnIDs ?? pending.map(\.id))
                try app.offline.enqueuePhoneTurns(migration.turns.filter { ids.contains($0.id) },generation:generation,handover:migration.handover)
            }
        } catch { if ticket == epoch { notice="本机对话仍在这里，电脑准备好后会自动同步。" } }
    }
    private func authorizeTransferredHistory(ticket: UUID) async throws {
        guard let app else { return }
        try refreshComputerMemory()
        if hasComputerReplica {
            // A cloud outage locks the replica, while the configured phone model remains usable.
            do { try await app.offline.authorizeMemory(control:app.offlineAuthorization) }
            catch { try refreshComputerMemory() }
        }
        guard ticket == epoch,account == app.phoneAccountIdentity else { throw OfflineFailure.authorization }
        if let host=app.offline.memoryHostID,let generation=app.offline.generation,
           let migration=state.migrations?[host],migration.generation != generation {
            state.applyMigrationGeneration(host:host,generation:generation);stop();try persist();throw OfflineFailure.authorization
        }
    }
    private func saveLibrary(_ next: PhoneModelLibrary) throws {
        guard let store else { throw APIFailure.credentialStorage };try store.saveLibrary(next)
        library=next;models=next.services.flatMap(\.configurations);modelID=next.threadSelections?[state.selected ?? ""] ?? next.selectedProfileId ?? models.first?.id ?? ""
    }
    func selectServiceModel(_ service: ModelService,_ model: ServiceModel) {
        guard model.enabled else { return }
        var next=library
        guard let i=next.services.firstIndex(where: {$0.service.id == service.id}),let m=next.services[i].service.models.firstIndex(where: {$0.modelId == model.modelId}) else { return }
        next.services[i].service.selectedModelId=model.modelId
        next.services[i].service.models[m].lastUsedAt=ISO8601DateFormatter().string(from:Date())
        if let priorDefault=next.selectedProfileId {
            if next.threadSelections == nil { next.threadSelections=[:] }
            for thread in state.threads where next.threadSelections?[thread.id] == nil { next.threadSelections?[thread.id]=priorDefault }
        }
        next.selectedProfileId=model.profileId ?? service.id+":"+model.modelId
        if let selected=state.selected { if next.threadSelections == nil { next.threadSelections=[:] };next.threadSelections?[selected]=next.selectedProfileId }
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
        if let enabled { for i in value.service.models.indices { value.service.models[i].enabled=enabled.contains(value.service.models[i].modelId) || value.service.models[i].modelId == manual } }
        guard !value.service.models.isEmpty else { throw OfflineFailure.model }
        let chosen=selected ?? (!manual.isEmpty ? manual : value.service.selectedModelId) ?? ModelCatalog.recommendedModel(value.service.models)
        value.service.selectedModelId=chosen;value.service.revision += 1
        var next=library;next.services.removeAll {$0.service.id == value.service.id};next.services.append(value)
        if existing == nil,let item=value.service.models.first(where: {$0.modelId == chosen}) { next.selectedProfileId=item.profileId }
        try saveLibrary(next)
    }
    func removeService(_ service: ModelService) {
        do {
            var next=library;next.services.removeAll {$0.service.id == service.id}
            if !next.services.flatMap(\.configurations).contains(where: {$0.id == next.selectedProfileId}) { next.selectedProfileId=next.services.flatMap(\.configurations).first?.id }
            let available=Set(next.services.flatMap(\.configurations).map(\.id));next.threadSelections=next.threadSelections?.filter { available.contains($0.value) }
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
    private func persist() throws {
        guard let store else { throw APIFailure.credentialStorage }
        if state.pending?.text != draft {
            var next=state;if next.pending == nil { next.pending = .init() };next.pending?.text=draft;state=next
        }
        try store.save(state)
    }
    func newThread() {
        guard !busy else { return }
        let thread=PhoneChatThread();state.threads.append(thread);state.selected=thread.id
        do {
            try persist();var next=library
            if let chosen=next.selectedProfileId { if next.threadSelections == nil { next.threadSelections=[:] };next.threadSelections?[thread.id]=chosen }
            try saveLibrary(next);thinkingEnabled=false
        } catch { notice="对话或模型选择没能保存，请重试。" }
    }
    func select(_ id: String) {
        guard !busy else { return };state.selected=id
        modelID=library.threadSelections?[id] ?? library.selectedProfileId ?? models.first?.id ?? "";thinkingEnabled=false
        do { try persist() } catch { notice="对话没能保存，请重试。" }
    }
    func stop() {
        draftTask?.cancel();let wasBusy=busy,unsavedDraft=state.pending?.text != draft
        epoch=UUID();task?.cancel();task=nil
        state.interruptReplies();queuedModels=[:];busy=false;testing=false
        if store != nil,wasBusy || unsavedDraft { try? persist() }
        if wasBusy { notice="已停止，已收到的内容保留。" }
    }
    var reminders: [LocalReminder] { state.reminders ?? [] }
    var allReminders: [LocalReminder] {
        let computers=state.computerReminders ?? [:]
        return reminders + computers.keys.sorted().flatMap { computers[$0] ?? [] }
    }
    func saveReminder(id: String? = nil, text: String, date: Date) throws {
        var next=state
        let row=LocalReminder(id:id ?? UUID().uuidString,text:text,fireAt:date,sessionID:state.selected)
        if let index=next.reminders?.firstIndex(where: { $0.id == row.id }) {
            var updated=row; updated.sessionID=next.reminders?[index].sessionID; next.reminders?[index]=updated
        } else { if next.reminders == nil { next.reminders=[] };next.reminders?.append(row) }
        try save(next)
    }
    func finishReminder(_ id: String, delete: Bool) throws {
        var next=state
        next.cancelReminder(.reminder(id:id,hostID:nil))
        if delete { next.reminders?.removeAll { $0.id == id } }
        else if let index=next.reminders?.firstIndex(where: { $0.id == id }) { next.reminders?[index].completed=true }
        try save(next)
    }
    var reminderSnapshotAccount: String? { store == nil ? nil : account }
    var reminderCancellations: [ReminderCancellation] { state.reminderCancellations ?? [] }
    var pausedReminderCancellations: [ReminderCancellation] {
        (state.pausedReminderIDs ?? [:]).flatMap { host,ids in ids.map { ReminderCancellation(.reminder(id:$0,hostID:host)) } }
    }
    func acknowledgeReminderCancellations(_ ids: Set<UUID>) throws {
        guard !ids.isEmpty else { return };var next=state;next.acknowledgeReminderCancellations(ids);try save(next)
    }
    func beginReminderRead(hostID: String) -> ReminderReadToken { state.beginReminderRead(hostID:hostID) }
    @discardableResult func receiveReminders(_ rows: [ManagedSchedule], hostID: String, read: ReminderReadToken) throws -> Bool {
        var next=state
        guard next.receiveReminders(rows,hostID:hostID,read:read) else { return false }
        if next.computerReminders != state.computerReminders || next.reminderCancellations != state.reminderCancellations || next.pausedReminderIDs != state.pausedReminderIDs { try save(next) }
        return true
    }
    func withdrawComputerReminder(_ row: ManagedSchedule, hostID: String, action: ScheduleAction = .delete) throws {
        var next=state;next.withdrawComputerReminder(row,hostID:hostID,action:action);try save(next)
    }
    @discardableResult func sendReminderCommand(_ text: String) -> Bool {
        guard let command=PhoneReminderCommand.parse(text) else { return false }
        let original=state
        if state.selected == nil { newThread() }
        guard let index=state.threads.firstIndex(where: { $0.id == state.selected }) else { return false }
        do {
            var next=state
            if next.reminders == nil { next.reminders=[] }
            next.reminders?.append(.init(text:command.text,fireAt:command.date,sessionID:next.selected))
            next.threads[index].messages.append(.init(role:"user",text:text))
            #if os(macOS)
            let confirmation = "已保存提醒：" + command.text + "，" + command.date.formatted(date: .abbreviated, time: .shortened) + "。允许 WeftMate 发送通知后，就能在到点时提醒你。"
            #else
            let confirmation = "已记下："+command.text+"，"+command.date.formatted(date:.abbreviated,time:.shortened)+"提醒你。通知是否弹出，可在目标页查看。"
            #endif
            var reply=PhoneChatMessage(role:"assistant",text:confirmation);reply.memoryRefs=[];reply.dependencyComplete=true
            next.threads[index].messages.append(reply)
            next.pending = .init();try save(next);draft="";notice=nil
        } catch { state=original;try? persist();notice="提醒没能保存，请检查本机存储后重试。" }
        return true
    }
    func send(regenerate: Bool = false) {
        do { try refreshComputerMemory() } catch { notice="电脑副本清理暂未保存，请重试。";return }
        guard !regenerate || !busy else { return }
        // Local reminder commands do not wait for the model or interrupt its active reply.
        if !regenerate,draft.utf16.count <= 16384,attachments.isEmpty,sendReminderCommand(draft.trimmingCharacters(in:.whitespacesAndNewlines)) { return }
        guard let model=currentModel else { return }
        let text=draft.trimmingCharacters(in:.whitespacesAndNewlines),pendingAttachments=attachments
        if !regenerate,pendingAttachments.contains(where: \.isImage),model.supportsImages == false { notice="当前模型看不了图片";return }
        guard regenerate || !text.isEmpty || !pendingAttachments.isEmpty else { return }
        guard regenerate || text.utf16.count <= 16384 else { notice="消息太长，请分几次发送。";return }
        draftTask?.cancel()
        let original=state
        var next=state
        guard let reply=next.enqueueReply(text:text,attachments:pendingAttachments,regenerate:regenerate) else { return }
        next.pending = .init()
        do { try save(next) } catch { state=original;notice="对话未保存，请检查本机存储后重试。";return }
        queuedModels[reply.replyID]=model;draft="";notice=nil
        startReplies(model:model)
    }
    func retryReply(_ id: String) {
        guard !busy,let model=currentModel else { return }
        var next=state;guard let reply=next.retryReply(id) else { return }
        do { try save(next) } catch { notice="对话未保存，请检查本机存储后重试。";return }
        queuedModels[reply.replyID]=model;notice=nil;startReplies(model:model)
    }
    private func startReplies(model: PhoneModelConfiguration) {
        guard !busy else { return }
        busy=true;let ticket=epoch
        task=Task {
            defer { if ticket == epoch { busy=false;task=nil } }
            while ticket == epoch,!Task.isCancelled,let next=state.nextReply {
                let config=queuedModels.removeValue(forKey:next.replyID) ?? model
                await reply(to:next,model:config,ticket:ticket)
            }
        }
    }
    private func reply(to reply: PhoneQueuedReply, model: PhoneModelConfiguration, ticket: UUID) async {
        var history: [PhoneChatMessage]=[]
        var received="",publishedAt=Date.distantPast,savedAt=Date.distantPast
        state.updateReply(reply,status:.replying)
        do {
            try persist();try await authorizeTransferredHistory(ticket:ticket)
            try Task.checkCancellation();guard ticket == epoch else { return }
            history=state.replyHistory(reply,allowComputerMemory:hasComputerReplica,memoryHostID:app?.offline.memoryHostID)
            guard history.last?.role == "user" else { throw OfflineFailure.authorization }
            let text=history.last?.text ?? ""
            let memoryRevision=app?.offline.memoryRevision,usesReplica=hasComputerReplica
            let computerItems=OfflineReplica.recall(computerMemory,query:text)
            if let t=state.threads.firstIndex(where: { $0.id == reply.threadID }),let m=state.threads[t].messages.firstIndex(where: { $0.id == reply.replyID }) {
                let refs=computerItems.map { OfflineMemoryRef(kind:$0.kind,id:$0.id) }
                let inherited=history.flatMap { $0.memoryRefs ?? [] }
                let all=Set(refs+inherited).sorted { $0.kind+$0.id < $1.kind+$1.id }
                state.threads[t].messages[m].memoryRefs=Array(all.prefix(64))
                state.threads[t].messages[m].dependencyComplete=all.count <= 64 && history.allSatisfy { $0.role != "assistant" || $0.dependencyComplete == true }
                state.threads[t].messages[m].memoryHostID=app?.offline.memoryHostID
            }
            let context=computerItems.map { ($0.text,$0.sources.map(\.id)) }
            let system=ComputerMemoryContext.prompt(context,computerOffline:app?.offline.hostOffline == true)
            let request=try model.attachmentRequest(messages:history,system:system,stream:true,allowLoopback:allowLoopback)
            for try await line in PhoneReplyStream.lines(request:request,model:model,timeout:replyTimeout) {
                try refreshComputerMemory()
                try Task.checkCancellation();guard ticket == epoch else { return }
                guard account == app?.phoneAccountIdentity, memoryRevision == app?.offline.memoryRevision, !usesReplica || hasComputerReplica else { throw OfflineFailure.authorization }
                if history.contains(where: { ($0.attachments ?? []).contains(where: \.isImage) }),line.contains("\"error\""),PhoneAttachmentFailure.isVisionRejection(status:400,body:line) { throw PhoneAttachmentFailure.vision }
                if let delta=try model.streamText(line) {
                    received += delta
                    let now=Date()
                    if now.timeIntervalSince(publishedAt) >= 0.15 {
                        state.updateReply(reply,text:received,status:.replying);publishedAt=now
                    }
                    if now.timeIntervalSince(savedAt) >= 0.75 { try persist();savedAt=now }
                }
                if model.streamFinished(line) { break }
            }
            try await authorizeTransferredHistory(ticket:ticket)
            try Task.checkCancellation();guard ticket == epoch else { return }
            guard memoryRevision == app?.offline.memoryRevision,!usesReplica || hasComputerReplica else { throw OfflineFailure.authorization }
            guard !received.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else { throw OfflineFailure.model }
            state.updateReply(reply,text:received,status:.complete);try persist()
        } catch {
            guard ticket == epoch else { return }
            if case OfflineFailure.authorization = error {
                state.updateReply(reply,text:"",status:.failed)
            } else { state.updateReply(reply,text:received,status:.failed) }
            if error as? PhoneAttachmentFailure == .vision,received.isEmpty,draft.isEmpty,
               let t=state.threads.firstIndex(where: { $0.id == reply.threadID }),state.threads[t].messages.last?.id == reply.replyID,
               let user=history.last,!(user.attachments ?? []).isEmpty {
                state.threads[t].messages.removeLast(2)
                state.pending = .init();state.pending?.attachments=user.attachments ?? [];draft=user.text
            }
            try? persist()
            notice=(error as? PhoneAttachmentFailure)?.message ?? "这次没回复，可以重试。"
        }
    }
}

private final class PhoneModelRedirectPolicy: NSObject, URLSessionTaskDelegate, Sendable {
    nonisolated func urlSession(_ session: URLSession,task: URLSessionTask,willPerformHTTPRedirection response: HTTPURLResponse,newRequest request: URLRequest,completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}
