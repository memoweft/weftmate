import SwiftUI
import WatchKit
import WatchConnectivity
import WeftMateCore

@MainActor final class WatchTimelineModel: NSObject, ObservableObject, WCSessionDelegate {
    @Published var snapshot: WatchTimelineSnapshot?
    @Published var notice: String?
    @Published var busy = false
    @Published var reachable = false
    private var feedback = WatchFeedbackTracker()
    private let session = WCSession.default
    override init() {
        super.init()
        if WCSession.isSupported() { session.delegate = self; session.activate() }
    }
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        let reachable = session.isReachable, bytes = session.receivedApplicationContext["snapshot"] as? Data
        Task { @MainActor in self.reachable = reachable; self.apply(bytes) }
    }
    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let reachable = session.isReachable
        Task { @MainActor in self.reachable = reachable }
    }
    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        let data = applicationContext["snapshot"] as? Data, clear = applicationContext["clear"] as? Bool == true
        Task { @MainActor in self.apply(data, clear: clear) }
    }
    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        let data = message["snapshot"] as? Data, clear = message["clear"] as? Bool == true
        Task { @MainActor in self.apply(data, clear: clear) }
    }
    private func receive(_ payload: [String: Any]) { apply(payload["snapshot"] as? Data, clear: payload["clear"] as? Bool == true) }
    private func apply(_ data: Data?, clear: Bool = false) {
        if clear { snapshot = nil; feedback = WatchFeedbackTracker(); return }
        guard let data, let value = try? JSONDecoder().decode(WatchTimelineSnapshot.self, from: data) else { return }
        let effects = feedback.apply(value); snapshot = value
        // No remote push yet: feedback is emitted only while this Watch app is active or refreshed.
        if WKExtension.shared().applicationState == .active {
            if effects.completed { WKInterfaceDevice.current().play(.success) }
            else if effects.approval { WKInterfaceDevice.current().play(.notification) }
        }
    }
    func refresh() { send(["action": "refresh"]) }
    func decide(_ approval: WatchApproval, allowed: Bool) {
        guard let snapshot else { return }
        send(["action": "approval", "sessionID": snapshot.sessionID, "approvalID": approval.id,
              "outcome": allowed ? "allowed-once" : "rejected"])
    }
    private func send(_ message: [String: Any]) {
        guard session.isReachable, !busy else { notice = "打开手机上的 WeftMate 后重试。"; return }
        busy = true; notice = nil
        session.sendMessage(message, replyHandler: { reply in
            let data = reply["snapshot"] as? Data, error = reply["error"] as? String, registered = reply["registered"] as? Bool == true
            Task { @MainActor in
                self.busy = false; self.apply(data)
                self.notice = error ?? (registered ? "决定已登记" : nil)
                if registered { self.refresh() }
            }
        }, errorHandler: { _ in Task { @MainActor in self.busy = false; self.notice = "手机未响应，请刷新后重试。" } })
    }
}
struct WatchHomeView: View {
    @StateObject private var model = WatchTimelineModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let snapshot = model.snapshot {
                        Label(snapshot.progress, systemImage: snapshot.running ? "gearshape" : "checkmark.circle")
                            .font(.caption).lineLimit(1).accessibilityIdentifier("watchProgress")
                        ForEach(snapshot.approvals) { approval in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(approval.summary).font(.caption)
                                HStack {
                                    Button("允许") { model.decide(approval, allowed: true) }
                                    Button("拒绝") { model.decide(approval, allowed: false) }
                                }.disabled(model.busy || !model.reachable)
                            }.padding(8).background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
                        }
                        if !snapshot.assistantSummary.isEmpty {
                            NavigationLink("最近回复") { ScrollView { Text(snapshot.assistantSummary).font(.caption).padding(8) } }
                        }
                    } else { Text("在手机上打开一段对话").font(.caption) }
                    Button("刷新") { model.refresh() }.disabled(model.busy)
                    if let notice = model.notice { Text(notice).font(.caption).foregroundStyle(.secondary) }
                    Text("前台或刷新时提醒；推送尚未接通。审批需要手机在线。")
                        .font(.caption2).foregroundStyle(.secondary)
                }.padding(8)
            }.navigationTitle("WeftMate")
        }
        .task(id: scenePhase) { if scenePhase == .active { model.refresh() } }
        .accessibilityIdentifier("watchHome")
    }
}
