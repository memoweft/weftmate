import Foundation

public struct WatchDecisionMessage: Sendable {
    public let sessionID: String
    public let approvalID: String
    public let allowed: Bool
    public init(sessionID: String, approvalID: String, allowed: Bool) {
        self.sessionID = sessionID; self.approvalID = approvalID; self.allowed = allowed
    }
    public var payload: [String: String] {
        ["action": "approval", "sessionID": sessionID, "approvalID": approvalID, "outcome": allowed ? "allowed-once" : "rejected"]
    }
}
public struct WatchMessageReply: Sendable {
    public let snapshot: Data?
    public let error: String?
    public let registered: Bool
}
/// WatchConnectivity invokes replies on its own operation queue. The returned
/// closures are nonisolated and Sendable; only typed values enter the UI actor.
public enum WatchMessageDelivery {
    public static func reply(_ receive: @escaping @MainActor @Sendable (WatchMessageReply) -> Void) -> @Sendable ([String: Any]) -> Void {
        { reply in
            let value = WatchMessageReply(snapshot: reply["snapshot"] as? Data, error: reply["error"] as? String, registered: reply["registered"] as? Bool == true)
            Task { @MainActor in receive(value) }
        }
    }
    public static func failure(_ receive: @escaping @MainActor @Sendable () -> Void) -> @Sendable (any Error) -> Void {
        { _ in Task { @MainActor in receive() } }
    }
}
