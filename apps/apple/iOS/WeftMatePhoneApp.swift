import SwiftUI

@main
struct WeftMatePhoneApp: App {
    @StateObject private var model = AppleAppModel()
    var body: some Scene {
        WindowGroup {
            #if DEBUG && targetEnvironment(simulator)
            if ProcessInfo.processInfo.arguments.contains("--ui-testing") && ProcessInfo.processInfo.arguments.contains("--h1-healthkit-fixture") {
                HealthKitUIFixture()
            } else { WeftMateRootView(model: model) }
            #else
            WeftMateRootView(model: model)
            #endif
        }
    }
}
