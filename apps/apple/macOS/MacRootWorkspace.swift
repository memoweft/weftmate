import SwiftUI
import WeftMateCore

/// Connection changes only change presentation. The local controller keeps its lifetime.
struct MacRootWorkspace: View {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var cloud: CloudLoginModel
    @StateObject private var chat: PhoneStandaloneModel
    @ObservedObject private var notifications = MacReminderNotifications.shared
    @State private var showLocal = false
    @Environment(\.scenePhase) private var phase
    @Environment(\.colorScheme) private var scheme
    private var localVisible: Bool { showLocal || (app.session == nil && (!cloud.authenticated || cloud.useLocalWorkspace)) }

    init(app: AppleAppModel, cloud: CloudLoginModel) {
        self.app = app; self.cloud = cloud
        #if DEBUG
        _chat = StateObject(wrappedValue: MacStandaloneReview.makeModel())
        #else
        _chat = StateObject(wrappedValue: PhoneStandaloneModel())
        #endif
    }
    var body: some View {
        VStack(spacing: 0) {
            if app.session != nil {
                HStack {
                    Button(localVisible ? "回到电脑上的对话" : "这台 Mac 上的对话") { showLocal.toggle() }
                        .buttonStyle(MacStandaloneActionStyle())
                        .accessibilityLabel(localVisible ? "回到电脑上的对话" : "这台 Mac 上的对话")
                        .accessibilityIdentifier(localVisible ? "macChat.openComputer" : "macChat.openLocal")
                        .accessibilityAction { showLocal.toggle() }
                    Spacer()
                }.padding(.horizontal, AppleTokens.Space.p12).padding(.vertical, AppleTokens.Space.p4)
                    .background(ServiceControlPalette(dark: scheme == .dark).canvas)
            }
            ZStack {
                MacStandaloneWorkspace(app: app, cloud: cloud, chat: chat)
                    .opacity(localVisible ? 1 : 0).allowsHitTesting(localVisible).accessibilityHidden(!localVisible)
                if let session = app.session {
                    OfflineWorkspace(app: app, model: app.offline).id(session.account.ownerId)
                        .opacity(localVisible ? 0 : 1).allowsHitTesting(!localVisible).accessibilityHidden(localVisible)
                } else if cloud.authenticated {
                    CloudAccountHome(app: app, cloud: cloud)
                        .opacity(localVisible ? 0 : 1).allowsHitTesting(!localVisible).accessibilityHidden(localVisible)
                }
            }
            if let notice = notifications.deliveryNotice {
                Text(notice).font(AppleTokens.Fonts.callout).foregroundStyle(ServiceControlPalette(dark: scheme == .dark).muted)
                    .padding(AppleTokens.Space.p12).accessibilityIdentifier("macReminders.notice")
            }
        }.accessibilityElement(children: .contain).accessibilityIdentifier("macRootWorkspace")
        .task(id: app.phoneAccountIdentity) {
            chat.activate(app: app); notifications.attach(chat); await notifications.reconcile()
        }
        .task(id: phase) {
            guard phase == .active else { return }
            while !Task.isCancelled {
                await notifications.reconcile()
                do { try await Task.sleep(for: .seconds(15)) } catch { return }
            }
        }
        .onChange(of: chat.allReminders) { _, _ in Task { await notifications.reconcile() } }
        .onChange(of: chat.reminderCancellations) { _, _ in Task { await notifications.reconcile() } }
        .onChange(of: notifications.openedReminder) { _, _ in openReminder() }
        .onChange(of: chat.busy) { _, busy in if !busy { openReminder() } }
        .alert("允许到点提醒你吗？", isPresented: $notifications.needsPermission) {
            Button("允许通知") { Task { await notifications.requestPermission() } }
            Button("以后再说", role: .cancel) {}
        } message: { Text("开启后，提醒到点会在这台 Mac 上显示。") }
        #if DEBUG
        .task {
            if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--apple12-fix1-notification") {
                await MacReminderReview.run(app: app, chat: chat, notifications: notifications)
            }
        }
        #endif
    }
    private func openReminder() {
        guard let route = notifications.openedReminder, route.account == ReminderRoute.accountKey(app.phoneAccountIdentity) else { return }
        showLocal = true
        guard !chat.busy else { return }
        if let id = route.sessionID, chat.state.selected != id, chat.state.threads.contains(where: { $0.id == id }) { chat.select(id) }
        notifications.consumeOpenedReminder()
    }
}
