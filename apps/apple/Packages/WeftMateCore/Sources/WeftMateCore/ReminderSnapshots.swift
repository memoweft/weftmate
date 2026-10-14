import Foundation

/// A missing subject is a local workspace only after the local credential read succeeded.
public enum ReminderAccountIdentity {
    public static func resolve(subject: String?, issuer: String, restored: Bool) -> String? {
        guard restored else { return nil }
        return subject.map { issuer+"|"+$0 } ?? "device-local"
    }
}
public struct ReminderReadToken: Codable, Equatable, Sendable {
    public let mutation: UUID
    public let request: UUID
    public init(mutation: UUID = UUID(), request: UUID = UUID()) { self.mutation=mutation;self.request=request }
}
/// Persist explicit withdrawals until the OS has been reconciled, including after restart.
public struct ReminderCancellation: Codable, Equatable, Identifiable, Sendable {
    public enum Target: Codable, Equatable, Sendable {
        case reminder(id: String, hostID: String?)
        case computer(hostID: String)
        case account
    }
    public let id: UUID
    public let target: Target
    public init(_ target: Target) { self.id=UUID();self.target=target }
    public func matches(_ notification: ReminderNotification) -> Bool {
        switch target {
        case .reminder(let id,let host): notification.route.reminderID == id && notification.route.hostID == host
        case .computer(let host): notification.route.hostID == host
        case .account: true
        }
    }
}
extension PhoneChatState {
    public mutating func beginReminderRead(hostID: String) -> ReminderReadToken {
        let token=ReminderReadToken(mutation:reminderReads?[hostID]?.mutation ?? UUID())
        if reminderReads == nil { reminderReads=[:] };reminderReads?[hostID]=token
        return token
    }
    private mutating func invalidateReminderReads(hostID: String) {
        if reminderReads == nil { reminderReads=[:] };reminderReads?[hostID]=ReminderReadToken()
    }
    public mutating func cancelReminder(_ target: ReminderCancellation.Target) {
        if reminderCancellations == nil { reminderCancellations=[] };reminderCancellations?.append(.init(target))
    }
    public mutating func acknowledgeReminderCancellations(_ ids: Set<UUID>) { reminderCancellations?.removeAll { ids.contains($0.id) } }
    @discardableResult public mutating func receiveReminders(_ rows: [ManagedSchedule],hostID: String,read: ReminderReadToken) -> Bool {
        guard reminderReads?[hostID] == read else { return false }
        let identities=Set(rows.map(\.identity))
        // A completed row remains in the authoritative list: normal delivery is not deletion.
        for previous in computerReminders?[hostID] ?? [] where !identities.contains(previous.id) {
            cancelReminder(.reminder(id:previous.id,hostID:hostID))
        }
        let paused=Set(rows.filter { $0.state == "paused" }.map(\.identity))
        for id in paused.subtracting(pausedReminderIDs?[hostID] ?? []) { cancelReminder(.reminder(id:id,hostID:hostID)) }
        if pausedReminderIDs == nil { pausedReminderIDs=[:] };pausedReminderIDs?[hostID]=paused
        if computerReminders == nil { computerReminders=[:] }
        computerReminders?[hostID]=LocalReminder.schedules(rows,hostID:hostID)
        return true
    }
    public mutating func withdrawComputerReminder(_ row: ManagedSchedule,hostID: String,action: ScheduleAction = .delete) {
        invalidateReminderReads(hostID:hostID)
        if action != .resume { computerReminders?[hostID]?.removeAll { $0.id == row.identity } }
        if action == .pause {
            if pausedReminderIDs == nil { pausedReminderIDs=[:] }
            if pausedReminderIDs?[hostID] == nil { pausedReminderIDs?[hostID]=[] }
            pausedReminderIDs?[hostID]?.insert(row.identity)
        } else { pausedReminderIDs?[hostID]?.remove(row.identity) }
        if action == .pause || action == .delete { cancelReminder(.reminder(id:row.identity,hostID:hostID)) }
    }
    public mutating func removeComputerReminders(hostID: String) {
        reminderReads?[hostID]=nil;pausedReminderIDs?[hostID]=nil
        cancelReminder(.computer(hostID:hostID));computerReminders?[hostID]=nil
    }
}
