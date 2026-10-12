import SwiftUI

@main
struct WeftMatePhoneApp: App {
    @UIApplicationDelegateAdaptor(RunLogPhoneDelegate.self) private var logDelegate
    @StateObject private var model = AppleAppModel()
    @StateObject private var health = DailyHealthModel()
    @Environment(\.scenePhase) private var logScenePhase
    @MainActor init() { DailyHealthBackground.register() }
    var body: some Scene {
        WindowGroup {
            #if DEBUG && targetEnvironment(simulator)
            if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--health4-double-model") { Health4BackgroundRegistrationFixture() }
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
        WeftMateRootView(model: model)
            .environmentObject(health)
            // Restored accounts also prepare observers when iOS starts the app in the background.
            .task(id: "health-account-\(model.accountEpoch)-\(model.session?.verification.rawValue ?? "none")") {
                await health.activate(app: model)
            }
            .task(id: "\(model.accountEpoch)-\(logScenePhase)-\(model.session?.verification.rawValue ?? "none")") {
                guard logScenePhase == .active else { return }
                await health.activate(app: model)
            }
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
