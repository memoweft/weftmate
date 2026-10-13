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
    private var transferring=false
    private let network: URLSession
    private let credentialsOverride: (any CredentialStore)?
    private let loopbackOverride: Bool
    init() {
        network=URLSession(configuration:.ephemeral,delegate:PhoneModelRedirectPolicy(),delegateQueue:nil)
        credentialsOverride=nil;loopbackOverride=false
    }
    #if DEBUG
    init(testCredentials: any CredentialStore, testLoopback: Bool) {
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
        diagnose("activate");stop(); epoch=UUID(); account=identity; state = .init(); models=[]; modelID=""; draft=""; notice=nil; store=nil
        do {
            let next=try PhoneChatStore(account:identity,directory:app.healthStateDirectory.deletingLastPathComponent().appendingPathComponent("PhoneChats"),credentials:credentialsOverride ?? KeychainCredentialStore(service:app.phoneCredentialNamespace))
            state=try next.load(); models=try next.loadModels(); modelID=models.first?.id ?? ""; store=next
        } catch { notice="手机上的内容暂时打不开，请重试。" }
    }
    func synchronize(app: AppleAppModel) async {
        guard !transferring, !busy, app.session?.verification == .verified,
              let host=app.session?.hostId, let subject=app.cloudLogin.subject, app.cloudLogin.authenticated else { return }
        activate(app:app);guard !state.threads.isEmpty || state.migrations?[host] != nil else { return }
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
            let pending=state.prepareMigration(host:host,generation:generation);try persist()
            if !pending.isEmpty { try app.offline.enqueuePhoneTurns(pending,generation:generation) }
        } catch { if ticket == epoch { notice="手机上的对话仍在这里，电脑准备好后会自动同步。" } }
    }
    private func authorizeTransferredHistory(ticket: UUID) async throws {
        guard let app,let migrations=state.migrations,!migrations.isEmpty else { return }
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
    func newThread() { guard !busy else { return }; let thread=PhoneChatThread(); state.threads.append(thread); state.selected=thread.id; draft=""; do { try persist() } catch { notice="对话没能保存，请重试。" } }
    func select(_ id: String) { guard !busy else { return }; state.selected=id; draft=""; do { try persist() } catch { notice="对话没能保存，请重试。" } }
    func stop() { let wasBusy=busy; epoch=UUID(); task?.cancel(); task=nil; busy=false; testing=false; if wasBusy { notice="已停止，已收到的内容保留。" } }
    func send(regenerate: Bool = false) {
        guard !busy, let model=currentModel else { return }
        let text=draft.trimmingCharacters(in:.whitespacesAndNewlines)
        guard regenerate || !text.isEmpty else { return }
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
            defer { if ticket == epoch { busy=false; task=nil } }
            do {
                try await authorizeTransferredHistory(ticket:ticket)
                try Task.checkCancellation();guard ticket == epoch else { return }
                let system=["role":"system","content":"你是 WeftMate。现在在手机上聊天，没有电脑工具，也没有正式记忆。需要操作电脑、文件、设置提醒或创建电脑成果时，如实说明手机上做不了，连上电脑后可用。不要声称已执行或已记住。"]
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
