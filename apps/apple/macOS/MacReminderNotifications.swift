import SwiftUI
import UserNotifications
import WeftMateCore

@MainActor final class MacReminderNotifications: ObservableObject {
    static let shared = MacReminderNotifications()
    @Published var needsPermission = false
    @Published private(set) var deliveryNotice: String?
    @Published private(set) var openedReminder: ReminderRoute?
    @Published private(set) var lastPresented: ReminderNotification?
    private let center: any ReminderNotificationCenter
    private let authorization: () async -> UNAuthorizationStatus
    private let request: () async throws -> Bool
    private let delegate = MacReminderNotificationDelegate()
    private lazy var scheduler = LocalReminderScheduler(center: center)
    private weak var chat: PhoneStandaloneModel?
    private var authorizationFailed = false
    private var promptedAccount: String?
    private var awaitingRoute: ReminderRoute?

    init(center: any ReminderNotificationCenter, authorization: @escaping () async -> UNAuthorizationStatus, request: @escaping () async throws -> Bool) {
        self.center = center; self.authorization = authorization; self.request = request
        delegate.owner = self
    }
    convenience init() {
        let adapter = NativeReminderNotificationCenter()
        self.init(center: adapter, authorization: { await adapter.center.notificationSettings().authorizationStatus }, request: { try await adapter.center.requestAuthorization(options: [.alert, .sound, .badge]) })
        adapter.center.delegate = delegate
    }
    func attach(_ chat: PhoneStandaloneModel) {
        self.chat = chat
        if let route = awaitingRoute { awaitingRoute = nil; open(route) }
    }
    func reconcile() async {
        guard let chat, let identity = chat.reminderSnapshotAccount else { return }
        let status = await authorization()
        guard identity == chat.reminderSnapshotAccount else { await reconcile(); return }
        let authorized = status == .authorized || status == .provisional
        if status == .notDetermined, chat.reminders.contains(where: { !$0.completed && $0.fireAt > Date() }), promptedAccount != identity {
            promptedAccount = identity; needsPermission = true
        }
        let cancellations = chat.reminderCancellations
        do {
            try await scheduler.reconcile(account: identity, reminders: chat.reminders, authorized: authorized, cancellations: cancellations)
            guard identity == chat.reminderSnapshotAccount else { await reconcile(); return }
            try chat.acknowledgeReminderCancellations(Set(cancellations.map(\.id)))
            if authorized { authorizationFailed = false }
            deliveryNotice = status == .denied ? "提醒已保存。请在系统设置里允许 WeftMate 发送通知，才能到点提醒你。" : authorizationFailed ? "通知权限暂时没能开启，请在系统设置里重试。" : nil
        } catch { deliveryNotice = "提醒已保存，通知暂时没排好；稍后会自动重试。" }
    }
    func requestPermission() async {
        needsPermission = false
        promptedAccount = chat?.reminderSnapshotAccount
        do { authorizationFailed = !(try await request()) }
        catch { authorizationFailed = true }
        await reconcile()
    }
    func presented(_ value: ReminderNotification) { lastPresented = value }
    func consumeOpenedReminder() { openedReminder = nil }
    func open(_ route: ReminderRoute) {
        guard chat != nil else { awaitingRoute = route; return }
        guard let account = chat?.reminderSnapshotAccount, route.account == ReminderRoute.accountKey(account) else { return }
        openedReminder = route
    }
}

@MainActor private final class MacReminderNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    weak var owner: MacReminderNotifications?
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        if let data = notification.request.content.userInfo["reminder"] as? Data,
           let value = try? JSONDecoder().decode(ReminderNotification.self, from: data) { await owner?.presented(value) }
        return [.banner, .list, .sound]
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let data = response.notification.request.content.userInfo["reminder"] as? Data,
              let value = try? JSONDecoder().decode(ReminderNotification.self, from: data) else { return }
        await owner?.open(value.route)
    }
}
