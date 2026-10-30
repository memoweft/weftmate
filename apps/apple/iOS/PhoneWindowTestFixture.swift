#if DEBUG && targetEnvironment(simulator)
import SwiftUI

/// Exercises the product memory page with an isolated synthetic computer replica.
struct PhoneWindowTestFixture: View {
    @ObservedObject var app: AppleAppModel
    @State private var ready=false
    @State private var failure: String?
    private var scene: String {
        let args=ProcessInfo.processInfo.arguments
        guard let i=args.firstIndex(of:"--phone-window-scene"),args.indices.contains(i+1) else { return "no-copy" }
        return args[i+1]
    }
    var body: some View {
        Group {
            if ready { NavigationStack { PhoneMemoryWorkspaceView(app:app) } }
            else if let failure { Text(failure).accessibilityIdentifier("phoneWindow.failure") }
            else { ProgressView("准备合成副本…") }
        }.preferredColorScheme(ProcessInfo.processInfo.arguments.contains("dark") ? .dark : .light).task {
            do { try app.seedPhoneWindowFixture(scene:scene);ready=true }
            catch { failure="合成副本准备失败。" }
        }
    }
}
#endif
