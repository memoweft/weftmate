import SwiftUI
import WatchKit
import WatchConnectivity
import WeftMateCore

@MainActor final class WatchTimelineModel: NSObject, ObservableObject, WCSessionDelegate {
    @Published var snapshot: WatchTimelineSnapshot?
    @Published var notice: String?
    @Published var busy = false
    @Published var reachable = false
    @Published var chat: WatchChatSnapshot?
    @Published var draft = ""
    private var conversationID=UUID().uuidString.lowercased()
    private var pendingChat: WatchChatRequest?
    private var freshConversation=false
    private var messageEpoch=UUID()
    #if DEBUG && targetEnvironment(simulator)
    private var routingPreview: String?
    #endif
    private var feedback = WatchFeedbackTracker()
    private var decisions = WatchDecisionState()
    private let session = WCSession.default
    override init() {
        super.init()
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--ui-testing"),let preview=WatchRoutingPreview.current {
            routingPreview=preview.scene; chat=preview.snapshot; draft=preview.draft; reachable=preview.reachable
            snapshot=preview.approval; decisions.apply(snapshot)
            if let record=chat?.record { conversationID=record.request.conversationID }
            return
        }
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
        Task { @MainActor in self.reachable = reachable; self.apply(bytes); if reachable { self.refresh() } }
    }
    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let reachable = session.isReachable
        Task { @MainActor in self.reachable = reachable; RunLogRuntime.shared.connection(reachable ? "connecting" : "offline", code: reachable ? nil : "UNAVAILABLE"); if reachable { self.refresh() } }
    }
    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        let data = applicationContext["snapshot"] as? Data, clear = applicationContext["clear"] as? Bool == true, clearChat=applicationContext["clearChat"] as? Bool == true, account=applicationContext["chatAccountKey"] as? String
        Task { @MainActor in self.apply(data, clear: clear); if clearChat || self.chat.map({ account != nil && $0.accountKey != account }) == true { self.resetChat() } }
    }
    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        let data = message["snapshot"] as? Data, clear = message["clear"] as? Bool == true, clearChat=message["clearChat"] as? Bool == true, account=message["chatAccountKey"] as? String
        Task { @MainActor in self.apply(data, clear: clear); if clearChat || self.chat.map({ account != nil && $0.accountKey != account }) == true { self.resetChat() } }
    }
    private func resetChat() {
        messageEpoch=UUID(); busy=false
        chat=nil; pendingChat=nil; draft=""; freshConversation=true; conversationID=UUID().uuidString.lowercased()
    }
    private func transferRunLog() {
        guard session.isReachable else { return }
        Task {
            await RunLogRuntime.shared.ready()
            _ = await RunLogRuntime.shared.store.deliverWatch { [weak self] bytes in
                await self?.sendRunLog(bytes) ?? false
            }
        }
    }
    private func sendRunLog(_ bytes: Data) async -> Bool {
        guard session.isReachable else { return false }
        return await withCheckedContinuation { continuation in
            // SDK callbacks capture only the Sendable continuation; no Watch UI actor state.
            session.sendMessage(["action": "run_log", "runLog": bytes], replyHandler: { reply in
                continuation.resume(returning: reply["accepted"] as? Bool == true)
            }, errorHandler: { _ in continuation.resume(returning: false) })
        }
    }
    private func receive(_ payload: [String: Any]) { apply(payload["snapshot"] as? Data, clear: payload["clear"] as? Bool == true) }
    private func apply(_ data: Data?, clear: Bool = false) {
        if clear { snapshot = nil; feedback = WatchFeedbackTracker(); decisions.apply(nil); return }
        guard let data else { return }
        guard let value = try? JSONDecoder().decode(WatchTimelineSnapshot.self, from: data) else {
            RunLogRuntime.shared.record(.syncFailure, ["phase": "notification", "code": "UNCONFIRMED"]); return
        }
        snapshot = value
        RunLogRuntime.shared.connection(value.progress == "电脑离线" ? "offline" : "online", code: value.progress == "电脑离线" ? "UNAVAILABLE" : nil)
        decisions.apply(value)
        record("snapshot", ["sessionID": value.sessionID, "running": value.running, "progress": value.progress, "approvals": value.approvals.map(\.summary)])
        // No remote push yet: feedback is emitted only while this Watch app is active or refreshed.
        if WKExtension.shared().applicationState == .active {
            let effects = feedback.apply(value)
            if effects.completed { WKInterfaceDevice.current().play(.success); record("haptic", ["type": "success"]) }
            else if effects.approval { WKInterfaceDevice.current().play(.notification); record("haptic", ["type": "notification"]) }
        }
    }
    func refresh() {
        transferRunLog()
        // A completion received in the background is announced on the next foreground refresh.
        if let snapshot, let bytes = try? JSONEncoder().encode(snapshot) { apply(bytes) }
        var message: [String:Any]=["action":"refresh"]
        if let pendingChat { message["chatRequestID"]=pendingChat.id }
        send(message)
    }
    var chatWorking: Bool { chat?.record?.phase.active == true || pendingChat != nil }
    func newConversation() {
        guard !chatWorking else { return }
        conversationID=UUID().uuidString.lowercased(); freshConversation=true; chat?.record=nil; chat?.answer=""; draft=""
    }
    func sendChat(device: WatchAnswerDevice? = nil) {
        guard let account=chat?.accountKey,!chatWorking,!busy else { return }
        let text=draft.trimmingCharacters(in:.whitespacesAndNewlines)
        let request=WatchChatRequest(conversationID:conversationID,accountKey:account,
                                    text:text.isEmpty ? chat?.record?.text ?? "" : text,device:device)
        do {
            try request.validate(); pendingChat=request
            send(["action":"chat.send","chatRequest":try JSONEncoder().encode(request)])
        } catch { pendingChat=nil; notice=WatchChatFailure.invalidInput.errorDescription }
    }
    private func applyChat(_ data: Data) {
        guard var value=try? JSONDecoder().decode(WatchChatSnapshot.self,from:data) else { return }
        if let old=chat,old.accountKey != value.accountKey {
            resetChat()
        }
        if let pending=pendingChat {
            if value.record?.request.id == pending.id {
                if draft.trimmingCharacters(in:.whitespacesAndNewlines) == pending.text { draft="" }
                pendingChat=nil; freshConversation=false
            } else if value.record == nil { pendingChat=nil }
        }
        if freshConversation,value.record?.request.conversationID != conversationID { value.record=nil; value.answer="" }
        if let record=value.record { conversationID=record.request.conversationID }
        chat=value
    }
    func decide(_ approval: WatchApproval, allowed: Bool) {
        guard let snapshot, snapshot.approvals.contains(where: { $0.id == approval.id }), !busy,
              decisions.begin(approval.id, allowed: allowed, reachable: session.isReachable) else { return }
        send(WatchDecisionMessage(sessionID: snapshot.sessionID, approvalID: approval.id, allowed: allowed).payload)
    }
    var pendingApprovals: [WatchApproval] { snapshot?.approvals.filter { !decisions.isRegistered($0.id) } ?? [] }
    func canDecide(_ approval: WatchApproval, allowed: Bool) -> Bool {
        !busy && decisions.canDecide(approval.id, allowed: allowed, reachable: reachable)
    }
    private func record(_ event: String, _ fields: [String: Any] = [:]) {
        #if DEBUG && targetEnvironment(simulator)
        guard ProcessInfo.processInfo.arguments.contains("--a12-live-evidence") else { return }
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("a12-watch.jsonl")
        let row = fields.merging(["event": event, "time": ISO8601DateFormatter().string(from: Date())]) { _, new in new }
        guard var data = try? JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]) else { return }
        data.append(10)
        if !FileManager.default.fileExists(atPath: url.path) { FileManager.default.createFile(atPath: url.path, contents: nil) }
        if let file = try? FileHandle(forWritingTo: url) { try? file.seekToEnd(); try? file.write(contentsOf: data); try? file.close() }
        #endif
    }
    private func send(_ message: [String: Any]) {
        #if DEBUG && targetEnvironment(simulator)
        if routingPreview != nil {
            if let bytes=message["chatRequest"] as? Data,let request=try? JSONDecoder().decode(WatchChatRequest.self,from:bytes),
               let reply=try? WatchRoutingPreview.reply(request).encoded() { applyChat(reply) }
            return
        }
        #endif
        guard !busy else { return }
        guard session.isReachable else { notice = "打开手机上的 WeftMate 后重试。"; return }
        busy = true; notice = nil
        let epoch=messageEpoch
        let approvalID = message["approvalID"] as? String
        record("send", message)
        session.sendMessage(message, replyHandler: WatchMessageDelivery.reply { reply in
            guard self.messageEpoch == epoch else { return }
            let data = reply.snapshot, error = reply.error, registered = reply.registered
            self.busy = false
            if let approvalID { self.decisions.finish(approvalID, registered: registered) }
            self.record("reply", ["registered": registered, "error": error ?? "", "approvalID": approvalID ?? ""])
            self.apply(data,clear:reply.clear)
            if let chat=reply.chat { self.applyChat(chat) }
            self.notice = error ?? (registered ? "决定已登记" : nil)
            if error != nil || (approvalID != nil && !registered) { RunLogRuntime.shared.record(.approvalFailure, ["phase": "approval", "code": "UNCONFIRMED"]) }
            if registered { self.refresh() }
        }, errorHandler: WatchMessageDelivery.failure {
            guard self.messageEpoch == epoch else { return }
            self.busy = false
            if let approvalID { self.decisions.finish(approvalID, registered: false) }
            self.record("transportError")
            RunLogRuntime.shared.record(approvalID == nil ? .syncFailure : .approvalFailure, ["phase": approvalID == nil ? "notification" : "approval", "code": "UNAVAILABLE"])
            self.notice = self.pendingChat == nil ? "手机未响应，请刷新后重试。" : "送达情况待核对，请刷新。"
        })
    }
}
struct WatchHomeView: View {
    @ObservedObject private var runLog = RunLogRuntime.shared
    @StateObject private var model = WatchTimelineModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: AppleTokens.Space.p12) {
                    #if DEBUG
                    if ProcessInfo.processInfo.arguments.contains("--diag3-check-marker") {
                        Text("运行记录检查").accessibilityIdentifier("diag3WatchMarker").accessibilityValue(runLog.snapshot?.previous?.clean == false ? "unclean" : "clean")
                    }
                    #endif
                    if let snapshot = model.snapshot {
                        if !snapshot.running && snapshot.progress == "已完成" {
                            WeftLabel("已完成", icon: "allow", size: AppleTokens.Space.p16)
                                .font(AppleTokens.Fonts.caption).accessibilityIdentifier("watchCompletion")
                        } else if !snapshot.running && snapshot.progress == "已停止" {
                            Text("已停止").font(AppleTokens.Fonts.caption).accessibilityIdentifier("watchStopped")
                        }
                        ForEach(model.pendingApprovals) { approval in
                            VStack(alignment: .leading, spacing: AppleTokens.Space.p8) {
                                WeftLabel(approval.summary, icon: "approval", size: AppleTokens.Space.p16).font(AppleTokens.Fonts.caption)
                                if let opinion = approval.secondOpinion { Text(opinion).font(AppleTokens.Fonts.caption).foregroundStyle(AppleTokens.Styles.secondary) }
                                HStack {
                                    Button { model.decide(approval, allowed: true) } label: { WeftLabel("批准", icon: "allow", size: AppleTokens.Space.p16) }.disabled(!model.canDecide(approval, allowed: true)).accessibilityIdentifier("watchApprove")
                                    Button { model.decide(approval, allowed: false) } label: { WeftLabel("拒绝", icon: "deny", size: AppleTokens.Space.p16) }.disabled(!model.canDecide(approval, allowed: false)).accessibilityIdentifier("watchReject")
                                }.disabled(model.busy || !model.reachable)
                            }.padding(AppleTokens.Space.p8).background(AppleTokens.Styles.quaternary, in: RoundedRectangle(cornerRadius: AppleTokens.Radius.r10))
                        }

                    }
                    WatchConversationView(model:model)
                    if let accountKey = model.snapshot?.accountKey { NavigationLink("健康") { WatchHealthView().id(accountKey) } }
                    Button("刷新") { model.refresh() }.disabled(model.busy)
                    if let notice = model.notice { Text(notice).font(AppleTokens.Fonts.caption).foregroundStyle(AppleTokens.Styles.secondary) }
                    if !model.reachable {
                        Text("打开手机上的 WeftMate 后再试。").font(AppleTokens.Fonts.caption2).foregroundStyle(AppleTokens.Styles.secondary)
                    }
                }.padding(AppleTokens.Space.p8)
            }.navigationTitle("WeftMate").tint(AppleTokens.Colors.primary)
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            model.refresh()
            while !Task.isCancelled {
                do { try await Task.sleep(for:.seconds(2)) } catch { return }
                if model.chatWorking { model.refresh() }
            }
        }
        .accessibilityIdentifier("watchHome")
    }
}
