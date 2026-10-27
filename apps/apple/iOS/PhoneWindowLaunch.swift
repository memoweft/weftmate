#if WEFTMATE_WINDOW_TEST
import Foundation

/// One installation launch can open the real form without submitting credentials.
@MainActor enum PhoneWindowLaunch {
    private static var presented = false
    private static var installID: String? {
        let args = ProcessInfo.processInfo.arguments
        guard args.contains("--window-manual-login"), let index = args.firstIndex(of: "--window-install-id"),
              args.indices.contains(index + 1), UUID(uuidString: args[index + 1]) != nil else { return nil }
        return args[index + 1]
    }
    static func present(in app: AppleAppModel) {
        guard installID != nil, !presented else { return }
        presented = true
        app.cloudLogin.requireLogin()
    }
    static func recordLoginVisible(server: String) {
        guard presented, let installID,
              let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        let directory = cache.appendingPathComponent("WindowInstall", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
            let payload: [String: Any] = ["loginVisible": true, "installID": installID,
                                          "bundleID": Bundle.main.bundleIdentifier ?? "", "server": server]
            let data = try JSONSerialization.data(withJSONObject: payload)
            try data.write(to: directory.appendingPathComponent("login-visible.json"), options: .atomic)
        } catch { /* Optional local evidence must not interrupt the user's login. */ }
    }
}
#endif
