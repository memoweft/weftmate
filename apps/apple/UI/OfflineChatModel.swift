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
    private var replica: OfflineReplica?
    private var identity: OfflineIdentity?
    @Published private(set) var polling = false
    var messages: [OfflineMessage] {
        turns.filter { $0.conversationId == conversationID }.flatMap(\.messages)
    }
    var conversationIDs: [String] { Array(Set(turns.map(\.conversationId))).sorted() }
    var pending: Int { turns.filter { !synced.contains($0.id) }.count }
    func newConversation(recent: String? = nil) {
        conversationID = UUID().uuidString.lowercased(); recentID = recent; draft = ""
    }
    func erase() {
        do { try replica?.clear(); notice = nil }
        catch { notice = "本机钥匙或副本清理失败，请检查设备存储后重试。" }
        replica = nil; identity = nil; draft = ""; turns = []; synced = []; recent = []; ready = false
        showHistory = false; hostOffline = false; conversationID = UUID().uuidString.lowercased()
    }
    private func publish(_ engine: OfflineReplica) {
        ready = engine.state.snapshot != nil; turns = engine.state.turns; synced = engine.state.synced
        recent = engine.state.snapshot?.recent ?? []; truncated = engine.state.snapshot?.truncated ?? false
        if !ready { draft = ""; recentID = nil }
    }
    func poll(session: AccountSession, client: PersonalClient, directory: URL, store: any CredentialStore,
              allowLoopback: Bool, control: (String) async throws -> OfflineAuthorization) async {
        guard !polling, !busy else { return }; polling = true; defer { polling = false }
        do {
            let next = OfflineIdentity(ownerId: session.account.ownerId, hostId: session.hostId, deviceId: session.device.id)
            if identity?.ownerId != next.ownerId || identity?.hostId != next.hostId || replica == nil {
                if replica != nil { erase() }
                replica = try OfflineReplica(vault: OfflineVault(identity: next, directory: directory, store: store), allowLoopback: allowLoopback)
                identity = next
            }
            guard let engine = replica else { return }
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
                notice = !turns.isEmpty && pending == 0 ? "已同步" : nil
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
                    notice = (error as? LocalizedError)?.errorDescription ?? "离线同步暂不可用。"
                    if engine.state.snapshot == nil { publish(engine) }
                }
            }
        } catch { notice = (error as? LocalizedError)?.errorDescription ?? "离线副本无法读取。" }
    }
    func send(control: (String) async throws -> OfflineAuthorization) async {
        guard let engine = replica, hostOffline, ready, !busy, !polling else { return }
        busy = true; notice = nil; let text = draft; draft = ""
        let previousCount = engine.state.turns.count
        defer { busy = false }
        do {
            try await engine.send(text, conversationID: conversationID, recentID: recentID, control: control)
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
