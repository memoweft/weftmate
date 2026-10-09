import Foundation

public struct WatchApproval: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let summary: String
    public init(id: String, summary: String) { self.id = id; self.summary = summary }
}
public struct WatchTimelineSnapshot: Codable, Equatable, Sendable {
    public let accountKey: String
    public let sessionID: String
    public let taskID: String?
    public let progress: String
    public let running: Bool
    public let assistantSummary: String
    public let approvals: [WatchApproval]
    public let completedTaskIDs: [String]
    public init(accountKey: String, sessionID: String, taskID: String?, progress: String, running: Bool,
                assistantSummary: String, approvals: [WatchApproval], completedTaskIDs: [String]) {
        self.accountKey = accountKey; self.sessionID = sessionID; self.taskID = taskID; self.progress = progress
        self.running = running; self.assistantSummary = assistantSummary; self.approvals = approvals; self.completedTaskIDs = completedTaskIDs
    }
}
/// Opening old history does not buzz. New completion or a newly pending approval buzzes once per account/session.
public struct WatchFeedbackTracker: Sendable {
    private var identity: String?
    private var completed = Set<String>()
    private var approvals = Set<String>()
    public init() {}
    public mutating func apply(_ snapshot: WatchTimelineSnapshot) -> (completed: Bool, approval: Bool) {
        let key = snapshot.accountKey + "|" + snapshot.sessionID
        let nextCompleted = Set(snapshot.completedTaskIDs), nextApprovals = Set(snapshot.approvals.map(\.id))
        guard identity == key else {
            identity = key; completed = nextCompleted; approvals = nextApprovals
            return (false, !nextApprovals.isEmpty)
        }
        let effects = (!nextCompleted.subtracting(completed).isEmpty, !nextApprovals.subtracting(approvals).isEmpty)
        // Old applicationContext/message snapshots cannot replay an already observed alert.
        completed.formUnion(nextCompleted); approvals.formUnion(nextApprovals)
        return effects
    }
}

public enum WatchTimelineProjection {
    public static func computerOffline(accountKey: String) -> WatchTimelineSnapshot {
        WatchTimelineSnapshot(accountKey: accountKey, sessionID: "offline", taskID: nil,
            progress: "电脑离线", running: false, assistantSummary: "", approvals: [], completedTaskIDs: [])
    }
    /// A Watch refresh may wake a background phone before its foreground offline poll.
    /// Authorization/identity failures clear the snapshot entirely; connectivity failures
    /// replace it with an offline projection containing no actionable approvals.
    public static func connectionFailure(_ error: any Error, accountKey: String) -> WatchTimelineSnapshot? {
        switch error {
        case APIFailure.transport(.unavailable), APIFailure.transport(.timeout):
            return computerOffline(accountKey: accountKey)
        case APIFailure.server(let status, _) where status >= 500:
            return computerOffline(accountKey: accountKey)
        default: return nil
        }
    }
    /// Aborted/rejected tasks end too, but must never announce successful completion.
    public static func successfulTaskIDs(in events: [TimelineEvent]) -> [String] {
        events.filter { $0.type == "task.ended" && $0.data["reason"]?.string == "completed" }
            .compactMap { $0.data["taskId"]?.string }
    }
}
