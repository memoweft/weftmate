import SwiftUI

@main
struct WeftMatePhoneApp: App {
    @UIApplicationDelegateAdaptor(RunLogPhoneDelegate.self) private var logDelegate
    @StateObject private var model: AppleAppModel
    @StateObject private var health = DailyHealthModel()
    @Environment(\.scenePhase) private var logScenePhase
    @MainActor init() {
        let app=AppleAppModel();_model=StateObject(wrappedValue:app)
        DailyHealthBackground.register();PhoneReminderBackground.register();PhoneReminderNotifications.shared.attach(app)
        #if DEBUG && targetEnvironment(simulator)
        PhoneWindowUIFixture.configure(app: app)
        #endif
    }
    var body: some Scene {
        WindowGroup {
            #if DEBUG && targetEnvironment(simulator)
            if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--apple11-fixture") { PhoneReminderTestFixture(app:model) }
            else if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--apple9-fixture") { PhoneServiceScreenshotFixture(app:model) }
            else if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--apple8-fixture") { PhoneAttachmentScreenshotFixture(app:model) }
            else if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--phone-window-fixture") { PhoneWindowTestFixture(app:model) }
            else if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--apple5-addendum") { Apple5AddendumFixture(health:health) }
            else if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--apple5-fixture") { Apple5Fixture(health:health) }
            else if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--apple4-fixture") { Apple4Fixture(health: health) }
            else if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--apple3-fixture") { Apple3Fixture(health:health) }
            else if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--health4-double-model") { Health4BackgroundRegistrationFixture() }
            else if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--health4-fixture") { Health4Fixture(health:health) }
            else if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--h1-healthkit-fixture") {
                HealthKitUIFixture()
            } else { content }
            #else
            content
            #endif
        }
        .onChange(of: logScenePhase) { _, phase in RunLogRuntime.shared.phase(phase) }
    }
    private var healthContent: some View {
        #if WEFTMATE_WINDOW_TEST
        WeftMateRootView(model: model)
            .modifier(PhoneReminderLifecycle(app:model,phone:model.phoneChat))
            .environmentObject(health)
        #else
        WeftMateRootView(model: model)
            .modifier(PhoneReminderLifecycle(app:model,phone:model.phoneChat))
            .environmentObject(health)
            .modifier(PhoneCloudHealthActivation(app:model,cloud:model.cloudLogin,health:health))
            // Restored accounts also prepare observers when iOS starts the app in the background.
            .task(id: "health-account-\(model.accountEpoch)-\(model.session?.verification.rawValue ?? "none")") {
                await health.activate(app: model)
            }
            .task(id: "\(model.accountEpoch)-\(logScenePhase)-\(model.session?.verification.rawValue ?? "none")") {
                guard logScenePhase == .active else { return }
                await health.activate(app: model)
            }
        #endif
    }
    @ViewBuilder private var content: some View {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--diag3-fixture") { DIAG3TestHost(model: model).environmentObject(health) }
        else { healthContent }
        #else
        healthContent
        #endif
    }
}

private struct PhoneCloudHealthActivation: ViewModifier {
    @ObservedObject var app: AppleAppModel
    @ObservedObject var cloud: CloudLoginModel
    @ObservedObject var health: DailyHealthModel
    func body(content: Content) -> some View {
        content.task(id:cloud.subject) { await health.activate(app:app) }
    }
}
