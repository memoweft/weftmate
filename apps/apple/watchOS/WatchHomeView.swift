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
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--ui-testing") && (ProcessInfo.processInfo.arguments.contains("--ic2-icons-fixture") || ProcessInfo.processInfo.arguments.contains("--a9-watch-fixture")) {
            snapshot = WatchTimelineSnapshot(accountKey: "ic2-synthetic", sessionID: "ic2-fixture", taskID: nil,
                progress: "已完成", running: false, assistantSummary: "", approvals: [
                    WatchApproval(id: "ic2-approval", summary: "要运行命令：npm test")], completedTaskIDs: [])
            return
        }
        #endif
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
        snapshot = value
        // No remote push yet: feedback is emitted only while this Watch app is active or refreshed.
        if WKExtension.shared().applicationState == .active {
            let effects = feedback.apply(value)
            if effects.completed { WKInterfaceDevice.current().play(.success) }
            else if effects.approval { WKInterfaceDevice.current().play(.notification) }
        }
    }
    func refresh() {
        // A completion received in the background is announced on the next foreground refresh.
        if let snapshot, let bytes = try? JSONEncoder().encode(snapshot) { apply(bytes) }
        send(["action": "refresh"])
    }
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
                VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                    if let snapshot = model.snapshot {
                        if !snapshot.running && snapshot.progress == "已完成" {
                            WeftLabel("已完成", icon: "allow", size: AppleTokens.Space.p16)
                                .font(AppleTokens.Fonts.caption).accessibilityIdentifier("watchCompletion")
                        }
                        ForEach(snapshot.approvals) { approval in
                            VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                                WeftLabel(approval.summary, icon: "approval", size: AppleTokens.Space.p16).font(AppleTokens.Fonts.caption)
                                HStack {
                                    Button { model.decide(approval, allowed: true) } label: { WeftLabel("批准", icon: "allow", size: AppleTokens.Space.p16) }
                                    Button { model.decide(approval, allowed: false) } label: { WeftLabel("拒绝", icon: "deny", size: AppleTokens.Space.p16) }
                                }.disabled(model.busy || !model.reachable)
                            }.padding(AppleTokens.Space.p8).background(AppleTokens.Styles.quaternary, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r10))
                        }

                    } else { Text("在手机上打开一段对话").font(AppleTokens.Fonts.caption) }
                    if let accountKey = model.snapshot?.accountKey { NavigationLink("健康") { WatchHealthView().id(accountKey) } }
                    Button("刷新") { model.refresh() }.disabled(model.busy)
                    if let notice = model.notice { Text(notice).font(AppleTokens.Fonts.caption).foregroundStyle(AppleTokens.Styles.secondary) }
                    if !model.reachable {
                        Text("打开手机后可审批").font(AppleTokens.Fonts.caption2).foregroundStyle(AppleTokens.Styles.secondary)
                    }
                }.padding(AppleTokens.Space.p8)
            }.navigationTitle("WeftMate").tint(AppleTokens.Colors.primary)
        }
        .task(id: scenePhase) { if scenePhase == .active { model.refresh() } }
        .accessibilityIdentifier("watchHome")
    }
}
