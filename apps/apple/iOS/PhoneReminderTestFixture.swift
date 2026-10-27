#if DEBUG && targetEnvironment(simulator)
import SwiftUI
import UIKit
import UserNotifications
import WeftMateCore

/// Isolated credentials and synthetic model config; creation and OS delivery use product code.
struct PhoneReminderTestFixture: View {
    @ObservedObject var app: AppleAppModel
    @State private var ready=false
    @State private var systemStatus=""
    @State private var setupPhase="starting"
    private var dark: Bool { ProcessInfo.processInfo.arguments.contains("--apple11-dark") }
    var body: some View {
        Group {
            if ready {
                PhoneWorkspace(model:app)
                    .modifier(PhoneReminderLifecycle(app:app,phone:app.phoneChat))

            } else { ProgressView("准备提醒检查…") }
        }.preferredColorScheme(dark ? .dark : .light)
            .environment(\.accessibilityReduceMotion, UIAccessibility.isReduceMotionEnabled || ProcessInfo.processInfo.arguments.contains("--ios-ui-reduce-motion"))
            .overlay(alignment:.top) { Text("setup="+setupPhase+" "+systemStatus).font(AppleTokens.Fonts.caption2).accessibilityIdentifier("reminders.systemEvidence") }
            .task {
                await app.start();setupPhase="restored";app.phoneChat.activate(app:app)
                do {
                    if app.phoneChat.models.isEmpty { try app.phoneChat.saveModel(.init(name:"合成模型",baseURL:"https://model.example.invalid/v1",model:"synthetic",apiKey:UUID().uuidString)) }
                    setupPhase="ready";ready=true
                } catch { setupPhase="fixture-failed" }
            }
            .task {
                while !Task.isCancelled {
                    let center=UNUserNotificationCenter.current()
                    let pending=await center.pendingNotificationRequests(),delivered=await center.deliveredNotifications(),settings=await center.notificationSettings()
                    systemStatus="pending=\(pending.count) delivered=\(delivered.count) permission=\(settings.authorizationStatus.rawValue)"
                    do { try await Task.sleep(for:.seconds(1)) } catch { return }
                }
            }
    }
}
#endif
