import SwiftUI
import UserNotifications
import BackgroundTasks
import WeftMateCore

/// Installed before launch completes; forwarding to Watch is owned by the OS.
private final class ReminderNotificationDelegate: NSObject, UNUserNotificationCenterDelegate, Sendable {
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        Task { @MainActor in await PhoneReminderNotifications.shared.reconcile() }
        return [.banner,.list,.sound]
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let data=response.notification.request.content.userInfo["reminder"] as? Data,
              let value=try? JSONDecoder().decode(ReminderNotification.self,from:data) else { return }
        await PhoneReminderNotifications.shared.open(value.route)
    }
}
@MainActor final class PhoneReminderNotifications: ObservableObject {
    static let shared=PhoneReminderNotifications()
    static let refreshID="com.weftmate.apple.local-reminders"
    @Published var needsPermission=false
    @Published private(set) var denied=false
    @Published private(set) var notificationsEnabled=false
    @Published private(set) var deliveryNotice: String?
    @Published var openedReminder: ReminderRoute?
    private(set) var opensConversation=false
    private let adapter=NativeReminderNotificationCenter()
    private let delegate=ReminderNotificationDelegate()
    private lazy var scheduler=LocalReminderScheduler(center:adapter)
    private weak var app: AppleAppModel?
    private var awaitingRoute: ReminderRoute?
    private var active=false
    private var promptShown: Bool {
        get { UserDefaults.standard.bool(forKey:"local-reminders.explanation-shown") }
        set { UserDefaults.standard.set(newValue,forKey:"local-reminders.explanation-shown") }
    }
    func install() { adapter.center.delegate=delegate }
    func attach(_ app: AppleAppModel) { self.app=app;install() }
    func setActive(_ value: Bool) {
        active=value
        if !value { scheduleRefresh() }
    }
    func reconcile() async {
        guard let app else { return }
        if app.phoneReminderAccountIdentity == nil, !app.restoring { await app.cloudLogin.restoreLocalIdentity() }
        guard let identity=app.phoneReminderAccountIdentity else { return }
        app.phoneChat.activate(app:app)
        guard app.phoneChat.reminderSnapshotAccount == identity else { return }
        let settings=await adapter.center.notificationSettings()
        guard identity == app.phoneReminderAccountIdentity else { await reconcile();return }
        denied=settings.authorizationStatus == .denied
        let authorized=[UNAuthorizationStatus.authorized,.provisional,.ephemeral].contains(settings.authorizationStatus)
        notificationsEnabled=authorized
        let rows=app.phoneChat.allReminders
        if active,settings.authorizationStatus == .notDetermined,rows.contains(where:{!$0.completed && $0.fireAt > Date()}),!promptShown {
            promptShown=true;needsPermission=true
        }
        let cancellations=app.phoneChat.reminderCancellations
        do {
            try await scheduler.reconcile(account:identity,reminders:rows,authorized:authorized,cancellations:cancellations+app.phoneChat.pausedReminderCancellations)
            if identity == app.phoneReminderAccountIdentity { try app.phoneChat.acknowledgeReminderCancellations(Set(cancellations.map(\.id))) }
            deliveryNotice=nil
        }
        catch { deliveryNotice="提醒已保存，通知暂时没排好；打开 App 后会重试。" }
        scheduleRefresh()
        if let route=awaitingRoute { awaitingRoute=nil;await open(route) }
    }
    func requestPermission() async {
        needsPermission=false
        do { _=try await adapter.center.requestAuthorization(options:[.alert,.sound,.badge]) }
        catch { deliveryNotice="通知权限暂时没能开启，请在系统设置里重试。" }
        await reconcile()
    }
    func readComputer() async {
        guard let app,let session=app.session,session.verification == .verified else { return }
        guard let identity=app.phoneReminderAccountIdentity else { return }
        app.phoneChat.activate(app:app)
        guard app.phoneChat.reminderSnapshotAccount == identity else { return }
        let epoch=app.accountEpoch,host=session.hostId,read=app.phoneChat.beginReminderRead(hostID:session.hostId)
        do {
            let reply=try await app.assistantClient.settingsSchedules()
            guard epoch == app.accountEpoch,identity == app.phoneAccountIdentity,host == app.session?.hostId,!Task.isCancelled else { return }
            if try app.phoneChat.receiveReminders(reply.items,hostID:host,read:read) { await reconcile() }
        } catch { /* Keep the last authenticated snapshot while offline. */ }
    }
    func foregroundLoop() async {
        while !Task.isCancelled {
            await reconcile();await readComputer()
            do { try await Task.sleep(for:.seconds(15)) } catch { return }
        }
    }
    func open(_ route: ReminderRoute) async {
        guard let app else { awaitingRoute=route;return }
        if app.restoring || app.phoneReminderAccountIdentity == nil { awaitingRoute=route;return }
        guard route.account == ReminderRoute.accountKey(app.phoneAccountIdentity) else { return }
        app.phoneChat.activate(app:app)
        opensConversation=false
        if route.hostID == nil,!app.phoneChat.busy,(app.session == nil || app.phoneChat.usesPhoneMemory),let session=route.sessionID,app.phoneChat.state.threads.contains(where:{$0.id == session}) {
            app.phoneChat.select(session);app.openedSessionID=session;opensConversation=true
        } else if let host=route.hostID,host == app.session?.hostId,let session=route.sessionID {
            app.openedSessionID=session;opensConversation=true
        }
        openedReminder=route
    }

    func scheduleRefresh() {
        #if !WEFTMATE_WINDOW_TEST
        guard let app,let identity=app.phoneReminderAccountIdentity,app.phoneChat.reminderSnapshotAccount == identity else { return }
        let dates=app.phoneChat.allReminders.filter { !$0.completed && $0.fireAt > Date() }.map(\.fireAt).sorted()
        guard let first=dates.first else { BGTaskScheduler.shared.cancel(taskRequestWithIdentifier:Self.refreshID);return }
        let request=BGAppRefreshTaskRequest(identifier:Self.refreshID);request.earliestBeginDate=first.addingTimeInterval(1)
        try? BGTaskScheduler.shared.submit(request)
        #endif
    }
    func runBackground() async -> Bool {
        guard app != nil else { return false }
        await reconcile();await readComputer();return !Task.isCancelled && deliveryNotice == nil
    }
}

struct PhoneReminderLifecycle: ViewModifier {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var phone: PhoneStandaloneModel
    @ObservedObject private var notifications=PhoneReminderNotifications.shared
    @Environment(\.scenePhase) private var phase
    func body(content: Content) -> some View {
        content
            .task(id:app.phoneReminderAccountIdentity) { notifications.attach(app);await notifications.reconcile() }
            .task(id:"reminders-\(phase)-\(app.accountEpoch)") {
                notifications.setActive(phase == .active)
                if phase == .active { await notifications.foregroundLoop() }
            }
            .onChange(of:phone.allReminders) { _,_ in Task { await notifications.reconcile() } }
            .onChange(of:phone.reminderCancellations) { _,_ in Task { await notifications.reconcile() } }
            .alert("允许到点提醒你吗？",isPresented:$notifications.needsPermission) {
                Button("允许通知") { Task { await notifications.requestPermission() } }
                Button("以后再说",role:.cancel) {}
            } message: { Text("开启通知后，提醒到点会在手机或配对的手表上显示。") }
    }
}

private final class ReminderBackgroundCompletion: @unchecked Sendable {
    let task: BGTask
    private let lock=NSLock()
    private var finished=false
    init(_ task: BGTask) { self.task=task }
    func finish(_ success: Bool) {
        lock.lock();guard !finished else { lock.unlock();return };finished=true;lock.unlock()
        task.expirationHandler=nil;task.setTaskCompleted(success:success)
    }
}
private enum ReminderBackgroundCallbacks {
    nonisolated static func launch() -> @Sendable (BGTask) -> Void {
        { @Sendable task in
            let owner=ReminderBackgroundCompletion(task)
            let work=Task { @MainActor in owner.finish(await PhoneReminderNotifications.shared.runBackground()) }
            task.expirationHandler=expiration(owner:owner,work:work)
        }
    }
    nonisolated static func expiration(owner: ReminderBackgroundCompletion, work: Task<Void,Never>) -> @Sendable () -> Void {
        { @Sendable in work.cancel();owner.finish(false) }
    }
}
@MainActor enum PhoneReminderBackground {
    private static var registered=false
    static func register() {
        #if !WEFTMATE_WINDOW_TEST
        guard !registered else { return };registered=true
        _=BGTaskScheduler.shared.register(forTaskWithIdentifier:PhoneReminderNotifications.refreshID,using:nil,launchHandler:ReminderBackgroundCallbacks.launch())
        #endif
    }
}
