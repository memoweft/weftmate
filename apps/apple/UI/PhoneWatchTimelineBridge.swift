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
        #if !WEFTMATE_WINDOW_TEST
        if WCSession.isSupported() { session.delegate = self; session.activate() }
        #endif
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
        let chatRequest = message["chatRequest"] as? Data, chatRequestID = message["chatRequestID"] as? String
        let action = message["action"] as? String, sessionID = message["sessionID"] as? String,
            approvalID = message["approvalID"] as? String, outcome = message["outcome"] as? String
        let reply = WatchReply(replyHandler)
        Task { @MainActor [weak self] in
            guard let model = self?.model else { reply.call(["error": "手机尚未打开 WeftMate"]); return }
            if action == "chat.send" {
                do {
                    guard let chatRequest,chatRequest.count <= 32_768 else { throw WatchChatFailure.invalidInput }
                    let request=try JSONDecoder().decode(WatchChatRequest.self,from:chatRequest)
                    _ = try await model.watchConversation.snapshot()
                    try model.watchConversation.send(request)
                    reply.call(["chat":try await model.watchConversation.snapshot(requestID:request.id).encoded()])
                } catch { reply.call(["error":(error as? WatchChatFailure)?.errorDescription ?? "这句话没能发送，请刷新后重试。"] ) }
            } else if action == "approval", let sessionID, let approvalID, let outcome {
                let success = await model.respondFromWatch(sessionID: sessionID, approvalID: approvalID, outcome: outcome)
                var result: [String: Any] = success ? ["registered": true] : ["error": "决定待核对，请在手机中查看"]
                if let bytes = await model.watchSnapshotBytes() { result["snapshot"] = bytes }
                reply.call(result)
            } else {
                var result: [String:Any]=[:]
                if let bytes=await model.watchSnapshotBytes() { result["snapshot"]=bytes }
                else { result["clear"]=true }
                do { result["chat"]=try await model.watchConversation.snapshot(requestID:chatRequestID).encoded() }
                catch { result["error"]="暂时读不到手机对话，请刷新。" }
                reply.call(result)
            }
        }
    }
    @MainActor func publish(_ snapshot: WatchTimelineSnapshot?, clearChat: Bool = false) {
        guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
        var payload: [String: Any] = snapshot.flatMap { try? JSONEncoder().encode($0) }.map { ["snapshot": $0] } ?? ["clear": true]
        if clearChat { payload["clearChat"]=true }
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
