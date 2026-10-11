import SwiftUI

@main
struct WeftMateWatchApp: App {
    @Environment(\.scenePhase) private var logScenePhase
    var body: some Scene {
        WindowGroup { WatchHomeView().task { await RunLogRuntime.shared.ready() } }
        .onChange(of: logScenePhase) { _, phase in RunLogRuntime.shared.phase(phase) }
    }
}
