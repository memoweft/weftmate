import Foundation
import Combine
import WeftMateCore

@MainActor final class OfflineChatModel: ObservableObject {
    static let warning = "电脑离线：只能聊天和用记忆，不能操作电脑"
    @Published private(set) var hostOffline = false
    @Published private(set) var ready = false
    @Published private(set) var busy = false
    @Published private(set) var turns: [OfflineTurn] = []
    @Published private(set) var synced: Set<String> = []
    @Published private(set) var recent: [OfflineRecent] = []
    @Published private(set) var truncated = false
    @Published private(set) var notice: String?
    @Published var showHistory = false
    @Published var draft = ""
    @Published var conversationID = UUID().uuidString.lowercased()
    private var recentID: String?
    private var retainedReplicas: [String:OfflineReplica]=[:]
    private var replica: OfflineReplica?
    private var identity: OfflineIdentity?
    @Published private(set) var workTasks: [OfflineWorkTask] = []
    var workSnapshot: OfflineSnapshot? { ready ? replica?.state.snapshot : nil }
    @Published private(set) var polling = false
    var memoryRevision: UUID? { replica?.revision }
    var memoryErasure: OfflineReplicaErasure? { replica?.state.erasure }
    var replicaHostID: String? { identity?.hostId }
    func acknowledgeMemoryErasure(_ id: String) throws { try replica?.acknowledgeErasure(id) }
    func invalidateMemory() throws {
        guard let replica else { return };try replica.revoke();publish(replica)
    }
    func authorizeMemory(control: (String) async throws -> OfflineAuthorization) async throws {
        guard let engine=replica,ready else { throw OfflineFailure.notReady }
        do {
            try await engine.check(control:control)
            guard replica === engine else { throw OfflineFailure.notReady }
            publish(engine)
        } catch { if replica === engine { publish(engine);ready=false };throw error }
    }
    var memoryHostID: String? { ready ? identity?.hostId : nil }
    var memoryAccountID: String? { ready ? replica?.state.snapshot?.control.accountId : nil }
    var memoryItems: [OfflineMemory] { ready ? replica?.state.snapshot?.items ?? [] : [] }
    var generation: Int? { replica?.state.snapshot?.generation }
    var memoryAuthorityReady: Bool { ready && replica?.state.snapshot?.memoryAuthority?.ready == true }
    func enqueuePhoneTurns(_ turns: [OfflineTurn], generation: Int, handover: OfflineHandover? = nil) throws {
        guard let replica, ready, !hostOffline, !polling, !busy else { throw OfflineFailure.notReady }
        try replica.enqueuePhoneTurns(turns,generation:generation,handover:handover); publish(replica)
    }
    var messages: [OfflineMessage] {
        turns.filter { $0.conversationId == conversationID }.flatMap(\.messages)
    }
    var conversationIDs: [String] { Array(Set(turns.map(\.conversationId))).sorted() }
    var pending: Int { turns.filter { !synced.contains($0.id) }.count }
    func newConversation(recent: String? = nil) {
        conversationID = UUID().uuidString.lowercased(); recentID = recent; draft = ""
    }
    func suspend() {
        if let replica,let identity { replica.suspend();retainedReplicas[scope(identity)]=replica }
        replica=nil;identity=nil;workTasks=[];draft="";turns=[];synced=[];recent=[];ready=false;showHistory=false;hostOffline=false;conversationID=UUID().uuidString.lowercased()
    }
    func removeComputer(_ host: String) {
        if identity?.hostId == host { do { try replica?.revoke() } catch { notice="电脑副本暂时没能清除，请重试。" };suspend() }
        do { for (key,engine) in retainedReplicas where engine.state.snapshot?.control.hostId == host { try engine.clear();retainedReplicas[key]=nil } }
        catch { notice="电脑副本暂时没能清除，请重试。" }
    }
    func erase() {
        do { try replica?.clear();for engine in retainedReplicas.values { try engine.clear() };retainedReplicas=[:]; notice = nil }
        catch { notice = "本机钥匙或副本清理失败，请检查设备存储后重试。" }
        replica = nil; identity = nil; draft = ""; turns = []; synced = []; recent = []; ready = false
        workTasks=[];showHistory = false; hostOffline = false; conversationID = UUID().uuidString.lowercased()
    }
    private func publish(_ engine: OfflineReplica) {
        workTasks = engine.state.workTasks ?? []
        ready = engine.state.snapshot != nil; turns = engine.state.turns; synced = engine.state.synced
        recent = engine.state.snapshot?.recent ?? []; truncated = engine.state.snapshot?.truncated ?? false
        if !ready { draft = ""; recentID = nil }
    }
    private func scope(_ identity: OfflineIdentity) -> String { "\(identity.ownerId.utf8.count):\(identity.ownerId)\(identity.hostId)" }
    private func load(identity next: OfflineIdentity,directory: URL,store: any CredentialStore,allowLoopback: Bool,phoneFirst: Bool,multipleComputers: Bool) throws -> OfflineReplica {
        if identity?.ownerId != next.ownerId || identity?.hostId != next.hostId || replica == nil {
            if replica != nil { suspend() }
            replica=try retainedReplicas.removeValue(forKey:scope(next)) ?? OfflineReplica(vault:OfflineVault(identity:next,directory:directory,store:store,multipleHosts:multipleComputers),allowLoopback:allowLoopback,phoneFirst:phoneFirst)
            identity=next
        }
        return replica!
    }
    /// A paired phone may restart with no computer session. Only cloud authorization unlocks its copy.
    func restore(identity: OfflineIdentity,directory: URL,store: any CredentialStore,allowLoopback: Bool = false,multipleComputers: Bool,
                 control: (String) async throws -> OfflineAuthorization) async {
        guard !polling,!busy else { return };polling=true;defer { polling=false }
        do {
            let engine=try load(identity:identity,directory:directory,store:store,allowLoopback:allowLoopback,phoneFirst:true,multipleComputers:multipleComputers)
            ready=false;hostOffline=true
            try await engine.check(control:control)
            guard replica === engine else { return };publish(engine);notice=nil
        } catch { ready=false;turns=[];synced=[];recent=[];notice="记忆副本暂不可用，仍可用自己的模型聊天。" }
    }
    func poll(session: AccountSession, client: PersonalClient, directory: URL, store: any CredentialStore,
              allowLoopback: Bool, phoneFirst: Bool = false, multipleComputers: Bool = false, workAndChat: Bool = false, transcriptExclusions: PhoneTranscriptSync? = nil, control: (String) async throws -> OfflineAuthorization) async {
        guard !polling, !busy else { return }; polling = true; defer { polling = false }
        do {
            let next = OfflineIdentity(ownerId: session.account.ownerId, hostId: session.hostId, deviceId: session.device.id)
            let engine=try load(identity:next,directory:directory,store:store,allowLoopback:allowLoopback,phoneFirst:phoneFirst,multipleComputers:multipleComputers)
            if let transcriptExclusions { try engine.excludeUnsubmittedPhoneTurns(transcriptExclusions) }
            engine.workAndChat=workAndChat
            // A cached replica is never rendered after process launch until cloud authorization succeeds.
            if engine.state.snapshot != nil {
                do {
                    try await engine.check(control: control)
                    guard replica === engine else { return }
                    let wasReady = ready; publish(engine)
                    if !wasReady { notice = nil }
                }
                catch {
                    guard replica === engine else { return }
                    turns = []; recent = []; ready = false; draft = ""
                    notice = (error as? LocalizedError)?.errorDescription ?? "无法核对云授权，请联网后重试。"
                    if engine.state.snapshot == nil { publish(engine) }
                    // Continue to sync so an online host can supply the new generation.
                }
            }
            do {
                try await engine.sync(identity: next, fetch: { try await client.syncOffline($0) },
                    submit: { try await client.submitOffline($0) }, control: control)
                guard replica === engine else { return }
                hostOffline = false; publish(engine)
                notice = !turns.isEmpty && pending == 0 ? "电脑已收到" : phoneFirst && !memoryAuthorityReady ? "电脑正在准备，原话留在手机，稍后自动交过去。" : nil
            } catch {
                guard replica === engine else { return }
                if case APIFailure.transport(let reason) = error, [.unavailable, .timeout].contains(reason) {
                    hostOffline = true
                    if engine.state.snapshot != nil {
                        do { try await engine.check(control: control); guard replica === engine else { return }; publish(engine) }
                        catch { ready = false; turns = []; recent = []; draft = ""; notice = "无法核对云授权，请联网后重试。"; if engine.state.snapshot == nil { publish(engine) } }
                    }
                } else if case APIFailure.server(let status, _) = error, status >= 500 {
                    hostOffline = true
                } else {
                    ready=false;turns=[];recent=[]
                    notice = (error as? LocalizedError)?.errorDescription ?? "离线同步暂不可用。"
                    if engine.state.snapshot == nil { publish(engine) }
                }
            }
        } catch { notice = (error as? LocalizedError)?.errorDescription ?? "离线副本无法读取。" }
    }
    #if DEBUG
    func seedPhoneWindowReplica(disconnected: Bool) throws {
        let args=ProcessInfo.processInfo.arguments
        guard args.contains("--ui-testing"),args.contains("--phone-window-fixture") else { return }
        let identity=OfflineIdentity(ownerId:"window-owner",hostId:"window-computer",deviceId:"window-device")
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent("apple-1-window-"+UUID().uuidString)
        let vault=try OfflineVault(identity:identity,directory:directory,store:Mode2IOfflineFixtureKeys())
        let data: [String:Any] = ["generation":1,"reset":false,
            "items":[["id":"window-memory","kind":"cognition","text":"合成电脑记忆：我喜欢清淡的茶。","sources":[["id":"window-source","summary":"合成对话原话"]],"currentState":"current"]],
            "remove":[],"hashes":["window-memory":String(repeating:"a",count:64)],"truncated":false,"recent":[],
            "control":["accountId":"window-account","hostId":"window-computer","generation":1],"memoryAuthority":["ready":true,"hostId":"window-computer"]]
        var state=OfflineState();state.snapshot=try JSONDecoder().decode(OfflineSnapshot.self,from:JSONSerialization.data(withJSONObject:data))
        try vault.save(state);let engine=try OfflineReplica(vault:vault);replica=engine;self.identity=identity;hostOffline=disconnected;publish(engine)
    }
    func seedMode2IOfflineFixture(disconnected: Bool = true) throws {
        let args=ProcessInfo.processInfo.arguments
        guard args.contains("--ui-testing"),args.contains("--mode2i-offline") else { return }
        let identity=OfflineIdentity(ownerId:"owner-fixture",hostId:"host-fixture",deviceId:"device-fixture")
        let keys=Mode2IOfflineFixtureKeys(),directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let vault=try OfflineVault(identity:identity,directory:directory,store:keys)
        let data: [String:Any] = ["generation":3,"reset":false,"items":[],"remove":[],"hashes":[:],"truncated":false,"recent":[],"control":["accountId":"cloud-fixture","hostId":"host-fixture","generation":3],"taskRecipient":try vault.publicJwk(),"taskReferences":[["id":"session-work","title":"合成工作","projectId":"project-a"]]]
        var state=OfflineState();state.snapshot=try JSONDecoder().decode(OfflineSnapshot.self,from:JSONSerialization.data(withJSONObject:data))
        try vault.save(state);let engine=try OfflineReplica(vault:vault);replica=engine;self.identity=identity;hostOffline=disconnected;publish(engine)
    }
    #endif
    func retainWorkTask(_ task: OfflineWorkTask) throws {
        guard let replica,ready else { throw OfflineFailure.notReady }
        try replica.retainWorkTask(task);publish(replica)
    }
    func acknowledgeWorkTask(_ receipt: OfflineTaskReceipt) throws {
        guard let replica,ready else { throw OfflineFailure.notReady }
        try replica.acknowledgeWorkTask(receipt);publish(replica)
    }
    func send(control: (String) async throws -> OfflineAuthorization, fallbackModel: PhoneModelConfiguration? = nil) async {
        guard let engine = replica, hostOffline, ready, !busy, !polling else { return }
        busy = true; notice = nil; let text = draft; draft = ""
        let previousCount = engine.state.turns.count
        defer { busy = false }
        do {
            try await engine.send(text, conversationID: conversationID, recentID: recentID, fallbackModel:fallbackModel, control: control)
            guard replica === engine else { return }
            notice = "电脑上线后自动同步"
        } catch {
            guard replica === engine else { return }
            notice = (error as? LocalizedError)?.errorDescription ?? "云模型暂不可用，请重试。"
            if engine.state.snapshot != nil, engine.state.turns.count == previousCount { draft = text }
        }
        guard replica === engine else { return }; publish(engine)
    }
}

#if DEBUG
private final class Mode2IOfflineFixtureKeys: CredentialStore,@unchecked Sendable {
    private let lock=NSLock();private var values:[String:Data]=[:]
    func load(key:String)->Data?{lock.withLock{values[key]}}
    func save(_ value:Data,key:String){lock.withLock{values[key]=value}}
    func delete(key:String){lock.withLock{values[key]=nil}}
}
#endif
