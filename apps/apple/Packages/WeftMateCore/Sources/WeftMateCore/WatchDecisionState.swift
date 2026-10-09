import Foundation

/// A decided card stays closed even if an older application context arrives.
/// An uncertain transport may retry only the original outcome; iPhone persists its request ID.
public struct WatchDecisionState: Sendable {
    private var identity: String?
    private var outcomes: [String: Bool] = [:]
    private var registered = Set<String>()
    public private(set) var inFlight: String?
    public init() {}
    public mutating func apply(_ snapshot: WatchTimelineSnapshot?) {
        let key = snapshot.map { $0.accountKey + "|" + $0.sessionID }
        if identity != key { identity = key; outcomes = [:]; registered = []; inFlight = nil }
    }
    public func canDecide(_ id: String, allowed: Bool, reachable: Bool) -> Bool {
        reachable && inFlight == nil && !registered.contains(id) && (outcomes[id] == nil || outcomes[id] == allowed)
    }
    public func isRegistered(_ id: String) -> Bool { registered.contains(id) }
    public mutating func begin(_ id: String, allowed: Bool, reachable: Bool) -> Bool {
        guard canDecide(id, allowed: allowed, reachable: reachable) else { return false }
        outcomes[id] = allowed; inFlight = id; return true
    }
    public mutating func finish(_ id: String, registered accepted: Bool) {
        guard inFlight == id else { return }
        if accepted { registered.insert(id) }
        inFlight = nil
    }
}
