import Foundation
import UserNotifications
import WeftMateCore

/// The same native queue adapter is used by iPhone and Mac.
@MainActor final class NativeReminderNotificationCenter: ReminderNotificationCenter {
    let center = UNUserNotificationCenter.current()
    func pending() async -> [ReminderNotification] {
        await center.pendingNotificationRequests().compactMap { request in
            guard request.identifier.hasPrefix(ReminderNotification.prefix), let data = request.content.userInfo["reminder"] as? Data else { return nil }
            return try? JSONDecoder().decode(ReminderNotification.self, from: data)
        }
    }
    func otherPendingCount() async -> Int { await center.pendingNotificationRequests().filter { !$0.identifier.hasPrefix(ReminderNotification.prefix) }.count }
    func remove(_ identifiers: [String]) { center.removePendingNotificationRequests(withIdentifiers: identifiers) }
    func deliveredNotifications() async -> [ReminderNotification] {
        await center.deliveredNotifications().compactMap { item in
            guard item.request.identifier.hasPrefix(ReminderNotification.prefix), let data = item.request.content.userInfo["reminder"] as? Data else { return nil }
            return try? JSONDecoder().decode(ReminderNotification.self, from: data)
        }
    }
    func removeDelivered(_ identifiers: [String]) { center.removeDeliveredNotifications(withIdentifiers: identifiers) }
    func add(_ notification: ReminderNotification) async throws {
        let content = UNMutableNotificationContent()
        content.title = "提醒"; content.body = notification.text; content.sound = .default
        content.userInfo = ["reminder": try JSONEncoder().encode(notification)]
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        var components = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: notification.fireAt)
        components.calendar = calendar; components.timeZone = calendar.timeZone
        try await center.add(UNNotificationRequest(identifier: notification.identifier, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false)))
    }
}
