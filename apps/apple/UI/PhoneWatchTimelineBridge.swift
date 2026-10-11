#if os(iOS)
import Foundation
import WatchConnectivity
import WeftMateCore

/// Only projections cross WatchConnectivity. Host Cookie/CSRF and credentials stay on iPhone.
final class PhoneWatchTimelineBridge: NSObject, WCSessionDelegate, @unchecked Sendable {
    @MainActor weak var model: AppleAppModel?
    private let session = WCSession.default
    @MainActor init(model: AppleAppModel) {
        self.model = model; super.init()
        if WCSession.isSupported() { session.delegate = self; session.activate() }
    }
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() }
    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        if message["action"] as? String == "run_log", let data = message["runLog"] as? Data {
            let reply = WatchReply(replyHandler)
            Task { @MainActor in
                await RunLogRuntime.shared.ready()
                let accepted = await RunLogRuntime.shared.store.receiveWatch(data)
                await RunLogRuntime.shared.reload()
                reply.call(["accepted": accepted])
            }
            return
        }
        let action = message["action"] as? String, sessionID = message["sessionID"] as? String,
            approvalID = message["approvalID"] as? String, outcome = message["outcome"] as? String
        let reply = WatchReply(replyHandler)
        Task { @MainActor [weak self] in
            guard let model = self?.model else { reply.call(["error": "手机尚未打开 WeftMate"]); return }
            if action == "approval", let sessionID, let approvalID, let outcome {
                let success = await model.respondFromWatch(sessionID: sessionID, approvalID: approvalID, outcome: outcome)
                var result: [String: Any] = success ? ["registered": true] : ["error": "决定待核对，请在手机中查看"]
                if let bytes = await model.watchSnapshotBytes() { result["snapshot"] = bytes }
                reply.call(result)
            } else { reply.call(await model.watchSnapshotBytes().map { ["snapshot": $0] } ?? ["error": "当前没有可读取的任务"]) }
        }
    }
    @MainActor func publish(_ snapshot: WatchTimelineSnapshot?) {
        guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
        let payload: [String: Any] = snapshot.flatMap { try? JSONEncoder().encode($0) }.map { ["snapshot": $0] } ?? ["clear": true]
        try? session.updateApplicationContext(payload)
        if session.isReachable { session.sendMessage(payload, replyHandler: nil, errorHandler: nil) }
    }
}
private final class WatchReply: @unchecked Sendable {
    let handler: ([String: Any]) -> Void
    init(_ handler: @escaping ([String: Any]) -> Void) { self.handler = handler }
    func call(_ value: [String: Any]) { handler(value) }
}
#endif
