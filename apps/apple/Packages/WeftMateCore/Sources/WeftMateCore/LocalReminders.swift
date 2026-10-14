import Foundation
import CryptoKit

public struct LocalReminder: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var text: String
    public var fireAt: Date
    public var sessionID: String?
    public var hostID: String?
    public var completed: Bool
    public init(id: String = UUID().uuidString, text: String, fireAt: Date, sessionID: String? = nil, hostID: String? = nil, completed: Bool = false) {
        self.id=id; self.text=text; self.fireAt=fireAt; self.sessionID=sessionID; self.hostID=hostID; self.completed=completed
    }
    public static func schedules(_ rows: [ManagedSchedule], hostID: String) -> [Self] {
        rows.compactMap { row in
            guard row.state == "scheduled", let at=row.nextRunAt, let date=ReminderDate.parse(at) else { return nil }
            return .init(id:row.identity,text:row.text,fireAt:date,sessionID:row.sessionId,hostID:hostID)
        }
    }
}
public enum ReminderDate {
    public static func parse(_ value: String) -> Date? {
        let formatter=ISO8601DateFormatter(); formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        return formatter.date(from:value) ?? ISO8601DateFormatter().date(from:value)
    }
}
public struct ReminderRoute: Codable, Equatable, Sendable {
    public let account: String
    public let reminderID: String
    public let sessionID: String?
    public let hostID: String?
    public init(account: String, reminder: LocalReminder) {
        self.account=Self.accountKey(account); reminderID=reminder.id; sessionID=reminder.sessionID; hostID=reminder.hostID
    }
    public static func accountKey(_ identity: String) -> String { SHA256.hash(data:Data(identity.utf8)).map { String(format:"%02x",$0) }.joined() }
}
public struct ReminderNotification: Codable, Equatable, Sendable {
    public static let prefix="weftmate.reminder."
    public let identifier: String
    public let text: String
    public let fireAt: Date
    public let route: ReminderRoute
    public init(account: String, reminder: LocalReminder) {
        route = .init(account:account,reminder:reminder); text=reminder.text; fireAt=reminder.fireAt
        identifier=Self.prefix+ReminderRoute.accountKey(route.account+"|"+(reminder.hostID ?? "phone")+"|"+reminder.id)
    }
}
@MainActor public protocol ReminderNotificationCenter {
    func pending() async -> [ReminderNotification]
    func otherPendingCount() async -> Int
    func remove(_ identifiers: [String])
    func deliveredNotifications() async -> [ReminderNotification]
    func removeDelivered(_ identifiers: [String])
    func add(_ notification: ReminderNotification) async throws
}
/// Reconciles with the OS queue, including after process restart or delivery.
/// One worker drains the latest snapshot so an older suspended add cannot win over a deletion.
@MainActor public final class LocalReminderScheduler {
    private let center: any ReminderNotificationCenter
    private let now: () -> Date
    private var desired: [ReminderNotification]=[]
    private var accountKey=""
    private var cancellations: [ReminderCancellation]=[]
    private var manuallyCompleted=Set<String>()
    private var revision=0
    private var worker: Task<Void,Error>?
    public init(center: any ReminderNotificationCenter, now: @escaping () -> Date = Date.init) { self.center=center; self.now=now }
    public func reconcile(account: String, reminders: [LocalReminder], authorized: Bool = true, cancellations: [ReminderCancellation] = []) async throws {
        let active=reminders.filter { !$0.completed }.map { ReminderNotification(account:account,reminder:$0) }
        accountKey=ReminderRoute.accountKey(account);self.cancellations=cancellations
        manuallyCompleted=Set(reminders.filter(\.completed).map { ReminderNotification(account:account,reminder:$0).identifier })
        desired=authorized ? active.filter { $0.fireAt > now() }.sorted { $0.fireAt == $1.fireAt ? $0.identifier < $1.identifier : $0.fireAt < $1.fireAt } : []
        revision += 1
        if let worker { try await worker.value; return }
        let work=Task {
            do { try await self.drain();self.worker=nil }
            catch { self.worker=nil;throw error }
        }; worker=work
        try await work.value
    }
    private func drain() async throws {
        while true {
            let version=revision
            let pending=await center.pending(), other=await center.otherPendingCount(), delivered=await center.deliveredNotifications()
            guard version == revision else { continue }
            let nearest=Array(desired.filter { $0.fireAt > now() }.prefix(max(0,64-other)))
            let ids=Set(nearest.map(\.identifier))
            center.remove(pending.filter { !ids.contains($0.identifier) }.map(\.identifier))
            let withdrawn=delivered.filter { item in
                item.route.account != accountKey || manuallyCompleted.contains(item.identifier) || cancellations.contains { $0.matches(item) }
            }
            center.removeDelivered(withdrawn.map(\.identifier))
            var failure: (any Error)?
            for item in nearest where !pending.contains(item) {
                guard version == revision else { break }
                do { try await center.add(item) } catch { failure=error }
            }
            if version != revision { continue }
            if let failure { throw failure }
            return
        }
    }
}
/// Explicit phone reminder commands never rely on a model promising an uncreated reminder.
public enum PhoneReminderCommand {
    public static func parse(_ text: String, now: Date = Date(), calendar: Calendar = .current) -> (text: String, date: Date)? {
        guard let range=text.range(of:"提醒我"), !text[range.upperBound...].trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else { return nil }
        let time=String(text[..<range.lowerBound]).trimmingCharacters(in:.whitespacesAndNewlines)
        let body=String(text[range.upperBound...]).trimmingCharacters(in:.whitespacesAndNewlines)
        func groups(_ pattern: String) -> [String]? {
            guard let regex=try? NSRegularExpression(pattern:pattern),let match=regex.firstMatch(in:time,range:NSRange(time.startIndex...,in:time)) else { return nil }
            return (1..<match.numberOfRanges).map { Range(match.range(at:$0),in:time).map { String(time[$0]) } ?? "" }
        }
        if let parts=groups("^([0-9]+)\\s*(分钟|小时|秒|天)后$"),let amount=Double(parts[0]), amount > 0 {
            let date: Date
            if parts[1] == "天" { guard let days=Int(exactly:amount),let next=calendar.date(byAdding:.day,value:days,to:now) else { return nil }; date=next }
            else { date=now.addingTimeInterval(amount * (parts[1] == "小时" ? 3600 : parts[1] == "分钟" ? 60 : 1)) }
            guard date.timeIntervalSince1970.isFinite else { return nil };return (body,date)
        }
        if let parts=groups("^(今天|明天|后天)?\\s*(上午|下午|晚上)?\\s*([0-9]{1,2})\\s*(?:点|:|：)\\s*([0-9]{1,2})?\\s*(半|分)?$"),let hour=Int(parts[2]) {
            let minute=parts[4] == "半" ? 30 : Int(parts[3]) ?? 0
            guard (0...23).contains(hour),(0...59).contains(minute),parts[4] != "半" || parts[3].isEmpty else { return nil }
            let h=(parts[1] == "下午" || parts[1] == "晚上") && hour < 12 ? hour+12 : hour
            let offset=parts[0] == "明天" ? 1 : parts[0] == "后天" ? 2 : 0
            guard let day=calendar.date(byAdding:.day,value:offset,to:now),let date=calendar.date(bySettingHour:h,minute:minute,second:0,of:day),date > now,
                  calendar.component(.hour,from:date) == h else { return nil }
            return (body,date)
        }
        return nil
    }
}
