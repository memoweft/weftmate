import SwiftUI

@main
struct WeftMatePhoneApp: App {
    @UIApplicationDelegateAdaptor(RunLogPhoneDelegate.self) private var logDelegate
    @StateObject private var model = AppleAppModel()
    @Environment(\.scenePhase) private var logScenePhase
    var body: some Scene {
        WindowGroup {
            #if DEBUG && targetEnvironment(simulator)
            if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--h1-healthkit-fixture") {
                HealthKitUIFixture()
            } else { content }
            #else
            content
            #endif
        }
        .onChange(of: logScenePhase) { _, phase in RunLogRuntime.shared.phase(phase) }
    }
    @ViewBuilder private var content: some View {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-testing"), ProcessInfo.processInfo.arguments.contains("--diag3-fixture") { DIAG3TestHost(model: model) }
        else { WeftMateRootView(model: model) }
        #else
        WeftMateRootView(model: model)
        #endif
    }
}
