import SwiftUI
import WeftMateCore

@MainActor final class PhoneStandaloneModel: ObservableObject {
    @Published private(set) var state=PhoneChatState()
    @Published private(set) var models: [PhoneModelConfiguration]=[]
    @Published var modelID=""
    @Published var draft=""
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
        stop();account="";store=nil;state = .init();models=[];modelID="";draft="";notice=nil;handoffCount=0;handoffBytes=0
    }
    func clearLocalData() {
        cancelExtraction();stop()
        do { guard let store else { return };try store.clear();app?.offline.erase();state = .init();models=[];modelID="";draft="";notice=nil;handoffCount=0;handoffBytes=0 }
        catch { notice="手机上的内容没能清除，请重试。" }
    }
    /// Called only after a successful authenticated account directory read, never on a network failure.
    func computerDirectoryChanged(hostIDs: Set<String>) {
        guard memory.computerHost != nil,hostIDs.isEmpty else { return }
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
                  let object=try JSONSerialization.jsonObject(with:responseData) as? [String:Any],let choices=object["choices"] as? [[String:Any]],let message=choices.first?["message"] as? [String:Any],let content=message["content"] as? String else { throw OfflineFailure.model }
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
    init(testCredentials: any CredentialStore, testLoopback: Bool, idleDelay: Duration = .seconds(20)) {
        self.idleDelay=idleDelay
        network=URLSession(configuration:.ephemeral,delegate:PhoneModelRedirectPolicy(),delegateQueue:nil)
        credentialsOverride=testCredentials;loopbackOverride=testLoopback
    }
    #endif
    var messages: [PhoneChatMessage] { state.threads.first { $0.id == state.selected }?.messages ?? [] }
    var currentModel: PhoneModelConfiguration? { models.first { $0.id == modelID } ?? models.first }
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
        diagnose("activate");cancelExtraction();handoffCount=0;handoffBytes=0;handoffApproved=false;stop(); epoch=UUID(); account=identity; state = .init(); models=[]; modelID=""; draft=""; notice=nil; store=nil
        do {
            let next=try PhoneChatStore(account:identity,directory:app.healthStateDirectory.deletingLastPathComponent().appendingPathComponent("PhoneChats"),credentials:credentialsOverride ?? KeychainCredentialStore(service:app.phoneCredentialNamespace))
            state=try next.load(); models=try next.loadModels(); modelID=models.first?.id ?? ""; store=next
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
    func saveModel(_ value: PhoneModelConfiguration) throws {
        guard let store else { throw APIFailure.credentialStorage }
        var next=models; next.removeAll { $0.id == value.id }; next.append(value)
        try store.saveModels(next); models=next; modelID=value.id
    }
    func removeModel(_ id: String) {
        if currentModel?.id == id { stop() }
        do { guard let store else { return }; let next=models.filter { $0.id != id }; try store.saveModels(next); models=next; modelID=next.first?.id ?? "" }
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
    func newThread() { guard !busy else { return }; finishConversation(); let thread=PhoneChatThread(); state.threads.append(thread); state.selected=thread.id; draft=""; do { try persist() } catch { notice="对话没能保存，请重试。" } }
    func select(_ id: String) { guard !busy else { return }; finishConversation(); state.selected=id; draft=""; do { try persist() } catch { notice="对话没能保存，请重试。" } }
    func stop() { cancelExtraction();let wasBusy=busy; epoch=UUID(); task?.cancel(); task=nil; busy=false; testing=false; if wasBusy { notice="已停止，已收到的内容保留。" } }
    func send(regenerate: Bool = false) {
        guard !busy, let model=currentModel else { return }
        cancelExtraction()
        let text=draft.trimmingCharacters(in:.whitespacesAndNewlines)
        guard regenerate || !text.isEmpty else { return }
        guard regenerate || text.utf16.count <= 16384 else { notice="消息太长，请分几次发送。";return }
        if state.selected == nil { newThread() }
        guard let index=state.threads.firstIndex(where: { $0.id == state.selected }) else { return }
        if regenerate {
            if state.threads[index].messages.last?.role == "assistant" { state.threads[index].messages.removeLast() }
            guard state.threads[index].messages.last?.role == "user" else { return }
        } else { state.threads[index].messages.append(.init(role:"user",text:text)) }
        let threadID=state.threads[index].id, ticket=epoch
        let history=state.threads[index].messages.suffix(20).map { ["role":$0.role,"content":$0.text] }
        state.threads[index].messages.append(.init(role:"assistant",text:"")); let replyID=state.threads[index].messages.last!.id
        do { try persist() } catch { notice="对话未保存，请检查手机存储后重试。"; return }
        draft=""; busy=true; notice=nil
        task=Task {
            defer { if ticket == epoch { busy=false; task=nil;scheduleExtraction(threadID) } }
            do {
                try await authorizeTransferredHistory(ticket:ticket)
                try Task.checkCancellation();guard ticket == epoch else { return }
                state.memory=memory
                let selected=usesPhoneMemory ? state.memory!.select(query:text.isEmpty ? history.last?["content"] ?? "" : text) : []
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
                let system=["role":"system","content":PhoneMemoryContext.prompt(context,computerOffline:app?.offline.hostOffline == true)]
                let request=try model.request(messages:[system]+history,stream:true,allowLoopback:allowLoopback)
                let (bytes,response)=try await network.bytes(for:request)
                guard let http=response as? HTTPURLResponse,(200...299).contains(http.statusCode) else { throw OfflineFailure.model }
                for try await line in bytes.lines {
                    try Task.checkCancellation(); guard ticket == epoch else { return }
                    if line.hasPrefix("data:"),line.dropFirst(5).trimmingCharacters(in:.whitespaces) == "[DONE]" { break }
                    if let delta=try PhoneStreamDelta.text(line),let t=state.threads.firstIndex(where: { $0.id == threadID }),let m=state.threads[t].messages.firstIndex(where: { $0.id == replyID }) {
                        state.threads[t].messages[m].text += delta; try persist()
                    }
                }
                try await authorizeTransferredHistory(ticket:ticket)
                if ticket == epoch, messages.last?.text.isEmpty == true { throw OfflineFailure.model }
            } catch {
                guard ticket == epoch else { return }
                notice=Task.isCancelled ? "已停止，已收到的内容保留。" : "回复中断，已收到的内容保留，可以重新生成。"
            }
        }
    }
}

private final class PhoneModelRedirectPolicy: NSObject, URLSessionTaskDelegate, Sendable {
    nonisolated func urlSession(_ session: URLSession,task: URLSessionTask,willPerformHTTPRedirection response: HTTPURLResponse,newRequest request: URLRequest,completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}
