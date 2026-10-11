import UIKit

@MainActor final class RunLogPhoneDelegate: NSObject, UIApplicationDelegate {
    func applicationWillTerminate(_ application: UIApplication) {
        // iOS rarely calls this for background reclamation. Best effort only; no main-thread disk I/O.
        let store = RunLogRuntime.shared.store
        Task.detached { await store.exit(reason: "system_termination") }
    }
}
